import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  applyAwards,
  createRound,
  LAST_CHANCE_SECONDS,
  recordVote,
  rememberWord,
  resolveLastChance,
  resolveRound,
  validateSetup,
  migrateSettings,
} from "./game";
import type { Outcome, Player, Round, Settings } from "./game";
import { loadRecentWords, saveRecentWords } from "./recentWords";
import {
  emptyHistory,
  HISTORY_LIMIT,
  historyView,
  recordCompletedGame,
} from "./history";
import type { SavedGameHistory } from "./history";

const LOCAL_PARTY_KEY = "ko-ho-local-party-v1";

export function localRosterSignature(names: string[]): string {
  return JSON.stringify(names.map((name) => name.trim().toLowerCase()));
}

function loadLocalHistory(names: string[]): SavedGameHistory {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_PARTY_KEY) ?? "null");
    if (
      saved?.version !== 1 ||
      saved.rosterSignature !== localRosterSignature(names) ||
      !Array.isArray(saved.history?.games) ||
      saved.history.games.length > HISTORY_LIMIT ||
      !Number.isSafeInteger(saved.history.completedGames) ||
      saved.history.completedGames < saved.history.games.length
    ) return emptyHistory();
    let history = emptyHistory();
    for (const game of [...saved.history.games].reverse()) {
      const settings = migrateSettings(game.settings);
      if (!settings || !Array.isArray(game.players)) return emptyHistory();
      if (validateSetup(game.players.map((player: Player) => player.name), settings))
        return emptyHistory();
      // Rebuild through the shared helper: no untrusted extra fields survive.
      history = recordCompletedGame(
        history, game.gameId, game.players, settings, game.completedAt,
      );
    }
    if (history.games.length !== saved.history.games.length) return emptyHistory();
    return { ...history, completedGames: saved.history.completedGames };
  } catch {
    return emptyHistory();
  }
}

export interface Match {
  gameId: string;
  players: Player[];
  settings: Settings;
  round: Round;
  usedWordIds: string[];
}

type State =
  | { phase: "setup"; recentWordIds: string[] }
  | { phase: "role"; match: Match; index: number; revealed: boolean }
  | { phase: "clue"; match: Match; index: number }
  | { phase: "discussion"; match: Match }
  | { phase: "vote"; match: Match; index: number; revealed: boolean }
  | { phase: "guess"; match: Match; revealed: boolean; deadline: number }
  | { phase: "result"; match: Match; outcome: Outcome }
  | { phase: "final"; match: Match };

type Action =
  | { type: "START"; names: string[]; settings: Settings }
  | { type: "REVEAL" }
  | { type: "HIDE" }
  | { type: "NEXT_ROLE" }
  | { type: "NEXT_CLUE" }
  | { type: "VOTE" }
  | { type: "CAST"; suspectId: string }
  | { type: "GUESS"; guess: string }
  | { type: "SKIP_GUESS" }
  | { type: "GUESS_TIMEOUT" }
  | { type: "CONTINUE" }
  | { type: "RESET" }
  | { type: "END_PARTY" }
  | { type: "ROSTER"; names: string[] };

interface Transition {
  action: Action;
  expectedRevision: number;
  now: number;
  startedMatch?: Match;
  nextRound?: Round;
}

function finishRound(match: Match, outcome: Outcome): State {
  return {
    phase: "result",
    match: { ...match, players: applyAwards(match.players, outcome) },
    outcome,
  };
}

function reduceScreen(state: State, transition: Transition): State {
  const { action, now } = transition;
  if (action.type === "RESET" || action.type === "END_PARTY") {
    return {
      phase: "setup",
      recentWordIds:
        state.phase === "setup" ? state.recentWordIds : state.match.usedWordIds,
    };
  }
  if (action.type === "START" && state.phase === "setup") {
    if (!transition.startedMatch) return state;
    return {
      phase: "role",
      index: 0,
      revealed: false,
      match: transition.startedMatch,
    };
  }
  if (
    action.type === "REVEAL" &&
    (state.phase === "role" ||
      state.phase === "vote" ||
      state.phase === "guess")
  )
    return { ...state, revealed: true };
  if (
    action.type === "HIDE" &&
    (state.phase === "role" ||
      state.phase === "vote" ||
      state.phase === "guess")
  )
    return state.revealed ? { ...state, revealed: false } : state;
  if (action.type === "NEXT_ROLE" && state.phase === "role" && state.revealed) {
    return state.index + 1 < state.match.players.length
      ? { ...state, index: state.index + 1, revealed: false }
      : { phase: "clue", index: 0, match: state.match };
  }
  if (action.type === "NEXT_CLUE" && state.phase === "clue") {
    const turns = state.match.players.length * state.match.settings.clueCycles;
    return state.index + 1 < turns
      ? { ...state, index: state.index + 1 }
      : { phase: "discussion", match: state.match };
  }
  if (action.type === "VOTE" && state.phase === "discussion")
    return { phase: "vote", match: state.match, index: 0, revealed: false };
  if (action.type === "CAST" && state.phase === "vote" && state.revealed) {
    const { players, round } = state.match;
    const voter = players[state.index];
    if (
      voter.id === action.suspectId ||
      !players.some((player) => player.id === action.suspectId)
    )
      return state;
    const updatedRound = recordVote(round, players, voter.id, action.suspectId);
    const match = { ...state.match, round: updatedRound };
    if (state.index + 1 < players.length)
      return { phase: "vote", match, index: state.index + 1, revealed: false };
    const outcome = resolveRound(updatedRound, players);
    if (match.settings.lastChanceGuess && outcome.caught) {
      return {
        phase: "guess",
        match,
        revealed: false,
        deadline: now + LAST_CHANCE_SECONDS * 1000,
      };
    }
    return finishRound(match, outcome);
  }
  if (
    state.phase === "guess" &&
    (action.type === "GUESS" ||
      action.type === "SKIP_GUESS" ||
      action.type === "GUESS_TIMEOUT")
  ) {
    const expired = now >= state.deadline;
    if (action.type === "GUESS_TIMEOUT" && !expired) return state;
    if (action.type === "GUESS" && !expired) {
      if (!state.revealed || !action.guess.trim() || action.guess.length > 80)
        return state;
    }
    const guess = action.type === "GUESS" && !expired ? action.guess : null;
    return finishRound(
      state.match,
      resolveLastChance(state.match.round, state.match.players, guess),
    );
  }
  if (action.type === "CONTINUE" && state.phase === "result") {
    if (state.match.round.number === state.match.settings.rounds)
      return { phase: "final", match: state.match };
    if (!transition.nextRound) return state;
    return {
      phase: "role",
      index: 0,
      revealed: false,
      match: {
        ...state.match,
        round: transition.nextRound,
        usedWordIds: rememberWord(
          state.match.usedWordIds,
          transition.nextRound.word.id,
        ),
      },
    };
  }
  return state;
}

interface Store {
  screen: State;
  revision: number;
  rosterSignature: string;
  gameHistory: SavedGameHistory;
}

function reducer(store: Store, transition: Transition): Store {
  // Ignore a second tap or a timer callback from an earlier rendered turn.
  if (transition.expectedRevision !== store.revision) return store;
  if (transition.action.type === "ROSTER") {
    if (store.screen.phase !== "setup") return store;
    const signature = localRosterSignature(transition.action.names);
    return signature === store.rosterSignature
      ? store
      : {
          ...store,
          rosterSignature: signature,
          gameHistory: emptyHistory(),
          revision: store.revision + 1,
        };
  }
  const screen = reduceScreen(store.screen, transition);
  if (screen === store.screen) return store;
  let gameHistory = transition.action.type === "END_PARTY"
    ? emptyHistory()
    : store.gameHistory;
  let rosterSignature = store.rosterSignature;
  if (transition.action.type === "START") {
    rosterSignature = localRosterSignature(transition.action.names);
    if (rosterSignature !== store.rosterSignature) gameHistory = emptyHistory();
  }
  if (screen.phase === "final") {
    gameHistory = recordCompletedGame(
      gameHistory,
      screen.match.gameId,
      screen.match.players,
      screen.match.settings,
      transition.now,
    );
  }
  return { screen, rosterSignature, gameHistory, revision: store.revision + 1 };
}

export function useGame(initialNames: string[]) {
  const [store, send] = useReducer(reducer, undefined, (): Store => ({
    screen: { phase: "setup", recentWordIds: loadRecentWords() },
    revision: 0,
    rosterSignature: localRosterSignature(initialNames),
    gameHistory: loadLocalHistory(initialNames),
  }));
  const state = store.screen;
  const dispatch = useCallback(
    (action: Action) => {
      const transition: Transition = {
        action,
        expectedRevision: store.revision,
        now: Date.now(),
      };
      if (action.type === "START" && state.phase === "setup") {
        if (validateSetup(action.names, action.settings)) return;
        const players = action.names.map((name, index) => ({
          id: `player-${index}`,
          name: name.trim(),
          score: 0,
        }));
        const round = createRound(
          players,
          action.settings,
          1,
          state.recentWordIds,
        );
        transition.startedMatch = {
          // getRandomValues also works on trusted-LAN HTTP development URLs.
          gameId: Array.from(
            crypto.getRandomValues(new Uint32Array(4)),
            (value) => value.toString(16).padStart(8, "0"),
          ).join(""),
          players,
          settings: action.settings,
          round,
          usedWordIds: rememberWord(state.recentWordIds, round.word.id),
        };
      }
      if (
        action.type === "CONTINUE" &&
        state.phase === "result" &&
        state.match.round.number < state.match.settings.rounds
      ) {
        transition.nextRound = createRound(
          state.match.players,
          state.match.settings,
          state.match.round.number + 1,
          state.match.usedWordIds,
        );
      }
      send(transition);
    },
    [state, store.revision],
  );

  const match = "match" in state ? state.match : null;
  const chosenRoundKey = match ? `${match.gameId}:${match.round.number}` : null;
  const wordHistory = match?.usedWordIds;
  const persistedRound = useRef<string | null>(null);
  useEffect(() => {
    if (
      !chosenRoundKey ||
      !wordHistory ||
      persistedRound.current === chosenRoundKey
    )
      return;
    // Only committed round selections are remembered, never reducer replays.
    saveRecentWords(wordHistory);
    persistedRound.current = chosenRoundKey;
  }, [chosenRoundKey, wordHistory]);

  useEffect(() => {
    try {
      if (store.gameHistory.completedGames === 0) {
        localStorage.removeItem(LOCAL_PARTY_KEY);
      } else {
        localStorage.setItem(LOCAL_PARTY_KEY, JSON.stringify({
          version: 1,
          rosterSignature: store.rosterSignature,
          history: store.gameHistory,
        }));
      }
    } catch {
      /* Completed games remain available in memory when storage is disabled. */
    }
  }, [store.gameHistory, store.rosterSignature]);

  const gameHistory = useMemo(() => historyView(store.gameHistory), [store.gameHistory]);

  useEffect(() => {
    if (state.phase !== "guess") return;
    const expire = () => {
      if (Date.now() >= state.deadline) dispatch({ type: "GUESS_TIMEOUT" });
    };
    expire();
    const interval = window.setInterval(expire, 200);
    document.addEventListener("visibilitychange", expire);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", expire);
    };
  }, [state, dispatch]);

  return [state, dispatch, gameHistory] as const;
}

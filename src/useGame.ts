import { useReducer } from "react";
import {
  applyAwards,
  createRound,
  recordVote,
  resolveRound,
  validateSetup,
} from "./game";
import type { Outcome, Player, Round, Settings } from "./game";

export interface Match {
  players: Player[];
  settings: Settings;
  round: Round;
  usedWordIds: string[];
}

type State =
  | { phase: "setup" }
  | { phase: "role"; match: Match; index: number; revealed: boolean }
  | { phase: "clue"; match: Match; index: number }
  | { phase: "discussion"; match: Match }
  | { phase: "vote"; match: Match; index: number; revealed: boolean }
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
  | { type: "CONTINUE" }
  | { type: "RESET" };

function reducer(state: State, action: Action): State {
  if (action.type === "RESET") return { phase: "setup" };
  if (action.type === "START") {
    if (state.phase !== "setup" || validateSetup(action.names, action.settings))
      return state;
    const players = action.names.map((name, i) => ({
      id: `player-${i}`,
      name: name.trim(),
      score: 0,
    }));
    const round = createRound(players, action.settings, 1, []);
    return {
      phase: "role",
      index: 0,
      revealed: false,
      match: {
        players,
        settings: action.settings,
        round,
        usedWordIds: [round.word.id],
      },
    };
  }
  if (
    action.type === "REVEAL" &&
    (state.phase === "role" || state.phase === "vote")
  )
    return { ...state, revealed: true };
  if (
    action.type === "HIDE" &&
    (state.phase === "role" || state.phase === "vote")
  )
    return { ...state, revealed: false };
  if (action.type === "NEXT_ROLE" && state.phase === "role" && state.revealed) {
    return state.index + 1 < state.match.players.length
      ? { ...state, index: state.index + 1, revealed: false }
      : { phase: "clue", index: 0, match: state.match };
  }
  if (action.type === "NEXT_CLUE" && state.phase === "clue") {
    return state.index + 1 < state.match.players.length
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
      !players.some((p) => p.id === action.suspectId)
    )
      return state;
    const updatedRound = recordVote(round, players, voter.id, action.suspectId);
    const match = { ...state.match, round: updatedRound };
    if (state.index + 1 < players.length)
      return { phase: "vote", match, index: state.index + 1, revealed: false };
    const outcome = resolveRound(updatedRound, players);
    return {
      phase: "result",
      match: { ...match, players: applyAwards(players, outcome) },
      outcome,
    };
  }
  if (action.type === "CONTINUE" && state.phase === "result") {
    if (state.match.round.number === state.match.settings.rounds)
      return { phase: "final", match: state.match };
    const {
      players,
      settings,
      usedWordIds,
      round: previousRound,
    } = state.match;
    const round = createRound(
      players,
      settings,
      previousRound.number + 1,
      usedWordIds,
    );
    return {
      phase: "role",
      index: 0,
      revealed: false,
      match: {
        ...state.match,
        round,
        usedWordIds: [...usedWordIds, round.word.id],
      },
    };
  }
  return state;
}

export function useGame() {
  return useReducer(reducer, { phase: "setup" });
}

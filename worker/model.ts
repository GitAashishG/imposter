import {
  applyAwards,
  createRound,
  LAST_CHANCE_SECONDS,
  RECENT_WORD_LIMIT,
  migrateSettings,
  rememberWord,
  rankPlayers,
  recordVote,
  resolveRound,
  resolveLastChance,
  validateSetup,
  type Outcome,
  type Player,
  type Round,
  type Settings,
} from "../src/game";
import type {
  PartyAction,
  PartyPhase,
  PartyPublicInfo,
  PartySnapshot,
} from "../src/party/protocol";

export const PARTY_TTL_MS = 12 * 60 * 60 * 1000;
export const ABANDONED_TTL_MS = 15 * 60 * 1000;
export const PARTY_SCHEMA_VERSION = 2;

export class PartyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "PartyError";
  }
}

export interface Member extends Player {
  tokenHash: string;
}

/** Server-only. Never serialize this object to a client. */
export interface PartyState {
  schemaVersion: typeof PARTY_SCHEMA_VERSION;
  id: string;
  gameId: string;
  hostRecoveryCode: string;
  notice: { id: string; message: string } | null;
  revision: number;
  hostId: string;
  pin: string;
  phase: PartyPhase;
  players: Member[];
  settings: Settings;
  round: Round | null;
  outcome: Outcome | null;
  readyIds: string[];
  clueIndex: number;
  discussion: { deadline: number | null; remainingMs: number };
  expiresAt: number;
  abandonedExpiresAt: number | null;
  guessDeadline: number | null;
}

function fail(code: string, message: string, status = 400): never {
  throw new PartyError(code, message, status);
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_BODY", "Expected a JSON object.");
  }
  return value as Record<string, unknown>;
}

export function exactKeys(
  value: Record<string, unknown>,
  keys: string[],
): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    fail("INVALID_BODY", "The request contains an unknown field.");
  }
}

export function validateName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 24) {
    fail("INVALID_NAME", "Choose a name between 1 and 24 characters.");
  }
  const name = value.trim();
  if (/[\u0000-\u001f\u007f]/u.test(name)) {
    fail("INVALID_NAME", "Names cannot contain control characters.");
  }
  return name;
}

export function validatePin(value: unknown): string {
  if (typeof value !== "string" || !/^\d{6}$/.test(value)) {
    fail("INVALID_PIN", "Use a six-digit party PIN.");
  }
  return value;
}

export function validateSettings(value: unknown): Settings {
  const candidate = object(value);
  exactKeys(candidate, [
    "packIds",
    "rounds",
    "discussionSeconds",
    "clueCycles",
    "lastChanceGuess",
  ]);
  const settings = candidate as unknown as Settings;
  const error = validateSetup(["First", "Second", "Third"], settings);
  if (error) fail("INVALID_SETTINGS", error);
  if (new Set(settings.packIds).size !== settings.packIds.length) {
    fail("INVALID_SETTINGS", "Choose each word pack only once.");
  }
  return { ...settings, packIds: [...settings.packIds] };
}

export function validateAction(value: unknown): PartyAction {
  const candidate = object(value);
  const fields: Record<string, string[]> = {
    settings: ["settings"],
    start: [],
    ready: ["roundNumber"],
    "start-clues": ["roundNumber"],
    "next-clue": ["roundNumber", "clueIndex"],
    "pause-timer": ["roundNumber"],
    "resume-timer": ["roundNumber"],
    "start-vote": ["roundNumber"],
    vote: ["roundNumber", "suspectId"],
    "next-round": ["roundNumber"],
    "guess-word": ["roundNumber", "guess"],
    "skip-guess": ["roundNumber"],
    "new-game": [],
    "fresh-party": ["pin"],
    "transfer-host": ["playerId"],
    "rotate-recovery": [],
    "remove-player": ["playerId"],
    leave: [],
    "end-party": [],
  };
  if (
    typeof candidate.type !== "string" ||
    !Object.hasOwn(fields, candidate.type)
  ) {
    fail("UNKNOWN_ACTION", "That party command is not supported.");
  }
  const required = fields[candidate.type]!;
  exactKeys(candidate, ["type", "gameId", ...required]);
  if (typeof candidate.gameId !== "string" || !candidate.gameId) {
    fail(
      "UPDATE_REQUIRED",
      "Refresh this page to update Ko Ho? before sending another command.",
      409,
    );
  }
  if (required.some((key) => !Object.hasOwn(candidate, key))) {
    fail("INVALID_ACTION", "The command is missing a required field.");
  }
  if (
    "roundNumber" in candidate &&
    (!Number.isSafeInteger(candidate.roundNumber) ||
      Number(candidate.roundNumber) < 1)
  ) {
    fail("INVALID_ACTION", "A current round number is required.");
  }
  if (
    "clueIndex" in candidate &&
    (!Number.isSafeInteger(candidate.clueIndex) ||
      Number(candidate.clueIndex) < 0)
  ) {
    fail("INVALID_ACTION", "A current clue index is required.");
  }
  for (const key of ["playerId", "suspectId"] as const) {
    if (
      key in candidate &&
      (typeof candidate[key] !== "string" || !candidate[key])
    ) {
      fail("INVALID_ACTION", "A player ID is required.");
    }
  }
  if (candidate.type === "settings") {
    return {
      type: "settings",
      gameId: candidate.gameId,
      settings: validateSettings(candidate.settings),
    };
  }
  if (candidate.type === "fresh-party") validatePin(candidate.pin);
  if (
    candidate.type === "guess-word" &&
    (typeof candidate.guess !== "string" ||
      !candidate.guess.trim() ||
      candidate.guess.length > 80)
  ) {
    fail("INVALID_GUESS", "Enter one word or phrase of 1–80 characters.");
  }
  return candidate as unknown as PartyAction;
}

export function createParty(
  id: string,
  host: { id: string; name: unknown; tokenHash: string },
  pin: unknown,
  settings: unknown,
  now: number,
): PartyState {
  return {
    id,
    schemaVersion: PARTY_SCHEMA_VERSION,
    gameId: crypto.randomUUID(),
    hostRecoveryCode: makeRecoveryCode(),
    notice: null,
    revision: 1,
    hostId: host.id,
    pin: validatePin(pin),
    phase: "lobby",
    players: [
      {
        id: host.id,
        name: validateName(host.name),
        score: 0,
        tokenHash: host.tokenHash,
      },
    ],
    settings: validateSettings(settings),
    round: null,
    outcome: null,
    readyIds: [],
    clueIndex: 0,
    discussion: { deadline: null, remainingMs: 0 },
    expiresAt: now + PARTY_TTL_MS,
    abandonedExpiresAt: now + ABANDONED_TTL_MS,
    guessDeadline: null,
  };
}

export function requireParty(
  state: PartyState | null,
  now: number,
): PartyState {
  if (!state || isExpired(state, now)) {
    fail(
      "SESSION_ENDED",
      "This party has ended. Join or create a new party.",
      401,
    );
  }
  return state;
}

export function authenticate(
  state: PartyState | null,
  tokenHash: string,
  now: number,
): string {
  const party = requireParty(state, now);
  const player = party.players.find((member) => member.tokenHash === tokenHash);
  if (!player) fail("SESSION_ENDED", "This player session has ended.", 401);
  return player.id;
}

export function publicInfo(
  state: PartyState | null,
  now: number,
): PartyPublicInfo {
  return state && !isExpired(state, now)
    ? {
        exists: true,
        phase: state.phase,
        playerCount: state.players.length,
        abandonedExpiresAt: state.abandonedExpiresAt,
      }
    : { exists: false };
}

function touch(state: PartyState, now: number): PartyState {
  return {
    ...state,
    revision: state.revision + 1,
    expiresAt: now + PARTY_TTL_MS,
  };
}

export function pinMatches(expected: string, supplied: string): boolean {
  let mismatch = expected.length ^ supplied.length;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ (supplied.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

export function makeRecoveryCode(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  )
    .join("")
    .toUpperCase();
  return hex.match(/.{4}/g)!.join("-");
}

export function normalizeRecoveryCode(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/[\s-]/gu, "").toUpperCase();
  return /^[A-F0-9]{32}$/.test(normalized) ? normalized : "";
}

function notice(message: string): NonNullable<PartyState["notice"]> {
  return { id: crypto.randomUUID(), message };
}

export function recoverParty(
  state: PartyState,
  recoveryCode: unknown,
  tokenHash: string,
  now: number,
): PartyState {
  requireParty(state, now);
  const supplied = normalizeRecoveryCode(recoveryCode);
  if (
    !supplied ||
    !pinMatches(normalizeRecoveryCode(state.hostRecoveryCode), supplied)
  ) {
    fail(
      "WRONG_RECOVERY_CODE",
      "That private host recovery code is not correct.",
      403,
    );
  }
  return touch(
    {
      ...state,
      players: state.players.map((player) =>
        player.id === state.hostId ? { ...player, tokenHash } : player,
      ),
      hostRecoveryCode: makeRecoveryCode(),
      notice: notice(
        "The host recovered their seat. The previous host session has been signed out.",
      ),
    },
    now,
  );
}

export interface SocketIdentity {
  partyId: string | null;
  playerId: string | null;
  tokenHash?: string | null;
}

/** A seat alone is not authentication: recovery revokes every socket using its old token. */
export function socketIdentityMatches(
  state: PartyState | null,
  identity: SocketIdentity | null,
): boolean {
  return (
    !!state &&
    identity?.partyId === state.id &&
    !!identity.tokenHash &&
    state.players.some(
      (player) =>
        player.id === identity.playerId &&
        player.tokenHash === identity.tokenHash,
    )
  );
}

export function isExpired(state: PartyState, now: number): boolean {
  return (
    state.expiresAt <= now ||
    (state.abandonedExpiresAt !== null && state.abandonedExpiresAt <= now)
  );
}

export function expirationMessage(state: PartyState): string {
  return state.abandonedExpiresAt !== null &&
    state.abandonedExpiresAt <= state.expiresAt
    ? "This party ended after everyone was disconnected for 15 minutes. Join or create a new party."
    : "This party expired after 12 hours without a game action. Join or create a new party.";
}

/** Presence is transport-owned, persisted, and never renews the state-change TTL. */
export function updatePresence(
  state: PartyState,
  connected: ReadonlySet<string>,
  now: number,
): PartyState {
  const anyConnected = state.players.some((player) => connected.has(player.id));
  const deadline = anyConnected
    ? null
    : (state.abandonedExpiresAt ?? now + ABANDONED_TTL_MS);
  return deadline === state.abandonedExpiresAt
    ? state
    : { ...state, abandonedExpiresAt: deadline };
}

export function nextAlarmDeadline(
  state: PartyState | null,
  unauthenticatedDeadlines: number[] = [],
): number | null {
  const deadline = Math.min(
    ...unauthenticatedDeadlines,
    state?.expiresAt ?? Infinity,
    state?.abandonedExpiresAt ?? Infinity,
    state?.guessDeadline ?? Infinity,
  );
  return Number.isFinite(deadline) ? deadline : null;
}

function finishRound(state: PartyState, outcome: Outcome): PartyState {
  const scores = new Map(
    applyAwards(state.players, outcome).map((player) => [
      player.id,
      player.score,
    ]),
  );
  return {
    ...state,
    phase: "result",
    outcome,
    guessDeadline: null,
    players: state.players.map((player) => ({
      ...player,
      score: scores.get(player.id)!,
    })),
  };
}

/** Used by alarms AND request entry points, so a delayed alarm cannot allow a late answer. */
export function advanceTime(
  state: PartyState | null,
  now: number,
): PartyState | null {
  if (!state || isExpired(state, now)) return null;
  if (
    state.phase === "guess" &&
    state.guessDeadline !== null &&
    state.guessDeadline <= now
  ) {
    return touch(
      finishRound(state, resolveLastChance(state.round!, state.players, null)),
      now,
    );
  }
  return state;
}

export function updateWordHistory(
  previous: PartyState | null,
  next: PartyState | null,
  history: string[],
): string[] {
  if (
    !next?.round ||
    (previous?.gameId === next.gameId &&
      previous.round?.number === next.round.number)
  )
    return history;
  return rememberWord(history, next.round.word.id);
}

function validHistory(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((id): id is string => typeof id === "string")
        .slice(-RECENT_WORD_LIMIT)
    : [];
}

/** One explicit persisted-v1 upgrade. It never resets a live round, credential hash, or identity. */
export function migrateStoredParty(
  value: unknown,
  storedHistory: unknown,
  now: number,
): {
  party: PartyState | null;
  history: string[];
  legacy: boolean;
} {
  const history = validHistory(storedHistory);
  if (value === null) return { party: null, history, legacy: false };
  const saved = object(value);
  if (saved.schemaVersion === PARTY_SCHEMA_VERSION)
    return { party: saved as unknown as PartyState, history, legacy: false };
  if (saved.schemaVersion !== undefined && saved.schemaVersion !== 1)
    throw new Error("Unsupported party schema.");
  const settings = migrateSettings(saved.settings);
  if (!settings) throw new Error("Invalid stored party settings.");
  const { usedWordIds, ...retained } = saved;
  const outcome = saved.outcome
    ? { ...object(saved.outcome), guessResult: null }
    : null;
  return {
    legacy: true,
    history: validHistory([...history, ...validHistory(usedWordIds)]),
    party: {
      ...retained,
      schemaVersion: PARTY_SCHEMA_VERSION,
      gameId: crypto.randomUUID(),
      hostRecoveryCode: makeRecoveryCode(),
      settings,
      outcome,
      guessDeadline: null,
      abandonedExpiresAt: now + ABANDONED_TTL_MS,
      notice: null,
    } as unknown as PartyState,
  };
}

export function joinParty(
  state: PartyState,
  member: { id: string; name: unknown; tokenHash: string },
  pin: unknown,
  now: number,
): PartyState {
  requireParty(state, now);
  if (state.phase !== "lobby")
    fail("NOT_IN_LOBBY", "Wait for the host to return to the lobby.", 409);
  if (!pinMatches(state.pin, validatePin(pin)))
    fail("WRONG_PIN", "That party PIN is not correct.", 403);
  const name = validateName(member.name);
  if (state.players.length >= 12)
    fail("PARTY_FULL", "This party already has 12 players.", 409);
  if (
    state.players.some(
      (player) => player.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    fail("NAME_TAKEN", "That name is already in this party.", 409);
  }
  return touch(
    {
      ...state,
      players: [
        ...state.players,
        { id: member.id, name, score: 0, tokenHash: member.tokenHash },
      ],
    },
    now,
  );
}

function requirePhase(state: PartyState, phase: PartyPhase): void {
  if (state.phase !== phase)
    fail("WRONG_PHASE", `This command is only available during ${phase}.`, 409);
}

function beginRound(
  state: PartyState,
  number: number,
  random: () => number,
  recentWordIds: string[],
): PartyState {
  const round = createRound(
    state.players,
    state.settings,
    number,
    recentWordIds,
    random,
  );
  return {
    ...state,
    phase: "role",
    round,
    outcome: null,
    guessDeadline: null,
    readyIds: [],
    clueIndex: 0,
    discussion: {
      deadline: null,
      remainingMs: state.settings.discussionSeconds * 1000,
    },
  };
}

/** Immutable transitions. Identity is established by token authentication, not browser IDs. */
export function applyAction(
  state: PartyState,
  actorId: string,
  input: unknown,
  now: number,
  connected: ReadonlySet<string>,
  random: () => number = Math.random,
  options: {
    recentWordIds?: string[];
    freshHost?: { id: string; tokenHash: string };
  } = {},
): PartyState | null {
  requireParty(state, now);
  if (!state.players.some((player) => player.id === actorId)) {
    fail("SESSION_ENDED", "This player session has ended.", 401);
  }
  const action = validateAction(input);
  if (action.gameId !== state.gameId) {
    fail(
      "STALE_GAME",
      "A new game has started. Use the current party state.",
      409,
    );
  }
  if ("roundNumber" in action && state.round?.number !== action.roundNumber) {
    fail(
      "STALE_ROUND",
      "The round has changed. Use the current party state.",
      409,
    );
  }
  const playerActions = new Set([
    "ready",
    "vote",
    "leave",
    "next-clue",
    "guess-word",
  ]);
  if (!playerActions.has(action.type) && actorId !== state.hostId) {
    fail("HOST_ONLY", "Only the host can do that.", 403);
  }
  let next: PartyState;
  switch (action.type) {
    case "settings":
      requirePhase(state, "lobby");
      next = { ...state, settings: action.settings };
      break;
    case "start": {
      requirePhase(state, "lobby");
      const error = validateSetup(
        state.players.map((player) => player.name),
        state.settings,
      );
      if (error) fail("INVALID_SETUP", error);
      if (state.players.some((player) => !connected.has(player.id))) {
        fail(
          "PLAYERS_OFFLINE",
          "Every player must be connected before starting.",
          409,
        );
      }
      next = beginRound(
        {
          ...state,
          players: state.players.map((player) => ({ ...player, score: 0 })),
          guessDeadline: null,
        },
        1,
        random,
        options.recentWordIds ?? [],
      );
      break;
    }
    case "ready":
      requirePhase(state, "role");
      if (state.readyIds.includes(actorId)) return state;
      next = { ...state, readyIds: [...state.readyIds, actorId] };
      break;
    case "start-clues":
      requirePhase(state, "role");
      if (state.players.some((player) => !state.readyIds.includes(player.id))) {
        fail(
          "PLAYERS_NOT_READY",
          "Every player must acknowledge their role first.",
          409,
        );
      }
      next = { ...state, phase: "clue" };
      break;
    case "next-clue":
      requirePhase(state, "clue");
      if (action.clueIndex !== state.clueIndex)
        fail("STALE_CLUE", "That clue turn has already moved on.", 409);
      if (
        actorId !== state.hostId &&
        state.round!.clueOrder[state.clueIndex % state.players.length] !==
          actorId
      ) {
        fail(
          "NOT_YOUR_TURN",
          "Only the current clue player or host can advance this turn.",
          403,
        );
      }
      if (
        state.clueIndex + 1 ===
        state.players.length * state.settings.clueCycles
      ) {
        next = {
          ...state,
          phase: "discussion",
          discussion: {
            deadline: now + state.discussion.remainingMs,
            remainingMs: state.discussion.remainingMs,
          },
        };
      } else {
        next = { ...state, clueIndex: state.clueIndex + 1 };
      }
      break;
    case "pause-timer":
      requirePhase(state, "discussion");
      if (state.discussion.deadline === null) return state;
      next = {
        ...state,
        discussion: {
          deadline: null,
          remainingMs: Math.max(0, state.discussion.deadline - now),
        },
      };
      break;
    case "resume-timer":
      requirePhase(state, "discussion");
      if (state.discussion.deadline !== null) return state;
      next = {
        ...state,
        discussion: {
          deadline: now + state.discussion.remainingMs,
          remainingMs: state.discussion.remainingMs,
        },
      };
      break;
    case "start-vote":
      requirePhase(state, "discussion");
      next = {
        ...state,
        phase: "vote",
        discussion: { deadline: null, remainingMs: 0 },
      };
      break;
    case "vote": {
      requirePhase(state, "vote");
      if (Object.hasOwn(state.round!.votes, actorId))
        fail("ALREADY_VOTED", "Your vote is already locked in.", 409);
      if (
        actorId === action.suspectId ||
        !state.players.some((player) => player.id === action.suspectId)
      ) {
        fail("INVALID_VOTE", "Choose another player from this party.");
      }
      const round = recordVote(
        state.round!,
        state.players,
        actorId,
        action.suspectId,
      );
      next = { ...state, round };
      if (
        state.players.every((player) => Object.hasOwn(round.votes, player.id))
      ) {
        const outcome = resolveRound(round, state.players);
        next =
          state.settings.lastChanceGuess && outcome.caught
            ? {
                ...next,
                phase: "guess",
                guessDeadline: now + LAST_CHANCE_SECONDS * 1000,
              }
            : finishRound(next, outcome);
      }
      break;
    }
    case "guess-word":
      requirePhase(state, "guess");
      if (actorId !== state.round!.imposterId) {
        fail(
          "IMPOSTER_ONLY",
          "Only the caught imposter can submit this guess.",
          403,
        );
      }
      next = finishRound(
        state,
        resolveLastChance(
          state.round!,
          state.players,
          now >= state.guessDeadline! ? null : action.guess,
        ),
      );
      break;
    case "skip-guess":
      requirePhase(state, "guess");
      next = finishRound(
        state,
        resolveLastChance(state.round!, state.players, null),
      );
      break;
    case "next-round":
      requirePhase(state, "result");
      next =
        state.round!.number === state.settings.rounds
          ? { ...state, phase: "final" }
          : beginRound(
              state,
              state.round!.number + 1,
              random,
              options.recentWordIds ?? [],
            );
      break;
    case "new-game":
      next = {
        ...state,
        gameId: crypto.randomUUID(),
        notice: notice(
          "The host started a new game with the same players. Scores and rounds have been reset.",
        ),
        phase: "lobby",
        players: state.players.map((player) => ({ ...player, score: 0 })),
        round: null,
        outcome: null,
        guessDeadline: null,
        readyIds: [],
        clueIndex: 0,
        discussion: { deadline: null, remainingMs: 0 },
      };
      break;
    case "fresh-party": {
      if (pinMatches(state.pin, action.pin))
        fail("PIN_UNCHANGED", "Choose a different PIN for the fresh party.");
      if (!options.freshHost)
        throw new Error("Fresh party requires a rotated session credential.");
      const host = state.players.find((player) => player.id === actorId)!;
      return createParty(
        crypto.randomUUID(),
        { ...options.freshHost, name: host.name },
        action.pin,
        state.settings,
        now,
      );
    }
    case "transfer-host": {
      const target = state.players.find(
        (player) => player.id === action.playerId,
      );
      if (!target)
        fail("PLAYER_NOT_FOUND", "That player is no longer in the party.", 404);
      if (target.id === state.hostId)
        fail("ALREADY_HOST", "That player is already the host.", 409);
      if (!connected.has(target.id))
        fail(
          "PLAYER_OFFLINE",
          "Choose a connected player to host the party.",
          409,
        );
      next = {
        ...state,
        hostId: target.id,
        hostRecoveryCode: makeRecoveryCode(),
        notice: notice(`${target.name} is now hosting the party.`),
      };
      break;
    }
    case "rotate-recovery":
      next = {
        ...state,
        hostRecoveryCode: makeRecoveryCode(),
        notice: notice("The host rotated the private recovery code."),
      };
      break;
    case "remove-player":
      requirePhase(state, "lobby");
      if (action.playerId === state.hostId)
        fail("CANNOT_REMOVE_HOST", "The host cannot remove themselves.");
      if (!state.players.some((player) => player.id === action.playerId))
        fail("PLAYER_NOT_FOUND", "That player is no longer in the party.", 404);
      next = {
        ...state,
        players: state.players.filter(
          (player) => player.id !== action.playerId,
        ),
      };
      break;
    case "leave":
      requirePhase(state, "lobby");
      if (actorId === state.hostId)
        fail("HOST_CANNOT_LEAVE", "The host must end the party instead.");
      next = {
        ...state,
        players: state.players.filter((player) => player.id !== actorId),
      };
      break;
    case "end-party":
      return null;
  }
  return touch(next, now);
}

export function project(
  state: PartyState,
  selfId: string,
  now: number,
  connected: ReadonlySet<string>,
): PartySnapshot {
  requireParty(state, now);
  if (!state.players.some((player) => player.id === selfId))
    fail("SESSION_ENDED", "This player session has ended.", 401);
  const privatePhase = ["role", "clue", "discussion", "vote", "guess"].includes(
    state.phase,
  );
  const publicResult =
    (state.phase === "result" || state.phase === "final") &&
    state.round &&
    state.outcome;
  const players =
    state.phase === "final" ? rankPlayers(state.players) : state.players;
  return {
    id: state.id,
    gameId: state.gameId,
    revision: state.revision,
    phase: state.phase,
    serverNow: now,
    expiresAt: state.expiresAt,
    abandonedExpiresAt: state.abandonedExpiresAt,
    notice: state.notice ? { ...state.notice } : null,
    selfId,
    hostId: state.hostId,
    ...(selfId === state.hostId
      ? { pin: state.pin, hostRecoveryCode: state.hostRecoveryCode }
      : {}),
    players: players.map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      ready: state.readyIds.includes(player.id),
      hasVoted: !!state.round && Object.hasOwn(state.round.votes, player.id),
      connected: connected.has(player.id),
    })),
    settings: { ...state.settings, packIds: [...state.settings.packIds] },
    roundNumber: state.round?.number ?? 0,
    clueOrder: state.round ? [...state.round.clueOrder] : [],
    clueIndex: state.clueIndex,
    clueCycle: Math.floor(state.clueIndex / state.players.length) + 1,
    guess:
      state.phase === "guess" && state.round && state.guessDeadline !== null
        ? { playerId: state.round.imposterId, deadline: state.guessDeadline }
        : null,
    discussion: {
      deadline: state.discussion.deadline,
      remainingMs:
        state.discussion.deadline === null
          ? state.discussion.remainingMs
          : Math.max(0, state.discussion.deadline - now),
    },
    ownRole:
      privatePhase && state.round
        ? state.round.imposterId === selfId
          ? { isImposter: true, word: null }
          : { isImposter: false, word: { ...state.round.word } }
        : null,
    result: publicResult
      ? {
          word: { ...state.round!.word },
          imposterId: state.round!.imposterId,
          outcome: structuredClone(state.outcome!),
        }
      : null,
  };
}

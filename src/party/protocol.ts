import type { Word } from "../data";
import type { Outcome, Player, Settings } from "../game";

export type PartyPhase =
  "lobby" | "role" | "clue" | "discussion" | "vote" | "result" | "final";

export interface PartyPlayer extends Player {
  ready: boolean;
  hasVoted: boolean;
  connected: boolean;
}

export type PrivateRole =
  { isImposter: true; word: null } | { isImposter: false; word: Word };

export interface PartySnapshot {
  id: string;
  revision: number;
  phase: PartyPhase;
  serverNow: number;
  expiresAt: number;
  selfId: string;
  hostId: string;
  /** Only included in the host's private snapshot. */
  pin?: string;
  players: PartyPlayer[];
  settings: Settings;
  roundNumber: number;
  clueOrder: string[];
  clueIndex: number;
  discussion: { deadline: number | null; remainingMs: number };
  /** Only the receiving player's role; never another player's assignment. */
  ownRole: PrivateRole | null;
  /** Public only after all votes are locked in. No individual ballots. */
  result: { word: Word; imposterId: string; outcome: Outcome } | null;
}

export interface PartySession {
  partyId: string;
  playerId: string;
  token: string;
}

export interface PartyPublicInfo {
  exists: boolean;
  phase?: PartyPhase;
  playerCount?: number;
}

export interface PartyEntry {
  session: PartySession;
  snapshot: PartySnapshot;
}

export type PartyAction =
  | { type: "settings"; settings: Settings }
  | { type: "start" }
  | { type: "ready"; roundNumber: number }
  | { type: "start-clues"; roundNumber: number }
  | { type: "next-clue"; roundNumber: number; clueIndex: number }
  | { type: "pause-timer"; roundNumber: number }
  | { type: "resume-timer"; roundNumber: number }
  | { type: "start-vote"; roundNumber: number }
  | { type: "vote"; roundNumber: number; suspectId: string }
  | { type: "next-round"; roundNumber: number }
  | { type: "back-to-lobby" }
  | { type: "remove-player"; playerId: string }
  | { type: "leave" }
  | { type: "end-party" };

export type PartyEvent =
  | { type: "snapshot"; snapshot: PartySnapshot }
  | { type: "error"; error: string; code: string }
  | { type: "ended"; message: string };

export interface PartyErrorBody {
  error: string;
  code: string;
}

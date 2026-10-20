import type { Word } from "../data";
import type { Outcome, Player, Settings } from "../game";
import type { GameHistory } from "../history";

export type PartyPhase =
  | "lobby"
  | "role"
  | "clue"
  | "discussion"
  | "vote"
  | "guess"
  | "result"
  | "final";

export interface PartyPlayer extends Player {
  ready: boolean;
  hasVoted: boolean;
  connected: boolean;
}

export type PrivateRole =
  { isImposter: true; word: null } | { isImposter: false; word: Word };

export interface PartySnapshot {
  id: string;
  roomCode: string;
  gameId: string;
  revision: number;
  phase: PartyPhase;
  serverNow: number;
  expiresAt: number;
  abandonedExpiresAt: number | null;
  notice: { id: string; message: string } | null;
  completedGames: number;
  selfId: string;
  hostId: string;
  /** Only included in the host's private snapshot. */
  pin?: string;
  /** Private host credential; never included for another player. */
  hostRecoveryCode?: string;
  players: PartyPlayer[];
  settings: Settings;
  roundNumber: number;
  clueOrder: string[];
  clueIndex: number;
  clueCycle: number;
  discussion: { deadline: number | null; remainingMs: number };
  /** Only the receiving player's role; never another player's assignment. */
  ownRole: PrivateRole | null;
  /** Word remains private until this optional challenge is resolved. */
  guess: { playerId: string; deadline: number } | null;
  /** Public only after all votes are locked in. No individual ballots. */
  result: { word: Word; imposterId: string; outcome: Outcome } | null;
}

export interface PartySession {
  roomCode: string;
  partyId: string;
  playerId: string;
  token: string;
}

export interface PartyPublicInfo {
  exists: boolean;
  roomCode: string;
  phase?: PartyPhase;
  playerCount?: number;
  abandonedExpiresAt?: number | null;
}

export interface RoomDirectoryInfo {
  activeRooms: number;
  roomCap: number;
  availableSlots: number;
  configVersion: number;
}

export interface RecentRoom {
  roomCode: string;
  lastVisited: number;
  playerName?: string;
}

export interface AdminRoom {
  roomCode: string;
  partyId: string | null;
  status: "pending" | "active" | "closed";
  phase: PartyPhase | null;
  playerCount: number;
  connectedCount: number;
  createdAt: number;
  lastActivityAt: number;
  expiresAt: number | null;
  abandonedExpiresAt: number | null;
  completedGames: number;
  closedAt: number | null;
  closeReason: string | null;
  storagePurged: boolean;
}

export interface AdminDirectoryView {
  rooms: AdminRoom[];
  roomCap: number;
  configVersion: number;
  activeRooms: number;
}

export interface AdminDirectoryConfig {
  roomCap: number;
  configVersion: number;
}

export interface PartyHistoryResponse {
  partyId: string;
  roomCode: string;
  history: GameHistory;
}

export interface PartyEntry {
  session: PartySession;
  snapshot: PartySnapshot;
}

export type PartyCommand =
  | { type: "settings"; settings: Settings }
  | { type: "start" }
  | { type: "ready"; roundNumber: number }
  | { type: "start-clues"; roundNumber: number }
  | { type: "next-clue"; roundNumber: number; clueIndex: number }
  | { type: "pause-timer"; roundNumber: number }
  | { type: "resume-timer"; roundNumber: number }
  | { type: "start-vote"; roundNumber: number }
  | { type: "vote"; roundNumber: number; suspectId: string }
  | { type: "guess-word"; roundNumber: number; guess: string }
  | { type: "skip-guess"; roundNumber: number }
  | { type: "next-round"; roundNumber: number }
  | { type: "new-game" }
  | { type: "fresh-party"; pin: string }
  | { type: "transfer-host"; playerId: string }
  | { type: "rotate-recovery" }
  | { type: "rotate-pin"; pin: string }
  | { type: "remove-player"; playerId: string }
  | { type: "leave" }
  | { type: "end-party" };

/** Captured by the UI with the game being acted on, not inferred at receipt. */
export type PartyAction = PartyCommand & { gameId: string };

export interface PartyActionResponse {
  snapshot: PartySnapshot | null;
  /** A fresh party rotates the acting host's session too. */
  session?: PartySession;
}

export type PartyEvent =
  | { type: "snapshot"; snapshot: PartySnapshot }
  | { type: "error"; error: string; code: string }
  | { type: "ended"; roomCode: string | null; partyId: string | null; message: string };

export interface PartyErrorBody {
  error: string;
  code: string;
}

import type { AdminRoom, RoomDirectoryInfo } from "../src/party/protocol";
import { ROOM_CODE_ALPHABET, normalizeRoomCode } from "../src/party/joining";
export { normalizeRoomCode } from "../src/party/joining";

export const DEFAULT_ROOM_CAP = 5;
export const RESERVATION_MS = 30_000;
export const CLOSED_RETENTION_MS = 24 * 60 * 60 * 1000;
export const MAX_CLOSED_ROOMS = 100;
export const MAX_RATE_BUCKETS = 2048;

export interface RoomRecord {
  objectKey: string;
  reservationId: string | null;
  reservationExpiresAt: number | null;
  metadata: AdminRoom;
}

export interface RateBucket {
  key: string;
  window: "request" | "creation" | "global-creation";
  startedAt: number;
  count: number;
}

export class RegistryError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    // Durable Object RPC preserves Error.message, but not arbitrary properties.
    super(`${code}: ${message}`);
    this.name = "RegistryError";
  }
}

export const REGISTRY_ERROR_STATUS: Record<string, number> = {
  ROOM_NOT_FOUND: 404,
  SESSION_ENDED: 401,
  ROOM_FULL: 409,
  STALE_PARTY: 409,
  ROOM_ACTIVE: 409,
  STALE_CONFIG: 409,
  INVALID_CAP: 400,
  INVALID_ROOM_CODE: 400,
  ROOM_RESERVATION_EXPIRED: 409,
  REQUEST_THROTTLED: 429,
  CREATION_THROTTLED: 429,
};


export function generateRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  // The alphabet has exactly 32 entries, so masking is unbiased.
  return Array.from(bytes, (byte) => ROOM_CODE_ALPHABET[byte & 31]).join("");
}

export interface RoomRoute {
  kind: "directory" | "restore" | "room";
  roomCode: string | null;
  operation: "public" | "join" | "recover" | "state" | "action" | "history" | "socket";
  methods: string[];
}

export function roomRoute(path: string): RoomRoute | null {
  if (path === "/api/rooms") return { kind: "directory", roomCode: null, operation: "public", methods: ["GET", "POST"] };
  if (path === "/api/rooms/restore") return { kind: "restore", roomCode: null, operation: "public", methods: ["POST"] };
  const match = /^\/api\/rooms\/([^/]+)(?:\/(join|recover|state|action|history|socket))?$/.exec(path);
  if (!match) return null;
  const roomCode = normalizeRoomCode(match[1]!);
  if (!roomCode) return null;
  const operation = (match[2] ?? "public") as RoomRoute["operation"];
  return { kind: "room", roomCode, operation, methods: [operation === "join" || operation === "recover" || operation === "action" ? "POST" : "GET"] };
}

export function isExpiredMetadata(room: AdminRoom, now: number): boolean {
  return room.status === "closed" || (room.expiresAt !== null && room.expiresAt <= now) || (room.abandonedExpiresAt !== null && room.abandonedExpiresAt <= now);
}

export function directoryInfo(rooms: RoomRecord[], roomCap: number, configVersion: number): RoomDirectoryInfo {
  const activeRooms = rooms.filter((room) => room.metadata.status !== "closed").length;
  return { activeRooms, roomCap, availableSlots: Math.max(0, roomCap - activeRooms), configVersion };
}

export function assertCapacity(rooms: RoomRecord[], roomCap: number): void {
  if (directoryInfo(rooms, roomCap, 0).activeRooms >= roomCap)
    throw new RegistryError("ROOM_FULL", "All room slots are in use. Join an existing room or try again after a party ends.", 409);
}

export function assertRoomVersion(room: RoomRecord | undefined, partyId: string | null): asserts room is RoomRecord {
  if (!room) throw new RegistryError("ROOM_NOT_FOUND", "This room has ended or does not exist.", 404);
  if (room.metadata.partyId !== partyId)
    throw new RegistryError("STALE_PARTY", "This room changed. Refresh before trying again.", 409);
}

export function assertReservation(room: RoomRecord | undefined, reservationId: string, now: number): asserts room is RoomRecord {
  if (!room || room.metadata.status !== "pending" || room.reservationId !== reservationId || (room.reservationExpiresAt ?? 0) <= now)
    throw new RegistryError("ROOM_RESERVATION_EXPIRED", "The room reservation expired. Please create a room again.", 409);
}

export function nextRoomConfig(cap: number, expectedVersion: number, currentVersion: number): { roomCap: number; configVersion: number } {
  if (!Number.isInteger(cap) || cap < 1 || cap > 20)
    throw new RegistryError("INVALID_CAP", "Choose a room cap from 1 to 20.");
  if (expectedVersion !== currentVersion)
    throw new RegistryError("STALE_CONFIG", "The room cap changed. Refresh before saving.", 409);
  return { roomCap: cap, configVersion: currentVersion + 1 };
}

export function acceptsRoomUpdate(room: RoomRecord | undefined, metadata: AdminRoom, expectedPartyId: string): boolean {
  return !!room && room.metadata.roomCode === metadata.roomCode && room.metadata.status === "active" && room.metadata.partyId === expectedPartyId;
}

export function pendingRoom(code: string, objectKey: string, reservationId: string, now: number): RoomRecord {
  return {
    objectKey,
    reservationId,
    reservationExpiresAt: now + RESERVATION_MS,
    metadata: {
      roomCode: code, partyId: null, status: "pending", phase: null,
      playerCount: 0, connectedCount: 0, createdAt: now, lastActivityAt: now,
      expiresAt: null, abandonedExpiresAt: null, completedGames: 0,
      closedAt: null, closeReason: null, storagePurged: false,
    },
  };
}

/** Whitelist, never spread an RPC payload into owner-visible metadata. */
export function safeMetadata(room: AdminRoom): AdminRoom {
  return {
    roomCode: room.roomCode, partyId: room.partyId, status: room.status,
    phase: room.phase, playerCount: room.playerCount, connectedCount: room.connectedCount,
    createdAt: room.createdAt, lastActivityAt: room.lastActivityAt,
    expiresAt: room.expiresAt, abandonedExpiresAt: room.abandonedExpiresAt,
    completedGames: room.completedGames, closedAt: room.closedAt,
    closeReason: room.closeReason, storagePurged: room.storagePurged,
  };
}

export function pruneClosed(rooms: RoomRecord[], now: number): RoomRecord[] {
  const closed = rooms.filter((room) => room.metadata.status === "closed" && room.metadata.storagePurged)
    .filter((room) => (room.metadata.closedAt ?? 0) + CLOSED_RETENTION_MS > now)
    .sort((a, b) => (b.metadata.closedAt ?? 0) - (a.metadata.closedAt ?? 0))
    .slice(0, MAX_CLOSED_ROOMS);
  const retained = new Set(closed);
  return rooms.filter((room) => room.metadata.status !== "closed" || !room.metadata.storagePurged || retained.has(room));
}

const WINDOWS = { request: 60_000, creation: 60 * 60 * 1000, "global-creation": 24 * 60 * 60 * 1000 };

/** Bounded hash-only buckets. At saturation fail closed rather than evicting live limits. */
export function consumeRate(buckets: RateBucket[], key: string, creating: boolean, now: number): RateBucket[] {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Rate keys must be SHA-256 hashes.");
  const active = buckets.filter((bucket) => now < bucket.startedAt + WINDOWS[bucket.window]).map((bucket) => ({ ...bucket }));
  const specs: Array<{ key: string; window: RateBucket["window"]; max: number }> = creating
    ? [{ key, window: "creation", max: 10 }, { key: "global", window: "global-creation", max: 100 }]
    : [{ key, window: "request", max: 600 }];
  const code = creating ? "CREATION_THROTTLED" : "REQUEST_THROTTLED";
  const message = creating ? "Too many new rooms were created. Please wait before creating another room; existing rooms still work." : "Too many requests. Please wait a minute and reconnect.";
  for (const spec of specs) {
    const bucket = active.find((entry) => entry.key === spec.key && entry.window === spec.window);
    if ((bucket?.count ?? 0) >= spec.max || (!bucket && active.length >= MAX_RATE_BUCKETS))
      throw new RegistryError(code, message, 429);
    if (bucket) bucket.count += 1;
    else active.push({ key: spec.key, window: spec.window, startedAt: now, count: 1 });
  }
  return active;
}

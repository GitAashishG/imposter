import type { PartySession, RecentRoom } from "./protocol";
import { normalizeRoomCode } from "./joining";

function sessionKey(api: string, code: string) { return `ko-ho-room-session-v2:${api}:${code}`; }
function recentKey(api: string) { return `ko-ho-recent-rooms-v1:${api}`; }
function legacyKey(api: string) { return `ko-ho-party-session-v1:${api}`; }

export interface LegacySession { partyId: string; playerId: string; token: string }

function credential(value: unknown): LegacySession | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as LegacySession;
  if (![candidate.partyId, candidate.playerId].every((part) => typeof part === "string" && part.length > 0) || typeof candidate.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(candidate.token)) return null;
  return { partyId: candidate.partyId, playerId: candidate.playerId, token: candidate.token };
}

export function readRoomSession(api: string, code: string): PartySession | null {
  const normalized = normalizeRoomCode(code);
  if (!normalized) return null;
  try {
    const value = JSON.parse(localStorage.getItem(sessionKey(api, normalized)) ?? "null");
    const saved = credential(value);
    return saved && value.roomCode === normalized ? { ...saved, roomCode: normalized } : null;
  } catch { return null; }
}

/** Compare-and-set prevents a delayed old response overwriting a newer seat. */
export function saveRoomSession(api: string, session: PartySession, expectedToken: string | null): "saved" | "changed" | "unavailable" {
  try {
    const stored = readRoomSession(api, session.roomCode);
    if (stored && stored.token !== session.token && stored.token !== expectedToken) return "changed";
    localStorage.setItem(sessionKey(api, session.roomCode), JSON.stringify(session));
    return "saved";
  } catch { return "unavailable"; }
}

export function retireRoomSession(api: string, session: PartySession): boolean {
  try {
    if (readRoomSession(api, session.roomCode)?.token !== session.token) return false;
    localStorage.removeItem(sessionKey(api, session.roomCode));
    return true;
  } catch { return false; }
}

export function readLegacySession(api: string): LegacySession | null {
  try { return credential(JSON.parse(localStorage.getItem(legacyKey(api)) ?? "null")); }
  catch { return null; }
}

export function retireLegacySession(api: string, token: string): void {
  try { if (readLegacySession(api)?.token === token) localStorage.removeItem(legacyKey(api)); }
  catch { /* A disabled browser store cannot be migrated or modified. */ }
}

export function readRecentRooms(api: string): RecentRoom[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(recentKey(api)) ?? "[]");
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.filter((entry): entry is RecentRoom => {
      if (!entry || typeof entry !== "object") return false;
      const record = entry as RecentRoom;
      const code = typeof record.roomCode === "string" ? normalizeRoomCode(record.roomCode) : "";
      if (!code || code !== record.roomCode || seen.has(code) || !Number.isFinite(record.lastVisited)) return false;
      seen.add(code);
      return true;
    }).map(({ roomCode, lastVisited, playerName }) => ({ roomCode, lastVisited, ...(typeof playerName === "string" && playerName.length <= 24 ? { playerName } : {}) })).sort((a, b) => b.lastVisited - a.lastVisited).slice(0, 10);
  } catch { return []; }
}

export function rememberRoom(api: string, roomCode: string, playerName?: string): RecentRoom[] {
  const next = [{ roomCode, lastVisited: Date.now(), ...(playerName ? { playerName } : {}) }, ...readRecentRooms(api).filter((room) => room.roomCode !== roomCode)].slice(0, 10);
  try { localStorage.setItem(recentKey(api), JSON.stringify(next)); } catch { /* Visit-only recents remain usable. */ }
  return next;
}

export function removeRecentRoom(api: string, roomCode: string): RecentRoom[] {
  const next = readRecentRooms(api).filter((room) => room.roomCode !== roomCode);
  try { localStorage.setItem(recentKey(api), JSON.stringify(next)); } catch { /* Removing metadata must never destroy a saved seat. */ }
  return next;
}

import type { AdminDirectoryView, AdminRoom } from "../src/party/protocol";
import { hashSecret, makeToken } from "./security";

export const OWNER_GITHUB_ID = "9066299";
export const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000;
export const OAUTH_NONCE_MS = 10 * 60 * 1000;
export const ADMIN_BODY_LIMIT = 16 * 1024;
export const SESSION_COOKIE = "__Host-koho_admin_session";
export const OAUTH_COOKIE = "__Host-koho_admin_oauth";
export const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ROOM_CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

export class AdminError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
  }
}

export interface AdminSessionRecord {
  token_hash: string;
  csrf_hash: string;
  user_id: string;
  login: string;
  origin: string;
  created_at: number;
  expires_at: number;
}

export interface OAuthNonceRecord {
  state_hash: string;
  binding_hash: string;
  redirect_uri: string;
  created_at: number;
  expires_at: number;
}

export function isAdminPath(path: string): boolean {
  return path === "/admin" || path.startsWith("/admin/") ||
    path === "/api/admin" || path.startsWith("/api/admin/");
}

export function adminRoute(path: string): { method: "GET" | "POST"; action: string; roomCode?: string } | null {
  const routes: Record<string, { method: "GET" | "POST"; action: string }> = {
    "/admin": { method: "GET", action: "page" },
    "/admin/auth/start": { method: "GET", action: "start" },
    "/admin/auth/callback": { method: "GET", action: "callback" },
    "/admin/logout": { method: "POST", action: "logout" },
    "/api/admin/session": { method: "GET", action: "session" },
    "/api/admin/rooms": { method: "GET", action: "rooms" },
    "/api/admin/config": { method: "POST", action: "config" },
    "/api/admin/purge-expired": { method: "POST", action: "purge-expired" },
  };
  if (Object.hasOwn(routes, path)) return routes[path]!;
  const match = /^\/api\/admin\/rooms\/([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8})\/(close|purge)$/.exec(path);
  return match ? { method: "POST", action: match[2]!, roomCode: match[1]! } : null;
}

export function enforceAdminRequest(request: Request, method: string, callback = false): void {
  if (request.method !== method) throw new AdminError("METHOD_NOT_ALLOWED", "This administration route does not allow that method.", 405);
  const url = new URL(request.url);
  if (url.protocol !== "https:") throw new AdminError("HTTPS_REQUIRED", "Administration requires a secure HTTPS connection.", 403);
  if (!callback && url.search) throw new AdminError("INVALID_QUERY", "Administration routes do not accept query parameters.");
  const origin = request.headers.get("Origin");
  const site = request.headers.get("Sec-Fetch-Site");
  if (method === "POST") {
    if (origin !== url.origin || (site !== null && site !== "same-origin")) {
      throw new AdminError("CSRF_REJECTED", "Use the administration page on this same origin.", 403);
    }
  } else if ((origin !== null && origin !== url.origin) || site === "cross-site" && !["/admin", "/admin/auth/callback"].includes(url.pathname)) {
    throw new AdminError("ORIGIN_REJECTED", "Cross-origin administration requests are not allowed.", 403);
  }
  if (method === "GET" && request.body !== null) throw new AdminError("INVALID_BODY", "GET requests cannot include a body.");
}

export function cookieValue(header: string | null, name: string): string | null {
  if (!header || header.length > 8192) return null;
  let result: string | null = null;
  for (const cookie of header.split(";")) {
    const index = cookie.indexOf("=");
    if (index < 0 || cookie.slice(0, index).trim() !== name) continue;
    const value = cookie.slice(index + 1).trim();
    if (result !== null || !OPAQUE_TOKEN.test(value)) return null;
    result = value;
  }
  return result;
}

export function adminCookie(name: typeof SESSION_COOKIE | typeof OAUTH_COOKIE, token: string, seconds: number): string {
  if (token !== "" && !OPAQUE_TOKEN.test(token)) throw new Error("Invalid cookie token.");
  return `${name}=${token}; Path=/; Max-Age=${seconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function ownerConfigured(env: { ADMIN_GITHUB_USER_ID: string; GITHUB_CLIENT_ID?: string; GITHUB_CLIENT_SECRET?: string }): boolean {
  return env.ADMIN_GITHUB_USER_ID === OWNER_GITHUB_ID &&
    typeof env.GITHUB_CLIENT_ID === "string" && env.GITHUB_CLIENT_ID.trim().length > 0 &&
    typeof env.GITHUB_CLIENT_SECRET === "string" && env.GITHUB_CLIENT_SECRET.trim().length > 0;
}

export function ownerIdentity(value: unknown, configuredOwner: string): { id: string; login: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AdminError("OAUTH_FAILED", "GitHub sign-in could not be verified.", 502);
  const profile = value as Record<string, unknown>;
  if (configuredOwner !== OWNER_GITHUB_ID || profile.id !== Number(OWNER_GITHUB_ID)) {
    throw new AdminError("OWNER_REQUIRED", "Only the configured Ko Ho? owner can administer rooms.", 403);
  }
  if (typeof profile.login !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(profile.login)) {
    throw new AdminError("OAUTH_FAILED", "GitHub sign-in could not be verified.", 502);
  }
  return { id: OWNER_GITHUB_ID, login: profile.login };
}

export function requireOwnerSession(session: AdminSessionRecord | null, configuredOwner: string, origin: string, now: number): AdminSessionRecord {
  if (!session || configuredOwner !== OWNER_GITHUB_ID || session.user_id !== OWNER_GITHUB_ID ||
      session.origin !== origin || session.created_at > now || session.expires_at <= now ||
      session.expires_at - session.created_at !== ADMIN_SESSION_MS) {
    throw new AdminError("ADMIN_SIGN_IN_REQUIRED", "Sign in with the owner’s GitHub account to continue.", 401);
  }
  return session;
}

export async function csrfToken(sessionToken: string): Promise<string> {
  if (!OPAQUE_TOKEN.test(sessionToken)) throw new AdminError("CSRF_REJECTED", "The administration session is invalid.", 403);
  return hashSecret(`koho-admin-csrf:${sessionToken}`);
}

export async function enforceCsrf(request: Request, session: AdminSessionRecord): Promise<void> {
  const token = request.headers.get("X-CSRF-Token");
  if (!token || !/^[a-f0-9]{64}$/.test(token) || await hashSecret(token) !== session.csrf_hash) {
    throw new AdminError("CSRF_REJECTED", "Refresh the administration page before trying again.", 403);
  }
}

async function base64Digest(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function pkceChallenge(verifier: string): Promise<string> {
  return base64Digest(verifier);
}

export function pkceVerifier(state: string, binding: string): Promise<string> {
  return base64Digest(`koho-admin-pkce:${state}:${binding}`);
}

export async function newOAuthNonce(origin: string, now: number): Promise<{ state: string; binding: string; verifier: string; record: OAuthNonceRecord }> {
  const state = makeToken();
  const binding = makeToken();
  return {
    state,
    binding,
    verifier: await pkceVerifier(state, binding),
    record: {
      state_hash: await hashSecret(state),
      binding_hash: await hashSecret(binding),
      redirect_uri: `${origin}/admin/auth/callback`,
      created_at: now,
      expires_at: now + OAUTH_NONCE_MS,
    },
  };
}

export function oauthCallbackParameters(url: URL): { state: string; code: string | null } {
  const allowed = new Set(["state", "code", "iss", "error", "error_description", "error_uri"]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw new AdminError("OAUTH_STATE_INVALID", "Restart GitHub sign-in from the administration page.", 400);
  }
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (url.searchParams.get("iss") !== "https://github.com/login/oauth" || !state || !OPAQUE_TOKEN.test(state) || (code !== null && (code.length < 1 || code.length > 1024 || /[\s\x00-\x1f\x7f]/.test(code)))) {
    throw new AdminError("OAUTH_STATE_INVALID", "Restart GitHub sign-in from the administration page.", 400);
  }
  if ((!code && !url.searchParams.has("error")) || (code && url.searchParams.has("error"))) throw new AdminError("OAUTH_STATE_INVALID", "Restart GitHub sign-in from the administration page.", 400);
  return { state, code };
}

export async function verifyOAuthNonce(record: OAuthNonceRecord | null, state: string, binding: string | null, origin: string, now: number): Promise<void> {
  if (!record || !binding || !OPAQUE_TOKEN.test(state) || !OPAQUE_TOKEN.test(binding) ||
      record.expires_at <= now || record.created_at > now || record.expires_at - record.created_at !== OAUTH_NONCE_MS ||
      record.redirect_uri !== `${origin}/admin/auth/callback` || record.state_hash !== await hashSecret(state) || record.binding_hash !== await hashSecret(binding)) {
    throw new AdminError("OAUTH_STATE_INVALID", "This sign-in attempt expired or belongs to another browser. Start again.", 400);
  }
}

export async function readAdminJson(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("Content-Type") ?? "")) {
    throw new AdminError("INVALID_BODY", "Send a JSON request body.", 415);
  }
  const declared = request.headers.get("Content-Length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > ADMIN_BODY_LIMIT)) throw new AdminError("BODY_TOO_LARGE", "The administration request is too large.", 413);
  if (!request.body) throw new AdminError("INVALID_BODY", "A JSON request body is required.");
  const reader = request.body.getReader();
  const bytes = new Uint8Array(ADMIN_BODY_LIMIT);
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (size + value.byteLength > ADMIN_BODY_LIMIT) {
      await reader.cancel();
      throw new AdminError("BODY_TOO_LARGE", "The administration request is too large.", 413);
    }
    bytes.set(value, size);
    size += value.byteLength;
  }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes.subarray(0, size))); }
  catch { throw new AdminError("INVALID_BODY", "Send a valid JSON object."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AdminError("INVALID_BODY", "Send a JSON object.");
  return value as Record<string, unknown>;
}

export function exactAdminKeys(body: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(body).length !== keys.length || keys.some((key) => !Object.hasOwn(body, key))) throw new AdminError("INVALID_BODY", "The administration request has unexpected or missing fields.");
}

export function capCommand(body: Record<string, unknown>): { roomCap: number; configVersion: number } {
  exactAdminKeys(body, ["roomCap", "configVersion"]);
  if (!Number.isSafeInteger(body.roomCap) || (body.roomCap as number) < 1 || (body.roomCap as number) > 20 || !Number.isSafeInteger(body.configVersion) || (body.configVersion as number) < 1) {
    throw new AdminError("INVALID_CAP", "Choose a room cap from 1 to 20 and refresh stale configuration.");
  }
  return { roomCap: body.roomCap as number, configVersion: body.configVersion as number };
}

export function partyCommand(body: Record<string, unknown>, allowNull: boolean): string | null {
  exactAdminKeys(body, ["partyId"]);
  if (allowNull && body.partyId === null) return null;
  if (typeof body.partyId !== "string" || body.partyId.length < 1 || body.partyId.length > 128 || /[\x00-\x20\x7f]/.test(body.partyId)) throw new AdminError("INVALID_BODY", "Refresh the room list before acting on a party.");
  return body.partyId;
}

/** Explicit projection is a second boundary: never forward unexpected room data. */
export function adminDirectoryView(view: AdminDirectoryView): AdminDirectoryView {
  const rooms: AdminRoom[] = view.rooms.map((room) => {
    if (!ROOM_CODE.test(room.roomCode)) throw new Error("Invalid registry room code.");
    return {
      roomCode: room.roomCode, partyId: room.partyId, status: room.status, phase: room.phase,
      playerCount: room.playerCount, connectedCount: room.connectedCount, createdAt: room.createdAt,
      lastActivityAt: room.lastActivityAt, expiresAt: room.expiresAt, abandonedExpiresAt: room.abandonedExpiresAt,
      completedGames: room.completedGames, closedAt: room.closedAt,
      closeReason: room.closeReason, storagePurged: room.storagePurged,
    };
  });
  return { rooms, roomCap: view.roomCap, configVersion: view.configVersion, activeRooms: view.activeRooms };
}

export function registryAdminError(error: unknown): AdminError {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code :
    error instanceof Error ? /^([A-Z_]+):/.exec(error.message)?.[1] : undefined;
  const known: Record<string, [string, number]> = {
    ROOM_NOT_FOUND: ["This room no longer exists. Refresh the room list.", 404],
    STALE_PARTY: ["This room now contains a different party. Refresh before acting.", 409],
    ROOM_ACTIVE: ["Close this room before purging its storage.", 409],
    STALE_CONFIG: ["The room cap changed elsewhere. Refresh before saving.", 409],
    INVALID_CAP: ["Choose a room cap from 1 to 20.", 400],
  };
  const detail = code && Object.hasOwn(known, code) ? known[code] : undefined;
  return detail ? new AdminError(code!, detail[0], detail[1]) : new AdminError("ADMIN_UNAVAILABLE", "The room directory could not complete that request. Refresh and try again.", 503);
}

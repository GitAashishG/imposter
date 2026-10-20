import { describe, expect, test } from "bun:test";
import type { AdminDirectoryView } from "../src/party/protocol";
import { hashSecret, makeToken } from "./security";
import { githubAuthorizationUrl } from "./admin-provider";
import {
  ADMIN_BODY_LIMIT,
  ADMIN_SESSION_MS,
  OAUTH_COOKIE,
  OAUTH_NONCE_MS,
  OWNER_GITHUB_ID,
  SESSION_COOKIE,
  AdminError,
  adminCookie,
  adminDirectoryView,
  adminRoute,
  capCommand,
  cookieValue,
  csrfToken,
  enforceAdminRequest,
  enforceCsrf,
  exactAdminKeys,
  isAdminPath,
  newOAuthNonce,
  oauthCallbackParameters,
  ownerConfigured,
  ownerIdentity,
  partyCommand,
  pkceChallenge,
  pkceVerifier,
  readAdminJson,
  registryAdminError,
  requireOwnerSession,
  verifyOAuthNonce,
  type AdminSessionRecord,
} from "./admin-security";

const origin = "https://ko-ho-party.example.workers.dev";
const now = 1_000_000;
const token = "A".repeat(43);
function session(overrides: Partial<AdminSessionRecord> = {}): AdminSessionRecord {
  return { token_hash: "hash", csrf_hash: "hash", user_id: OWNER_GITHUB_ID, login: "GitAashishG", origin, created_at: now, expires_at: now + ADMIN_SESSION_MS, ...overrides };
}
function post(path = "/api/admin/config", options: { origin?: string; csrf?: string; site?: string; body?: string; type?: string; method?: string } = {}): Request {
  return new Request(origin + path, {
    method: options.method ?? "POST",
    headers: { Origin: options.origin ?? origin, "Content-Type": options.type ?? "application/json", ...(options.csrf ? { "X-CSRF-Token": options.csrf } : {}), ...(options.site ? { "Sec-Fetch-Site": options.site } : {}) },
    body: options.body ?? '{"roomCap":5,"configVersion":1}',
  });
}

describe("immutable owner policy and fixed session lifetime", () => {
  test("requires the real numeric owner id, not login, local flags, or configurable impersonation", () => {
    expect(ownerIdentity({ id: 9066299, login: "renamed-owner", private: "discard" }, OWNER_GITHUB_ID)).toEqual({ id: OWNER_GITHUB_ID, login: "renamed-owner" });
    for (const profile of [{ id: 1, login: "GitAashishG" }, { id: "9066299", login: "GitAashishG" }, { login: "GitAashishG", admin: true }, { id: 9066299, login: "<script>" }]) {
      expect(() => ownerIdentity(profile, OWNER_GITHUB_ID)).toThrow(AdminError);
    }
    expect(() => ownerIdentity({ id: 1, login: "attacker" }, "1")).toThrow(AdminError);
    expect(() => ownerIdentity({ id: 9066299, login: "owner" }, "1")).toThrow(AdminError);
  });
  test("fails closed until both OAuth secrets and the immutable owner policy are configured", () => {
    expect(ownerConfigured({ ADMIN_GITHUB_USER_ID: OWNER_GITHUB_ID })).toBe(false);
    expect(ownerConfigured({ ADMIN_GITHUB_USER_ID: OWNER_GITHUB_ID, GITHUB_CLIENT_ID: "client", GITHUB_CLIENT_SECRET: " " })).toBe(false);
    expect(ownerConfigured({ ADMIN_GITHUB_USER_ID: "1", GITHUB_CLIENT_ID: "client", GITHUB_CLIENT_SECRET: "secret" })).toBe(false);
    expect(ownerConfigured({ ADMIN_GITHUB_USER_ID: OWNER_GITHUB_ID, GITHUB_CLIENT_ID: "client", GITHUB_CLIENT_SECRET: "secret" })).toBe(true);
  });
  test("expiry is exclusive, never sliding, and session origin and owner are checked every request", () => {
    const saved = session();
    expect(requireOwnerSession(saved, OWNER_GITHUB_ID, origin, now + ADMIN_SESSION_MS - 1)).toBe(saved);
    for (const invalid of [null, session({ user_id: "1" }), session({ origin: "https://evil.example" }), session({ created_at: now + 1 }), session({ expires_at: now + ADMIN_SESSION_MS + 1 })]) {
      expect(() => requireOwnerSession(invalid, OWNER_GITHUB_ID, origin, now)).toThrow(AdminError);
    }
    expect(() => requireOwnerSession(saved, OWNER_GITHUB_ID, origin, saved.expires_at)).toThrow(AdminError);
    expect(() => requireOwnerSession(saved, "1", origin, now)).toThrow(AdminError);
    expect(saved.expires_at).toBe(now + ADMIN_SESSION_MS);
  });
});

describe("route, cookie and same-origin consumer boundaries", () => {
  test("only exact admin namespaces enter the auth service; no old or guessed aliases", () => {
    for (const path of ["/admin", "/admin/auth/callback", "/api/admin/rooms", "/api/admin/unknown"]) expect(isAdminPath(path)).toBe(true);
    for (const path of ["/api/rooms", "/api/rooms/ABCDEFGH/state", "/administrator", "/administer", "/api/administration", "/"]) expect(isAdminPath(path)).toBe(false);
    expect(adminRoute("/api/admin/rooms/ABCDEFGH/close")).toEqual({ method: "POST", action: "close", roomCode: "ABCDEFGH" });
    for (const path of ["/api/admin/rooms/abcdefgh/close", "/api/admin/rooms/ABCDEFGH/delete", "/api/admin/rooms/ABCDEFGH/close/", "/api/admin/rooms/ABCD0123/close", "/api/admin/session/", "/admin/auth/local", "/api/admin/rooms?admin=true"]) expect(adminRoute(path)).toBeNull();
  });
  test("secure host-only cookies are opaque, HttpOnly, Lax, scoped to root and expire on logout", () => {
    const value = adminCookie(SESSION_COOKIE, token, ADMIN_SESSION_MS / 1000);
    expect(value).toBe(`${SESSION_COOKIE}=${token}; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=Lax`);
    expect(value).not.toContain("Domain=");
    expect(adminCookie(OAUTH_COOKIE, token, OAUTH_NONCE_MS / 1000)).toContain("Max-Age=600");
    expect(adminCookie(SESSION_COOKIE, "", 0)).toContain("=; Path=/; Max-Age=0;");
    expect(() => adminCookie(SESSION_COOKIE, "x\r\nInjected: true", 1)).toThrow();
    expect(cookieValue(`other=x; ${SESSION_COOKIE}=${token}`, SESSION_COOKIE)).toBe(token);
    expect(cookieValue(`${SESSION_COOKIE}=${token}; ${SESSION_COOKIE}=${token}`, SESSION_COOKIE)).toBeNull();
    expect(cookieValue(`${SESSION_COOKIE}=bad; ${SESSION_COOKIE}=${token}`, SESSION_COOKIE)).toBeNull();
    expect(cookieValue(`${SESSION_COOKIE}=${token}%3Bfoo`, SESSION_COOKIE)).toBeNull();
    expect(cookieValue(`host_token=${token}; admin=true`, SESSION_COOKIE)).toBeNull();
  });
  test("mutations require POST, exact Origin, HTTPS, no query, and no cross-site fetch", () => {
    expect(() => enforceAdminRequest(post(), "POST")).not.toThrow();
    const invalid = [
      post("/api/admin/config", { origin: "https://evil.example" }),
      post("/api/admin/config", { origin: "null" }),
      post("/api/admin/config", { origin: "https://ko-ho-party.example.workers.dev.evil.example" }),
      post("/api/admin/config", { site: "same-site" }),
      post("/api/admin/config", { site: "cross-site" }),
      post("/api/admin/config?csrf=anything"),
      new Request(origin + "/api/admin/config", { method: "POST", body: "{}" }),
      new Request("http://localhost:8787/api/admin/config", { method: "POST", headers: { Origin: "http://localhost:8787" }, body: "{}" }),
      new Request(origin + "/api/admin/config"),
      post("/api/admin/config", { method: "PUT" }),
    ];
    for (const request of invalid) expect(() => enforceAdminRequest(request, "POST")).toThrow(AdminError);
    expect(() => enforceAdminRequest(new Request(origin + "/api/admin/rooms", { headers: { Origin: "https://evil.example" } }), "GET")).toThrow(AdminError);
    expect(() => enforceAdminRequest(new Request(origin + "/api/admin/session", { method: "OPTIONS" }), "GET")).toThrow(AdminError);
    expect(() => enforceAdminRequest(new Request(origin + "/admin/auth/callback?state=x", { headers: { "Sec-Fetch-Site": "cross-site" } }), "GET", true)).not.toThrow();
  });
  test("CSRF belongs to one session and neither room credentials nor cookies substitute for it", async () => {
    const csrf = await csrfToken(token);
    const saved = session({ csrf_hash: await hashSecret(csrf) });
    await expect(enforceCsrf(post("/api/admin/config", { csrf }), saved)).resolves.toBeUndefined();
    for (const request of [post(), post("/api/admin/config", { csrf: token }), post("/api/admin/config", { csrf: await csrfToken("B".repeat(43)) }), new Request(origin + "/admin/logout", { method: "POST", headers: { Cookie: `${SESSION_COOKIE}=${token}`, Authorization: `Bearer ${token}` } })]) {
      await expect(enforceCsrf(request, saved)).rejects.toBeInstanceOf(AdminError);
    }
    expect(await csrfToken(token)).toBe(csrf);
    expect(csrf).not.toBe(token);
  });
});

describe("OAuth state, browser binding and S256 PKCE", () => {
  test("matches the RFC7636 S256 test vector and requests no GitHub permissions", async () => {
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    const flow = await newOAuthNonce(origin, now);
    const url = new URL(await githubAuthorizationUrl("public-client-id", flow.state, flow.verifier, flow.record.redirect_uri));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe("");
    expect(url.searchParams.get("state")).toBe(flow.state);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(await pkceChallenge(flow.verifier));
    expect(url.searchParams.get("redirect_uri")).toBe(origin + "/admin/auth/callback");
    expect(url.searchParams.has("client_secret")).toBe(false);
    expect(url.href).not.toContain(flow.binding);
    expect(flow.record).not.toHaveProperty("verifier");
    expect(flow.record.state_hash).not.toBe(flow.state);
    expect(flow.record.binding_hash).not.toBe(flow.binding);
  });
  test("callback validates state, browser nonce, exact origin and ten-minute expiry", async () => {
    const flow = await newOAuthNonce(origin, now);
    await expect(verifyOAuthNonce(flow.record, flow.state, flow.binding, origin, now + OAUTH_NONCE_MS - 1)).resolves.toBeUndefined();
    for (const attempt of [
      { record: null, state: flow.state, binding: flow.binding, origin, time: now },
      { record: flow.record, state: makeToken(), binding: flow.binding, origin, time: now },
      { record: flow.record, state: flow.state, binding: makeToken(), origin, time: now },
      { record: flow.record, state: flow.state, binding: null, origin, time: now },
      { record: flow.record, state: flow.state, binding: flow.binding, origin: "https://evil.example", time: now },
      { record: flow.record, state: flow.state, binding: flow.binding, origin, time: now + OAUTH_NONCE_MS },
      { record: flow.record, state: flow.state, binding: flow.binding, origin, time: now - 1 },
    ]) await expect(verifyOAuthNonce(attempt.record, attempt.state, attempt.binding, attempt.origin, attempt.time)).rejects.toBeInstanceOf(AdminError);
    expect(await pkceVerifier(flow.state, flow.binding)).toBe(flow.verifier);
    expect(await pkceVerifier(flow.state, makeToken())).not.toBe(flow.verifier);
  });
  test("callback rejects repeated/extra parameters and never follows caller redirects", () => {
    expect(oauthCallbackParameters(new URL(origin + "/admin/auth/callback?state=" + token + "&code=github-code"))).toEqual({ state: token, code: "github-code" });
    expect(oauthCallbackParameters(new URL(origin + "/admin/auth/callback?state=" + token + "&error=access_denied"))).toEqual({ state: token, code: null });
    for (const suffix of ["state=x&code=c", `state=${token}&state=${token}&code=c`, `state=${token}&code=c&code=d`, `state=${token}&code=c&redirect_uri=https://evil.example`, `state=${token}&code=c&error=denied`, `state=${token}`, `state=${token}&code=%0D%0Ainjected`]) {
      expect(() => oauthCallbackParameters(new URL(origin + "/admin/auth/callback?" + suffix))).toThrow(AdminError);
    }
  });
});

describe("bounded bodies and registry command consumers", () => {
  test("parses only bounded JSON objects, even without Content-Length", async () => {
    expect(await readAdminJson(post())).toEqual({ roomCap: 5, configVersion: 1 });
    for (const options of [{ body: "[]" }, { body: "null" }, { body: "{" }, { body: '"text"' }, { type: "text/plain", body: "{}" }, { body: JSON.stringify({ padding: "x".repeat(ADMIN_BODY_LIMIT) }) }]) {
      await expect(readAdminJson(post("/api/admin/config", options))).rejects.toBeInstanceOf(AdminError);
    }
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(ADMIN_BODY_LIMIT)); controller.enqueue(new Uint8Array([32])); controller.close(); } });
    await expect(readAdminJson(new Request(origin + "/api/admin/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream }))).rejects.toBeInstanceOf(AdminError);
    expect(() => exactAdminKeys({ admin: true }, [])).toThrow(AdminError);
  });
  test("capacity uses CAS and room operations cannot omit captured party identity", () => {
    expect(capCommand({ roomCap: 1, configVersion: 1 })).toEqual({ roomCap: 1, configVersion: 1 });
    expect(capCommand({ roomCap: 20, configVersion: 42 })).toEqual({ roomCap: 20, configVersion: 42 });
    for (const value of [0, 21, 1.5, "5", NaN, Infinity]) expect(() => capCommand({ roomCap: value, configVersion: 1 })).toThrow(AdminError);
    for (const version of [null, "1", -1, 0, 1.5]) expect(() => capCommand({ roomCap: 5, configVersion: version })).toThrow(AdminError);
    expect(() => capCommand({ roomCap: 5, configVersion: 1, admin: true })).toThrow(AdminError);
    expect(partyCommand({ partyId: "captured-party-id" }, false)).toBe("captured-party-id");
    expect(partyCommand({ partyId: null }, true)).toBeNull();
    for (const body of [{}, { partyId: null }, { partyId: "" }, { partyId: "stale party" }, { partyId: "id", force: true }]) expect(() => partyCommand(body, false)).toThrow(AdminError);
  });
  test("admin responses explicitly strip private or unexpected registry fields", () => {
    const view = {
      roomCap: 5, configVersion: 1, activeRooms: 1, accessToken: "provider-secret",
      rooms: [{ roomCode: "ABCDEFGH", partyId: "party-id", status: "active", phase: "vote", playerCount: 3, connectedCount: 2, createdAt: 1, lastActivityAt: 2, expiresAt: 3, abandonedExpiresAt: null, completedGames: 2, closedAt: null, closeReason: null, storagePurged: false, players: [{ name: "private name", tokenHash: "private-token" }], pin: "123456", word: "private-word", votes: { host: "target" }, recoveryCode: "private-recovery" }],
    };
    const result = adminDirectoryView(view as AdminDirectoryView);
    expect(Object.keys(result).sort()).toEqual(["activeRooms", "configVersion", "roomCap", "rooms"]);
    expect(Object.keys(result.rooms[0]!).sort()).toEqual(["abandonedExpiresAt", "closeReason", "closedAt", "completedGames", "connectedCount", "createdAt", "expiresAt", "lastActivityAt", "partyId", "phase", "playerCount", "roomCode", "status", "storagePurged"]);
    const text = JSON.stringify(result);
    for (const secret of ["provider-secret", "private name", "private-token", "123456", "private-word", "private-recovery", '"votes"']) expect(text).not.toContain(secret);
  });
  test("RPC errors preserve safe conflicts but never reflect arbitrary exception text", () => {
    expect(registryAdminError(new Error("STALE_CONFIG: sensitive internal value")).status).toBe(409);
    expect(registryAdminError(new Error("ROOM_ACTIVE: sensitive internal value")).code).toBe("ROOM_ACTIVE");
    expect(registryAdminError({ code: "STALE_PARTY", message: "private" }).status).toBe(409);
    for (const error of [new Error("provider-secret"), new Error("UNKNOWN: private-token"), { status: 401, message: "private words" }]) {
      const safe = registryAdminError(error);
      expect(safe.status).toBe(503);
      expect(safe.message).not.toMatch(/provider-secret|private-token|private words/);
    }
  });
});

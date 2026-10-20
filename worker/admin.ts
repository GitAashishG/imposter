import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { SerialQueue, hashSecret, makeToken } from "./security";
import { adminPage } from "./admin-page";
import { githubAuthorizationUrl, verifyGithubOwner } from "./admin-provider";
import { admitFreshOAuthStart, OAUTH_START_BUCKET_LIMIT, type OAuthStartRate } from "./admin-admission";
import {
  ADMIN_SESSION_MS,
  OAUTH_NONCE_MS,
  OAUTH_COOKIE,
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
  partyCommand,
  pkceVerifier,
  readAdminJson,
  registryAdminError,
  requireOwnerSession,
  verifyOAuthNonce,
  type AdminSessionRecord,
  type OAuthNonceRecord,
} from "./admin-security";

const MAX_NONCES = 128;
const MAX_SESSIONS = 32;
const SETUP_ERROR = "Owner administration is not configured. The owner must register the GitHub OAuth app and set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET Worker secrets, with owner ID 9066299. Public play does not require GitHub sign-in.";

type SessionRow = AdminSessionRecord & Record<string, SqlStorageValue>;
type NonceRow = OAuthNonceRecord & Record<string, SqlStorageValue>;
type StartRateRow = OAuthStartRate & Record<string, SqlStorageValue>;

function responseHeaders(): Headers {
  return new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Strict-Transport-Security": "max-age=31536000",
  });
}

function json(value: unknown, status = 200): Response {
  const headers = responseHeaders();
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { status, headers });
}

function redirect(location: string): Response {
  const headers = responseHeaders();
  headers.set("Location", location);
  return new Response(null, { status: 303, headers });
}

function errorResponse(error: unknown): Response {
  if (error instanceof AdminError) return json({ error: error.message, code: error.code }, error.status);
  return json({ error: "Administration could not complete this request. Please try again.", code: "ADMIN_ERROR" }, 500);
}

/** Runs before public CORS. Neither room credentials nor public origins authorize it. */
export async function handleAdminRequest(request: Request, env: Env): Promise<Response | null> {
  if (!isAdminPath(new URL(request.url).pathname)) return null;
  return env.ADMIN_AUTH.getByName("owner").fetch(request);
}

export class AdminAuth extends DurableObject<Env> {
  private readonly queue = new SerialQueue();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS oauth_nonces (
      state_hash TEXT PRIMARY KEY,
      binding_hash TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`);
    ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS oauth_nonce_expiry ON oauth_nonces(expires_at)");
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      csrf_hash TEXT NOT NULL,
      user_id TEXT NOT NULL,
      login TEXT NOT NULL,
      origin TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`);
    ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS admin_session_expiry ON admin_sessions(expires_at)");
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS oauth_start_rates (ip_hash TEXT PRIMARY KEY, started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, count INTEGER NOT NULL)");
    ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS oauth_start_rate_expiry ON oauth_start_rates(expires_at)");
  }

  async fetch(request: Request): Promise<Response> {
    return this.queue.run(async () => {
      let response: Response;
      try { response = await this.route(request); }
      catch (error) { response = errorResponse(error); }
      if (new URL(request.url).pathname === "/admin/auth/callback") {
        response.headers.append("Set-Cookie", adminCookie(OAUTH_COOKIE, "", 0));
      }
      return response;
    });
  }

  private async route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const route = adminRoute(url.pathname);
    if (!route) throw new AdminError("ADMIN_NOT_FOUND", "This administration route does not exist.", 404);
    // Configuration errors are useful locally too, but never permit authentication.
    if (!ownerConfigured(this.env)) {
      if (request.method !== route.method) {
        const response = errorResponse(new AdminError("METHOD_NOT_ALLOWED", "This administration route does not allow that method.", 405));
        response.headers.set("Allow", route.method);
        return response;
      }
      if (route.action === "page") return this.page(false, false, 503);
      throw new AdminError("ADMIN_NOT_CONFIGURED", SETUP_ERROR, 503);
    }
    try { enforceAdminRequest(request, route.method, route.action === "callback"); }
    catch (error) {
      if (error instanceof AdminError && error.status === 405) {
        const response = errorResponse(error);
        response.headers.set("Allow", route.method);
        return response;
      }
      throw error;
    }
    const now = Date.now();
    await this.cleanup(now);
    if (route.action === "start") return this.start(request, now);
    if (route.action === "callback") return this.callback(request, now);

    const token = cookieValue(request.headers.get("Cookie"), SESSION_COOKIE);
    const session = token ? this.ctx.storage.sql.exec<SessionRow>("SELECT * FROM admin_sessions WHERE token_hash = ?", await hashSecret(token)).toArray()[0] ?? null : null;
    let owner: AdminSessionRecord;
    try { owner = requireOwnerSession(session, this.env.ADMIN_GITHUB_USER_ID, url.origin, now); }
    catch (error) {
      if (route.action === "page" && error instanceof AdminError && error.status === 401) return this.page(false, true);
      throw error;
    }
    if (route.action === "page") return this.page(true, true);
    if (request.method === "POST") await enforceCsrf(request, owner);

    if (route.action === "session") return json({ owner: { id: owner.user_id, login: owner.login }, expiresAt: owner.expires_at, csrfToken: await csrfToken(token!) });
    if (route.action === "logout") {
      exactAdminKeys(await readAdminJson(request), []);
      this.ctx.storage.sql.exec("DELETE FROM admin_sessions WHERE token_hash = ?", owner.token_hash);
      await this.scheduleCleanup();
      const response = json({ signedOut: true });
      response.headers.append("Set-Cookie", adminCookie(SESSION_COOKIE, "", 0));
      response.headers.append("Set-Cookie", adminCookie(OAUTH_COOKIE, "", 0));
      return response;
    }

    const directory = this.env.DIRECTORY.getByName("rooms");
    try {
      if (route.action === "rooms") return json(adminDirectoryView(await directory.listForAdmin()));
      const body = await readAdminJson(request);
      if (route.action === "config") {
        const { roomCap, configVersion } = capCommand(body);
        const config = await directory.setRoomCap(roomCap, configVersion);
        return json({ roomCap: config.roomCap, configVersion: config.configVersion });
      }
      if (route.action === "close") {
        const partyId = partyCommand(body, false)!;
        await directory.closeForAdmin(route.roomCode!, partyId);
        return json({ closed: true });
      }
      if (route.action === "purge") {
        const partyId = partyCommand(body, true);
        await directory.purgeForAdmin(route.roomCode!, partyId);
        return json({ purged: true });
      }
      if (route.action === "purge-expired") {
        exactAdminKeys(body, []);
        const result = await directory.purgeExpiredForAdmin();
        return json({ purged: result.purged });
      }
      throw new AdminError("ADMIN_NOT_FOUND", "This administration route does not exist.", 404);
    } catch (error) {
      if (error instanceof AdminError) throw error;
      throw registryAdminError(error);
    }
  }

  private page(signedIn: boolean, configured: boolean, status = 200): Response {
    const nonce = makeToken();
    const headers = responseHeaders();
    headers.set("Content-Type", "text/html; charset=utf-8");
    headers.set("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'`);
    return new Response(adminPage(nonce, signedIn, configured, this.env.PUBLIC_SITE_URL), { status, headers });
  }

  private async start(request: Request, now: number): Promise<Response> {
    const oldBinding = cookieValue(request.headers.get("Cookie"), OAUTH_COOKIE);
    const oldHash = oldBinding ? await hashSecret(oldBinding) : null;
    const replacing = oldHash !== null && this.ctx.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM oauth_nonces WHERE binding_hash = ?", oldHash).toArray()[0]!.count > 0;
    if (!replacing) {
      const ipHash = await hashSecret(request.headers.get("CF-Connecting-IP") ?? "local");
      const previous = this.ctx.storage.sql.exec<StartRateRow>("SELECT * FROM oauth_start_rates WHERE ip_hash = ?", ipHash).toArray()[0] ?? null;
      const rate = admitFreshOAuthStart(previous, ipHash, now);
      this.ctx.storage.sql.exec("INSERT INTO oauth_start_rates (ip_hash, started_at, expires_at, count) VALUES (?, ?, ?, ?) ON CONFLICT(ip_hash) DO UPDATE SET started_at = excluded.started_at, expires_at = excluded.expires_at, count = excluded.count", rate.ip_hash, rate.started_at, rate.expires_at, rate.count);
      this.ctx.storage.sql.exec("DELETE FROM oauth_start_rates WHERE ip_hash IN (SELECT ip_hash FROM oauth_start_rates ORDER BY expires_at DESC, ip_hash LIMIT -1 OFFSET ?)", OAUTH_START_BUCKET_LIMIT);
    }
    const origin = new URL(request.url).origin;
    const flow = await newOAuthNonce(origin, now);
    const record = flow.record;
    this.ctx.storage.transactionSync(() => {
      // Replace this browser's slot before checking global capacity. An existing
      // binding can renew even when other browsers have filled the nonce pool.
      if (oldHash) this.ctx.storage.sql.exec("DELETE FROM oauth_nonces WHERE binding_hash = ?", oldHash);
      const count = this.ctx.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM oauth_nonces").toArray()[0]!.count;
      if (count >= MAX_NONCES) throw new AdminError("OAUTH_BUSY", "Too many pending sign-ins. Wait a few minutes and try again.", 429);
      this.ctx.storage.sql.exec("INSERT INTO oauth_nonces (state_hash, binding_hash, redirect_uri, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", record.state_hash, record.binding_hash, record.redirect_uri, record.created_at, record.expires_at);
    });
    await this.scheduleCleanup();
    const response = redirect(await githubAuthorizationUrl(this.env.GITHUB_CLIENT_ID!, flow.state, flow.verifier, record.redirect_uri));
    response.headers.append("Set-Cookie", adminCookie(OAUTH_COOKIE, flow.binding, OAUTH_NONCE_MS / 1000));
    return response;
  }

  private async callback(request: Request, now: number): Promise<Response> {
    const url = new URL(request.url);
    const { state, code } = oauthCallbackParameters(url);
    const stateHash = await hashSecret(state);
    const record = this.ctx.storage.sql.exec<NonceRow>("SELECT * FROM oauth_nonces WHERE state_hash = ?", stateHash).toArray()[0] ?? null;
    const binding = cookieValue(request.headers.get("Cookie"), OAUTH_COOKIE);
    await verifyOAuthNonce(record, state, binding, url.origin, now);
    // Consume before any provider request; errors, denial and replay cannot reuse it.
    this.ctx.storage.sql.exec("DELETE FROM oauth_nonces WHERE state_hash = ?", stateHash);
    await this.scheduleCleanup();
    if (!code) throw new AdminError("OAUTH_DENIED", "GitHub sign-in was not completed. Start again from the administration page.", 403);
    const identity = await verifyGithubOwner(this.env, code, await pkceVerifier(state, binding!), record!.redirect_uri);
    const token = makeToken();
    const tokenHash = await hashSecret(token);
    const csrfHash = await hashSecret(await csrfToken(token));
    const createdAt = Date.now();
    const oldToken = cookieValue(request.headers.get("Cookie"), SESSION_COOKIE);
    if (oldToken) this.ctx.storage.sql.exec("DELETE FROM admin_sessions WHERE token_hash = ?", await hashSecret(oldToken));
    this.ctx.storage.sql.exec("INSERT INTO admin_sessions (token_hash, csrf_hash, user_id, login, origin, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)", tokenHash, csrfHash, identity.id, identity.login, url.origin, createdAt, createdAt + ADMIN_SESSION_MS);
    this.ctx.storage.sql.exec("DELETE FROM admin_sessions WHERE token_hash IN (SELECT token_hash FROM admin_sessions ORDER BY created_at DESC, token_hash LIMIT -1 OFFSET ?)", MAX_SESSIONS);
    await this.scheduleCleanup();
    const response = redirect("/admin");
    response.headers.append("Set-Cookie", adminCookie(SESSION_COOKIE, token, ADMIN_SESSION_MS / 1000));
    return response;
  }

  private async cleanup(now: number): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM oauth_nonces WHERE expires_at <= ?", now);
    this.ctx.storage.sql.exec("DELETE FROM admin_sessions WHERE expires_at <= ?", now);
    this.ctx.storage.sql.exec("DELETE FROM oauth_start_rates WHERE expires_at <= ?", now);
    await this.scheduleCleanup();
  }

  private async scheduleCleanup(): Promise<void> {
    const next = this.ctx.storage.sql.exec<{ expires_at: number | null }>("SELECT MIN(expires_at) AS expires_at FROM (SELECT expires_at FROM oauth_nonces UNION ALL SELECT expires_at FROM admin_sessions UNION ALL SELECT expires_at FROM oauth_start_rates)").toArray()[0]!.expires_at;
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }

  async alarm(): Promise<void> {
    return this.queue.run(() => this.cleanup(Date.now()));
  }
}

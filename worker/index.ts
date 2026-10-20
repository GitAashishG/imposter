import { DurableObject } from "cloudflare:workers";
import type { PartyEntry, PartyEvent } from "../src/party/protocol";
import {
  PartyError,
  applyAction,
  authenticate,
  createParty,
  exactKeys,
  joinParty,
  object,
  pinMatches,
  project,
  publicInfo,
  requireParty,
  validateName,
  validatePin,
  validateSettings,
  type PartyState,
} from "./model";
import {
  SerialQueue,
  checkPinThrottle,
  hashSecret,
  hashToken,
  makeToken,
  recordWrongPin,
  type PinAttempt,
} from "./security";

export interface Env {
  PARTY: DurableObjectNamespace<PartyRoom>;
  ALLOWED_ORIGINS: string;
}

const BODY_LIMIT = 16 * 1024;
const AUTH_TIMEOUT_MS = 15_000;
const MAX_SOCKETS = 96;
const paths = new Map([
  ["/api/party", "GET"],
  ["/api/party/create", "POST"],
  ["/api/party/join", "POST"],
  ["/api/party/state", "GET"],
  ["/api/party/action", "POST"],
  ["/api/party/socket", "GET"],
]);

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function errorResponse(error: unknown): Response {
  if (error instanceof PartyError)
    return json({ error: error.message, code: error.code }, error.status);
  // Never return exception text: it could contain persisted private state.
  return json(
    {
      error:
        "The party server could not complete this request. Please reconnect.",
      code: "SERVER_ERROR",
    },
    500,
  );
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (
    !request.headers
      .get("Content-Type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    throw new PartyError("INVALID_BODY", "Send a JSON request body.", 415);
  }
  const declared = request.headers.get("Content-Length");
  if (declared && Number(declared) > BODY_LIMIT)
    throw new PartyError("BODY_TOO_LARGE", "The request is too large.", 413);
  if (!request.body)
    throw new PartyError("INVALID_BODY", "A JSON request body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > BODY_LIMIT) {
      await reader.cancel();
      throw new PartyError("BODY_TOO_LARGE", "The request is too large.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    );
  } catch {
    throw new PartyError(
      "INVALID_BODY",
      "The request must contain valid JSON.",
    );
  }
  return object(value);
}

function cors(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers);
  headers.set("Vary", "Origin");
  headers.set("Cache-Control", "no-store");
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  headers.set("Access-Control-Max-Age", "600");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
    ...(response.webSocket ? { webSocket: response.webSocket } : {}),
  });
}

export default {
  async fetch(request, env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const allowed = (env.ALLOWED_ORIGINS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (origin && !allowed.includes(origin)) {
      return errorResponse(
        new PartyError(
          "ORIGIN_FORBIDDEN",
          "This website is not allowed to access the party server.",
          403,
        ),
      );
    }
    try {
      const url = new URL(request.url);
      const method = paths.get(url.pathname);
      if (!method)
        throw new PartyError(
          "NOT_FOUND",
          "No party endpoint exists at this address.",
          404,
        );
      if (url.search)
        throw new PartyError(
          "INVALID_URL",
          "Party requests cannot contain URL parameters.",
        );
      if (request.method === "OPTIONS")
        return cors(new Response(null, { status: 204 }), origin);
      if (request.method !== method)
        throw new PartyError(
          "METHOD_NOT_ALLOWED",
          "That HTTP method is not supported.",
          405,
        );
      const room = env.PARTY.get(env.PARTY.idFromName("single-party"));
      return cors(await room.fetch(request), origin);
    } catch (error) {
      return cors(errorResponse(error), origin);
    }
  },
} satisfies ExportedHandler<Env>;

interface SocketAttachment {
  partyId: string | null;
  playerId: string | null;
  authDeadline: number;
}

/** The binding points to exactly one SQLite-backed room for this whole application. */
export class PartyRoom extends DurableObject<Env> {
  private party: PartyState | null = null;
  private attempts: PinAttempt[] = [];
  private readonly serial = new SerialQueue();
  private readonly randomBuffer = new Uint32Array(1);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS party_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
      );
      const rows = ctx.storage.sql.exec<{ key: string; value: string }>(
        "SELECT key, value FROM party_store",
      );
      for (const row of rows) {
        if (row.key === "party")
          this.party = JSON.parse(row.value) as PartyState;
        if (row.key === "pin_attempts")
          this.attempts = JSON.parse(row.value) as PinAttempt[];
      }
      ctx.setWebSocketAutoResponse(
        new WebSocketRequestResponsePair("ping", "pong"),
      );
    });
  }

  private attachment(socket: WebSocket): SocketAttachment | null {
    return socket.deserializeAttachment() as SocketAttachment | null;
  }

  private connected(exclude?: WebSocket): Set<string> {
    const ids = new Set<string>();
    if (!this.party) return ids;
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === exclude || socket.readyState !== WebSocket.OPEN) continue;
      const auth = this.attachment(socket);
      if (
        auth?.partyId === this.party.id &&
        auth.playerId &&
        this.party.players.some((player) => player.id === auth.playerId)
      ) {
        ids.add(auth.playerId);
      }
    }
    return ids;
  }

  private send(socket: WebSocket, event: PartyEvent): void {
    try {
      socket.send(JSON.stringify(event));
    } catch {
      try {
        socket.close(1011, "Connection lost");
      } catch {
        /* Already closed. */
      }
    }
  }

  private endSocket(socket: WebSocket, message: string): void {
    this.send(socket, { type: "ended", message });
    try {
      socket.close(1000, "Session ended");
    } catch {
      /* Already closed. */
    }
  }

  private broadcast(now: number, exclude?: WebSocket): void {
    const connected = this.connected(exclude);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === exclude || socket.readyState !== WebSocket.OPEN) continue;
      const auth = this.attachment(socket);
      if (!auth?.playerId) continue;
      if (
        !this.party ||
        auth.partyId !== this.party.id ||
        !this.party.players.some((player) => player.id === auth.playerId)
      ) {
        this.endSocket(socket, "Your party session has ended.");
      } else {
        this.send(socket, {
          type: "snapshot",
          snapshot: project(this.party, auth.playerId, now, connected),
        });
      }
    }
  }

  private writeState(): void {
    if (this.party) {
      this.ctx.storage.sql.exec(
        "INSERT INTO party_store(key, value) VALUES ('party', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        JSON.stringify(this.party),
      );
    } else {
      this.ctx.storage.sql.exec("DELETE FROM party_store WHERE key = 'party'");
    }
  }

  private async scheduleAlarm(): Promise<void> {
    let deadline = this.party?.expiresAt ?? Infinity;
    for (const socket of this.ctx.getWebSockets()) {
      const auth = this.attachment(socket);
      if (socket.readyState === WebSocket.OPEN && !auth?.playerId)
        deadline = Math.min(deadline, auth?.authDeadline ?? Date.now());
    }
    if (Number.isFinite(deadline)) await this.ctx.storage.setAlarm(deadline);
    else await this.ctx.storage.deleteAlarm();
  }

  private async expire(now: number): Promise<void> {
    if (this.party && this.party.expiresAt <= now) {
      this.party = null;
      this.writeState();
      for (const socket of this.ctx.getWebSockets())
        this.endSocket(
          socket,
          "This party expired after 12 hours without a game action.",
        );
      await this.scheduleAlarm();
    }
  }

  private async actor(request: Request, now: number): Promise<string> {
    const header = request.headers.get("Authorization");
    const match = header?.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
    if (!match)
      throw new PartyError(
        "SESSION_ENDED",
        "This player session has ended.",
        401,
      );
    return authenticate(this.party, await hashToken(match[1]), now);
  }

  private secureRandom(): number {
    return crypto.getRandomValues(this.randomBuffer)[0]! / 0x100000000;
  }

  private async enter(
    body: Record<string, unknown>,
    creating: boolean,
    request: Request,
    now: number,
  ): Promise<Response> {
    exactKeys(body, creating ? ["name", "pin", "settings"] : ["name", "pin"]);
    const name = validateName(body.name);
    const pin = validatePin(body.pin);
    if (creating && this.party)
      throw new PartyError(
        "PARTY_EXISTS",
        "There is already an active party. Join it with its PIN.",
        409,
      );
    if (creating) validateSettings(body.settings);
    if (!creating) {
      const party = requireParty(this.party, now);
      if (party.phase !== "lobby")
        throw new PartyError(
          "NOT_IN_LOBBY",
          "Wait for the host to return to the lobby.",
          409,
        );
      const ipKey = await hashSecret(
        request.headers.get("CF-Connecting-IP") || "local",
      );
      checkPinThrottle(this.attempts, ipKey, now);
      if (!pinMatches(party.pin, pin)) {
        this.attempts = recordWrongPin(this.attempts, ipKey, now);
        this.ctx.storage.sql.exec(
          "INSERT INTO party_store(key, value) VALUES ('pin_attempts', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          JSON.stringify(this.attempts),
        );
        throw new PartyError(
          "WRONG_PIN",
          "That party PIN is not correct.",
          403,
        );
      }
    }
    const token = makeToken();
    const member = {
      id: crypto.randomUUID(),
      name,
      tokenHash: await hashToken(token),
    };
    const next = creating
      ? createParty(crypto.randomUUID(), member, pin, body.settings, now)
      : joinParty(this.party!, member, pin, now);
    this.party = next;
    this.writeState();
    await this.scheduleAlarm();
    this.broadcast(now);
    const entry: PartyEntry = {
      session: { partyId: next.id, playerId: member.id, token },
      snapshot: project(next, member.id, now, this.connected()),
    };
    return json(entry, creating ? 201 : 200);
  }

  private async upgrade(request: Request, now: number): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      throw new PartyError(
        "UPGRADE_REQUIRED",
        "Open a WebSocket connection to this endpoint.",
        426,
      );
    }
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS)
      throw new PartyError(
        "TOO_MANY_CONNECTIONS",
        "The party has too many open connections. Close an unused tab and retry.",
        429,
      );
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.serializeAttachment({
      partyId: null,
      playerId: null,
      authDeadline: now + AUTH_TIMEOUT_MS,
    } satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server);
    await this.scheduleAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      // Read bounded HTTP bodies outside the mutation queue so slow uploads cannot hold its lock.
      const body = request.method === "POST" ? await readJson(request) : null;
      return await this.serial.run(async () => {
        const now = Date.now();
        await this.expire(now);
        switch (url.pathname) {
          case "/api/party":
            return json(publicInfo(this.party, now));
          case "/api/party/create":
            return this.enter(body!, true, request, now);
          case "/api/party/join":
            return this.enter(body!, false, request, now);
          case "/api/party/socket":
            return this.upgrade(request, now);
          case "/api/party/state": {
            const actorId = await this.actor(request, now);
            return json(project(this.party!, actorId, now, this.connected()));
          }
          case "/api/party/action": {
            exactKeys(body!, ["action"]);
            const actorId = await this.actor(request, now);
            const previous = this.party!;
            const next = applyAction(
              previous,
              actorId,
              body!.action,
              now,
              this.connected(),
              () => this.secureRandom(),
            );
            if (next !== previous) {
              this.party = next;
              this.writeState();
              await this.scheduleAlarm();
              this.broadcast(now);
            }
            return json(
              next && next.players.some((player) => player.id === actorId)
                ? project(next, actorId, now, this.connected())
                : null,
            );
          }
          default:
            throw new PartyError(
              "NOT_FOUND",
              "This party endpoint does not exist.",
              404,
            );
        }
      });
    } catch (error) {
      return errorResponse(error);
    }
  }

  async webSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    await this.serial.run(async () => {
      const now = Date.now();
      await this.expire(now);
      if (socket.readyState !== WebSocket.OPEN) return;
      const prior = this.attachment(socket);
      if (prior?.playerId) {
        this.send(socket, {
          type: "error",
          code: "UNKNOWN_MESSAGE",
          error: "Game actions use the authenticated HTTP action endpoint.",
        });
        return;
      }
      try {
        if (!prior || prior.authDeadline <= now)
          throw new PartyError(
            "SESSION_ENDED",
            "The connection authentication timed out.",
            401,
          );
        if (
          typeof message !== "string" ||
          new TextEncoder().encode(message).byteLength > BODY_LIMIT
        ) {
          throw new PartyError(
            "INVALID_BODY",
            "Send a small JSON authentication message.",
          );
        }
        let body: Record<string, unknown>;
        try {
          body = object(JSON.parse(message));
        } catch {
          throw new PartyError(
            "INVALID_BODY",
            "Send a valid JSON authentication message.",
          );
        }
        exactKeys(body, ["type", "token"]);
        if (body.type !== "auth")
          throw new PartyError(
            "AUTH_REQUIRED",
            "Authenticate this connection first.",
            401,
          );
        const actorId = authenticate(
          this.party,
          await hashToken(body.token),
          now,
        );
        socket.serializeAttachment({
          partyId: this.party!.id,
          playerId: actorId,
          authDeadline: 0,
        } satisfies SocketAttachment);
        await this.scheduleAlarm();
        this.broadcast(now);
      } catch (error) {
        const known =
          error instanceof PartyError
            ? error
            : new PartyError(
                "SERVER_ERROR",
                "Unable to authenticate this connection.",
                500,
              );
        this.send(socket, {
          type: "error",
          code: known.code,
          error: known.message,
        });
        this.endSocket(socket, "Reconnect or join a new party to continue.");
        await this.scheduleAlarm();
      }
    });
  }

  async webSocketClose(
    socket: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ): Promise<void> {
    // Do not reflect remote close reasons, which are untrusted and might contain secrets.
    void code;
    void reason;
    void wasClean;
    await this.serial.run(async () => {
      const now = Date.now();
      await this.expire(now);
      try {
        socket.close(1000, "Connection closed");
      } catch {
        /* Already closed. */
      }
      this.broadcast(now, socket);
      await this.scheduleAlarm();
    });
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket, 1011, "Connection lost", false);
  }

  async alarm(): Promise<void> {
    await this.serial.run(async () => {
      const now = Date.now();
      await this.expire(now);
      for (const socket of this.ctx.getWebSockets()) {
        const auth = this.attachment(socket);
        if (!auth?.playerId && (!auth || auth.authDeadline <= now)) {
          this.endSocket(socket, "The connection authentication timed out.");
        }
      }
      await this.scheduleAlarm();
    });
  }
}

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { handleAdminRequest } from "./admin";
import { historyView } from "../src/history";
import { PARTY_TTL_MS } from "./model";
import { REGISTRY_ERROR_STATUS, RegistryError, normalizeRoomCode, roomRoute, safeMetadata } from "./registry-domain";
export { AdminAuth } from "./admin";
export { RoomDirectory } from "./registry";
import type {
  AdminRoom,
  PartyActionResponse,
  PartyEntry,
  PartyEvent,
} from "../src/party/protocol";
import {
  PartyError,
  applyAction,
  advanceTime,
  authenticate,
  createParty,
  exactKeys,
  expirationMessage,
  joinParty,
  object,
  migrateStoredParty,
  nextAlarmDeadline,
  normalizeRecoveryCode,
  pinMatches,
  project,
  publicInfo,
  requireParty,
  recoverParty,
  socketIdentityMatches,
  updatePresence,
  updateWordHistory,
  validateAction,
  validateName,
  validatePin,
  validateSettings,
  type PartyState,
} from "./model";
import {
  SerialQueue,
  checkPinThrottle,
  checkRecoveryThrottle,
  hashSecret,
  hashToken,
  makeToken,
  recordFailure,
  type FailureAttempt,
} from "./security";


const BODY_LIMIT = 16 * 1024;
const AUTH_TIMEOUT_MS = 15_000;
const MAX_SOCKETS = 96;

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
  if (error instanceof Error) {
    const match = /^(?:remote: )?([A-Z_]+): (.+)$/.exec(error.message);
    if (match && Object.hasOwn(REGISTRY_ERROR_STATUS, match[1]!))
      return json({ error: match[2], code: match[1] }, REGISTRY_ERROR_STATUS[match[1]!]!);
  }
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
    // Owner authentication/cookies stay same-origin and never enter player CORS.
    const admin = await handleAdminRequest(request, env);
    if (admin) return admin;
    const origin = request.headers.get("Origin");
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
    if (origin && !allowed.includes(origin))
      return errorResponse(new PartyError("ORIGIN_FORBIDDEN", "This website is not allowed to access the party server.", 403));
    try {
      const url = new URL(request.url);
      if (url.pathname === "/api/party" || url.pathname.startsWith("/api/party/"))
        return cors(json({ code: "UPDATE_REQUIRED", error: "Ko Ho? now uses room codes. Refresh the game to update; your saved seat will be restored." }, 426), origin);
      const route = roomRoute(url.pathname);
      if (!route) throw new PartyError("ROOM_NOT_FOUND", "This room has ended or does not exist. Return home to join or create a room.", 404);
      if (url.search) throw new PartyError("INVALID_URL", "Room requests cannot contain URL parameters.");
      if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }), origin);
      if (!route.methods.includes(request.method)) throw new PartyError("METHOD_NOT_ALLOWED", "That HTTP method is not supported.", 405);
      const directory = env.DIRECTORY.getByName("rooms");
      const ipHash = await hashSecret(request.headers.get("CF-Connecting-IP") || "local");
      await directory.checkRequest(ipHash);
      if (route.kind === "directory") {
        if (request.method === "GET") return cors(json(await directory.publicInfo()), origin);
        const body = await readJson(request);
        exactKeys(body, ["name", "pin", "settings"]);
        validateName(body.name);
        validatePin(body.pin);
        validateSettings(body.settings);
        const reservation = await directory.reserve(ipHash);
        try {
          const room = env.PARTY.getByName(reservation.objectKey);
          await room.bindRoomCode(reservation.roomCode);
          const entry = await room.createReserved(body, reservation.reservationId);
          return cors(json(entry, 201), origin);
        } catch (error) {
          await directory.releaseReservation(reservation.roomCode, reservation.reservationId);
          throw error;
        }
      }
      if (route.kind === "restore") {
        exactKeys(await readJson(request), []);
        const migrated = await directory.migratedRoom();
        if (!migrated) throw new PartyError("SESSION_ENDED", "The saved party has ended. Join or create a room.", 401);
        const entry = await env.PARTY.getByName(migrated.objectKey).restoreSession(request.headers.get("Authorization") || "");
        return cors(json(entry), origin);
      }
      const address = await directory.lookup(route.roomCode!);
      if (!address) throw new PartyError("ROOM_NOT_FOUND", "This room has ended or does not exist. Return home to join or create a room.", 404);
      const routed = new URL(request.url);
      routed.pathname = `/api/rooms/${address.roomCode}${route.operation === "public" ? "" : `/${route.operation}`}`;
      return cors(await env.PARTY.getByName(address.objectKey).fetch(new Request(routed, request)), origin);
    } catch (error) {
      return cors(errorResponse(error), origin);
    }
  },
} satisfies ExportedHandler<Env>;

interface SocketAttachment {
  partyId: string | null;
  playerId: string | null;
  tokenHash?: string | null;
  authDeadline: number;
}

/** One authoritative SQLite room; crypto, mutations, alarms and storage share one queue. */
export class PartyRoom extends DurableObject<Env> {
  private party: PartyState | null = null;
  private history: string[] = [];
  private attempts: FailureAttempt[] = [];
  private recoveryAttempts: FailureAttempt[] = [];
  private roomCode: string | null = null;
  private createdAt = 0;
  private publishedPartyId: string | null = null;
  private publishedMetadata = "";
  private readonly serial = new SerialQueue();
  private readonly randomBuffer = new Uint32Array(1);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS party_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
      );
      let saved: unknown = null;
      let history: unknown;
      for (const row of ctx.storage.sql.exec<{ key: string; value: string }>(
        "SELECT key, value FROM party_store",
      )) {
        if (row.key === "party") saved = JSON.parse(row.value);
        if (row.key === "room_code") this.roomCode = JSON.parse(row.value) as string;
        if (row.key === "created_at") this.createdAt = JSON.parse(row.value) as number;
        if (row.key === "word_history") history = JSON.parse(row.value);
        if (row.key === "pin_attempts")
          this.attempts = JSON.parse(row.value) as FailureAttempt[];
        if (row.key === "recovery_attempts")
          this.recoveryAttempts = JSON.parse(row.value) as FailureAttempt[];
      }
      const migrated = migrateStoredParty(saved, history, Date.now());
      this.saveParty(migrated.party, migrated.history);
      this.publishedPartyId = this.party?.id ?? null;
      if (saved && !this.party) {
        // Migration may discover an already-expired saved party before settle sees it.
        // Do not leave its anonymous word history behind until a directory probe.
        this.ctx.storage.sql.exec("DELETE FROM party_store");
        this.history = [];
        this.attempts = [];
        this.recoveryAttempts = [];
        this.endAll("This party expired. Join or create a new room when you are ready.");
        await this.ctx.storage.deleteAlarm();
      }
      // A v1/v2 schema upgrade may attach the original credential to old live sockets.
      // Later wakes must never re-authorize a revoked host by their seat ID alone.
      if (migrated.legacy && this.party) {
        for (const socket of ctx.getWebSockets()) {
          const auth = this.attachment(socket);
          const member =
            auth?.partyId === this.party.id
              ? this.party.players.find((player) => player.id === auth.playerId)
              : undefined;
          if (member && !auth?.tokenHash)
            socket.serializeAttachment({
              ...auth,
              tokenHash: member.tokenHash,
            });
        }
      }
      ctx.setWebSocketAutoResponse(
        new WebSocketRequestResponsePair("ping", "pong"),
      );
      await this.settle(Date.now());
      this.broadcast(Date.now());
    });
  }

  private boundCode(): string {
    if (!this.roomCode || !normalizeRoomCode(this.roomCode))
      throw new PartyError("ROOM_NOT_FOUND", "This room has not been registered.", 404);
    return this.roomCode;
  }

  private metadata(exclude?: WebSocket): AdminRoom | null {
    if (!this.party || !this.roomCode) return null;
    return safeMetadata({
      roomCode: this.roomCode, partyId: this.party.id, status: "active",
      phase: this.party.phase, playerCount: this.party.players.length,
      connectedCount: this.connected(this.party, exclude).size,
      createdAt: this.createdAt, lastActivityAt: this.party.expiresAt - PARTY_TTL_MS,
      expiresAt: this.party.expiresAt, abandonedExpiresAt: this.party.abandonedExpiresAt,
      completedGames: this.party.gameHistory.completedGames,
      closedAt: null, closeReason: null, storagePurged: false,
    });
  }

  private async publishMetadata(exclude?: WebSocket): Promise<void> {
    const metadata = this.metadata(exclude);
    if (!metadata) return;
    const encoded = JSON.stringify(metadata);
    if (encoded === this.publishedMetadata) return;
    await this.env.DIRECTORY.getByName("rooms").updateRoom(metadata, this.publishedPartyId ?? metadata.partyId!);
    this.publishedMetadata = encoded;
    this.publishedPartyId = metadata.partyId;
  }

  /** Transport binding is independent of saved game schema and never rotates a seat. */
  async bindRoomCode(code: string): Promise<AdminRoom | null> {
    return this.serial.run(async () => {
      if (normalizeRoomCode(code) !== code || (this.roomCode && this.roomCode !== code))
        throw new RegistryError("INVALID_ROOM_CODE", "This room address cannot be rebound.");
      this.roomCode = code;
      this.store("room_code", code);
      await this.settle(Date.now());
      if (this.party) this.broadcast(Date.now());
      return this.metadata();
    });
  }

  async createReserved(body: Record<string, unknown>, reservationId: string): Promise<PartyEntry> {
    return this.serial.run(async () => {
      const code = this.boundCode();
      const directory = this.env.DIRECTORY.getByName("rooms");
      await directory.claimReservation(code, reservationId);
      try {
        const response = await this.enter(body, true, new Request("https://room.invalid"));
        await directory.activateReservation(code, reservationId, this.metadata()!);
        return await response.json() as PartyEntry;
      } catch (error) {
        await this.terminate("This room could not be created. Please try again.", "reservation-expired");
        throw error;
      }
    });
  }

  async restoreSession(authorization: string): Promise<PartyEntry> {
    return this.serial.run(async () => {
      try {
        const playerId = await this.actor(new Request("https://room.invalid", { headers: { Authorization: authorization } }));
        const token = authorization.slice(7);
        return {
          session: { roomCode: this.boundCode(), partyId: this.party!.id, playerId, token },
          snapshot: project(this.party!, playerId, Date.now(), this.connected(), this.boundCode()),
        };
      } catch (error) {
        if (error instanceof PartyError) throw new RegistryError(error.code, error.message, error.status);
        throw error;
      }
    });
  }

  async inspectRoom(): Promise<AdminRoom | null> {
    return this.serial.run(async () => {
      await this.settle(Date.now());
      if (!this.party) {
        this.ctx.storage.sql.exec("DELETE FROM party_store");
        await this.ctx.storage.deleteAlarm();
      }
      return this.metadata();
    });
  }

  async closeRoom(code: string, expectedPartyId: string): Promise<void> {
    await this.serial.run(async () => {
      if (this.roomCode !== code || this.party?.id !== expectedPartyId)
        throw new RegistryError("STALE_PARTY", "This room changed. Refresh before trying again.", 409);
      await this.terminate("The owner closed this room. Join or create a new room when you are ready.", "owner-closed");
    });
  }

  /** Purge never deletes a non-expired replacement generation. */
  async purgeRoom(code: string, expectedPartyId: string | null): Promise<void> {
    await this.serial.run(async () => {
      if (this.roomCode && this.roomCode !== code)
        throw new RegistryError("STALE_PARTY", "This room changed. Refresh before trying again.", 409);
      if (this.party) {
        if (this.party.id !== expectedPartyId)
          throw new RegistryError("STALE_PARTY", "This room changed. Refresh before trying again.", 409);
        if (advanceTime(this.party, Date.now()))
          throw new RegistryError("ROOM_ACTIVE", "Close this active room before purging it.", 409);
        await this.terminate(expirationMessage(this.party), "expired");
      } else {
        this.ctx.storage.sql.exec("DELETE FROM party_store");
        this.history = [];
        this.attempts = [];
        this.recoveryAttempts = [];
        await this.ctx.storage.deleteAlarm();
      }
    });
  }

  private async terminate(message: string, reason: string): Promise<void> {
    const previous = this.metadata();
    this.endAll(message);
    this.ctx.storage.sql.exec("DELETE FROM party_store");
    this.party = null;
    this.history = [];
    this.attempts = [];
    this.recoveryAttempts = [];
    await this.ctx.storage.deleteAlarm();
    if (previous) {
      const closed: AdminRoom = { ...previous, status: "closed", phase: null,
        connectedCount: 0, playerCount: 0, closedAt: Date.now(), closeReason: reason, storagePurged: true };
      await this.env.DIRECTORY.getByName("rooms").updateRoom(closed, previous.partyId!);
      this.publishedMetadata = JSON.stringify(closed);
    }
  }

  private attachment(socket: WebSocket): SocketAttachment | null {
    return socket.deserializeAttachment() as SocketAttachment | null;
  }

  private connected(state = this.party, exclude?: WebSocket): Set<string> {
    const ids = new Set<string>();
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === exclude || socket.readyState !== WebSocket.OPEN) continue;
      const auth = this.attachment(socket);
      if (socketIdentityMatches(state, auth)) ids.add(auth!.playerId!);
    }
    return ids;
  }

  private send(socket: WebSocket, event: PartyEvent): void {
    try {
      socket.send(JSON.stringify(event));
    } catch {
      // A failed send is not a live authenticated connection, even before its close callback.
      try {
        socket.serializeAttachment({
          partyId: this.attachment(socket)?.partyId ?? null,
          playerId: null,
          tokenHash: null,
          authDeadline: Date.now(),
        } satisfies SocketAttachment);
      } catch {
        /* The socket may already be gone. */
      }
      try {
        socket.close(1011, "Connection lost");
      } catch {
        /* Already closed. */
      }
    }
  }

  private endSocket(socket: WebSocket, message: string): void {
    this.send(socket, {
      type: "ended",
      roomCode: this.roomCode,
      partyId: this.attachment(socket)?.partyId ?? null,
      message,
    });
    try {
      socket.close(1000, "Session ended");
    } catch {
      /* Already closed. */
    }
  }

  private endAll(message: string): void {
    for (const socket of this.ctx.getWebSockets())
      this.endSocket(socket, message);
  }

  private broadcast(now: number, exclude?: WebSocket): void {
    if (!this.roomCode) return; // Registry binds the legacy address before any projection.
    const connected = this.connected(this.party, exclude);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === exclude || socket.readyState !== WebSocket.OPEN) continue;
      const auth = this.attachment(socket);
      if (!auth?.playerId) continue;
      if (!socketIdentityMatches(this.party, auth)) {
        this.endSocket(
          socket,
          "Your party session has ended or was replaced. Rejoin or recover hosting to continue.",
        );
      } else {
        this.send(socket, {
          type: "snapshot",
          snapshot: project(this.party!, auth.playerId, now, connected, this.roomCode),
        });
      }
    }
  }

  /** Personal state and separate non-personal history commit atomically before memory changes. */
  private saveParty(next: PartyState | null, history = this.history): void {
    if (next && !this.createdAt) {
      this.createdAt = next.expiresAt - PARTY_TTL_MS;
      this.store("created_at", this.createdAt);
    }
    const clearAttempts =
      !next || (this.party !== null && this.party.id !== next.id);
    this.ctx.storage.transactionSync(() => {
      if (next) this.store("party", next);
      else
        this.ctx.storage.sql.exec(
          "DELETE FROM party_store WHERE key = 'party'",
        );
      this.store("word_history", history);
      if (clearAttempts)
        this.ctx.storage.sql.exec(
          "DELETE FROM party_store WHERE key IN ('pin_attempts', 'recovery_attempts')",
        );
    });
    this.party = next;
    this.history = history;
    if (clearAttempts) {
      this.attempts = [];
      this.recoveryAttempts = [];
    }
  }

  private store(key: string, value: unknown): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO party_store(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      JSON.stringify(value),
    );
  }

  private async scheduleAlarm(exclude?: WebSocket): Promise<void> {
    if (this.party) {
      const next = updatePresence(
        this.party,
        this.connected(this.party, exclude),
        Date.now(),
      );
      if (next !== this.party) this.saveParty(next);
    }
    const unauthenticated: number[] = [];
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      const auth = this.attachment(socket);
      if (!auth?.playerId)
        unauthenticated.push(auth?.authDeadline ?? Date.now());
    }
    const deadline = nextAlarmDeadline(this.party, unauthenticated);
    if (deadline === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(deadline);
    await this.publishMetadata(exclude);
  }

  /** Alarms and requests share deadline resolution, preventing late guesses after delayed alarms. */
  private async settle(now: number, exclude?: WebSocket): Promise<void> {
    const previous = this.party;
    // Expiry is checked before presence: a late reconnect must not revive an expired room.
    const advanced = advanceTime(previous, now);
    if (previous && !advanced) {
      await this.terminate(expirationMessage(previous), "expired");
      return;
    }
    const next = advanced ? updatePresence(advanced, this.connected(advanced, exclude), now) : null;
    if (next !== previous) {
      this.saveParty(next);
      this.broadcast(now, exclude);
    }
    await this.scheduleAlarm(exclude);
  }

  private async actor(request: Request): Promise<string> {
    const match = request.headers
      .get("Authorization")
      ?.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
    if (!match)
      throw new PartyError(
        "SESSION_ENDED",
        "This player session has ended.",
        401,
      );
    const hash = await hashToken(match[1]);
    authenticate(this.party, hash, Date.now()); // Reject foreign tokens before any presence/state mutation.
    await this.settle(Date.now());
    return authenticate(this.party, hash, Date.now());
  }

  private secureRandom(): number {
    return crypto.getRandomValues(this.randomBuffer)[0]! / 0x100000000;
  }

  private async enter(
    body: Record<string, unknown>,
    creating: boolean,
    request: Request,
  ): Promise<Response> {
    exactKeys(body, creating ? ["name", "pin", "settings"] : ["name", "pin"]);
    const name = validateName(body.name);
    const pin = validatePin(body.pin);
    if (creating) validateSettings(body.settings);
    const ipKey = creating
      ? ""
      : await hashSecret(request.headers.get("CF-Connecting-IP") || "local");
    const token = makeToken();
    const member = {
      id: crypto.randomUUID(),
      name,
      tokenHash: await hashToken(token),
    };
    await this.settle(Date.now());
    const now = Date.now();
    if (creating && this.party)
      throw new PartyError(
        "PARTY_EXISTS",
        "There is already an active party. Join it with its PIN.",
        409,
      );
    if (!creating) {
      const party = requireParty(this.party, now);
      if (party.phase !== "lobby")
        throw new PartyError(
          "NOT_IN_LOBBY",
          "Wait for the host to start a new game in the lobby.",
          409,
        );
      checkPinThrottle(this.attempts, ipKey, now);
      if (!pinMatches(party.pin, pin)) {
        const attempts = recordFailure(this.attempts, ipKey, now);
        this.store("pin_attempts", attempts);
        this.attempts = attempts;
        throw new PartyError(
          "WRONG_PIN",
          "That party PIN is not correct.",
          403,
        );
      }
    }
    const next = creating
      ? createParty(crypto.randomUUID(), member, pin, body.settings, now)
      : joinParty(this.party!, member, pin, now);
    this.saveParty(next);
    this.broadcast(now);
    await this.scheduleAlarm();
    const entry: PartyEntry = {
      session: { roomCode: this.boundCode(), partyId: next.id, playerId: member.id, token },
      snapshot: project(next, member.id, now, this.connected(), this.boundCode()),
    };
    return json(entry, creating ? 201 : 200);
  }

  private async recover(
    body: Record<string, unknown>,
    request: Request,
  ): Promise<Response> {
    exactKeys(body, ["recoveryCode"]);
    const ipKey = await hashSecret(
      request.headers.get("CF-Connecting-IP") || "local",
    );
    await this.settle(Date.now());
    let now = Date.now();
    const party = requireParty(this.party, now);
    checkRecoveryThrottle(this.recoveryAttempts, ipKey, now);
    const code = normalizeRecoveryCode(body.recoveryCode);
    if (
      !code ||
      !pinMatches(normalizeRecoveryCode(party.hostRecoveryCode), code)
    ) {
      const attempts = recordFailure(this.recoveryAttempts, ipKey, now);
      this.store("recovery_attempts", attempts);
      this.recoveryAttempts = attempts;
      throw new PartyError(
        "WRONG_RECOVERY_CODE",
        "That private host recovery code is not correct.",
        403,
      );
    }
    const token = makeToken();
    const tokenHash = await hashToken(token);
    await this.settle(Date.now());
    now = Date.now();
    let next = recoverParty(
      requireParty(this.party, now),
      code,
      tokenHash,
      now,
    );
    next = updatePresence(next, this.connected(next), now);
    this.saveParty(next);
    this.broadcast(now);
    await this.scheduleAlarm();
    const entry: PartyEntry = {
      session: { roomCode: this.boundCode(), partyId: next.id, playerId: next.hostId, token },
      snapshot: project(next, next.hostId, now, this.connected(), this.boundCode()),
    };
    return json(entry);
  }

  private async act(
    body: Record<string, unknown>,
    request: Request,
  ): Promise<Response> {
    exactKeys(body, ["action"]);
    const actorId = await this.actor(request);
    const action = validateAction(body.action);
    const token = action.type === "fresh-party" ? makeToken() : null;
    const freshHost = token
      ? { id: crypto.randomUUID(), tokenHash: await hashToken(token) }
      : undefined;
    await this.settle(Date.now());
    const now = Date.now();
    const previous = requireParty(this.party, now);
    let next = applyAction(
      previous,
      actorId,
      action,
      now,
      this.connected(),
      () => this.secureRandom(),
      {
        recentWordIds: this.history,
        freshHost,
      },
    );
    if (next !== previous) {
      if (next) next = updatePresence(next, this.connected(next), now);
      if (!next) {
        await this.terminate("The host ended this party. Join or create a new party when you are ready.", "host-ended");
      } else {
        this.saveParty(next, updateWordHistory(previous, next, this.history));
        if (next.id !== previous.id)
          this.endAll("The host started a fresh party. Ask for the new PIN and join again.");
        else this.broadcast(now);
      }
      await this.scheduleAlarm();
    }
    const session =
      next && token && freshHost
        ? { roomCode: this.boundCode(), partyId: next.id, playerId: freshHost.id, token }
        : undefined;
    const selfId = session?.playerId ?? actorId;
    const response: PartyActionResponse = {
      snapshot:
        next && next.players.some((player) => player.id === selfId)
          ? project(next, selfId, now, this.connected(), this.boundCode())
          : null,
      ...(session ? { session } : {}),
    };
    return json(response);
  }

  private async upgrade(request: Request, now: number): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      throw new PartyError(
        "UPGRADE_REQUIRED",
        "Open a WebSocket connection to this endpoint.",
        426,
      );
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
      tokenHash: null,
      authDeadline: now + AUTH_TIMEOUT_MS,
    } satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server);
    await this.scheduleAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const route = roomRoute(url.pathname);
      if (!route || route.kind !== "room" || route.roomCode !== this.roomCode || url.search)
        throw new PartyError("ROOM_NOT_FOUND", "This room has ended or does not exist.", 404);
      if (!route.methods.includes(request.method)) throw new PartyError("METHOD_NOT_ALLOWED", "That HTTP method is not supported.", 405);
      // Slow bounded uploads cannot hold the mutation lock.
      const body = request.method === "POST" ? await readJson(request) : null;
      return await this.serial.run(async () => {
        const now = Date.now();
        switch (route.operation) {
          case "public": {
            await this.settle(now);
            if (!this.party) throw new PartyError("ROOM_NOT_FOUND", "This room has ended or does not exist.", 404);
            return json(publicInfo(this.party, now, this.boundCode()));
          }
          case "join": return this.enter(body!, false, request);
          case "recover": return this.recover(body!, request);
          case "socket": {
            await this.settle(now);
            requireParty(this.party, now);
            return this.upgrade(request, now);
          }
          case "state": {
            const actorId = await this.actor(request);
            return json(project(this.party!, actorId, Date.now(), this.connected(), this.boundCode()));
          }
          case "history": {
            await this.actor(request);
            return json({ partyId: this.party!.id, roomCode: this.boundCode(), history: historyView(this.party!.gameHistory) });
          }
          case "action": return this.act(body!, request);
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
      let now = Date.now();
      if (socket.readyState !== WebSocket.OPEN) return;
      const prior = this.attachment(socket);
      if (prior?.playerId) {
        if (socketIdentityMatches(this.party, prior)) await this.settle(now);
        if (!socketIdentityMatches(this.party, prior))
          this.endSocket(
            socket,
            "Your session was replaced. Rejoin or recover hosting to continue.",
          );
        else
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
        )
          throw new PartyError(
            "INVALID_BODY",
            "Send a small JSON authentication message.",
          );
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
        const tokenHash = await hashToken(body.token);
        now = Date.now();
        authenticate(this.party, tokenHash, now);
        await this.settle(now);
        this.boundCode();
        if (prior.authDeadline <= now)
          throw new PartyError(
            "SESSION_ENDED",
            "The connection authentication timed out.",
            401,
          );
        const actorId = authenticate(this.party, tokenHash, now);
        socket.serializeAttachment({
          partyId: this.party!.id,
          playerId: actorId,
          tokenHash,
          authDeadline: 0,
        } satisfies SocketAttachment);
        await this.settle(now);
        this.broadcast(now);
        await this.scheduleAlarm();
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
    // Do not reflect remote close reasons, which may contain secrets.
    void code;
    void reason;
    void wasClean;
    await this.serial.run(async () => {
      try {
        socket.close(1000, "Connection closed");
      } catch {
        /* Already closed. */
      }
      const now = Date.now();
      await this.settle(now, socket);
      this.broadcast(now, socket);
    });
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket, 1011, "Connection lost", false);
  }

  async alarm(): Promise<void> {
    await this.serial.run(async () => {
      const now = Date.now();
      await this.settle(now);
      for (const socket of this.ctx.getWebSockets()) {
        if (socket.readyState !== WebSocket.OPEN) continue;
        const auth = this.attachment(socket);
        if (!auth?.playerId && (!auth || auth.authDeadline <= now))
          this.endSocket(socket, "The connection authentication timed out.");
      }
      await this.scheduleAlarm();
    });
  }
}

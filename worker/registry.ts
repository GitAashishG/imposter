import { DurableObject } from "cloudflare:workers";
import type { AdminDirectoryConfig, AdminDirectoryView, AdminRoom, RoomDirectoryInfo } from "../src/party/protocol";
import type { Env } from "./env";
import { SerialQueue } from "./security";
import {
  CLOSED_RETENTION_MS, DEFAULT_ROOM_CAP, RegistryError,
  acceptsRoomUpdate, assertCapacity, assertReservation, assertRoomVersion, consumeRate, directoryInfo,
  generateRoomCode, isExpiredMetadata, nextRoomConfig, normalizeRoomCode, pendingRoom,
  pruneClosed, safeMetadata, type RateBucket, type RoomRecord,
} from "./registry-domain";

interface DirectoryState {
  roomCap: number;
  configVersion: number;
  bootstrapDone: boolean;
  migratedRoomCode: string | null;
  rooms: RoomRecord[];
  rates: RateBucket[];
}

export interface RoomReservation {
  roomCode: string;
  objectKey: string;
  reservationId: string;
}

/** Only this object allocates public room addresses. No room RPC is awaited under serial. */
export class RoomDirectory extends DurableObject<Env> {
  private state: DirectoryState = {
    roomCap: DEFAULT_ROOM_CAP, configVersion: 1, bootstrapDone: false,
    migratedRoomCode: null, rooms: [], rates: [],
  };
  private readonly serial = new SerialQueue();
  private bootstrapPromise: Promise<void> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS directory_store (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    for (const row of ctx.storage.sql.exec<{ value: string }>("SELECT value FROM directory_store WHERE key = 'state'"))
      this.state = JSON.parse(row.value) as DirectoryState;
  }

  private async save(): Promise<void> {
    this.state.rooms = pruneClosed(this.state.rooms, Date.now());
    this.ctx.storage.sql.exec("INSERT INTO directory_store(key, value) VALUES ('state', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(this.state));
    const now = Date.now();
    const deadlines = this.state.rooms.map((room) => room.metadata.status === "pending"
      ? room.reservationExpiresAt ?? now
      : room.metadata.status === "closed"
        ? room.metadata.storagePurged ? (room.metadata.closedAt ?? now) + CLOSED_RETENTION_MS : now + 30_000
        : Math.min(room.metadata.expiresAt ?? Infinity, room.metadata.abandonedExpiresAt ?? Infinity));
    // Rate buckets are bounded and are pruned on use; no polling alarm for ordinary reads.
    const deadline = Math.min(...deadlines);
    if (Number.isFinite(deadline)) await this.ctx.storage.setAlarm(Math.max(now + 1000, deadline));
    else await this.ctx.storage.deleteAlarm();
  }

  private freshCode(): string {
    let code: string;
    do { code = generateRoomCode(); } while (this.state.rooms.some((room) => room.metadata.roomCode === code));
    return code;
  }

  private ensureBootstrap(): Promise<void> {
    if (this.state.bootstrapDone) return Promise.resolve();
    if (!this.bootstrapPromise) {
      this.bootstrapPromise = this.bootstrap().catch((error) => {
        this.bootstrapPromise = null;
        throw error;
      });
    }
    return this.bootstrapPromise;
  }

  private async bootstrap(): Promise<void> {
    const code = await this.serial.run(async () => {
      if (this.state.bootstrapDone) return null;
      let code = this.state.migratedRoomCode;
      if (!code) {
        code = this.freshCode();
        this.state.migratedRoomCode = code;
        this.state.rooms.push(pendingRoom(code, "single-party", crypto.randomUUID(), Date.now()));
        await this.save();
      }
      return code;
    });
    if (!code) return;
    // Explicit one-time singleton probe; normal unknown codes never reach PARTY.
    const metadata = await this.env.PARTY.getByName("single-party").bindRoomCode(code);
    if (!metadata) await this.env.PARTY.getByName("single-party").purgeRoom(code, null);
    await this.serial.run(async () => {
      const room = this.state.rooms.find((entry) => entry.metadata.roomCode === code);
      if (metadata && room) {
        room.metadata = safeMetadata(metadata);
        room.reservationId = null;
        room.reservationExpiresAt = null;
      } else {
        this.state.rooms = this.state.rooms.filter((entry) => entry !== room);
        this.state.migratedRoomCode = null;
      }
      this.state.bootstrapDone = true;
      await this.save();
    });
  }

  async checkRequest(ipHash: string): Promise<void> {
    await this.serial.run(async () => {
      this.state.rates = consumeRate(this.state.rates, ipHash, false, Date.now());
      await this.save();
    });
  }

  async reserve(ipHash: string): Promise<RoomReservation> {
    await this.ensureBootstrap();
    await this.reconcile(true);
    return this.serial.run(async () => {
      assertCapacity(this.state.rooms, this.state.roomCap);
      const rates = consumeRate(this.state.rates, ipHash, true, Date.now());
      const code = this.freshCode();
      const reservationId = crypto.randomUUID();
      this.state.rooms.push(pendingRoom(code, code, reservationId, Date.now()));
      this.state.rates = rates;
      await this.save();
      return { roomCode: code, objectKey: code, reservationId };
    });
  }

  async claimReservation(code: string, reservationId: string): Promise<void> {
    await this.serial.run(() => {
      const room = this.state.rooms.find((entry) => entry.metadata.roomCode === code);
      assertReservation(room, reservationId, Date.now());
    });
  }

  async activateReservation(code: string, reservationId: string, metadata: AdminRoom): Promise<void> {
    await this.serial.run(async () => {
      const room = this.state.rooms.find((entry) => entry.metadata.roomCode === code);
      assertReservation(room, reservationId, Date.now());
      if (metadata.roomCode !== code || metadata.status !== "active" || !metadata.partyId)
        throw new RegistryError("ROOM_RESERVATION_EXPIRED", "The room reservation expired. Please create a room again.", 409);
      room.metadata = safeMetadata(metadata);
      room.reservationId = null;
      room.reservationExpiresAt = null;
      await this.save();
    });
  }

  async releaseReservation(code: string, reservationId: string): Promise<void> {
    const target = await this.serial.run(async () => {
      const room = this.state.rooms.find((entry) => entry.metadata.roomCode === code);
      if (!room || room.metadata.status !== "pending" || room.reservationId !== reservationId) return null;
      room.metadata = { ...room.metadata, status: "closed", closedAt: Date.now(), closeReason: "reservation-expired" };
      await this.save();
      return { ...room };
    });
    if (target) await this.purgeRecord(target);
  }

  /** Callback accepts only a known live generation; closed entries cannot be revived. */
  async updateRoom(metadata: AdminRoom, expectedPartyId: string): Promise<void> {
    await this.serial.run(async () => {
      const room = this.state.rooms.find((entry) => entry.metadata.roomCode === metadata.roomCode);
      if (!acceptsRoomUpdate(room, metadata, expectedPartyId)) return;
      room!.metadata = safeMetadata(metadata);
      await this.save();
    });
  }

  async lookup(code: string): Promise<{ roomCode: string; objectKey: string } | null> {
    await this.ensureBootstrap();
    const normalized = normalizeRoomCode(code);
    if (!normalized) return null;
    // Probe due metadata outside the lock before granting access, never allocate on a miss.
    const due = await this.serial.run(() => this.state.rooms.find((room) => room.metadata.roomCode === normalized && room.metadata.status === "active" && isExpiredMetadata(room.metadata, Date.now())));
    if (due) await this.probe({ ...due, metadata: { ...due.metadata } });
    return this.serial.run(() => {
      const room = this.state.rooms.find((entry) => entry.metadata.roomCode === normalized && entry.metadata.status === "active");
      return room ? { roomCode: normalized, objectKey: room.objectKey } : null;
    });
  }

  async migratedRoom(): Promise<{ roomCode: string; objectKey: string } | null> {
    await this.ensureBootstrap();
    return this.state.migratedRoomCode ? this.lookup(this.state.migratedRoomCode) : null;
  }

  async publicInfo(): Promise<RoomDirectoryInfo> {
    await this.ensureBootstrap();
    await this.reconcile();
    return this.serial.run(() => directoryInfo(this.state.rooms, this.state.roomCap, this.state.configVersion));
  }

  async listForAdmin(): Promise<AdminDirectoryView> {
    await this.ensureBootstrap();
    await this.reconcile(true);
    return this.serial.run(() => ({
      rooms: this.state.rooms.map((room) => safeMetadata(room.metadata)),
      roomCap: this.state.roomCap, configVersion: this.state.configVersion,
      activeRooms: directoryInfo(this.state.rooms, this.state.roomCap, this.state.configVersion).activeRooms,
    }));
  }

  async setRoomCap(cap: number, expectedVersion: number): Promise<AdminDirectoryConfig> {
    await this.ensureBootstrap();
    return this.serial.run(async () => {
      const config = nextRoomConfig(cap, expectedVersion, this.state.configVersion);
      this.state.roomCap = config.roomCap;
      this.state.configVersion = config.configVersion;
      await this.save();
      return { roomCap: cap, configVersion: this.state.configVersion };
    });
  }

  private async getVersion(code: string, expectedPartyId: string | null): Promise<RoomRecord> {
    const normalized = normalizeRoomCode(code);
    return this.serial.run(() => {
      const room = this.state.rooms.find((entry) => entry.metadata.roomCode === normalized);
      assertRoomVersion(room, expectedPartyId);
      return { ...room, metadata: { ...room.metadata } };
    });
  }

  async closeForAdmin(code: string, expectedPartyId: string): Promise<void> {
    await this.ensureBootstrap();
    const room = await this.getVersion(code, expectedPartyId);
    if (room.metadata.status === "closed") return;
    // Room repeats generation check atomically with closure, protecting fresh-party races.
    await this.env.PARTY.getByName(room.objectKey).closeRoom(room.metadata.roomCode, expectedPartyId);
  }

  async purgeForAdmin(code: string, expectedPartyId: string | null): Promise<void> {
    await this.ensureBootstrap();
    const room = await this.getVersion(code, expectedPartyId);
    if (room.metadata.status === "active" && !isExpiredMetadata(room.metadata, Date.now()))
      throw new RegistryError("ROOM_ACTIVE", "Close this active room before purging it.", 409);
    if (room.metadata.status === "pending" && (room.reservationExpiresAt ?? Infinity) > Date.now())
      throw new RegistryError("ROOM_ACTIVE", "This room is still being created. Refresh before purging.", 409);
    await this.purgeRecord(room);
    await this.serial.run(async () => {
      const current = this.state.rooms.find((entry) => entry.metadata.roomCode === room.metadata.roomCode);
      assertRoomVersion(current, expectedPartyId);
      if (current.metadata.status !== "closed")
        throw new RegistryError("ROOM_ACTIVE", "Close this active room before purging it.", 409);
      this.state.rooms = this.state.rooms.filter((entry) => entry !== current);
      await this.save();
    });
  }

  async purgeExpiredForAdmin(): Promise<{ purged: number }> {
    await this.ensureBootstrap();
    await this.reconcile();
    const rooms = await this.serial.run(() => this.state.rooms.filter((room) => room.metadata.status === "closed").map((room) => ({ ...room, metadata: { ...room.metadata } })));
    let purged = 0;
    for (const room of rooms) {
      try {
        await this.purgeForAdmin(room.metadata.roomCode, room.metadata.partyId);
        purged += 1;
      } catch (error) {
        // Concurrent lifecycle changes must never turn batch cleanup into active-room deletion.
        if (!(error instanceof Error) || !/^(STALE_PARTY|ROOM_ACTIVE|ROOM_NOT_FOUND):/.test(error.message)) throw error;
      }
    }
    return { purged };
  }

  private async purgeRecord(room: RoomRecord): Promise<void> {
    await this.env.PARTY.getByName(room.objectKey).purgeRoom(room.metadata.roomCode, room.metadata.partyId);
    await this.serial.run(async () => {
      const current = this.state.rooms.find((entry) => entry.metadata.roomCode === room.metadata.roomCode);
      if (!current || current.metadata.partyId !== room.metadata.partyId) return;
      current.metadata = { ...current.metadata, status: "closed", closedAt: current.metadata.closedAt ?? Date.now(), closeReason: current.metadata.closeReason ?? "expired", storagePurged: true, connectedCount: 0, playerCount: 0, phase: null };
      current.reservationId = null;
      current.reservationExpiresAt = null;
      await this.save();
    });
  }

  private async probe(room: RoomRecord): Promise<void> {
    const metadata = await this.env.PARTY.getByName(room.objectKey).inspectRoom();
    await this.serial.run(async () => {
      const current = this.state.rooms.find((entry) => entry.metadata.roomCode === room.metadata.roomCode);
      if (!current || current.metadata.status !== "active" || current.metadata.partyId !== room.metadata.partyId) return;
      current.metadata = metadata ? safeMetadata(metadata) : {
        ...current.metadata, status: "closed", phase: null, playerCount: 0, connectedCount: 0,
        closedAt: Date.now(), closeReason: "expired", storagePurged: true,
      };
      await this.save();
    });
  }

  private async reconcile(probeAll = false): Promise<void> {
    const candidates = await this.serial.run(async () => {
      const now = Date.now();
      const targets: RoomRecord[] = [];
      for (const room of this.state.rooms) {
        if (room.metadata.status === "pending" && (room.reservationExpiresAt ?? 0) <= now) {
          room.metadata = { ...room.metadata, status: "closed", closedAt: now, closeReason: "reservation-expired" };
          targets.push({ ...room, metadata: { ...room.metadata } });
        } else if ((room.metadata.status === "active" && (probeAll || isExpiredMetadata(room.metadata, now))) || (room.metadata.status === "closed" && !room.metadata.storagePurged)) {
          targets.push({ ...room, metadata: { ...room.metadata } });
        }
      }
      this.state.rooms = pruneClosed(this.state.rooms, now);
      await this.save();
      return targets;
    });
    for (const room of candidates) {
      try {
        if (room.metadata.status === "active") await this.probe(room);
        else await this.purgeRecord(room);
      } catch (error) {
        // A reservation can time out while the room is rolling back activation.
        // A fresh-party change can also invalidate a captured expiry probe.
        if (!(error instanceof Error) || !/^(?:remote: )?(STALE_PARTY|ROOM_ACTIVE):/.test(error.message)) throw error;
      }
    }
  }

  async alarm(): Promise<void> {
    await this.ensureBootstrap();
    await this.reconcile(true);
  }
}

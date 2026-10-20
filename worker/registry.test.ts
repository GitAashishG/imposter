import { describe, expect, test } from "bun:test";
import type { AdminRoom } from "../src/party/protocol";
import { SerialQueue } from "./security";
import {
  CLOSED_RETENTION_MS, DEFAULT_ROOM_CAP, MAX_CLOSED_ROOMS, MAX_RATE_BUCKETS,
  RESERVATION_MS, acceptsRoomUpdate, assertCapacity, assertReservation,
  assertRoomVersion, consumeRate, directoryInfo, generateRoomCode,
  isExpiredMetadata, nextRoomConfig, normalizeRoomCode, pendingRoom,
  pruneClosed, roomRoute, safeMetadata, type RateBucket, type RoomRecord,
} from "./registry-domain";

const now = 1_000_000;
const hash = (index: number) => index.toString(16).padStart(64, "0");
function active(code = "ABCDEFGH", partyId = "party-one"): RoomRecord {
  const record = pendingRoom(code, code, "reservation", now);
  record.metadata = { ...record.metadata, partyId, status: "active", phase: "lobby",
    playerCount: 3, connectedCount: 2, expiresAt: now + 43_200_000,
    abandonedExpiresAt: null };
  record.reservationExpiresAt = null;
  record.reservationId = null;
  return record;
}
function closed(index: number, closedAt = now): RoomRecord {
  const record = active(`room-${index}`, `party-${index}`);
  record.metadata = { ...record.metadata, status: "closed", closedAt, storagePurged: true };
  return record;
}

describe("room-coded gateway domain", () => {
  test("case-insensitive routing has one shared alphabet and excludes ambiguous characters", () => {
    expect(normalizeRoomCode(" abcdefgh ")).toBe("ABCDEFGH");
    for (const code of ["ABCDEF1H", "ABCDEF0H", "ABCDEFIH", "ABCDEFOH", "ABCDEFG", "ABCDEFGHI", "<script>"])
      expect(normalizeRoomCode(code)).toBe("");
    for (let index = 0; index < 100; index += 1)
      expect(generateRoomCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  });

  test("only explicit new room endpoints route; arbitrary object keys and old aliases do not", () => {
    expect(roomRoute("/api/rooms")?.methods).toEqual(["GET", "POST"]);
    expect(roomRoute("/api/rooms/restore")?.kind).toBe("restore");
    expect(roomRoute("/api/rooms/abcdefgh/history")).toEqual({
      kind: "room", roomCode: "ABCDEFGH", operation: "history", methods: ["GET"],
    });
    expect(roomRoute("/api/rooms/ABCDEFGH/action")?.methods).toEqual(["POST"]);
    expect(roomRoute("/api/rooms/ABCDEFGH/socket")?.methods).toEqual(["GET"]);
    for (const path of ["/api/party", "/api/party/create", "/api/rooms/single-party/state", "/api/rooms/ABCDEFGH/create", "/api/rooms/ABCDEFGH/admin", "/api/rooms/ABCDEFGH/state/extra", "/api/rooms/%41BCDEFGH", "/api/rooms/ABCDEFGH/"])
      expect(roomRoute(path)).toBeNull();
  });

  test("public directory exposes counts only, not room codes, object keys, or credentials", () => {
    const records = [active(), pendingRoom("JKLMNPQR", "private-object", "secret-reservation", now), closed(1)];
    expect(directoryInfo(records, DEFAULT_ROOM_CAP, 1)).toEqual({ activeRooms: 2, availableSlots: 3, roomCap: 5, configVersion: 1 });
    expect(JSON.stringify(directoryInfo(records, 5, 1))).not.toContain("ABCDEFGH");
    expect(JSON.stringify(directoryInfo(records, 5, 1))).not.toContain("secret-reservation");
  });

  test("owner metadata whitelists fields even if an RPC payload contains game secrets", () => {
    const unsafe = { ...active().metadata, pin: "123456", token: "private-token", hostRecoveryCode: "private-recovery",
      players: [{ name: "Private name", tokenHash: "secret-hash" }], word: "secret-word", roles: ["imposter"], votes: { a: "b" }, objectKey: "private-object" };
    const output = safeMetadata(unsafe as AdminRoom);
    expect(output).toEqual(active().metadata);
    const encoded = JSON.stringify(output);
    for (const secret of ["123456", "private-token", "private-recovery", "Private name", "secret-hash", "secret-word", "imposter", "private-object"])
      expect(encoded).not.toContain(secret);
  });
});

describe("atomic room reservations and generation guards", () => {
  test("concurrent serialized reservations admit exactly five, including pending slots", async () => {
    const serial = new SerialQueue();
    const records: RoomRecord[] = [];
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => serial.run(async () => {
      assertCapacity(records, DEFAULT_ROOM_CAP);
      await Promise.resolve();
      records.push(pendingRoom(`code-${index}`, `object-${index}`, `reservation-${index}`, now));
    })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(5);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(7);
    expect(directoryInfo(records, 5, 1).availableSlots).toBe(0);
  });

  test("reservations validate identity and expire at exactly thirty seconds", () => {
    const record = pendingRoom("ABCDEFGH", "private-object", "reservation", now);
    expect(record.reservationExpiresAt).toBe(now + RESERVATION_MS);
    expect(() => assertReservation(record, "reservation", now + RESERVATION_MS - 1)).not.toThrow();
    expect(() => assertReservation(record, "wrong", now)).toThrow("ROOM_RESERVATION_EXPIRED");
    expect(() => assertReservation(record, "reservation", now + RESERVATION_MS)).toThrow("ROOM_RESERVATION_EXPIRED");
    expect(() => assertReservation(undefined, "reservation", now)).toThrow("ROOM_RESERVATION_EXPIRED");
    record.metadata.status = "closed";
    expect(() => assertReservation(record, "reservation", now)).toThrow("ROOM_RESERVATION_EXPIRED");
  });

  test("ending a room frees one slot; lowering the cap never removes current rooms", () => {
    const records = Array.from({ length: 5 }, (_, index) => active(`code-${index}`));
    expect(() => assertCapacity(records, 5)).toThrow("ROOM_FULL");
    records[0]!.metadata.status = "closed";
    expect(() => assertCapacity(records, 5)).not.toThrow();
    expect(directoryInfo(records, 2, 9)).toEqual({ activeRooms: 4, availableSlots: 0, roomCap: 2, configVersion: 9 });
    expect(records).toHaveLength(5);
    expect(() => assertCapacity(records, 2)).toThrow("ROOM_FULL");
  });

  test("config writes are compare-and-swap and enforce the full owner range", () => {
    expect(nextRoomConfig(1, 1, 1)).toEqual({ roomCap: 1, configVersion: 2 });
    expect(nextRoomConfig(20, 2, 2)).toEqual({ roomCap: 20, configVersion: 3 });
    expect(() => nextRoomConfig(5, 1, 2)).toThrow("STALE_CONFIG");
    for (const cap of [0, 21, -1, 1.5, NaN, Infinity])
      expect(() => nextRoomConfig(cap, 1, 1)).toThrow("INVALID_CAP");
  });

  test("stale administrative generations cannot target a fresh replacement", () => {
    const replacement = active("ABCDEFGH", "new-party");
    expect(() => assertRoomVersion(replacement, "old-party")).toThrow("STALE_PARTY");
    expect(() => assertRoomVersion(replacement, null)).toThrow("STALE_PARTY");
    expect(() => assertRoomVersion(replacement, "new-party")).not.toThrow();
    expect(() => assertRoomVersion(undefined, "old-party")).toThrow("ROOM_NOT_FOUND");
    expect(replacement.metadata.status).toBe("active");
  });

  test("only a known current generation can publish metadata; closed and unknown rooms never revive", () => {
    const current = active();
    const replacement = { ...current.metadata, partyId: "new-party" };
    expect(acceptsRoomUpdate(current, replacement, "party-one")).toBe(true);
    expect(acceptsRoomUpdate(current, replacement, "stale-party")).toBe(false);
    expect(acceptsRoomUpdate(current, { ...replacement, roomCode: "JKLMNPQR" }, "party-one")).toBe(false);
    expect(acceptsRoomUpdate(undefined, replacement, "party-one")).toBe(false);
    current.metadata.status = "closed";
    expect(acceptsRoomUpdate(current, replacement, "party-one")).toBe(false);
  });

  test("authoritative probes are needed at either inactivity deadline, not just ordinary TTL", () => {
    const metadata = active().metadata;
    expect(isExpiredMetadata(metadata, now)).toBe(false);
    expect(isExpiredMetadata(metadata, metadata.expiresAt!)).toBe(true);
    metadata.abandonedExpiresAt = now + 900_000;
    expect(isExpiredMetadata(metadata, now + 899_999)).toBe(false);
    expect(isExpiredMetadata(metadata, now + 900_000)).toBe(true);
    metadata.status = "closed";
    expect(isExpiredMetadata(metadata, now)).toBe(true);
  });

  test("closed metadata keeps latest hundred for at most a day without pruning active rooms", () => {
    const records = [active(), ...Array.from({ length: 120 }, (_, index) => closed(index, now - index)), closed(999, now - CLOSED_RETENTION_MS)];
    const kept = pruneClosed(records, now);
    expect(kept.filter((record) => record.metadata.status === "closed")).toHaveLength(MAX_CLOSED_ROOMS);
    expect(kept[0]!.metadata.status).toBe("active");
    expect(kept.some((record) => record.metadata.partyId === "party-999")).toBe(false);
    expect(pruneClosed([closed(1, now - CLOSED_RETENTION_MS + 1)], now)).toHaveLength(1);
  });
});

describe("bounded hash-only gateway and creation limits", () => {
  test("six hundred requests per minute, with exact reset boundary", () => {
    let buckets: RateBucket[] = [];
    for (let index = 0; index < 600; index += 1) buckets = consumeRate(buckets, hash(1), false, now);
    expect(() => consumeRate(buckets, hash(1), false, now + 59_999)).toThrow("REQUEST_THROTTLED");
    expect(consumeRate(buckets, hash(1), false, now + 60_000)[0]!.count).toBe(1);
    expect(() => consumeRate(buckets, hash(2), false, now)).not.toThrow();
  });

  test("ten creations per IP per hour does not prevent existing room requests", () => {
    let buckets: RateBucket[] = [];
    for (let index = 0; index < 10; index += 1) buckets = consumeRate(buckets, hash(1), true, now);
    expect(() => consumeRate(buckets, hash(1), true, now + 3_599_999)).toThrow("CREATION_THROTTLED");
    expect(() => consumeRate(buckets, hash(1), false, now)).not.toThrow();
    expect(() => consumeRate(buckets, hash(1), true, now + 3_600_000)).not.toThrow();
  });

  test("one hundred creations globally per day cannot be bypassed by rotating IPs", () => {
    let buckets: RateBucket[] = [];
    for (let index = 0; index < 100; index += 1) buckets = consumeRate(buckets, hash(index), true, now);
    const before = JSON.stringify(buckets);
    expect(() => consumeRate(buckets, hash(999), true, now + 86_399_999)).toThrow("CREATION_THROTTLED");
    expect(JSON.stringify(buckets)).toBe(before); // Failed multi-bucket checks commit nothing.
    expect(() => consumeRate(buckets, hash(999), false, now)).not.toThrow();
    expect(() => consumeRate(buckets, hash(999), true, now + 86_400_000)).not.toThrow();
  });

  test("live buckets are bounded without eviction-based rate-limit bypass", () => {
    const buckets: RateBucket[] = Array.from({ length: MAX_RATE_BUCKETS }, (_, index) => ({ key: hash(index), window: "request", startedAt: now, count: 1 }));
    expect(() => consumeRate(buckets, hash(MAX_RATE_BUCKETS), false, now)).toThrow("REQUEST_THROTTLED");
    expect(consumeRate(buckets, hash(1), false, now)).toHaveLength(MAX_RATE_BUCKETS);
    expect(consumeRate(buckets, hash(MAX_RATE_BUCKETS), false, now + 60_000)).toHaveLength(1);
    expect(() => consumeRate([], "192.0.2.1", false, now)).toThrow("SHA-256");
  });
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PartyActionResponse, PartyCommand, PartyEntry, PartyErrorBody, PartyEvent, PartyHistoryResponse, PartyPublicInfo, PartySession, PartySnapshot, RoomDirectoryInfo } from "../src/party/protocol";
import type { Settings } from "../src/game";

const root = fileURLToPath(new URL("../", import.meta.url));
const stateDirectory = await mkdtemp(join(tmpdir(), "koho-integration-"));
const allocator = createServer();
await new Promise<void>((resolve, reject) => { allocator.once("error", reject); allocator.listen(0, "127.0.0.1", resolve); });
const address = allocator.address();
if (!address || typeof address === "string") throw new Error("Could not allocate a local test port.");
const port = address.port;
await new Promise<void>((resolve, reject) => allocator.close((error) => error ? reject(error) : resolve()));
const api = `http://127.0.0.1:${port}`;
const child = spawn(join(root, "node_modules", ".bin", "wrangler"), ["dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--persist-to", stateDirectory], { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
let logs = "";
const log = (chunk: Buffer) => { logs = (logs + chunk.toString()).slice(-5000); };
child.stdout?.on("data", log);
child.stderr?.on("data", log);
const ready = new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Local referee did not become ready. ${logs}`)), 30000);
  const onData = (chunk: Buffer) => { if (chunk.toString().includes("Ready on")) { clearTimeout(timeout); resolve(); } };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  child.once("error", (error) => { clearTimeout(timeout); reject(error); });
  child.once("exit", (code) => { clearTimeout(timeout); if (code !== null) reject(new Error(`Local referee exited (${code}). ${logs}`)); });
});

async function http<T>(path: string, token?: string, body?: unknown, expected = 200): Promise<T> {
  const response = await fetch(api + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(12000),
  });
  const value: unknown = await response.json();
  const code = value && typeof value === "object" && "code" in value ? String(value.code) : "unexpected-response";
  assert.equal(response.status, expected, `${path} returned ${response.status} (${code})`);
  return value as T;
}

class Client {
  readonly socket: WebSocket;
  snapshot: PartySnapshot | null = null;
  ended = false;
  error: string | null = null;
  private readonly listeners = new Set<() => void>();
  constructor(readonly seat: PartySession) {
    this.socket = new WebSocket(`${api.replace("http:", "ws:")}/api/rooms/${seat.roomCode}/socket`);
    this.socket.onopen = () => this.socket.send(JSON.stringify({ type: "auth", token: seat.token }));
    this.socket.onmessage = (event) => {
      if (event.data === "pong") return;
      const message = JSON.parse(String(event.data)) as PartyEvent;
      if (message.type === "snapshot") this.snapshot = message.snapshot;
      else if (message.type === "ended") this.ended = true;
      else this.error = message.error;
      for (const listener of this.listeners) listener();
    };
  }
  async waitFor(predicate: (snapshot: PartySnapshot) => boolean): Promise<PartySnapshot> {
    if (this.snapshot && predicate(this.snapshot)) return this.snapshot;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.listeners.delete(check); reject(new Error(`Room ${this.seat.roomCode} did not reach its expected state.`)); }, 10000);
      const check = () => {
        if (this.error) { clearTimeout(timeout); this.listeners.delete(check); reject(new Error(`Socket rejected: ${this.error}`)); }
        else if (this.snapshot && predicate(this.snapshot)) { clearTimeout(timeout); this.listeners.delete(check); resolve(this.snapshot); }
      };
      this.listeners.add(check);
    });
  }
  close() { this.socket.close(); }
}

interface TestRoom { code: string; entries: PartyEntry[]; clients: Client[]; pin: string }
const ownedRooms: TestRoom[] = [];
const settings: Settings = { packIds: ["easy"], rounds: 3, discussionSeconds: 60, clueCycles: 1, lastChanceGuess: false };

async function state(room: TestRoom, actor = 0) {
  return http<PartySnapshot>(`/api/rooms/${room.code}/state`, room.entries[actor]!.session.token);
}
async function act(room: TestRoom, command: PartyCommand, actor = 0, expected = 200, gameId?: string) {
  const current = gameId ?? (await state(room, actor)).gameId;
  return http<PartyActionResponse>(`/api/rooms/${room.code}/action`, room.entries[actor]!.session.token, { action: { ...command, gameId: current } }, expected);
}
async function makeRoom(name: string, pin: string, players = 1): Promise<TestRoom> {
  const entry = await http<PartyEntry>("/api/rooms", undefined, { name, pin, settings }, 201);
  const room: TestRoom = { code: entry.session.roomCode, pin, entries: [entry], clients: [] };
  ownedRooms.push(room);
  assert.match(room.code, /^[A-HJ-NP-Z2-9]{8}$/);
  for (let index = 1; index < players; index++) room.entries.push(await http<PartyEntry>(`/api/rooms/${room.code}/join`, undefined, { name: `${name} ${index}`, pin }));
  room.clients = room.entries.map((member) => new Client(member.session));
  await Promise.all(room.clients.map((client) => client.waitFor((snapshot) => snapshot.players.length === players && snapshot.players.every((player) => player.connected))));
  return room;
}

function publicState(snapshot: PartySnapshot) {
  return { id: snapshot.id, gameId: snapshot.gameId, phase: snapshot.phase, roundNumber: snapshot.roundNumber, ownRole: snapshot.ownRole, players: snapshot.players.map(({ id, name, score, ready, hasVoted }) => ({ id, name, score, ready, hasVoted })) };
}

async function runChecks() {
  await ready;
  const initial = await http<RoomDirectoryInfo>("/api/rooms");
  assert.equal(initial.activeRooms, 0);
  assert.equal(initial.roomCap, 5);
  const roomA = await makeRoom("Aashish", "123456", 3);
  const roomB = await makeRoom("Krishna", "654321", 3);
  assert.notEqual(roomA.code, roomB.code);
  const beforeUnknown = await http<RoomDirectoryInfo>("/api/rooms");
  const unknown = ["ABCDEFGH", "BCDEFGHJ", "CDEFGHJK"].find((code) => code !== roomA.code && code !== roomB.code)!;
  await http<PartyErrorBody>(`/api/rooms/${unknown}`, undefined, undefined, 404);
  assert.equal((await http<RoomDirectoryInfo>("/api/rooms")).activeRooms, beforeUnknown.activeRooms);
  const invalidToken = roomA.entries[0]!.session.token;
  const bState = await state(roomB);
  await http<PartyErrorBody>(`/api/rooms/${roomB.code}/state`, invalidToken, undefined, 401);
  await http<PartyErrorBody>(`/api/rooms/${roomB.code}/history`, invalidToken, undefined, 401);
  await http<PartyErrorBody>(`/api/rooms/${roomB.code}/action`, invalidToken, { action: { type: "end-party", gameId: bState.gameId } }, 401);
  await http<PartyErrorBody>(`/api/rooms/${roomB.code}/recover`, undefined, { recoveryCode: (await state(roomA)).hostRecoveryCode }, 403);
  assert.deepEqual(publicState(await state(roomB)), publicState(bState));

  const oldPinState = await state(roomA);
  await act(roomA, { type: "rotate-pin", pin: "112233" });
  roomA.pin = "112233";
  assert.equal((await state(roomA)).players.length, oldPinState.players.length);
  await http<PartyErrorBody>(`/api/rooms/${roomA.code}/join`, undefined, { name: "Old invitation", pin: "123456" }, 403);
  const joined = await http<PartyEntry>(`/api/rooms/${roomA.code}/join`, undefined, { name: "Ana", pin: roomA.pin });
  await act(roomA, { type: "remove-player", playerId: joined.session.playerId });
  await http<PartyErrorBody>(`/api/rooms/${roomA.code}/state`, joined.session.token, undefined, 401);

  await act(roomB, { type: "start" });
  const untouchedB = publicState(await state(roomB));
  await act(roomA, { type: "start" });
  const scores = new Map(roomA.entries.map((entry) => [entry.session.playerId, 0]));
  const dealt = new Set<string>();
  for (let roundNumber = 1; roundNumber <= 3; roundNumber++) {
    await roomA.clients[0]!.waitFor((snapshot) => snapshot.phase === "role" && snapshot.roundNumber === roundNumber);
    const views = await Promise.all(roomA.entries.map((_, index) => state(roomA, index)));
    const imposter = views.findIndex((snapshot) => snapshot.ownRole?.isImposter);
    assert(imposter >= 0);
    const word = views.find((snapshot) => snapshot.ownRole && !snapshot.ownRole.isImposter)!.ownRole!;
    assert(!word.isImposter);
    assert(!dealt.has(word.word.id)); dealt.add(word.word.id);
    for (let index = 0; index < views.length; index++) {
      const snapshot = views[index]!;
      assert.equal(snapshot.roomCode, roomA.code);
      assert.equal(snapshot.result, null);
      if (index !== 0) { assert(!Object.hasOwn(snapshot, "pin")); assert(!Object.hasOwn(snapshot, "hostRecoveryCode")); }
      if (snapshot.ownRole?.isImposter) assert.equal(snapshot.ownRole.word, null);
      for (const player of snapshot.players) { assert(!Object.hasOwn(player, "tokenHash")); assert(!Object.hasOwn(player, "suspectId")); }
      await act(roomA, { type: "ready", roundNumber }, index);
    }
    await act(roomA, { type: "start-clues", roundNumber });
    for (let clueIndex = 0; clueIndex < 3; clueIndex++) await act(roomA, { type: "next-clue", roundNumber, clueIndex });
    await act(roomA, { type: "start-vote", roundNumber });
    for (let voter = 0; voter < 3; voter++) {
      const target = voter === imposter ? (imposter === 0 ? 1 : 0) : imposter;
      await act(roomA, { type: "vote", roundNumber, suspectId: roomA.entries[target]!.session.playerId }, voter);
    }
    const result = await state(roomA);
    assert.equal(result.phase, "result");
    for (let index = 0; index < 3; index++) if (index !== imposter) scores.set(roomA.entries[index]!.session.playerId, scores.get(roomA.entries[index]!.session.playerId)! + 1);
    assert(result.players.every((player) => player.score === scores.get(player.id)));
    assert.equal(result.completedGames, 0);
    await act(roomA, { type: "next-round", roundNumber });
  }
  const final = await state(roomA);
  assert.equal(final.phase, "final");
  assert.equal(final.completedGames, 1);
  const history = await http<PartyHistoryResponse>(`/api/rooms/${roomA.code}/history`, roomA.entries[1]!.session.token);
  assert.equal(history.history.completedGames, 1);
  assert.equal(history.history.games[0]!.gameId, final.gameId);
  assert.equal(history.history.totals.length, 3);
  const historyText = JSON.stringify(history);
  for (const forbidden of ["tokenHash", "hostRecoveryCode", "voteCounts", "imposterId", '"word"']) assert(!historyText.includes(forbidden), `History exposed ${forbidden}`);
  await act(roomA, { type: "next-round", roundNumber: 3 }, 0, 409);
  assert.equal((await http<PartyHistoryResponse>(`/api/rooms/${roomA.code}/history`, roomA.entries[0]!.session.token)).history.completedGames, 1);
  await act(roomA, { type: "new-game" });
  assert.equal((await state(roomA)).completedGames, 1);
  await act(roomA, { type: "end-party" }, 0, 409, final.gameId);
  assert.deepEqual(publicState(await state(roomB)), untouchedB);

  const contenders = await Promise.all(Array.from({ length: 4 }, async (_, index) => {
    const response = await fetch(`${api}/api/rooms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `Capacity ${index}`, pin: `22334${index}`, settings }), signal: AbortSignal.timeout(12000) });
    if (response.status === 409) return null;
    assert.equal(response.status, 201, "Concurrent capacity request must create or reject cleanly");
    const entry = await response.json() as PartyEntry;
    const room: TestRoom = { code: entry.session.roomCode, pin: `22334${index}`, entries: [entry], clients: [new Client(entry.session)] };
    ownedRooms.push(room);
    await room.clients[0]!.waitFor((snapshot) => snapshot.players.every((player) => player.connected));
    return room;
  }));
  const admitted = contenders.filter((room): room is TestRoom => room !== null);
  assert.equal(admitted.length, 3, "Exactly three remaining slots admit concurrent requests");
  const roomC = admitted[0]!;
  const full = await http<RoomDirectoryInfo>("/api/rooms");
  assert.equal(full.activeRooms, 5);
  assert.equal(full.availableSlots, 0);
  await http<PartyErrorBody>("/api/rooms", undefined, { name: "Over capacity", pin: "556677", settings }, 409);
  await act(roomC, { type: "end-party" });
  await http<PartyErrorBody>(`/api/rooms/${roomC.code}`, undefined, undefined, 404);
  await makeRoom("Reused capacity", "667788");
  assert.equal((await http<RoomDirectoryInfo>("/api/rooms")).activeRooms, 5);
  await act(roomA, { type: "end-party" });
  await http<PartyErrorBody>(`/api/rooms/${roomA.code}/state`, roomA.entries[0]!.session.token, undefined, 404);
  assert.deepEqual(publicState(await state(roomB)), untouchedB);
  assert.equal((await http<PartyPublicInfo>(`/api/rooms/${roomB.code}`)).exists, true);
  const adminResponse = await fetch(`${api}/api/admin/rooms`, { headers: { Authorization: `Bearer ${roomB.entries[0]!.session.token}`, "X-Admin-Id": "9066299" }, signal: AbortSignal.timeout(10000) });
  assert([401, 403, 503].includes(adminResponse.status), "Room credentials must not authorize owner administration");
  const admin = await adminResponse.json() as Record<string, unknown>;
  assert(!Object.hasOwn(admin, "rooms"));
  await http<PartyErrorBody>("/api/party", undefined, undefined, 426);
  console.log("Verified: real isolated rooms, room-bound tokens/recovery, PIN rotation, exactly-once history, stale-game guards, five-room capacity/release, independent cleanup, and fail-closed admin routes.");
}

let failure: unknown;
try { await runChecks(); }
catch (error) { failure = error; }
finally {
  for (const room of ownedRooms) for (const client of room.clients) client.close();
  for (const room of ownedRooms) {
    try {
      const current = await state(room);
      await http<PartyActionResponse>(`/api/rooms/${room.code}/action`, room.entries[0]!.session.token, { action: { type: "end-party", gameId: current.gameId } });
    } catch { /* The room may already be closed; its test storage is discarded below. */ }
  }
  if (child.pid) {
    try { if (process.platform === "win32") child.kill("SIGTERM"); else process.kill(-child.pid, "SIGTERM"); } catch { /* Already stopped. */ }
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) { resolve(); return; }
      const timeout = setTimeout(() => {
        try { if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* Already stopped. */ }
        resolve();
      }, 5000);
      timeout.unref();
      child.once("exit", () => { clearTimeout(timeout); resolve(); });
    });
  }
  await rm(stateDirectory, { recursive: true, force: true });
}
if (failure) throw failure;

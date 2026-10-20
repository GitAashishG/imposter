import { describe, expect, test } from "bun:test";
import type { PartyCommand } from "../src/party/protocol";
import type { Settings } from "../src/game";
import { historyView } from "../src/history";
import {
  PARTY_TTL_MS,
  PartyError,
  applyAction,
  authenticate,
  createParty,
  joinParty,
  project,
  publicInfo,
  updatePresence,
  updateWordHistory,
  validateAction,
  validateSettings,
  type PartyState,
} from "./model";
import {
  PIN_WINDOW_MS,
  SerialQueue,
  checkPinThrottle,
  hashToken,
  makeToken,
  recordFailure,
  type FailureAttempt,
} from "./security";

const settings: Settings = {
  packIds: ["everyday"],
  rounds: 3,
  discussionSeconds: 60,
  clueCycles: 1,
  lastChanceGuess: false,
};
const ids = ["host", "b", "c", "d"];
const online = new Set(ids);
const zero = () => 0;
const histories = new WeakMap<PartyState, string[]>();

function lobby(count = 4): PartyState {
  let state = createParty(
    "party-one",
    { id: "host", name: "Asha", tokenHash: "hash-host" },
    "123456",
    settings,
    1_000,
  );
  for (const [index, name] of ["Bikash", "Chandra", "Dipa"].entries()) {
    if (index + 1 >= count) break;
    state = joinParty(
      state,
      { id: ids[index + 1]!, name, tokenHash: `hash-${ids[index + 1]}` },
      "123456",
      1_000,
    );
  }
  return updatePresence(state, online, 1_000);
}

function act(
  state: PartyState,
  action: PartyCommand,
  actor = "host",
  now = 2_000,
): PartyState {
  const history = histories.get(state) ?? [];
  const next = applyAction(
    state,
    actor,
    { ...action, gameId: state.gameId },
    now,
    online,
    zero,
    { recentWordIds: history },
  );
  if (!next) throw new Error("This helper expects a surviving party.");
  histories.set(next, updateWordHistory(state, next, history));
  return next;
}

function roles(): PartyState {
  return act(lobby(), { type: "start" });
}

function clues(state = roles()): PartyState {
  for (const player of state.players)
    state = act(
      state,
      { type: "ready", roundNumber: state.round!.number },
      player.id,
    );
  return act(state, { type: "start-clues", roundNumber: state.round!.number });
}

function discussion(state = clues(), now = 5_000): PartyState {
  while (state.phase === "clue") {
    state = act(
      state,
      {
        type: "next-clue",
        roundNumber: state.round!.number,
        clueIndex: state.clueIndex,
      },
      "host",
      now,
    );
  }
  return state;
}

function voting(state = discussion()): PartyState {
  return act(
    state,
    { type: "start-vote", roundNumber: state.round!.number },
    "host",
    6_000,
  );
}

function caught(state = voting()): PartyState {
  for (const id of ids) {
    state = act(
      state,
      {
        type: "vote",
        roundNumber: state.round!.number,
        suspectId: id === "host" ? "b" : "host",
      },
      id,
      7_000,
    );
  }
  return state;
}

function rejects(code: string, operation: () => unknown): void {
  try {
    operation();
    throw new Error("Expected the party operation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(PartyError);
    expect((error as PartyError).code).toBe(code);
  }
}

describe("admission and identity", () => {
  test("normalizes names, checks PIN and prevents duplicate or over-capacity joins", () => {
    const state = lobby();
    rejects("NAME_TAKEN", () =>
      joinParty(
        state,
        { id: "e", name: "  aSHA ", tokenHash: "new" },
        "123456",
        2_000,
      ),
    );
    rejects("WRONG_PIN", () =>
      joinParty(
        state,
        { id: "e", name: "New", tokenHash: "new" },
        "000000",
        2_000,
      ),
    );
    rejects("INVALID_PIN", () =>
      joinParty(
        state,
        { id: "e", name: "New", tokenHash: "new" },
        123456,
        2_000,
      ),
    );
    rejects("INVALID_NAME", () =>
      joinParty(
        state,
        { id: "e", name: "x".repeat(25), tokenHash: "new" },
        "123456",
        2_000,
      ),
    );
    rejects("INVALID_NAME", () =>
      joinParty(
        state,
        { id: "e", name: "A\nB", tokenHash: "new" },
        "123456",
        2_000,
      ),
    );
    const joined = joinParty(
      state,
      { id: "e", name: "  Esha  ", tokenHash: "new" },
      "123456",
      2_000,
    );
    expect(joined.players.at(-1)!.name).toBe("Esha");
    let full = state;
    for (let index = 4; index < 12; index += 1) {
      full = joinParty(
        full,
        { id: `p${index}`, name: `Player ${index}`, tokenHash: `hash${index}` },
        "123456",
        2_000,
      );
    }
    rejects("PARTY_FULL", () =>
      joinParty(
        full,
        { id: "extra", name: "Extra", tokenHash: "extra" },
        "123456",
        2_000,
      ),
    );
    rejects("NOT_IN_LOBBY", () =>
      joinParty(
        roles(),
        { id: "extra", name: "Extra", tokenHash: "extra" },
        "123456",
        2_000,
      ),
    );
  });

  test("validates settings and rejects unknown/forged command fields", () => {
    for (const value of [
      null,
      {},
      { ...settings, rounds: 4 },
      { ...settings, packIds: ["missing"] },
      { ...settings, packIds: ["everyday", "everyday"] },
    ]) {
      expect(() => validateSettings(value)).toThrow();
    }
    rejects("UNKNOWN_ACTION", () => validateAction({ type: "__proto__" }));
    rejects("UNKNOWN_ACTION", () => validateAction({ type: "resolve" }));
    rejects("INVALID_BODY", () =>
      validateAction({ type: "start", gameId: "game", playerId: "host" }),
    );
    rejects("INVALID_ACTION", () =>
      validateAction({ type: "vote", gameId: "game", suspectId: "b" }),
    );
    rejects("INVALID_ACTION", () =>
      validateAction({
        type: "next-clue",
        gameId: "game",
        roundNumber: 1,
        clueIndex: -1,
      }),
    );
    rejects("INVALID_ACTION", () =>
      validateAction({ type: "ready", gameId: "game", roundNumber: "1" }),
    );
  });

  test("uses strong opaque tokens, stores only hashes and restores exactly the authenticated identity", async () => {
    const token = makeToken();
    const secondToken = makeToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toBe(secondToken);
    const tokenHash = await hashToken(token);
    expect(tokenHash).toHaveLength(64);
    const state = createParty(
      "private",
      { id: "host", name: "Asha", tokenHash },
      "123456",
      settings,
      1_000,
    );
    const restored = JSON.parse(JSON.stringify(state)) as PartyState;
    expect(JSON.stringify(restored)).not.toContain(token);
    expect(authenticate(restored, await hashToken(token), 2_000)).toBe("host");
    rejects("SESSION_ENDED", () => authenticate(restored, "host", 2_000));
    rejects("SESSION_ENDED", () => authenticate(restored, "123456", 2_000));
    rejects("SESSION_ENDED", () =>
      authenticate(restored, "unknown-hash", 2_000),
    );
    await expect(hashToken("short")).rejects.toMatchObject({
      code: "SESSION_ENDED",
    });
  });

  test("removal, leave, end and expiry invalidate prior sessions", () => {
    const state = lobby();
    const removed = act(state, { type: "remove-player", playerId: "b" });
    rejects("SESSION_ENDED", () => authenticate(removed, "hash-b", 2_000));
    const left = act(state, { type: "leave" }, "b");
    rejects("SESSION_ENDED", () => authenticate(left, "hash-b", 2_000));
    expect(
      applyAction(
        state,
        "host",
        { type: "end-party", gameId: state.gameId },
        2_000,
        online,
      ),
    ).toBeNull();
    rejects("SESSION_ENDED", () => authenticate(null, "hash-host", 2_000));
    const fresh = createParty(
      "different-party",
      { id: "new-host", name: "Asha", tokenHash: "different-hash" },
      "123456",
      settings,
      3_000,
    );
    rejects("SESSION_ENDED", () => authenticate(fresh, "hash-host", 3_000));
    rejects("SESSION_ENDED", () =>
      authenticate(state, "hash-host", state.expiresAt),
    );
    expect(publicInfo(state, state.expiresAt, "ABCDEFGH")).toEqual({
      exists: false,
      roomCode: "ABCDEFGH",
    });
    rejects("SESSION_ENDED", () => project(removed, "b", 2_000, online, "ABCDEFGH"));
  });
});

describe("permissions and phase guards", () => {
  test("only the host controls setup, match flow, removal and ending", () => {
    const cases: Array<[PartyState, PartyCommand]> = [
      [lobby(), { type: "settings", settings }],
      [lobby(), { type: "start" }],
      [roles(), { type: "start-clues", roundNumber: 1 }],
      [discussion(), { type: "pause-timer", roundNumber: 1 }],
      [discussion(), { type: "resume-timer", roundNumber: 1 }],
      [discussion(), { type: "start-vote", roundNumber: 1 }],
      [caught(), { type: "next-round", roundNumber: 1 }],
      [roles(), { type: "new-game" }],
      [lobby(), { type: "remove-player", playerId: "c" }],
      [lobby(), { type: "end-party" }],
    ];
    for (const [state, action] of cases)
      rejects("HOST_ONLY", () => act(state, action, "b", 8_000));
    rejects("SESSION_ENDED", () => act(lobby(), { type: "start" }, "intruder"));
    rejects("HOST_CANNOT_LEAVE", () => act(lobby(), { type: "leave" }));
    rejects("CANNOT_REMOVE_HOST", () =>
      act(lobby(), { type: "remove-player", playerId: "host" }),
    );
  });

  test("start requires 3–12 connected players; readiness is per-player and idempotent", () => {
    rejects("INVALID_SETUP", () => act(lobby(2), { type: "start" }));
    const waiting = lobby();
    rejects("PLAYERS_OFFLINE", () =>
      applyAction(
        waiting,
        "host",
        { type: "start", gameId: waiting.gameId },
        2_000,
        new Set(["host", "b", "c"]),
        zero,
      ),
    );
    const state = roles();
    rejects("PLAYERS_NOT_READY", () =>
      act(state, { type: "start-clues", roundNumber: 1 }),
    );
    const ready = act(state, { type: "ready", roundNumber: 1 }, "b");
    expect(ready.readyIds).toEqual(["b"]);
    expect(act(ready, { type: "ready", roundNumber: 1 }, "b", 3_000)).toBe(
      ready,
    );
    expect(ready.revision).toBe(state.revision + 1);
    expect(ready.expiresAt).toBe(2_000 + PARTY_TTL_MS);
    rejects("WRONG_PHASE", () =>
      act(clues(), { type: "ready", roundNumber: 1 }, "b"),
    );
  });

  test("current clue player or host may advance exactly the current turn", () => {
    const state = clues();
    const current = state.round!.clueOrder[state.clueIndex]!;
    const other = ids.find((id) => id !== current && id !== "host")!;
    rejects("NOT_YOUR_TURN", () =>
      act(state, { type: "next-clue", roundNumber: 1, clueIndex: 0 }, other),
    );
    const next = act(
      state,
      { type: "next-clue", roundNumber: 1, clueIndex: 0 },
      current,
    );
    expect(next.clueIndex).toBe(1);
    rejects("STALE_CLUE", () =>
      act(next, { type: "next-clue", roundNumber: 1, clueIndex: 0 }, current),
    );
    expect(
      act(next, { type: "next-clue", roundNumber: 1, clueIndex: 1 }).clueIndex,
    ).toBe(2);
    rejects("WRONG_PHASE", () =>
      act(roles(), { type: "next-clue", roundNumber: 1, clueIndex: 0 }),
    );
  });

  test("phase and round guards reject delayed round commands without mutations", () => {
    const result = caught();
    const next = act(
      result,
      { type: "next-round", roundNumber: 1 },
      "host",
      8_000,
    );
    const before = JSON.stringify(next);
    for (const action of [
      { type: "ready", roundNumber: 1 },
      { type: "start-clues", roundNumber: 1 },
      { type: "next-clue", roundNumber: 1, clueIndex: 0 },
      { type: "pause-timer", roundNumber: 1 },
      { type: "resume-timer", roundNumber: 1 },
      { type: "start-vote", roundNumber: 1 },
      { type: "vote", roundNumber: 1, suspectId: "b" },
      { type: "next-round", roundNumber: 1 },
    ])
      rejects("STALE_ROUND", () =>
        applyAction(
          next,
          "host",
          { ...action, gameId: next.gameId },
          9_000,
          online,
          zero,
        ),
      );
    expect(JSON.stringify(next)).toBe(before);
    rejects("WRONG_PHASE", () => act(roles(), { type: "start" }));
    rejects("WRONG_PHASE", () => act(voting(), { type: "settings", settings }));
    rejects("WRONG_PHASE", () => act(roles(), { type: "leave" }, "b"));
    rejects("WRONG_PHASE", () =>
      act(roles(), { type: "remove-player", playerId: "b" }),
    );
    rejects("WRONG_PHASE", () =>
      act(voting(), { type: "next-round", roundNumber: 1 }),
    );
  });
});

describe("private projection and presence", () => {
  test("host has no privileged role visibility and only result reveals the imposter/word", () => {
    for (const state of [roles(), clues(), discussion(), voting()]) {
      expect(state.round!.imposterId).toBe("host");
      const host = project(state, "host", 6_000, online, "ABCDEFGH");
      expect(host.roomCode).toBe("ABCDEFGH");
      expect(host.completedGames).toBe(0);
      expect(host.pin).toBe("123456");
      expect(host.ownRole).toEqual({ isImposter: true, word: null });
      expect(host.result).toBeNull();
      const hostJson = JSON.stringify(host);
      expect(hostJson).not.toContain(state.round!.word.english);
      expect(hostJson).not.toContain("imposterId");
      expect(hostJson).not.toContain("tokenHash");
      expect(hostJson).not.toContain("votes");
      const crew = project(state, "b", 6_000, online, "ABCDEFGH");
      expect(crew).not.toHaveProperty("pin");
      expect(crew.ownRole).toEqual({
        isImposter: false,
        word: state.round!.word,
      });
      expect(crew).not.toHaveProperty("round");
      expect(crew).not.toHaveProperty("imposterId");
      for (const player of crew.players) {
        expect(Object.keys(player).sort()).toEqual([
          "connected",
          "hasVoted",
          "id",
          "name",
          "ready",
          "score",
        ]);
      }
    }
    const result = project(caught(), "b", 8_000, online, "ABCDEFGH");
    expect(result.ownRole).toBeNull();
    expect(result.result!.imposterId).toBe("host");
    expect(result.result!.outcome.caught).toBe(true);
    expect(result).not.toHaveProperty("round");
  });

  test("individual ballot targets never appear, before or after results", () => {
    let state = act(
      voting(),
      { type: "vote", roundNumber: 1, suspectId: "host" },
      "b",
      7_000,
    );
    for (const self of ids) {
      const view = project(state, self, 7_000, online, "ABCDEFGH");
      expect(view.players.find((player) => player.id === "b")!.hasVoted).toBe(
        true,
      );
      expect(view.result).toBeNull();
      expect(JSON.stringify(view)).not.toContain('"votes"');
      expect(JSON.stringify(view)).not.toContain('"suspectId"');
    }
    for (const id of ["host", "c", "d"])
      state = act(
        state,
        {
          type: "vote",
          roundNumber: 1,
          suspectId: id === "host" ? "b" : "host",
        },
        id,
        7_000,
      );
    const view = project(state, "host", 7_000, online, "ABCDEFGH");
    expect(view.result!.outcome.voteCounts).toEqual({
      host: 3,
      b: 1,
      c: 0,
      d: 0,
    });
    expect(JSON.stringify(view)).not.toContain('"votes"');
    expect(JSON.stringify(view)).not.toContain('"suspectId"');
  });

  test("presence comes only from live connection identities and never changes the revision", () => {
    const state = roles();
    const offline = project(state, "host", 3_000, new Set(), "ABCDEFGH");
    const reconnect = project(state, "host", 4_000, new Set(["host", "c"]), "ABCDEFGH");
    expect(offline.players.every((player) => !player.connected)).toBe(true);
    expect(
      reconnect.players
        .filter((player) => player.connected)
        .map((player) => player.id),
    ).toEqual(["host", "c"]);
    expect(reconnect.revision).toBe(offline.revision);
    expect(reconnect.serverNow).toBe(4_000);
    expect(reconnect.ownRole).toEqual(offline.ownRole);
    expect(publicInfo(state, 4_000, "ABCDEFGH")).toEqual({
      exists: true,
      roomCode: "ABCDEFGH",
      phase: "role",
      playerCount: 4,
      abandonedExpiresAt: null,
    });
  });
});

describe("authoritative discussion timing", () => {
  test("uses elapsed server time, pauses, resumes and never auto-advances at zero", () => {
    const state = discussion();
    expect(state.discussion.deadline).toBe(65_000);
    expect(project(state, "host", 15_000, online, "ABCDEFGH").discussion.remainingMs).toBe(
      50_000,
    );
    const paused = act(
      state,
      { type: "pause-timer", roundNumber: 1 },
      "host",
      20_000,
    );
    expect(paused.discussion).toEqual({ deadline: null, remainingMs: 45_000 });
    expect(project(paused, "b", 100_000, online, "ABCDEFGH").discussion.remainingMs).toBe(
      45_000,
    );
    expect(
      act(paused, { type: "pause-timer", roundNumber: 1 }, "host", 100_000),
    ).toBe(paused);
    const resumed = act(
      paused,
      { type: "resume-timer", roundNumber: 1 },
      "host",
      100_000,
    );
    expect(resumed.discussion.deadline).toBe(145_000);
    const atZero = project(resumed, "b", 150_000, online, "ABCDEFGH");
    expect(atZero.discussion.remainingMs).toBe(0);
    expect(atZero.phase).toBe("discussion");
    expect(
      act(resumed, { type: "start-vote", roundNumber: 1 }, "host", 150_000)
        .phase,
    ).toBe("vote");
  });

  test("expiration depends on real state changes, not viewing or idempotent readiness", () => {
    const state = roles();
    const ready = act(state, { type: "ready", roundNumber: 1 }, "b", 3_000);
    const expires = ready.expiresAt;
    project(ready, "b", expires - 1, online, "ABCDEFGH");
    expect(
      act(ready, { type: "ready", roundNumber: 1 }, "b", expires - 1).expiresAt,
    ).toBe(expires);
    rejects("SESSION_ENDED", () =>
      act(ready, { type: "ready", roundNumber: 1 }, "b", expires),
    );
  });
});

describe("voting, scoring and match lifecycle", () => {
  test("votes reject self/unknown/duplicates and points are awarded only on the last vote", () => {
    let state = voting();
    rejects("INVALID_VOTE", () =>
      act(state, { type: "vote", roundNumber: 1, suspectId: "b" }, "b"),
    );
    rejects("INVALID_VOTE", () =>
      act(state, { type: "vote", roundNumber: 1, suspectId: "missing" }, "b"),
    );
    state = act(
      state,
      { type: "vote", roundNumber: 1, suspectId: "host" },
      "b",
      7_000,
    );
    rejects("ALREADY_VOTED", () =>
      act(state, { type: "vote", roundNumber: 1, suspectId: "c" }, "b", 7_000),
    );
    for (const id of ["host", "c"])
      state = act(
        state,
        {
          type: "vote",
          roundNumber: 1,
          suspectId: id === "host" ? "b" : "host",
        },
        id,
        7_000,
      );
    expect(state.phase).toBe("vote");
    expect(state.players.every((player) => player.score === 0)).toBe(true);
    state = act(
      state,
      { type: "vote", roundNumber: 1, suspectId: "host" },
      "d",
      7_000,
    );
    expect(state.phase).toBe("result");
    expect(state.players.map((player) => player.score)).toEqual([0, 1, 1, 1]);
    const scored = JSON.stringify(state);
    rejects("WRONG_PHASE", () =>
      act(
        state,
        { type: "vote", roundNumber: 1, suspectId: "host" },
        "d",
        8_000,
      ),
    );
    expect(JSON.stringify(state)).toBe(scored);
  });

  test("ties let the imposter escape, while a unique plurality is enough to catch", () => {
    let tied = voting();
    for (const [voter, suspect] of [
      ["host", "b"],
      ["b", "host"],
      ["c", "d"],
      ["d", "c"],
    ]) {
      tied = act(
        tied,
        { type: "vote", roundNumber: 1, suspectId: suspect! },
        voter!,
        7_000,
      );
    }
    expect(tied.outcome!.tied).toBe(true);
    expect(tied.outcome!.caught).toBe(false);
    expect(tied.players.map((player) => player.score)).toEqual([2, 0, 0, 0]);
    let plurality = voting();
    for (const [voter, suspect] of [
      ["host", "b"],
      ["b", "host"],
      ["c", "host"],
      ["d", "c"],
    ]) {
      plurality = act(
        plurality,
        { type: "vote", roundNumber: 1, suspectId: suspect! },
        voter!,
        7_000,
      );
    }
    expect(plurality.outcome!.caught).toBe(true);
    expect(plurality.outcome!.voteCounts.host).toBe(2);
  });

  test("completes every round without repeating words, then ranks final scores", () => {
    let state = roles();
    const words = new Set<string>();
    for (let number = 1; number <= settings.rounds; number += 1) {
      expect(state.phase).toBe("role");
      expect(state.round!.number).toBe(number);
      expect(state.round!.votes).toEqual({});
      expect(state.readyIds).toEqual([]);
      expect(words.has(state.round!.word.id)).toBe(false);
      words.add(state.round!.word.id);
      state = caught(voting(discussion(clues(state))));
      state = act(
        state,
        { type: "next-round", roundNumber: number },
        "host",
        8_000,
      );
    }
    expect(state.phase).toBe("final");
    expect(state.players.map((player) => player.score)).toEqual([0, 3, 3, 3]);
    expect(state.gameHistory.completedGames).toBe(1);
    expect(state.gameHistory.games[0]?.players).toEqual(
      state.players.map(({ id, name, score }) => ({ id, name, score })),
    );
    expect(state.gameHistory.games[0]?.winnerIds).toEqual(["b", "c", "d"]);
    expect(project(state, "host", 9_000, online, "ABCDEFGH").completedGames).toBe(1);
    expect(
      project(state, "host", 9_000, online, "ABCDEFGH").players.map((player) => player.id),
    ).toEqual(["b", "c", "d", "host"]);
    rejects("WRONG_PHASE", () =>
      act(state, { type: "next-round", roundNumber: 3 }, "host", 9_000),
    );
    const reset = act(state, { type: "new-game" }, "host", 10_000);
    expect(reset.players.map((player) => player.id)).toEqual(ids);
    expect(reset.players.every((player) => player.score === 0)).toBe(true);
    expect(reset.round).toBeNull();
    expect(histories.get(reset)).toEqual([...words]);
    expect(reset.gameHistory).toBe(state.gameHistory);
    const restarted = act(reset, { type: "start" }, "host", 11_000);
    expect(restarted.round!.number).toBe(1);
    expect(words.has(restarted.round!.word.id)).toBe(false);
  });

  test("host can abort from every active phase and retain roster/session identities", () => {
    for (const state of [roles(), clues(), discussion(), voting(), caught()]) {
      const reset = act(state, { type: "new-game" }, "host", 9_000);
      expect(reset.phase).toBe("lobby");
      expect(reset.round).toBeNull();
      expect(reset.outcome).toBeNull();
      expect(reset.readyIds).toEqual([]);
      expect(reset.gameHistory).toEqual({ completedGames: 0, games: [] });
      expect(reset.players.map((player) => player.tokenHash)).toEqual(
        lobby().players.map((player) => player.tokenHash),
      );
      expect(authenticate(reset, "hash-b", 10_000)).toBe("b");
      expect(project(reset, "b", 10_000, online, "ABCDEFGH").ownRole).toBeNull();
    }
  });
});

describe("completed-game history and joining PIN rotation", () => {
  function complete(initial: PartyState): PartyState {
    let state = act(initial, { type: "start" });
    for (let number = 1; number <= state.settings.rounds; number++) {
      state = caught(voting(discussion(clues(state))));
      state = act(state, { type: "next-round", roundNumber: number }, "host", 8_000);
    }
    return state;
  }

  test("empty parties have no totals; only finalization records actual final scores once", () => {
    const initial = lobby();
    expect(historyView(initial.gameHistory).totals).toEqual([]);
    const unfinished = caught();
    expect(unfinished.gameHistory.completedGames).toBe(0);
    const final = complete(initial);
    expect(final.gameHistory.games[0]?.gameId).toBe(final.gameId);
    expect(final.gameHistory.games[0]?.completedAt).toBe(8_000);
    expect(final.gameHistory.games[0]?.settings).toEqual(final.settings);
    expect(historyView(final.gameHistory).totals).toEqual([
      { id: "b", name: "Bikash", gamesPlayed: 1, wins: 1, points: 3 },
      { id: "c", name: "Chandra", gamesPlayed: 1, wins: 1, points: 3 },
      { id: "d", name: "Dipa", gamesPlayed: 1, wins: 1, points: 3 },
      { id: "host", name: "Asha", gamesPlayed: 1, wins: 0, points: 0 },
    ]);
    rejects("WRONG_PHASE", () => act(final, { type: "next-round", roundNumber: 3 }));
    const rotated = act(final, { type: "rotate-pin", pin: "654321" });
    expect(rotated.gameHistory).toBe(final.gameHistory);
    const json = JSON.stringify(final.gameHistory);
    for (const secret of ["tokenHash", "hash-host", "word", "imposterId", "votes", "awards", "hostRecoveryCode", "pin"])
      expect(json).not.toContain(secret);
    expect(Object.keys(final.gameHistory.games[0]!.players[0]!)).toEqual(["id", "name", "score"]);
  });

  test("retains only 20 games and their totals while new games retain and fresh parties clear history", () => {
    let state = lobby();
    let oldestGameId = "";
    for (let index = 0; index < 21; index++) {
      state = complete(state);
      if (index === 0) oldestGameId = state.gameId;
      if (index < 20) state = act(state, { type: "new-game" });
    }
    expect(state.gameHistory.completedGames).toBe(21);
    expect(state.gameHistory.games).toHaveLength(20);
    expect(state.gameHistory.games.some((game) => game.gameId === oldestGameId)).toBe(false);
    for (const total of historyView(state.gameHistory).totals) {
      expect(total.gamesPlayed).toBe(20);
      expect(total.points).toBe(total.id === "host" ? 0 : 60);
      expect(total.wins).toBe(total.id === "host" ? 0 : 20);
    }
    const reset = act(state, { type: "new-game" });
    expect(reset.gameHistory).toBe(state.gameHistory);
    const fresh = applyAction(reset, "host", {
      type: "fresh-party", pin: "654321", gameId: reset.gameId,
    }, 9_000, online, zero, { freshHost: { id: "fresh", tokenHash: "fresh-hash" } })!;
    expect(fresh.gameHistory).toEqual({ completedGames: 0, games: [] });
  });

  test("only the host rotates to a different valid PIN without disturbing live game state or seats", () => {
    const state = voting();
    const rotated = act(state, { type: "rotate-pin", pin: "654321" });
    expect(rotated.pin).toBe("654321");
    expect(rotated.gameId).toBe(state.gameId);
    expect(rotated.players).toBe(state.players);
    expect(rotated.round).toBe(state.round);
    expect(rotated.discussion).toBe(state.discussion);
    expect(rotated.hostRecoveryCode).toBe(state.hostRecoveryCode);
    expect(rotated.notice?.message).toContain("Old invitations no longer work");
    rejects("HOST_ONLY", () => act(state, { type: "rotate-pin", pin: "654321" }, "b"));
    rejects("PIN_UNCHANGED", () => act(state, { type: "rotate-pin", pin: "123456" }));
    rejects("INVALID_PIN", () => act(state, { type: "rotate-pin", pin: "12345" }));
    const admission = act(lobby(), { type: "rotate-pin", pin: "654321" });
    rejects("WRONG_PIN", () => joinParty(admission, { id: "new", name: "New", tokenHash: "new" }, "123456", 3_000));
    expect(joinParty(admission, { id: "new", name: "New", tokenHash: "new" }, "654321", 3_000).players).toHaveLength(5);
  });
});

describe("mutation serialization and bounded PIN throttling", () => {
  test("serializes awaited token work and recovers after rejected operations", async () => {
    const queue = new SerialQueue();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const events: string[] = [];
    const first = queue.run(async () => {
      events.push("first-start");
      await gate;
      await hashToken(makeToken());
      events.push("first-end");
      return 1;
    });
    const second = queue.run(() => {
      events.push("second");
      throw new Error("rejected");
    });
    const rejected = second.catch((error: Error) => error.message);
    const third = queue.run(() => {
      events.push("third");
      return 3;
    });
    await Promise.resolve();
    expect(events).toEqual(["first-start"]);
    release();
    expect(await first).toBe(1);
    expect(await rejected).toBe("rejected");
    expect(await third).toBe(3);
    expect(events).toEqual(["first-start", "first-end", "second", "third"]);
  });

  test("allows household mistakes but throttles guessing, expires windows and bounds storage", () => {
    let attempts: FailureAttempt[] = [];
    for (let index = 0; index < 20; index += 1) {
      checkPinThrottle(attempts, "shared-household", 1_000);
      attempts = recordFailure(attempts, "shared-household", 1_000);
    }
    rejects("PIN_THROTTLED", () =>
      checkPinThrottle(attempts, "shared-household", 1_001),
    );
    expect(() =>
      checkPinThrottle(attempts, "other-household", 1_001),
    ).not.toThrow();
    expect(() =>
      checkPinThrottle(attempts, "shared-household", 1_000 + PIN_WINDOW_MS),
    ).not.toThrow();
    attempts = recordFailure(
      attempts,
      "shared-household",
      1_000 + PIN_WINDOW_MS,
    );
    expect(
      attempts.find((attempt) => attempt.key === "shared-household")!.count,
    ).toBe(1);
    for (let index = 0; index < 300; index += 1)
      attempts = recordFailure(
        attempts,
        `different-${index}`,
        1_000 + PIN_WINDOW_MS,
      );
    expect(attempts.length).toBeLessThanOrEqual(256);
    rejects("PIN_THROTTLED", () =>
      checkPinThrottle(attempts, "new-household", 1_001 + PIN_WINDOW_MS),
    );
    expect(attempts.find((attempt) => attempt.key === "global")!.count).toBe(
      301,
    );
  });
});

describe("persisted round recovery", () => {
  test("restores private roles, running deadlines and vote locks without trusting stored presence", () => {
    const original = discussion();
    const restored = JSON.parse(JSON.stringify(original)) as PartyState;
    expect(authenticate(restored, "hash-host", 8_000)).toBe("host");
    expect(project(restored, "host", 8_000, new Set(), "ABCDEFGH").ownRole).toEqual({
      isImposter: true,
      word: null,
    });
    expect(project(restored, "b", 8_000, new Set(), "ABCDEFGH").ownRole).toEqual({
      isImposter: false,
      word: original.round!.word,
    });
    expect(project(restored, "b", 8_000, new Set(), "ABCDEFGH").discussion).toEqual({
      deadline: 65_000,
      remainingMs: 57_000,
    });
    expect(
      project(restored, "host", 8_000, new Set(), "ABCDEFGH").players.every(
        (player) => !player.connected,
      ),
    ).toBe(true);
    const cast = act(
      voting(restored),
      { type: "vote", roundNumber: 1, suspectId: "host" },
      "b",
      9_000,
    );
    const voteRestored = JSON.parse(JSON.stringify(cast)) as PartyState;
    rejects("ALREADY_VOTED", () =>
      act(
        voteRestored,
        { type: "vote", roundNumber: 1, suspectId: "c" },
        "b",
        10_000,
      ),
    );
    let completed = voteRestored;
    for (const id of ["host", "c", "d"])
      completed = act(
        completed,
        {
          type: "vote",
          roundNumber: 1,
          suspectId: id === "host" ? "b" : "host",
        },
        id,
        10_000,
      );
    const resultRestored = JSON.parse(JSON.stringify(completed)) as PartyState;
    expect(resultRestored.players.map((player) => player.score)).toEqual([
      0, 1, 1, 1,
    ]);
    rejects("WRONG_PHASE", () =>
      act(
        resultRestored,
        { type: "vote", roundNumber: 1, suspectId: "host" },
        "d",
        11_000,
      ),
    );
    expect(resultRestored.players.map((player) => player.score)).toEqual([
      0, 1, 1, 1,
    ]);
  });
});

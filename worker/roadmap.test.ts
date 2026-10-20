import { describe, expect, test } from "bun:test";
import { RECENT_WORD_LIMIT, rememberWord, type Settings } from "../src/game";
import type { PartyCommand } from "../src/party/protocol";
import {
  ABANDONED_TTL_MS,
  PARTY_SCHEMA_VERSION,
  PARTY_TTL_MS,
  PartyError,
  advanceTime,
  applyAction,
  authenticate,
  createParty,
  joinParty,
  makeRecoveryCode,
  migrateStoredParty,
  nextAlarmDeadline,
  normalizeRecoveryCode,
  project,
  publicInfo,
  recoverParty,
  socketIdentityMatches,
  updatePresence,
  updateWordHistory,
  validateAction,
  validateSettings,
  type PartyState,
} from "./model";
import {
  PIN_WINDOW_MS,
  checkPinThrottle,
  checkRecoveryThrottle,
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

function lobby(options: Partial<Settings> = {}): PartyState {
  let state = createParty(
    "party",
    { id: "host", name: "Asha", tokenHash: "hash-host" },
    "123456",
    { ...settings, ...options },
    1_000,
  );
  for (const [index, name] of ["Bikash", "Chandra", "Dipa"].entries()) {
    state = joinParty(
      state,
      { id: ids[index + 1]!, name, tokenHash: `hash-${ids[index + 1]}` },
      "123456",
      1_000,
    );
  }
  return updatePresence(state, online, 1_000);
}

function move(
  state: PartyState,
  command: PartyCommand,
  actor = state.hostId,
  now = 2_000,
): PartyState {
  const next = applyAction(
    state,
    actor,
    { ...command, gameId: state.gameId },
    now,
    online,
    zero,
  );
  if (!next) throw new Error("Expected a surviving party.");
  return next;
}

function roles(options: Partial<Settings> = {}): PartyState {
  return move(lobby(options), { type: "start" });
}

function clues(state = roles()): PartyState {
  for (const id of ids)
    state = move(state, { type: "ready", roundNumber: 1 }, id);
  return move(state, { type: "start-clues", roundNumber: 1 });
}

function voting(options: Partial<Settings> = {}): PartyState {
  let state = clues(roles(options));
  while (state.phase === "clue")
    state = move(state, {
      type: "next-clue",
      roundNumber: 1,
      clueIndex: state.clueIndex,
    });
  return move(state, { type: "start-vote", roundNumber: 1 });
}

function caught(
  options: Partial<Settings> = { lastChanceGuess: true },
): PartyState {
  let state = voting(options);
  for (const id of ids) {
    state = move(
      state,
      { type: "vote", roundNumber: 1, suspectId: id === "host" ? "b" : "host" },
      id,
      7_000,
    );
  }
  return state;
}

function rejects(code: string, operation: () => unknown): void {
  try {
    operation();
    throw new Error("Expected this operation to be rejected.");
  } catch (error) {
    expect(error).toBeInstanceOf(PartyError);
    expect((error as PartyError).code).toBe(code);
  }
}

function legacy(
  state: PartyState,
  words: string[] = [],
): Record<string, unknown> {
  const {
    schemaVersion: _schema,
    gameId: _game,
    hostRecoveryCode: _recovery,
    abandonedExpiresAt: _abandoned,
    guessDeadline: _guess,
    notice: _notice,
    settings: currentSettings,
    outcome: currentOutcome,
    ...retained
  } = state;
  const {
    clueCycles: _cycles,
    lastChanceGuess: _lastChance,
    ...oldSettings
  } = currentSettings;
  let oldOutcome: unknown = null;
  if (currentOutcome) {
    const { guessResult: _result, ...outcome } = currentOutcome;
    oldOutcome = outcome;
  }
  return {
    ...retained,
    settings: oldSettings,
    outcome: oldOutcome,
    usedWordIds: words,
  };
}

describe("game identities and complete management permissions", () => {
  test("every supported command rejects missing and stale game IDs before any user mutation", () => {
    const state = caught();
    const commands: PartyCommand[] = [
      { type: "settings", settings },
      { type: "start" },
      { type: "ready", roundNumber: 1 },
      { type: "start-clues", roundNumber: 1 },
      { type: "next-clue", roundNumber: 1, clueIndex: 0 },
      { type: "pause-timer", roundNumber: 1 },
      { type: "resume-timer", roundNumber: 1 },
      { type: "start-vote", roundNumber: 1 },
      { type: "vote", roundNumber: 1, suspectId: "b" },
      { type: "guess-word", roundNumber: 1, guess: "Tea" },
      { type: "skip-guess", roundNumber: 1 },
      { type: "next-round", roundNumber: 1 },
      { type: "new-game" },
      { type: "fresh-party", pin: "654321" },
      { type: "transfer-host", playerId: "b" },
      { type: "rotate-recovery" },
      { type: "remove-player", playerId: "b" },
      { type: "leave" },
      { type: "end-party" },
    ];
    const before = JSON.stringify(state);
    for (const command of commands) {
      rejects("UPDATE_REQUIRED", () =>
        applyAction(state, "host", command, 8_000, online),
      );
      rejects("STALE_GAME", () =>
        applyAction(
          state,
          "host",
          { ...command, gameId: "previous-game" },
          8_000,
          online,
        ),
      );
    }
    expect(JSON.stringify(state)).toBe(before);
    rejects("UNKNOWN_ACTION", () =>
      validateAction({ type: "back-to-lobby", gameId: state.gameId }),
    );
    rejects("UPDATE_REQUIRED", () => validateAction({ type: "start" }));
  });

  test("new game resets every active phase while retaining party credentials, roster and options", () => {
    for (const state of [
      lobby(),
      roles(),
      clues(),
      voting(),
      caught(),
      caught({ lastChanceGuess: false }),
    ]) {
      const next = move(state, { type: "new-game" }, state.hostId, 8_000);
      expect(next.id).toBe(state.id);
      expect(next.gameId).not.toBe(state.gameId);
      expect(next.pin).toBe(state.pin);
      expect(next.hostRecoveryCode).toBe(state.hostRecoveryCode);
      expect(next.settings).toEqual(state.settings);
      expect(next.players).toEqual(
        state.players.map((player) => ({ ...player, score: 0 })),
      );
      expect(next.phase).toBe("lobby");
      expect(next.round).toBeNull();
      expect(next.outcome).toBeNull();
      expect(next.guessDeadline).toBeNull();
      expect(next.readyIds).toEqual([]);
      rejects("STALE_GAME", () =>
        applyAction(
          next,
          "host",
          { type: "end-party", gameId: state.gameId },
          9_000,
          online,
        ),
      );
    }
  });

  test("fresh party replaces all identities and credentials, preserving only host name and settings", () => {
    const state = caught();
    const options = { freshHost: { id: "new-host", tokenHash: "new-hash" } };
    const next = applyAction(
      state,
      "host",
      { type: "fresh-party", pin: "654321", gameId: state.gameId },
      8_000,
      online,
      zero,
      options,
    )!;
    expect(next.id).not.toBe(state.id);
    expect(next.gameId).not.toBe(state.gameId);
    expect(next.hostRecoveryCode).not.toBe(state.hostRecoveryCode);
    expect(next.pin).toBe("654321");
    expect(next.settings).toEqual(state.settings);
    expect(next.players).toEqual([
      { id: "new-host", name: "Asha", tokenHash: "new-hash", score: 0 },
    ]);
    expect(next.round).toBeNull();
    expect(next.phase).toBe("lobby");
    expect(next.abandonedExpiresAt).toBe(8_000 + ABANDONED_TTL_MS);
    for (const player of state.players)
      rejects("SESSION_ENDED", () =>
        authenticate(next, player.tokenHash, 8_001),
      );
    expect(authenticate(next, "new-hash", 8_001)).toBe("new-host");
    rejects("WRONG_RECOVERY_CODE", () =>
      recoverParty(next, state.hostRecoveryCode, "bad-hash", 8_001),
    );
    rejects("PIN_UNCHANGED", () =>
      applyAction(
        state,
        "host",
        { type: "fresh-party", pin: state.pin, gameId: state.gameId },
        8_000,
        online,
        zero,
        options,
      ),
    );
  });

  test("all management commands are host-only in lobby and during a live guess", () => {
    for (const state of [lobby(), caught()]) {
      for (const command of [
        { type: "new-game" },
        { type: "fresh-party", pin: "654321" },
        { type: "transfer-host", playerId: "c" },
        { type: "rotate-recovery" },
        { type: "end-party" },
      ] as PartyCommand[])
        rejects("HOST_ONLY", () => move(state, command, "b", 8_000));
    }
  });
});

describe("host transfer, private recovery and socket authority", () => {
  test("transfer works in every phase without altering votes, private roles or scores", () => {
    for (const state of [
      lobby(),
      roles(),
      clues(),
      voting(),
      caught(),
      caught({ lastChanceGuess: false }),
    ]) {
      const next = move(
        state,
        { type: "transfer-host", playerId: "b" },
        "host",
        8_000,
      );
      expect(next.hostId).toBe("b");
      expect(next.gameId).toBe(state.gameId);
      expect(next.phase).toBe(state.phase);
      expect(next.players).toEqual(state.players);
      expect(next.round).toEqual(state.round);
      expect(next.outcome).toEqual(state.outcome);
      expect(next.guessDeadline).toBe(state.guessDeadline);
      expect(next.hostRecoveryCode).not.toBe(state.hostRecoveryCode);
      rejects("HOST_ONLY", () =>
        move(next, { type: "new-game" }, "host", 8_001),
      );
      expect(move(next, { type: "new-game" }, "b", 8_001).phase).toBe("lobby");
      expect(project(next, "host", 8_001, online)).not.toHaveProperty("pin");
      expect(project(next, "host", 8_001, online)).not.toHaveProperty(
        "hostRecoveryCode",
      );
      expect(project(next, "b", 8_001, online).hostRecoveryCode).toBe(
        next.hostRecoveryCode,
      );
      rejects("WRONG_RECOVERY_CODE", () =>
        recoverParty(next, state.hostRecoveryCode, "hijacked", 8_001),
      );
    }
  });

  test("transfer rejects unknown, self, or disconnected players", () => {
    const state = lobby();
    rejects("PLAYER_NOT_FOUND", () =>
      move(state, { type: "transfer-host", playerId: "absent" }),
    );
    rejects("ALREADY_HOST", () =>
      move(state, { type: "transfer-host", playerId: "host" }),
    );
    rejects("PLAYER_OFFLINE", () =>
      applyAction(
        state,
        "host",
        { type: "transfer-host", playerId: "b", gameId: state.gameId },
        2_000,
        new Set(["host"]),
      ),
    );
  });

  test("private recovery revokes old tokens and all host sockets while preserving the exact host seat", () => {
    const original = move(
      voting(),
      { type: "vote", roundNumber: 1, suspectId: "host" },
      "b",
      6_000,
    );
    const identity = {
      partyId: original.id,
      playerId: original.hostId,
      tokenHash: "hash-host",
    };
    expect(socketIdentityMatches(original, identity)).toBe(true);
    expect(
      socketIdentityMatches(original, { ...identity, tokenHash: undefined }),
    ).toBe(false);
    expect(
      socketIdentityMatches(original, {
        ...identity,
        partyId: "previous-party",
      }),
    ).toBe(false);
    const normalized = original.hostRecoveryCode
      .toLowerCase()
      .replaceAll("-", " \n");
    const next = recoverParty(original, normalized, "recovered-hash", 8_000);
    expect(next.id).toBe(original.id);
    expect(next.gameId).toBe(original.gameId);
    expect(next.hostId).toBe(original.hostId);
    expect(next.round).toEqual(original.round);
    expect(next.settings).toEqual(original.settings);
    expect(next.players).toEqual(
      original.players.map((player) =>
        player.id === "host"
          ? { ...player, tokenHash: "recovered-hash" }
          : player,
      ),
    );
    expect(next.hostRecoveryCode).not.toBe(original.hostRecoveryCode);
    rejects("SESSION_ENDED", () => authenticate(next, "hash-host", 8_001));
    expect(authenticate(next, "recovered-hash", 8_001)).toBe("host");
    expect(socketIdentityMatches(next, identity)).toBe(false);
    expect(
      socketIdentityMatches(next, { ...identity, tokenHash: "recovered-hash" }),
    ).toBe(true);
    expect(
      socketIdentityMatches(next, {
        partyId: next.id,
        playerId: "b",
        tokenHash: "hash-b",
      }),
    ).toBe(true);
    rejects("WRONG_RECOVERY_CODE", () =>
      recoverParty(next, original.hostRecoveryCode, "another-hash", 8_001),
    );
    rejects("WRONG_RECOVERY_CODE", () =>
      recoverParty(next, original.pin, "another-hash", 8_001),
    );
    for (const id of ["b", "c", "d"]) {
      const view = JSON.stringify(project(next, id, 8_001, online));
      expect(view).not.toContain(next.hostRecoveryCode);
      expect(view).not.toContain("recovered-hash");
      expect(view).not.toContain(next.pin);
    }
  });

  test("codes use 128 random bits with strict whole-code normalization and explicit rotation", () => {
    const code = makeRecoveryCode();
    expect(code).toMatch(/^[A-F0-9]{4}(?:-[A-F0-9]{4}){7}$/);
    expect(normalizeRecoveryCode(code)).toHaveLength(32);
    expect(normalizeRecoveryCode(` \n${code.toLowerCase()}\t`)).toBe(
      code.replaceAll("-", ""),
    );
    for (const invalid of ["123456", code + "A", code.replace(/-/u, "/"), null])
      expect(normalizeRecoveryCode(invalid)).toBe("");
    expect(makeRecoveryCode()).not.toBe(code);
    const state = lobby();
    const next = move(state, { type: "rotate-recovery" });
    expect(next.players).toEqual(state.players);
    expect(next.gameId).toBe(state.gameId);
    expect(next.hostRecoveryCode).not.toBe(state.hostRecoveryCode);
    rejects("WRONG_RECOVERY_CODE", () =>
      recoverParty(next, state.hostRecoveryCode, "new", 3_000),
    );
  });

  test("PIN failures and private recovery failures have independent bounded windows", () => {
    let pins: FailureAttempt[] = [];
    let recovery: FailureAttempt[] = [];
    for (let index = 0; index < 20; index++)
      pins = recordFailure(pins, "house", 1_000);
    rejects("PIN_THROTTLED", () => checkPinThrottle(pins, "house", 1_001));
    expect(() => checkRecoveryThrottle(recovery, "house", 1_001)).not.toThrow();
    for (let index = 0; index < 10; index++)
      recovery = recordFailure(recovery, "house", 1_000);
    rejects("RECOVERY_THROTTLED", () =>
      checkRecoveryThrottle(recovery, "house", 1_001),
    );
    expect(() => checkPinThrottle([], "house", 1_001)).not.toThrow();
    expect(() =>
      checkRecoveryThrottle(recovery, "house", 1_000 + PIN_WINDOW_MS),
    ).not.toThrow();
    for (let index = 0; index < 300; index++)
      recovery = recordFailure(recovery, `ip-${index}`, 1_001);
    expect(recovery.length).toBeLessThanOrEqual(256);
    rejects("RECOVERY_THROTTLED", () =>
      checkRecoveryThrottle(recovery, "new-ip", 1_002),
    );
  });
});

describe("authenticated presence and alarm boundaries", () => {
  test("initial creation starts the offline grace period, and only admitted connections clear it", () => {
    const initial = createParty(
      "initial",
      { id: "host", name: "Asha", tokenHash: "hash-host" },
      "123456",
      settings,
      1_000,
    );
    expect(initial.abandonedExpiresAt).toBe(1_000 + ABANDONED_TTL_MS);
    expect(updatePresence(initial, new Set(["unadmitted"]), 2_000)).toBe(
      initial,
    );
    const connected = updatePresence(initial, new Set(["host"]), 2_000);
    expect(connected.abandonedExpiresAt).toBeNull();
    expect(connected.expiresAt).toBe(initial.expiresAt);
    expect(connected.revision).toBe(initial.revision);
    // A still-open authenticated background tab remains connected; visibility is not a server signal.
    expect(updatePresence(connected, new Set(["host"]), 100_000)).toBe(
      connected,
    );
  });

  test("continuous all-offline time persists across wake, resets on reconnect and expires exactly at 15 minutes", () => {
    const initial = lobby();
    const offline = updatePresence(initial, new Set(), 10_000);
    expect(offline.abandonedExpiresAt).toBe(10_000 + ABANDONED_TTL_MS);
    expect(updatePresence(offline, new Set(), 20_000)).toBe(offline);
    const restored = migrateStoredParty(
      JSON.parse(JSON.stringify(offline)),
      [],
      50_000,
    ).party!;
    expect(restored.abandonedExpiresAt).toBe(offline.abandonedExpiresAt);
    expect(advanceTime(restored, restored.abandonedExpiresAt! - 1)).toBe(
      restored,
    );
    expect(advanceTime(restored, restored.abandonedExpiresAt!)).toBeNull();
    expect(publicInfo(restored, restored.abandonedExpiresAt!)).toEqual({
      exists: false,
    });
    rejects("SESSION_ENDED", () =>
      authenticate(restored, "hash-host", restored.abandonedExpiresAt!),
    );
    const reconnected = updatePresence(restored, new Set(["b"]), 60_000);
    expect(reconnected.abandonedExpiresAt).toBeNull();
    const offlineAgain = updatePresence(reconnected, new Set(), 70_000);
    expect(offlineAgain.abandonedExpiresAt).toBe(70_000 + ABANDONED_TTL_MS);
    expect(offlineAgain.expiresAt).toBe(initial.expiresAt);
    expect(publicInfo(offlineAgain, 80_000)).toEqual({
      exists: true,
      phase: "lobby",
      playerCount: 4,
      abandonedExpiresAt: offlineAgain.abandonedExpiresAt,
    });
  });

  test("alarm takes the minimum TTL, abandonment, guess or unauthenticated socket deadline", () => {
    const initial = lobby();
    expect(nextAlarmDeadline(initial)).toBe(initial.expiresAt);
    expect(nextAlarmDeadline(null)).toBeNull();
    expect(nextAlarmDeadline(null, [9_000, 5_000])).toBe(5_000);
    const offline = updatePresence(initial, new Set(), 10_000);
    expect(nextAlarmDeadline(offline)).toBe(10_000 + ABANDONED_TTL_MS);
    const guessing = caught();
    expect(nextAlarmDeadline(guessing)).toBe(37_000);
    expect(nextAlarmDeadline(guessing, [20_000, 50_000])).toBe(20_000);
    const earlierTtl = { ...guessing, expiresAt: 15_000 };
    expect(nextAlarmDeadline(earlierTtl)).toBe(15_000);
    expect(advanceTime(earlierTtl, 15_000)).toBeNull();
    expect(initial.expiresAt).toBe(1_000 + PARTY_TTL_MS);
    expect(advanceTime(initial, initial.expiresAt)).toBeNull();
  });
});

describe("optional clue cycles and authoritative last chance", () => {
  test("two cycles repeat the same order with a global stale-turn guard", () => {
    let state = clues(roles({ clueCycles: 2 }));
    const order = [...state.round!.clueOrder];
    for (let index = 0; index < ids.length * 2; index++) {
      expect(state.phase).toBe("clue");
      expect(state.clueIndex).toBe(index);
      expect(state.round!.clueOrder).toEqual(order);
      expect(project(state, "b", 3_000, online).clueCycle).toBe(
        Math.floor(index / ids.length) + 1,
      );
      const speaker = order[index % ids.length]!;
      const wrongSpeaker = ids.find(
        (id) => id !== speaker && id !== state.hostId,
      )!;
      rejects("NOT_YOUR_TURN", () =>
        move(
          state,
          { type: "next-clue", roundNumber: 1, clueIndex: index },
          wrongSpeaker,
        ),
      );
      if (index >= ids.length)
        rejects("STALE_CLUE", () =>
          move(
            state,
            {
              type: "next-clue",
              roundNumber: 1,
              clueIndex: index - ids.length,
            },
            speaker,
          ),
        );
      state = move(
        state,
        { type: "next-clue", roundNumber: 1, clueIndex: index },
        speaker,
      );
    }
    expect(state.phase).toBe("discussion");
  });

  test("last vote starts an unscored 30-second chance with no secret or ballots exposed to the imposter", () => {
    const state = caught();
    expect(state.phase).toBe("guess");
    expect(state.outcome).toBeNull();
    expect(state.guessDeadline).toBe(37_000);
    expect(state.players.every((player) => player.score === 0)).toBe(true);
    const view = project(state, "host", 8_000, online);
    expect(view.guess).toEqual({ playerId: "host", deadline: 37_000 });
    expect(view.result).toBeNull();
    expect(view.ownRole).toEqual({ isImposter: true, word: null });
    const text = JSON.stringify(view);
    expect(text).not.toContain(state.round!.word.english);
    expect(text).not.toContain(state.round!.word.nepali);
    expect(text).not.toContain('"votes"');
    expect(text).not.toContain('"outcome"');
    const civilian = project(state, "b", 8_000, online);
    expect(civilian).not.toHaveProperty("hostRecoveryCode");
    expect(civilian).not.toHaveProperty("pin");
    expect(civilian.result).toBeNull();
  });

  test("only the caught imposter can answer once; host may skip and other players cannot", () => {
    let state = caught();
    state = move(
      state,
      { type: "transfer-host", playerId: "b" },
      "host",
      8_000,
    );
    rejects("IMPOSTER_ONLY", () =>
      move(
        state,
        {
          type: "guess-word",
          roundNumber: 1,
          guess: state.round!.word.english,
        },
        "b",
        9_000,
      ),
    );
    rejects("HOST_ONLY", () =>
      move(state, { type: "skip-guess", roundNumber: 1 }, "host", 9_000),
    );
    rejects("HOST_ONLY", () =>
      move(state, { type: "skip-guess", roundNumber: 1 }, "c", 9_000),
    );
    const success = move(
      state,
      { type: "guess-word", roundNumber: 1, guess: state.round!.word.english },
      "host",
      9_000,
    );
    expect(success.phase).toBe("result");
    expect(success.outcome?.guessResult).toBe("correct");
    expect(success.outcome?.caught).toBe(false);
    expect(success.outcome?.accusedId).toBe("host");
    expect(success.players.map((player) => player.score)).toEqual([2, 0, 0, 0]);
    rejects("WRONG_PHASE", () =>
      move(
        success,
        {
          type: "guess-word",
          roundNumber: 1,
          guess: state.round!.word.english,
        },
        "host",
        10_000,
      ),
    );
    expect(advanceTime(success, 40_000)).toBe(success);
    const skipped = move(
      state,
      { type: "skip-guess", roundNumber: 1 },
      "b",
      9_000,
    );
    expect(skipped.outcome?.guessResult).toBe("skipped");
    expect(skipped.players.map((player) => player.score)).toEqual([0, 1, 1, 1]);
  });

  test("correct, wrong, skipped and deadline answers each apply exactly one set of awards", () => {
    for (const [answer, result, scores] of [
      ["correct", "correct", [2, 0, 0, 0]],
      ["wrong", "incorrect", [0, 1, 1, 1]],
      ["skip", "skipped", [0, 1, 1, 1]],
    ] as const) {
      const state = caught();
      const command: PartyCommand =
        answer === "skip"
          ? { type: "skip-guess", roundNumber: 1 }
          : {
              type: "guess-word",
              roundNumber: 1,
              guess:
                answer === "correct"
                  ? state.round!.word.nepali
                  : "Definitely not this answer",
            };
      const next = move(state, command, "host", 36_999);
      expect(next.outcome?.guessResult).toBe(result);
      expect(next.players.map((player) => player.score)).toEqual([...scores]);
      expect(next.guessDeadline).toBeNull();
      expect(advanceTime(next, 37_000)).toBe(next);
      expect(advanceTime(next, 40_000)).toBe(next);
      expect(project(next, "host", 40_000, online).result?.word).toEqual(
        state.round!.word,
      );
    }
    for (const time of [37_000, 37_001, 60_000]) {
      const state = caught();
      const late = move(
        state,
        {
          type: "guess-word",
          roundNumber: 1,
          guess: state.round!.word.english,
        },
        "host",
        time,
      );
      expect(late.outcome?.guessResult).toBe("skipped");
      expect(late.players.map((player) => player.score)).toEqual([0, 1, 1, 1]);
    }
  });

  test("alarm timeout persists and cannot score again after wake or a racing late request", () => {
    const state = caught();
    expect(advanceTime(state, 36_999)).toBe(state);
    const result = advanceTime(state, 37_000)!;
    expect(result.phase).toBe("result");
    expect(result.outcome?.guessResult).toBe("skipped");
    expect(result.players.map((player) => player.score)).toEqual([0, 1, 1, 1]);
    const restored = migrateStoredParty(
      JSON.parse(JSON.stringify(result)),
      [],
      38_000,
    ).party!;
    expect(advanceTime(restored, 38_000)).toBe(restored);
    rejects("WRONG_PHASE", () =>
      move(
        restored,
        {
          type: "guess-word",
          roundNumber: 1,
          guess: state.round!.word.english,
        },
        "host",
        38_000,
      ),
    );
    expect(restored.players.map((player) => player.score)).toEqual([
      0, 1, 1, 1,
    ]);
    expect(nextAlarmDeadline(restored)).toBe(restored.expiresAt);
  });

  test("invalid answers and stale round IDs never consume a live attempt", () => {
    const state = caught();
    for (const guess of ["", "   ", "x".repeat(81), 123])
      rejects("INVALID_GUESS", () =>
        applyAction(
          state,
          "host",
          { type: "guess-word", gameId: state.gameId, roundNumber: 1, guess },
          8_000,
          online,
        ),
      );
    rejects("STALE_ROUND", () =>
      move(
        state,
        { type: "guess-word", roundNumber: 2, guess: "Tea" },
        "host",
        8_000,
      ),
    );
    expect(state.phase).toBe("guess");
    expect(state.outcome).toBeNull();
  });

  test("default rules and ties bypass guessing even with the optional variant enabled", () => {
    const standard = caught({ lastChanceGuess: false });
    expect(standard.phase).toBe("result");
    expect(standard.outcome?.guessResult).toBeNull();
    let tied = voting({ lastChanceGuess: true });
    for (const [voter, suspect] of [
      ["host", "b"],
      ["b", "host"],
      ["c", "d"],
      ["d", "c"],
    ]) {
      tied = move(
        tied,
        { type: "vote", roundNumber: 1, suspectId: suspect! },
        voter!,
        7_000,
      );
    }
    expect(tied.phase).toBe("result");
    expect(tied.outcome?.tied).toBe(true);
    expect(tied.outcome?.guessResult).toBeNull();
    expect(tied.players.map((player) => player.score)).toEqual([2, 0, 0, 0]);
  });

  test("both variants complete a scored match and transfer hosting from final without changing standings", () => {
    let state = lobby({ clueCycles: 2, lastChanceGuess: true });
    let history: string[] = [];
    let now = 2_000;
    const send = (command: PartyCommand, actor = state.hostId): void => {
      const previous = state;
      state = applyAction(
        state,
        actor,
        { ...command, gameId: state.gameId },
        now++,
        online,
        zero,
        { recentWordIds: history },
      )!;
      history = updateWordHistory(previous, state, history);
    };
    send({ type: "start" });
    for (let roundNumber = 1; roundNumber <= settings.rounds; roundNumber++) {
      for (const id of ids) send({ type: "ready", roundNumber }, id);
      send({ type: "start-clues", roundNumber });
      let turns = 0;
      while (state.phase === "clue") {
        send({ type: "next-clue", roundNumber, clueIndex: state.clueIndex });
        turns++;
      }
      expect(turns).toBe(8);
      send({ type: "start-vote", roundNumber });
      for (const id of ids)
        send(
          {
            type: "vote",
            roundNumber,
            suspectId: id === "host" ? "b" : "host",
          },
          id,
        );
      expect(state.phase).toBe("guess");
      send(
        { type: "guess-word", roundNumber, guess: state.round!.word.english },
        "host",
      );
      expect(state.players.map((player) => player.score)).toEqual([
        roundNumber * 2,
        0,
        0,
        0,
      ]);
      send({ type: "next-round", roundNumber });
    }
    expect(state.phase).toBe("final");
    expect(new Set(history).size).toBe(3);
    const standings = state.players;
    send({ type: "transfer-host", playerId: "b" });
    expect(state.phase).toBe("final");
    expect(state.players).toEqual(standings);
    const final = project(state, "b", now, online);
    expect(final.players[0]!.score).toBe(6);
    expect(final.result?.outcome.guessResult).toBe("correct");
    send({ type: "new-game" });
    expect(state.players.every((player) => player.score === 0)).toBe(true);
    expect(history).toHaveLength(3);
  });
});

describe("separate word history and persisted v1 migration", () => {
  test("history records each chosen round once and survives new, fresh and ended parties", () => {
    const initial = lobby();
    const first = move(initial, { type: "start" });
    let history = updateWordHistory(initial, first, []);
    expect(history).toEqual([first.round!.word.id]);
    expect(
      updateWordHistory(
        first,
        move(first, { type: "ready", roundNumber: 1 }, "b"),
        history,
      ),
    ).toBe(history);
    const reset = move(first, { type: "new-game" });
    expect(updateWordHistory(first, reset, history)).toBe(history);
    const next = applyAction(
      reset,
      "host",
      { type: "start", gameId: reset.gameId },
      3_000,
      online,
      zero,
      { recentWordIds: history },
    )!;
    expect(next.round!.word.id).not.toBe(first.round!.word.id);
    history = updateWordHistory(reset, next, history);
    const fresh = applyAction(
      next,
      "host",
      { type: "fresh-party", gameId: next.gameId, pin: "654321" },
      4_000,
      online,
      zero,
      { freshHost: { id: "fresh", tokenHash: "fresh-hash" } },
    )!;
    expect(updateWordHistory(next, fresh, history)).toBe(history);
    expect(updateWordHistory(fresh, null, history)).toBe(history);
    expect(history).toHaveLength(2);
    const persisted = migrateStoredParty(
      null,
      JSON.parse(JSON.stringify(history)),
      5_000,
    );
    expect(persisted.party).toBeNull();
    expect(persisted.history).toEqual(history);
    expect(JSON.stringify(persisted.history)).not.toContain("Asha");
    expect(first).not.toHaveProperty("usedWordIds");
  });

  test("history has a fixed bound and contains word IDs only", () => {
    let history: string[] = [];
    for (let index = 0; index < 300; index++)
      history = rememberWord(history, `word-${index}`);
    expect(history).toHaveLength(RECENT_WORD_LIMIT);
    expect(history[0]).toBe("word-100");
    expect(history.at(-1)).toBe("word-299");
    const restored = migrateStoredParty(null, [null, 123, ...history], 1_000);
    expect(restored.history).toEqual(history);
  });

  test("real v1 shapes upgrade in place in every existing phase without resetting personal or game state", () => {
    for (const state of [
      lobby(),
      roles(),
      clues(),
      voting(),
      caught({ lastChanceGuess: false }),
    ]) {
      const usedWords = state.round ? [state.round.word.id] : [];
      const old = legacy(state, usedWords);
      const migrated = migrateStoredParty(
        JSON.parse(JSON.stringify(old)),
        undefined,
        8_000,
      );
      const next = migrated.party!;
      expect(migrated.legacy).toBe(true);
      expect(next.schemaVersion).toBe(PARTY_SCHEMA_VERSION);
      expect(next.id).toBe(state.id);
      expect(next.hostId).toBe(state.hostId);
      expect(next.pin).toBe(state.pin);
      expect(next.players).toEqual(state.players);
      expect(next.round).toEqual(state.round);
      expect(next.phase).toBe(state.phase);
      expect(next.readyIds).toEqual(state.readyIds);
      expect(next.clueIndex).toBe(state.clueIndex);
      expect(next.discussion).toEqual(state.discussion);
      expect(next.expiresAt).toBe(state.expiresAt);
      expect(next.revision).toBe(state.revision);
      expect(next.settings.clueCycles).toBe(1);
      expect(next.settings.lastChanceGuess).toBe(false);
      expect(next.outcome).toEqual(state.outcome);
      expect(next.gameId).toBeTruthy();
      expect(next.hostRecoveryCode).toMatch(/^[A-F0-9]{4}(?:-[A-F0-9]{4}){7}$/);
      expect(next).not.toHaveProperty("usedWordIds");
      expect(migrated.history).toEqual(usedWords);
      expect(authenticate(next, "hash-host", 8_000)).toBe("host");
      rejects("UPDATE_REQUIRED", () =>
        applyAction(next, "host", { type: "new-game" }, 8_000, online),
      );
      const secondWake = migrateStoredParty(
        JSON.parse(JSON.stringify(next)),
        migrated.history,
        9_000,
      );
      expect(secondWake.legacy).toBe(false);
      expect(secondWake.party).toEqual(next);
      expect(secondWake.history).toEqual(migrated.history);
    }
  });

  test("v1 partial ballots, current roles and running timer retain their exact stored values", () => {
    const voted = move(
      voting(),
      { type: "vote", roundNumber: 1, suspectId: "host" },
      "b",
      6_000,
    );
    const migrated = migrateStoredParty(
      legacy(voted, [voted.round!.word.id]),
      [],
      8_000,
    ).party!;
    expect(migrated.round?.votes).toEqual({ b: "host" });
    expect(project(migrated, "host", 8_000, online).ownRole).toEqual({
      isImposter: true,
      word: null,
    });
    expect(project(migrated, "b", 8_000, online).ownRole).toEqual({
      isImposter: false,
      word: voted.round!.word,
    });
    rejects("ALREADY_VOTED", () =>
      move(
        migrated,
        { type: "vote", roundNumber: 1, suspectId: "c" },
        "b",
        8_000,
      ),
    );
    let timed = clues();
    while (timed.phase === "clue")
      timed = move(
        timed,
        { type: "next-clue", roundNumber: 1, clueIndex: timed.clueIndex },
        "host",
        5_000,
      );
    const timerRestored = migrateStoredParty(legacy(timed), [], 8_000).party!;
    expect(timerRestored.discussion).toEqual(timed.discussion);
    expect(
      project(timerRestored, "b", 8_000, online).discussion.remainingMs,
    ).toBe(57_000);
  });

  test("new requests stay strict instead of retaining a legacy settings API", () => {
    const {
      clueCycles: _clues,
      lastChanceGuess: _guess,
      ...oldSettings
    } = settings;
    rejects("INVALID_SETTINGS", () => validateSettings(oldSettings));
    rejects("INVALID_SETTINGS", () =>
      validateSettings({ ...settings, clueCycles: 3 }),
    );
    rejects("INVALID_SETTINGS", () =>
      validateSettings({ ...settings, lastChanceGuess: "yes" }),
    );
    rejects("INVALID_BODY", () =>
      validateSettings({ ...settings, unexpected: true }),
    );
  });
});

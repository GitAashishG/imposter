import { describe, expect, test } from "bun:test";
import { PACKS, WORDS } from "./data";
import {
  applyAwards,
  createRound,
  rankPlayers,
  recordVote,
  resolveRound,
  validateSetup,
  type Player,
  type Round,
  type Settings,
} from "./game";

function makePlayers(): Player[] {
  return [
    { id: "a", name: "Asha", score: 0 },
    { id: "b", name: "Bikash", score: 0 },
    { id: "c", name: "Chandra", score: 0 },
    { id: "d", name: "Dipa", score: 0 },
  ];
}

function makeSettings(): Settings {
  return { packIds: ["everyday"], rounds: 3, discussionSeconds: 60 };
}

function makeRound(
  votes: Record<string, string> = {},
  players = makePlayers(),
): Round {
  return {
    number: 1,
    word: WORDS[0]!,
    imposterId: players[0]!.id,
    clueOrder: players.map((player) => player.id),
    votes,
  };
}

const almostOne = 1 - Number.EPSILON;

describe("setup validation", () => {
  test("accepts valid settings, trimmed names, and every offered option", () => {
    const names = [" Asha ", "Bikash", "चन्द्र"];
    for (const rounds of [3, 5, 7]) {
      for (const discussionSeconds of [30, 60, 90, 120]) {
        expect(
          validateSetup(names, {
            packIds: PACKS.map((pack) => pack.id),
            rounds,
            discussionSeconds,
          }),
        ).toBeNull();
      }
    }
    expect(names[0]).toBe(" Asha ");
  });

  test("requires 3–12 named players", () => {
    expect(validateSetup(["Asha", "Bikash"], makeSettings())).not.toBeNull();
    expect(
      validateSetup(
        Array.from({ length: 13 }, (_, index) => `Player ${index}`),
        makeSettings(),
      ),
    ).not.toBeNull();
    expect(
      validateSetup(["Asha", "Bikash", "  "], makeSettings()),
    ).not.toBeNull();
    expect(
      validateSetup(
        Array.from({ length: 12 }, (_, index) => `Player ${index}`),
        makeSettings(),
      ),
    ).toBeNull();
  });

  test("rejects case-insensitive duplicates after trimming", () => {
    expect(
      validateSetup(["Asha", " asHA ", "Dipa"], makeSettings()),
    ).not.toBeNull();
  });

  test("enforces the name limit after trimming", () => {
    expect(
      validateSetup(["A".repeat(24), "Bikash", "Dipa"], makeSettings()),
    ).toBeNull();
    expect(
      validateSetup([` ${"A".repeat(24)} `, "Bikash", "Dipa"], makeSettings()),
    ).toBeNull();
    expect(
      validateSetup(["A".repeat(25), "Bikash", "Dipa"], makeSettings()),
    ).not.toBeNull();
  });

  test("rejects empty or unknown packs and unsupported numeric settings", () => {
    const names = ["Asha", "Bikash", "Dipa"];
    expect(
      validateSetup(names, { ...makeSettings(), packIds: [] }),
    ).not.toBeNull();
    expect(
      validateSetup(names, {
        ...makeSettings(),
        packIds: ["everyday", "unknown"],
      } as unknown as Settings),
    ).not.toBeNull();
    for (const rounds of [0, 1, 4, 3.5, NaN]) {
      expect(
        validateSetup(names, { ...makeSettings(), rounds }),
      ).not.toBeNull();
    }
    for (const discussionSeconds of [0, 45, 61, Infinity]) {
      expect(
        validateSetup(names, { ...makeSettings(), discussionSeconds }),
      ).not.toBeNull();
    }
  });
});

describe("round creation and word cycles", () => {
  test("uses selected packs and never mutates players, settings, or history", () => {
    const players = makePlayers();
    const settings = makeSettings();
    const selectedWords = WORDS.filter((word) => word.packId === "everyday");
    const history = [selectedWords[0]!.id];
    const beforePlayers = structuredClone(players);
    const beforeSettings = structuredClone(settings);
    const round = createRound(players, settings, 2, history, () => 0);
    expect(round.number).toBe(2);
    expect(round.word.id).toBe(selectedWords[1]!.id);
    expect(round.word.packId).toBe("everyday");
    expect(round.votes).toEqual({});
    expect(players).toEqual(beforePlayers);
    expect(settings).toEqual(beforeSettings);
    expect(history).toEqual([selectedWords[0]!.id]);
  });

  test("selects the first and last words at valid random boundaries", () => {
    const pool = WORDS.filter((word) => word.packId === "everyday");
    expect(
      createRound(makePlayers(), makeSettings(), 1, [], () => 0).word.id,
    ).toBe(pool[0]!.id);
    expect(
      createRound(makePlayers(), makeSettings(), 1, [], () => almostOne).word
        .id,
    ).toBe(pool[pool.length - 1]!.id);
  });

  test("gives every player an equal-sized imposter selection interval", () => {
    const players = makePlayers();
    for (let index = 0; index < players.length; index += 1) {
      let calls = 0;
      const random = () => (calls++ === 1 ? (index + 0.5) / players.length : 0);
      expect(
        createRound(players, makeSettings(), 1, [], random).imposterId,
      ).toBe(players[index]!.id);
    }
    expect(
      createRound(players, makeSettings(), 1, [], () => 0).imposterId,
    ).toBe("a");
    expect(
      createRound(players, makeSettings(), 1, [], () => almostOne).imposterId,
    ).toBe("d");
  });

  test("shuffles clue order separately from the imposter and includes everyone once", () => {
    const players = makePlayers();
    const originalIds = players.map((player) => player.id);
    const low = createRound(players, makeSettings(), 1, [], () => 0);
    const high = createRound(players, makeSettings(), 1, [], () => almostOne);
    expect(low.clueOrder).toEqual(["b", "c", "d", "a"]);
    expect(high.clueOrder).toEqual(originalIds);
    expect(new Set(low.clueOrder)).toEqual(new Set(originalIds));
    expect(low.clueOrder).toHaveLength(players.length);
    expect(players.map((player) => player.id)).toEqual(originalIds);
  });

  test("all clue permutations are reachable through equal-sized shuffle intervals", () => {
    const players = makePlayers().slice(0, 3);
    const orders = new Set<string>();
    for (let firstSwap = 0; firstSwap < 3; firstSwap += 1) {
      for (let secondSwap = 0; secondSwap < 2; secondSwap += 1) {
        const values = [0, 0, (firstSwap + 0.5) / 3, (secondSwap + 0.5) / 2];
        let index = 0;
        const round = createRound(
          players,
          makeSettings(),
          1,
          [],
          () => values[index++]!,
        );
        orders.add(round.clueOrder.join(","));
      }
    }
    expect(orders.size).toBe(6);
  });

  test("rejects invalid random values rather than returning an impossible role or word", () => {
    for (const invalid of [-0.01, 1, Infinity, -Infinity, NaN]) {
      expect(() =>
        createRound(makePlayers(), makeSettings(), 1, [], () => invalid),
      ).toThrow();
      let calls = 0;
      expect(() =>
        createRound(makePlayers(), makeSettings(), 1, [], () =>
          calls++ === 0 ? 0 : invalid,
        ),
      ).toThrow();
      calls = 0;
      expect(() =>
        createRound(makePlayers(), makeSettings(), 1, [], () =>
          calls++ < 2 ? 0 : invalid,
        ),
      ).toThrow();
    }
  });

  test("never repeats a word before all selected-pack words have been used", () => {
    const pool = WORDS.filter((word) => word.packId === "everyday");
    const history: string[] = [];
    for (let index = 0; index < pool.length; index += 1) {
      const round = createRound(
        makePlayers(),
        makeSettings(),
        1,
        history,
        () => 0,
      );
      expect(history).not.toContain(round.word.id);
      history.push(round.word.id);
    }
    expect(new Set(history).size).toBe(pool.length);
  });

  test("restarts exhausted pools and keeps the second cycle nonrepeating too", () => {
    const pool = WORDS.filter((word) => word.packId === "everyday");
    const history = pool.map((word) => word.id);
    const first = createRound(
      makePlayers(),
      makeSettings(),
      1,
      history,
      () => 0,
    );
    expect(first.word.id).toBe(pool[0]!.id);
    history.push(first.word.id);
    const second = createRound(
      makePlayers(),
      makeSettings(),
      1,
      history,
      () => 0,
    );
    expect(second.word.id).toBe(pool[1]!.id);
    history.push(...pool.slice(1).map((word) => word.id));
    expect(
      createRound(makePlayers(), makeSettings(), 1, history, () => almostOne)
        .word.id,
    ).toBe(pool[pool.length - 1]!.id);
  });

  test("ignores history from unselected packs and unknown words", () => {
    const pool = WORDS.filter((word) => word.packId === "everyday");
    const otherPack = WORDS.find((word) => word.packId !== "everyday")!;
    const round = createRound(
      makePlayers(),
      makeSettings(),
      1,
      [otherPack.id, "not-a-word"],
      () => 0,
    );
    expect(round.word.id).toBe(pool[0]!.id);
  });

  test("rejects impossible setup, duplicate IDs, and out-of-match round numbers", () => {
    const players = makePlayers();
    expect(() =>
      createRound(players.slice(0, 2), makeSettings(), 1, []),
    ).toThrow();
    expect(() =>
      createRound(
        [players[0]!, { ...players[1]!, name: " asha " }, ...players.slice(2)],
        makeSettings(),
        1,
        [],
      ),
    ).toThrow();
    expect(() =>
      createRound(
        [players[0]!, { ...players[1]!, id: "a" }, ...players.slice(2)],
        makeSettings(),
        1,
        [],
      ),
    ).toThrow();
    expect(() =>
      createRound(
        [{ ...players[0]!, id: "" }, ...players.slice(1)],
        makeSettings(),
        1,
        [],
      ),
    ).toThrow();
    for (const number of [0, -1, 1.5, 4, NaN]) {
      expect(() => createRound(players, makeSettings(), number, [])).toThrow();
    }
  });
});

describe("private voting", () => {
  test("records one vote immutably and preserves other round data", () => {
    const players = makePlayers();
    const round = makeRound({ b: "a" });
    const next = recordVote(round, players, "a", "b");
    expect(next).not.toBe(round);
    expect(next.votes).toEqual({ a: "b", b: "a" });
    expect(round.votes).toEqual({ b: "a" });
    expect(next.word).toBe(round.word);
    expect(next.clueOrder).toBe(round.clueOrder);
  });

  test("rejects self votes and unknown voters or suspects", () => {
    const players = makePlayers();
    const round = makeRound();
    expect(() => recordVote(round, players, "a", "a")).toThrow();
    expect(() => recordVote(round, players, "unknown", "a")).toThrow();
    expect(() => recordVote(round, players, "a", "unknown")).toThrow();
    expect(round.votes).toEqual({});
  });

  test("rejects repeated votes even when repeating the same suspect", () => {
    const players = makePlayers();
    const round = makeRound({ a: "b" });
    expect(() => recordVote(round, players, "a", "c")).toThrow();
    expect(() => recordVote(round, players, "a", "b")).toThrow();
    expect(round.votes).toEqual({ a: "b" });
  });

  test("rejects duplicate player IDs in both vote recording and resolution", () => {
    const players = makePlayers();
    players[1] = { ...players[1]!, id: "a" };
    expect(() => recordVote(makeRound(), players, "a", "c")).toThrow();
    expect(() =>
      resolveRound(makeRound({ a: "b", b: "a", c: "a", d: "c" }), players),
    ).toThrow();
  });

  test("rejects corrupted existing votes instead of counting them", () => {
    const invalidVotes: Record<string, string>[] = [
      { a: "a" },
      { unknown: "a" },
      { a: "unknown" },
    ];
    for (const votes of invalidVotes) {
      const round = makeRound(votes);
      expect(() => recordVote(round, makePlayers(), "b", "c")).toThrow();
      expect(() => resolveRound(round, makePlayers())).toThrow();
    }
  });

  test("rejects an unknown imposter or missing, duplicate, and unknown clue players", () => {
    const round = makeRound();
    expect(() =>
      recordVote({ ...round, imposterId: "unknown" }, makePlayers(), "a", "b"),
    ).toThrow();
    for (const clueOrder of [
      ["a", "b", "c"],
      ["a", "b", "c", "c"],
      ["a", "b", "c", "unknown"],
    ]) {
      expect(() =>
        recordVote({ ...round, clueOrder }, makePlayers(), "a", "b"),
      ).toThrow();
      expect(() =>
        resolveRound({ ...round, clueOrder }, makePlayers()),
      ).toThrow();
    }
  });

  test("handles IDs that resemble Object prototype properties safely", () => {
    const players = makePlayers()
      .slice(0, 3)
      .map((player, index) => ({
        ...player,
        id: ["__proto__", "constructor", "toString"][index]!,
      }));
    let round = makeRound({}, players);
    round = recordVote(round, players, "__proto__", "constructor");
    round = recordVote(round, players, "constructor", "__proto__");
    round = recordVote(round, players, "toString", "__proto__");
    const outcome = resolveRound(round, players);
    expect(outcome.caught).toBe(true);
    expect(outcome.voteCounts.__proto__).toBe(2);
    expect(applyAwards(players, outcome).map((player) => player.score)).toEqual(
      [0, 1, 1],
    );
  });
});

describe("resolution and scoring", () => {
  test("requires every player to vote, including the imposter", () => {
    expect(() => resolveRound(makeRound(), makePlayers())).toThrow();
    expect(() =>
      resolveRound(makeRound({ b: "a", c: "a", d: "b" }), makePlayers()),
    ).toThrow();
  });

  test("a unique plurality catches the imposter without requiring an absolute majority", () => {
    const players = makePlayers();
    const round = makeRound({ a: "b", b: "a", c: "a", d: "c" });
    const outcome = resolveRound(round, players);
    expect(outcome).toEqual({
      caught: true,
      tied: false,
      accusedId: "a",
      voteCounts: { a: 2, b: 1, c: 1, d: 0 },
      awards: { a: 0, b: 1, c: 1, d: 1 },
    });
    expect(players.every((player) => player.score === 0)).toBe(true);
    expect(round.votes).toEqual({ a: "b", b: "a", c: "a", d: "c" });
  });

  test("a wrong accusation gives only the imposter two points", () => {
    const outcome = resolveRound(
      makeRound({ a: "b", b: "a", c: "b", d: "c" }),
      makePlayers(),
    );
    expect(outcome.caught).toBe(false);
    expect(outcome.tied).toBe(false);
    expect(outcome.accusedId).toBe("b");
    expect(outcome.awards).toEqual({ a: 2, b: 0, c: 0, d: 0 });
  });

  test("a two-way tie lets the imposter escape, even when they are tied for most votes", () => {
    const outcome = resolveRound(
      makeRound({ a: "b", b: "a", c: "a", d: "b" }),
      makePlayers(),
    );
    expect(outcome).toEqual({
      caught: false,
      tied: true,
      accusedId: null,
      voteCounts: { a: 2, b: 2, c: 0, d: 0 },
      awards: { a: 2, b: 0, c: 0, d: 0 },
    });
  });

  test("a multiway tie never picks the first player as the accused", () => {
    const outcome = resolveRound(
      makeRound({ a: "b", b: "a", c: "d", d: "c" }),
      makePlayers(),
    );
    expect(outcome.tied).toBe(true);
    expect(outcome.accusedId).toBeNull();
    expect(outcome.caught).toBe(false);
    expect(outcome.awards).toEqual({ a: 2, b: 0, c: 0, d: 0 });
  });

  test("awards are pure and added to existing scores only when applied by the caller", () => {
    const players = makePlayers().map((player, index) => ({
      ...player,
      score: index,
    }));
    const outcome = resolveRound(
      makeRound({ a: "b", b: "a", c: "a", d: "c" }),
      players,
    );
    const first = applyAwards(players, outcome);
    const second = applyAwards(players, outcome);
    expect(first.map((player) => player.score)).toEqual([0, 2, 3, 4]);
    expect(second).toEqual(first);
    expect(players.map((player) => player.score)).toEqual([0, 1, 2, 3]);
    expect(first[0]).not.toBe(players[0]);
    expect(applyAwards(first, outcome).map((player) => player.score)).toEqual([
      0, 3, 4, 5,
    ]);
  });

  test("rejects missing, unknown, or invalid awards and impossible scores", () => {
    const players = makePlayers();
    const outcome = resolveRound(
      makeRound({ a: "b", b: "a", c: "a", d: "c" }),
      players,
    );
    const invalidAwards: Record<string, number>[] = [
      { a: 0, b: 1, c: 1 },
      { a: 0, b: 1, c: 1, unknown: 1 },
      { a: 0, b: -1, c: 1, d: 1 },
      { a: 0, b: NaN, c: 1, d: 1 },
      { a: 0, b: 0.5, c: 1, d: 1 },
      { a: 0, b: 3, c: 1, d: 1 },
    ];
    for (const awards of invalidAwards) {
      expect(() => applyAwards(players, { ...outcome, awards })).toThrow();
    }
    for (const score of [-1, NaN, Infinity, 0.5]) {
      expect(() =>
        applyAwards([{ ...players[0]!, score }, ...players.slice(1)], outcome),
      ).toThrow();
    }
    const maxed = players.map((player) => ({
      ...player,
      score: Number.MAX_SAFE_INTEGER,
    }));
    expect(() => applyAwards(maxed, outcome)).toThrow();
  });

  test("ranks descending without mutating input and preserves original order for tied scores", () => {
    const players = makePlayers().map((player, index) => ({
      ...player,
      score: [3, 5, 5, 0][index]!,
    }));
    expect(rankPlayers(players).map((player) => player.id)).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
    expect(players.map((player) => player.id)).toEqual(["a", "b", "c", "d"]);
    expect(rankPlayers([])).toEqual([]);
  });
});

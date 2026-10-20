import { describe, expect, test } from "bun:test";
import { PACKS, WORDS } from "./data";
import {
  applyAwards,
  createRound,
  rankPlayers,
  recordVote,
  resolveRound,
  validateSetup,
  DEFAULT_SETTINGS,
  RECENT_WORD_LIMIT,
  matchesWord,
  migrateSettings,
  rememberWord,
  resolveLastChance,
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
  return { ...DEFAULT_SETTINGS, packIds: ["everyday"], rounds: 3 };
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
            clueCycles: 1,
            lastChanceGuess: false,
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
    expect(round.word.id).toBe(selectedWords[1]!.id);
    expect(round.word.packId).toBe("everyday");
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

  test("uses the least-recently-used word after a selected pool is exhausted", () => {
    const pool = WORDS.filter((word) => word.packId === "everyday");
    const oldest = pool[pool.length - 1]!;
    const history = [oldest.id, ...pool.slice(0, -1).map((word) => word.id)];
    const first = createRound(
      makePlayers(),
      makeSettings(),
      1,
      history,
      () => almostOne,
    );
    expect(first.word.id).toBe(oldest.id);
    const continued = rememberWord(history, first.word.id);
    const next = createRound(
      makePlayers(),
      makeSettings(),
      1,
      continued,
      () => almostOne,
    );
    expect(next.word.id).toBe(history[1]!);
    expect(next.word.id).not.toBe(first.word.id);
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
      guessResult: null,
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
      guessResult: null,
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

describe("optional game rules", () => {
  test("accepts both clue cycle options and last-chance choices", () => {
    for (const clueCycles of [1, 2] as const) {
      for (const lastChanceGuess of [false, true]) {
        expect(
          validateSetup(["Aashish", "Ashu", "Ashim"], {
            ...makeSettings(),
            clueCycles,
            lastChanceGuess,
          }),
        ).toBeNull();
      }
    }
  });

  test("rejects unsupported cycles and missing or non-boolean guess options", () => {
    for (const clueCycles of [0, 3, 1.5, undefined]) {
      expect(
        validateSetup(["Aashish", "Ashu", "Ashim"], {
          ...makeSettings(),
          clueCycles,
        } as unknown as Settings),
      ).not.toBeNull();
    }
    for (const lastChanceGuess of [undefined, null, "yes", 1]) {
      expect(
        validateSetup(["Aashish", "Ashu", "Ashim"], {
          ...makeSettings(),
          lastChanceGuess,
        } as unknown as Settings),
      ).not.toBeNull();
    }
  });

  test("upgrades saved settings without changing the group's existing selections", () => {
    const saved: Pick<Settings, "packIds" | "rounds" | "discussionSeconds"> = {
      packIds: ["culture"],
      rounds: 7,
      discussionSeconds: 90,
    };
    expect(migrateSettings(saved)).toEqual({
      ...saved,
      clueCycles: 1,
      lastChanceGuess: false,
    });
    expect(saved).toEqual({
      packIds: ["culture"],
      rounds: 7,
      discussionSeconds: 90,
    });
    expect(
      migrateSettings({ ...saved, clueCycles: 2, lastChanceGuess: true }),
    ).toEqual({ ...saved, clueCycles: 2, lastChanceGuess: true });
    expect(migrateSettings({ ...saved, rounds: 4 })).toBeNull();
    expect(migrateSettings({ ...saved, clueCycles: 3 })).toBeNull();
  });
});

describe("persistent recent words", () => {
  test("a new match avoids a word chosen in the previous game", () => {
    const previous = createRound(makePlayers(), makeSettings(), 3, [], () => 0);
    const history = rememberWord([], previous.word.id);
    const fresh = createRound(
      makePlayers(),
      makeSettings(),
      1,
      history,
      () => 0,
    );
    expect(fresh.word.id).not.toBe(previous.word.id);
    expect(history).toEqual([previous.word.id]);
  });

  test("keeps the most recent bounded history without mutating its input", () => {
    const history = Array.from(
      { length: RECENT_WORD_LIMIT },
      (_, index) => `word-${index}`,
    );
    const updated = rememberWord(history, "new-word");
    expect(updated).toHaveLength(RECENT_WORD_LIMIT);
    expect(updated[0]).toBe("word-1");
    expect(updated.at(-1)).toBe("new-word");
    expect(updated).not.toContain("word-0");
    expect(history[0]).toBe("word-0");
    expect(history.at(-1)).toBe(`word-${RECENT_WORD_LIMIT - 1}`);
  });
});

describe("last-chance imposter guess", () => {
  const tea = {
    ...WORDS[0]!,
    english: "Tea",
    nepali: "चिया",
    aliases: ["Chiya"],
  };
  const caughtRound = () => ({
    ...makeRound({ a: "b", b: "a", c: "a", d: "c" }),
    word: tea,
  });

  test("matches either language or an exact known alias, not a substring", () => {
    for (const answer of [" Tea! ", "चिया", "CHIYA", "Ｔｅａ"])
      expect(matchesWord(tea, answer)).toBe(true);
    for (const answer of ["te", "green tea", "coffee", "", "!!!"])
      expect(matchesWord(tea, answer)).toBe(false);
    expect(matchesWord({ ...tea, english: "Video call" }, "VIDEO—CALL")).toBe(
      true,
    );
  });

  test("a correct last guess changes only the scoring outcome, not the votes", () => {
    const round = caughtRound();
    const players = makePlayers();
    const outcome = resolveLastChance(round, players, "चिया");
    expect(outcome.caught).toBe(false);
    expect(outcome.guessResult).toBe("correct");
    expect(outcome.accusedId).toBe("a");
    expect(outcome.voteCounts).toEqual({ a: 2, b: 1, c: 1, d: 0 });
    expect(outcome.awards).toEqual({ a: 2, b: 0, c: 0, d: 0 });
    expect(applyAwards(players, outcome).map((player) => player.score)).toEqual(
      [2, 0, 0, 0],
    );
    expect(round.votes).toEqual({ a: "b", b: "a", c: "a", d: "c" });
    expect(players.map((player) => player.score)).toEqual([0, 0, 0, 0]);
  });

  test("wrong and skipped guesses leave the group's catch points intact", () => {
    for (const guess of ["coffee", null]) {
      const outcome = resolveLastChance(caughtRound(), makePlayers(), guess);
      expect(outcome.caught).toBe(true);
      expect(outcome.guessResult).toBe(
        guess === null ? "skipped" : "incorrect",
      );
      expect(outcome.awards).toEqual({ a: 0, b: 1, c: 1, d: 1 });
    }
  });

  test("rejects invalid attempts and never grants a guess on an escape or tie", () => {
    for (const guess of ["", " ", "x".repeat(81)])
      expect(() =>
        resolveLastChance(caughtRound(), makePlayers(), guess),
      ).toThrow();
    expect(() =>
      resolveLastChance(
        makeRound({ a: "b", b: "a", c: "b", d: "c" }),
        makePlayers(),
        "Tea",
      ),
    ).toThrow();
    expect(() =>
      resolveLastChance(
        makeRound({ a: "b", b: "a", c: "a", d: "b" }),
        makePlayers(),
        "Tea",
      ),
    ).toThrow();
  });
});

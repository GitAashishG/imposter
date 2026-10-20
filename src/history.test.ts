import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "./game";
import type { Player, Settings } from "./game";
import { HISTORY_LIMIT, emptyHistory, historyView, recordCompletedGame } from "./history";

function players(): Player[] {
  return [{ id: "a", name: "Aashish", score: 3 }, { id: "b", name: "Ashu", score: 2 }, { id: "c", name: "Ashim", score: 1 }];
}
function settings(): Settings { return { ...DEFAULT_SETTINGS, packIds: ["culture"] }; }

describe("completed party history", () => {
  test("a repeated finalization does not count a game twice or overwrite its result", () => {
    const first = recordCompletedGame(emptyHistory(), "game-1", players(), settings(), 1000);
    const again = recordCompletedGame(first, "game-1", players().map((player) => ({ ...player, score: 99 })), settings(), 2000);
    expect(again).toBe(first);
    expect(again.completedGames).toBe(1);
    expect(again.games[0]!.completedAt).toBe(1000);
    expect(again.games[0]!.players.map((player) => player.score)).toEqual([3, 2, 1]);
  });

  test("retains only the latest twenty summaries while keeping the completed count", () => {
    let saved = emptyHistory();
    for (let index = 0; index <= HISTORY_LIMIT; index++) saved = recordCompletedGame(saved, `game-${index}`, players(), settings(), index + 1);
    const view = historyView(saved);
    expect(view.completedGames).toBe(HISTORY_LIMIT + 1);
    expect(view.games).toHaveLength(HISTORY_LIMIT);
    expect(view.games[0]!.gameId).toBe(`game-${HISTORY_LIMIT}`);
    expect(view.games.at(-1)!.gameId).toBe("game-1");
    expect(view.games.some((game) => game.gameId === "game-0")).toBe(false);
    expect(view.totals.find((player) => player.id === "a")).toEqual({ id: "a", name: "Aashish", gamesPlayed: HISTORY_LIMIT, wins: HISTORY_LIMIT, points: 3 * HISTORY_LIMIT });
  });

  test("totals use seat IDs rather than merging equal nicknames from different players", () => {
    const first = recordCompletedGame(emptyHistory(), "game-1", players(), settings(), 1000);
    const secondPlayers = players().map((player) => player.id === "a" ? { ...player, id: "new-a", score: 1 } : player);
    const view = historyView(recordCompletedGame(first, "game-2", secondPlayers, settings(), 2000));
    expect(view.totals.filter((player) => player.name === "Aashish")).toHaveLength(2);
    expect(view.totals.find((player) => player.id === "a")?.gamesPlayed).toBe(1);
    expect(view.totals.find((player) => player.id === "new-a")?.points).toBe(1);
    expect(view.totals.find((player) => player.id === "b")?.gamesPlayed).toBe(2);
  });

  test("shared winners each receive one win and later names remain attached to the same seat", () => {
    const tied = players().map((player) => ({ ...player, score: player.id === "c" ? 1 : 5 }));
    const first = recordCompletedGame(emptyHistory(), "game-1", tied, settings(), 1000);
    const renamed = players().map((player) => player.id === "b" ? { ...player, name: "Ashu dai", score: 7 } : player);
    const view = historyView(recordCompletedGame(first, "game-2", renamed, settings(), 2000));
    expect(first.games[0]!.winnerIds).toEqual(["a", "b"]);
    expect(view.totals.find((player) => player.id === "a")?.wins).toBe(1);
    expect(view.totals.find((player) => player.id === "b")).toEqual({ id: "b", name: "Ashu dai", gamesPlayed: 2, wins: 2, points: 12 });
  });

  test("summaries snapshot public scores/settings without storing member credentials or role data", () => {
    const members = players().map((player) => ({ ...player, tokenHash: `private-${player.id}`, role: "imposter", ballot: "a" }));
    const selected = settings();
    const saved = recordCompletedGame(emptyHistory(), "game-1", members, selected, 1000);
    members[0]!.score = 99;
    selected.packIds.push("easy");
    const json = JSON.stringify(saved);
    expect(json).not.toContain("tokenHash");
    expect(json).not.toContain("private-");
    expect(json).not.toContain("ballot");
    expect(json).not.toContain("imposter");
    expect(saved.games[0]!.players[0]!.score).toBe(3);
    expect(saved.games[0]!.settings.packIds).toEqual(["culture"]);
    expect(members[0]!.tokenHash).toBe("private-a");
  });
});

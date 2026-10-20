import { rankPlayers } from "./game";
import type { Player, Settings } from "./game";

export const HISTORY_LIMIT = 20;

export interface CompletedGame {
  gameId: string;
  completedAt: number;
  settings: Settings;
  players: Player[];
  winnerIds: string[];
}

export interface SavedGameHistory {
  completedGames: number;
  games: CompletedGame[];
}

export interface PlayerTotal {
  id: string;
  name: string;
  gamesPlayed: number;
  wins: number;
  points: number;
}

export interface GameHistory extends SavedGameHistory {
  totals: PlayerTotal[];
}

export function emptyHistory(): SavedGameHistory {
  return { completedGames: 0, games: [] };
}

export function recordCompletedGame(
  history: SavedGameHistory,
  gameId: string,
  players: Player[],
  settings: Settings,
  completedAt: number,
): SavedGameHistory {
  if (!gameId || !Number.isSafeInteger(completedAt) || completedAt < 0) throw new Error("A completed game needs an identity and timestamp.");
  if (history.games.some((game) => game.gameId === gameId)) return history;
  if (players.length < 3 || players.length > 12) throw new Error("A completed game needs 3–12 players.");
  const ranked = rankPlayers(players);
  const winnerIds = ranked.filter((player) => player.score === ranked[0]!.score).map((player) => player.id);
  const game: CompletedGame = {
    gameId,
    completedAt,
    settings: { ...settings, packIds: [...settings.packIds] },
    // Worker members also have credential hashes. History must never copy them.
    players: players.map(({ id, name, score }) => ({ id, name, score })),
    winnerIds,
  };
  return { completedGames: history.completedGames + 1, games: [game, ...history.games].slice(0, HISTORY_LIMIT) };
}

export function historyView(history: SavedGameHistory): GameHistory {
  const totals = new Map<string, PlayerTotal>();
  // Oldest first makes the latest display name win without merging by name.
  for (let index = history.games.length - 1; index >= 0; index -= 1) {
    const game = history.games[index]!;
    for (const player of game.players) {
      const total = totals.get(player.id) ?? { id: player.id, name: player.name, gamesPlayed: 0, wins: 0, points: 0 };
      total.name = player.name;
      total.gamesPlayed += 1;
      total.points += player.score;
      if (game.winnerIds.includes(player.id)) total.wins += 1;
      totals.set(player.id, total);
    }
  }
  return { ...history, totals: [...totals.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name)) };
}

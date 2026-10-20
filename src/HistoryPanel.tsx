import { Trophy } from "lucide-react";
import type { GameHistory } from "./history";

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function HistoryPanel({ history, loading = false, error = null, onRetry }: {
  history: GameHistory | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  if (loading) return <p className="history-status" role="status">Loading this party’s completed games…</p>;
  if (error) return <div className="history-status"><p role="alert">{error}</p>{onRetry && <button type="button" className="secondary-button" onClick={onRetry}>Try history again</button>}</div>;
  if (!history || history.games.length === 0) return <div className="history-status"><Trophy size={28} aria-hidden="true" /><h3>A fresh scoreboard.</h3><p>Finish a full game to start this party’s history. Unfinished games and current-round points are not counted.</p></div>;

  return <div className="history-panel">
    <p className="history-explanation">{history.completedGames} {history.completedGames === 1 ? "game completed" : "games completed"}. Showing the latest {history.games.length}, up to 20. Party totals cover only these retained games—not a global skill ranking.</p>
    <h3>Party totals</h3>
    <div className="history-table-wrap"><table className="history-totals"><thead><tr><th scope="col">Player</th><th scope="col">Games</th><th scope="col">Wins</th><th scope="col">Points</th></tr></thead><tbody>{history.totals.map((player) => <tr key={player.id}><th scope="row">{player.name}</th><td>{player.gamesPlayed}</td><td>{player.wins}</td><td>{player.points}</td></tr>)}</tbody></table></div>
    <p className="history-small-note">Totals use player seats, never nicknames. Shared winners each receive a win. Games can use different rules, so compare points for fun rather than as a universal ranking.</p>
    <h3>Completed games</h3>
    <ol className="history-games">{history.games.map((game) => <li key={game.gameId}><div className="history-game-heading"><time dateTime={new Date(game.completedAt).toISOString()}>{timeFormat.format(game.completedAt)}</time><span>{game.settings.rounds} rounds</span></div><p className="history-game-winners"><Trophy size={15} aria-hidden="true" />{game.players.filter((player) => game.winnerIds.includes(player.id)).map((player) => player.name).join(" & ")}</p><p className="history-small-note">{game.settings.clueCycles} clue {game.settings.clueCycles === 1 ? "cycle" : "cycles"} · Last chance {game.settings.lastChanceGuess ? "on" : "off"} · {game.settings.discussionSeconds / 60} min discussion</p><ul>{[...game.players].sort((a, b) => b.score - a.score).map((player) => <li key={player.id}><span>{player.name}</span><strong>{player.score} pts</strong></li>)}</ul></li>)}</ol>
    <p className="history-small-note">History contains final scores and rules, not private roles, secret words, ballots, or recovery codes. Ending or replacing this party clears its personal history.</p>
  </div>;
}

import { useEffect, useState } from "react";
import { CircleHelp, History, RotateCcw, ShieldCheck, Trophy, X } from "lucide-react";
import Setup, { loadPreferences, savePreferences } from "./Setup";
import type { Preferences } from "./Setup";
import { Eyes, Modal, Rules, Scoreboard } from "./components";
import {
  Ballot,
  ClueTurn,
  Discussion,
  FinalResult,
  Handoff,
  LastChance,
  RoleReveal,
  RoundProgress,
  RoundResult,
} from "./GameScreen";
import { useGame } from "./useGame";
import { PlayModeSwitch } from "./PlayModeSwitch";
import { ThemeToggle } from "./Appearance";
import { DeviceOptions } from "./DeviceOptions";
import { HistoryPanel } from "./HistoryPanel";
import { PwaControls } from "./PwaControls";

export default function App({ onParty }: { onParty: () => void }) {
  const [preferences, setPreferences] = useState(loadPreferences);
  const [state, dispatch, gameHistory] = useGame(preferences.names);
  const [modal, setModal] = useState<
    "rules" | "scores" | "history" | "end" | "reset" | "switch" | null
  >(null);
  const playing = state.phase !== "setup";
  const match = "match" in state ? state.match : null;

  const deviceActive = ["role", "clue", "discussion", "vote", "guess"].includes(
    state.phase,
  );
  const turnKey =
    state.phase === "clue"
      ? `${state.match.gameId}:${state.match.round.number}:${state.index}`
      : null;
  useEffect(() => {
    const hide = () => dispatch({ type: "HIDE" });
    const visibility = () => {
      if (document.hidden) hide();
    };
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", hide);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [dispatch]);

  useEffect(() => {
    if (state.phase === "setup") return;
    document
      .querySelector<HTMLElement>("main h1")
      ?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [
    state.phase,
    "index" in state ? state.index : null,
    "revealed" in state ? state.revealed : null,
  ]);

  function showModal(value: "rules" | "scores" | "history" | "end" | "reset" | "switch") {
    dispatch({ type: "HIDE" });
    setModal(value);
  }

  function start(value: Preferences) {
    setPreferences(value);
    savePreferences(value);
    dispatch({ type: "START", names: value.names, settings: value.settings });
  }

  function changePreferences(value: Preferences) {
    setPreferences(value);
    savePreferences(value);
    dispatch({ type: "ROSTER", names: value.names });
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="brand" aria-label="Ko Ho? — को हो?">
          <span className="brand-icon">
            <Eyes />
          </span>
          <span>
            ko ho<span className="brand-question">?</span>
            <small lang="ne">को हो?</small>
          </span>
        </div>
        <div className="header-actions">
          {playing && (
            <button
              className="header-button"
              onClick={() => showModal("scores")}
            >
              <Trophy size={16} />
              <span>Standings</span>
            </button>
          )}
          <button className="header-button" onClick={() => showModal("rules")}>
            <CircleHelp size={17} />
            <span>How to play</span>
          </button>
          <ThemeToggle />
          {!playing && (
            <span className="header-label">A GAME FOR YOUR PEOPLE</span>
          )}
        </div>
      </header>
      <PlayModeSwitch
        mode="local"
        onChange={(next) => {
          if (next === "party") {
            if (playing) showModal("switch");
            else onParty();
          }
        }}
      />
      <DeviceOptions active={deviceActive} turnKey={turnKey} />
      <PwaControls gameActive={playing && state.phase !== "final"} />
      <div className="local-party-bar" aria-label="Local party">
        <button className="secondary-button" onClick={() => showModal("history")}>
          <History size={16} /> Party history & totals
          <span className="count-badge">{gameHistory.completedGames}</span>
        </button>
        <button className="text-button" onClick={() => showModal("end")}>
          <X size={15} /> End local party
        </button>
      </div>

      {state.phase === "setup" ? (
        <Setup initial={preferences} onChange={changePreferences} onStart={start} />
      ) : (
        <main className="game-layout">
          <div className="game-topbar">
            <button
              className="secondary-button new-game-button"
              onClick={() => showModal("reset")}
            >
              <RotateCcw size={15} /> New game, same players
            </button>
            <span>
              <ShieldCheck size={14} /> ONE PHONE. SAME CIRCLE.
            </span>
          </div>
          {state.phase !== "final" && (
            <RoundProgress
              phase={state.phase}
              round={state.match.round.number}
              total={state.match.settings.rounds}
            />
          )}
          {state.phase === "role" &&
            (state.revealed ? (
              <RoleReveal
                match={state.match}
                index={state.index}
                onNext={() => dispatch({ type: "NEXT_ROLE" })}
              />
            ) : (
              <Handoff
                player={state.match.players[state.index]}
                index={state.index}
                count={state.match.players.length}
                onReveal={() => dispatch({ type: "REVEAL" })}
              />
            ))}
          {state.phase === "clue" && (
            <ClueTurn
              match={state.match}
              index={state.index}
              onNext={() => dispatch({ type: "NEXT_CLUE" })}
            />
          )}
          {state.phase === "discussion" && (
            <Discussion
              seconds={state.match.settings.discussionSeconds}
              onVote={() => dispatch({ type: "VOTE" })}
            />
          )}
          {state.phase === "vote" &&
            (state.revealed ? (
              <Ballot
                key={state.index}
                players={state.match.players}
                voter={state.match.players[state.index]}
                onVote={(suspectId) => dispatch({ type: "CAST", suspectId })}
              />
            ) : (
              <Handoff
                voting
                player={state.match.players[state.index]}
                index={state.index}
                count={state.match.players.length}
                onReveal={() => dispatch({ type: "REVEAL" })}
              />
            ))}
          {state.phase === "guess" && (
            <LastChance
              key={`${state.match.gameId}:${state.match.round.number}`}
              player={state.match.players.find(
                (player) => player.id === state.match.round.imposterId,
              )!}
              deadline={state.deadline}
              revealed={state.revealed}
              onReveal={() => dispatch({ type: "REVEAL" })}
              onGuess={(guess) => dispatch({ type: "GUESS", guess })}
              onSkip={() => dispatch({ type: "SKIP_GUESS" })}
            />
          )}
          {state.phase === "result" && (
            <RoundResult
              match={state.match}
              outcome={state.outcome}
              onContinue={() => dispatch({ type: "CONTINUE" })}
            />
          )}
          {state.phase === "final" && (
            <FinalResult
              match={state.match}
              onAgain={() => showModal("reset")}
            />
          )}
          <div className="game-bottom-note">
            <span lang="ne">आफ्नै मान्छे, आफ्नै रमाइलो।</span> Your people. Your
            kind of fun.
          </div>
        </main>
      )}

      <footer className="site-footer">
        <span>GOOD COMPANY. GREAT BLUFFS.</span>
        <span>
          Made for the gathering. <span lang="ne">भेटघाटको लागि।</span>
        </span>
        <span className="footer-version">
          v0.1 <span /> PASS & PLAY
        </span>
      </footer>

      {modal === "rules" && (
        <Modal title="A little bluffing 101." onClose={() => setModal(null)}>
          <Rules />
        </Modal>
      )}
      {modal === "scores" && match && (
        <Modal title="The circle’s standings." onClose={() => setModal(null)}>
          <p className="modal-description">
            {state.phase === "final"
              ? "Final scores"
              : `Round ${match.round.number} of ${match.settings.rounds}`}{" "}
            · Catch the imposter: +1 each. Escape: +2.
          </p>
          {state.phase === "guess" && (
            <p className="modal-description">
              This round’s points are pending until the last chance ends.
            </p>
          )}
          <Scoreboard players={match.players} />
        </Modal>
      )}
      {modal === "history" && (
        <Modal title="This local party’s history." onClose={() => setModal(null)}>
          <p className="modal-description">
            Saved only in this browser: up to 20 completed games, final scores,
            and rules. Current-game points stay separate. New game keeps these
            totals; changing the roster or ending the local party clears them.
          </p>
          <HistoryPanel history={gameHistory} />
        </Modal>
      )}
      {modal === "end" && (
        <Modal title="End this local party?" onClose={() => setModal(null)}>
          <p className="modal-description">
            This clears the current game, completed-game history, and party
            totals on this device. Your editable names, setup preferences, and
            recent words stay. Unfinished games are never counted.
          </p>
          <div className="modal-actions">
            <button className="secondary-button" onClick={() => setModal(null)}>
              Keep this party
            </button>
            <button className="danger-button" onClick={() => {
              setModal(null);
              dispatch({ type: "END_PARTY" });
            }}>
              End local party
            </button>
          </div>
        </Modal>
      )}
      {modal === "reset" && (
        <Modal title="New game, same players?" onClose={() => setModal(null)}>
          <p className="modal-description">
            This ends the current game and resets its scores, roles, and votes.
            Completed games and party totals stay, along with names, settings,
            and recent words. Unfinished games are not counted. You’ll return
            to setup before starting round 1.
          </p>
          <div className="modal-actions">
            <button className="secondary-button" onClick={() => setModal(null)}>
              Keep playing
            </button>
            <button
              className="danger-button"
              onClick={() => {
                setModal(null);
                dispatch({ type: "RESET" });
              }}
            >
              <RotateCcw size={16} /> New game
            </button>
          </div>
        </Modal>
      )}
      {modal === "switch" && (
        <Modal title="Switch to Own Phones?" onClose={() => setModal(null)}>
          <p className="modal-description">
            Switching ends this shared-phone game and clears its current scores.
            Completed games, party totals, saved names, setup, and recent words
            stay on this device. Everyone can then join Own Phones separately.
          </p>
          <div className="modal-actions">
            <button className="secondary-button" onClick={() => setModal(null)}>
              Keep playing
            </button>
            <button className="danger-button" onClick={onParty}>
              Switch to Own Phones
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

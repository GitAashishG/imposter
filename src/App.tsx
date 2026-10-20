import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CircleHelp,
  RotateCcw,
  ShieldCheck,
  Trophy,
} from "lucide-react";
import Setup, { loadPreferences, savePreferences } from "./Setup";
import type { Preferences } from "./Setup";
import { Eyes, Modal, Rules, Scoreboard } from "./components";
import {
  Ballot,
  ClueTurn,
  Discussion,
  FinalResult,
  Handoff,
  RoleReveal,
  RoundProgress,
  RoundResult,
} from "./GameScreen";
import { useGame } from "./useGame";

export default function App() {
  const [state, dispatch] = useGame();
  const [preferences, setPreferences] = useState(loadPreferences);
  const [modal, setModal] = useState<"rules" | "scores" | "reset" | null>(null);
  const playing = state.phase !== "setup";
  const match = "match" in state ? state.match : null;

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

  function showModal(value: "rules" | "scores" | "reset") {
    dispatch({ type: "HIDE" });
    setModal(value);
  }

  function start(value: Preferences) {
    setPreferences(value);
    savePreferences(value);
    dispatch({ type: "START", names: value.names, settings: value.settings });
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
          {!playing && (
            <span className="header-label">A GAME FOR YOUR PEOPLE</span>
          )}
        </div>
      </header>

      {state.phase === "setup" ? (
        <Setup initial={preferences} onStart={start} />
      ) : (
        <main className="game-layout">
          <div className="game-topbar">
            <button className="text-button" onClick={() => showModal("reset")}>
              <ArrowLeft size={15} /> New game
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
              onAgain={() => dispatch({ type: "RESET" })}
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
          <Scoreboard players={match.players} />
        </Modal>
      )}
      {modal === "reset" && (
        <Modal title="Start a fresh game?" onClose={() => setModal(null)}>
          <p className="modal-description">
            This ends the current game and clears its scores. Your names and
            setup will stay.
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
              <RotateCcw size={16} /> Start fresh
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

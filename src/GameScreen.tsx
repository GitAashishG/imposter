import { useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  Fingerprint,
  LockKeyhole,
  MessageCircle,
  Pause,
  Play,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
  Vote,
} from "lucide-react";
import { Eyes, PrimaryButton, Scoreboard } from "./components";
import type { Outcome, Player } from "./game";
import { rankPlayers } from "./game";
import type { Match } from "./useGame";

export function RoundProgress({
  phase,
  round,
  total,
}: {
  phase: string;
  round: number;
  total: number;
}) {
  const steps = [
    { label: "Secret roles", icon: Eye, phases: ["role"] },
    { label: "Clue time", icon: MessageCircle, phases: ["clue", "discussion"] },
    { label: "The vote", icon: Vote, phases: ["vote"] },
    { label: "The reveal", icon: Sparkles, phases: ["result"] },
  ];
  const current = steps.findIndex((step) => step.phases.includes(phase));
  return (
    <div className="round-progress">
      <div className="round-label">
        <span className="live-dot" /> ROUND {String(round).padStart(2, "0")}{" "}
        <span>/ {String(total).padStart(2, "0")}</span>
      </div>
      <ol>
        {steps.map((step, index) => (
          <li
            key={step.label}
            className={`${index === current ? "active" : ""} ${index < current ? "complete" : ""}`}
            aria-current={index === current ? "step" : undefined}
          >
            <step.icon size={16} />
            <span>{step.label}</span>
            {index < current && <Check size={12} />}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Handoff({
  player,
  index,
  count,
  voting,
  onReveal,
}: {
  player: Player;
  index: number;
  count: number;
  voting?: boolean;
  onReveal: () => void;
}) {
  return (
    <section className="play-card handoff-card">
      <span className="eyebrow muted">
        {voting ? "PRIVATE VOTE" : "FOR YOUR EYES ONLY"} · {index + 1} OF{" "}
        {count}
      </span>
      <div className="handoff-icon">
        <Fingerprint size={46} strokeWidth={1.2} />
        <span>
          <LockKeyhole size={15} />
        </span>
      </div>
      <h1 tabIndex={-1}>
        Pass the phone to
        <br />
        <span className="serif-italic accent-text">{player.name}.</span>
      </h1>
      <p className="play-description">
        {voting
          ? "Keep your pick to yourself. Everyone else, look away."
          : "Make a little space. No peeking over shoulders."}
      </p>
      <div className="privacy-strip">
        <EyeOff size={16} /> Nothing secret is visible yet.
      </div>
      <PrimaryButton onClick={onReveal}>
        I’m {player.name} — {voting ? "vote" : "reveal"}
      </PrimaryButton>
      <p className="card-footnote">Only tap when the phone is in your hands.</p>
    </section>
  );
}

export function RoleReveal({
  match,
  index,
  onNext,
}: {
  match: Match;
  index: number;
  onNext: () => void;
}) {
  const player = match.players[index];
  const imposter = player.id === match.round.imposterId;
  return (
    <section
      className={`play-card reveal-card ${imposter ? "is-imposter" : ""}`}
    >
      <span className="eyebrow">
        {player.name.toUpperCase()}, THIS IS YOUR SECRET
      </span>
      <div className="role-symbol">
        {imposter ? <Eyes /> : <ShieldCheck size={48} strokeWidth={1.3} />}
      </div>
      <h1 tabIndex={-1}>
        {imposter ? "You’re the imposter." : "You’re in the know."}
      </h1>
      {imposter ? (
        <>
          <p className="secret-nepali" lang="ne">
            थाहा नभए पनि थाहा भएजस्तै गर!
          </p>
          <p className="play-description">
            You don’t get a word. Listen to the clues,
            <br />
            blend into the circle, and don’t get caught.
          </p>
        </>
      ) : (
        <>
          <div className="secret-word">
            <span>THE SECRET WORD</span>
            <strong>{match.round.word.english}</strong>
            <span className="secret-nepali" lang="ne">
              {match.round.word.nepali}
            </span>
          </div>
          <p className="play-description">
            Remember it. Your clue should hint at the word,
            <br />
            not give it away. Either language works.
          </p>
        </>
      )}
      <PrimaryButton onClick={onNext}>Got it — hide my role</PrimaryButton>
      <p className="card-footnote">
        <LockKeyhole size={12} /> Your role also hides if you leave this tab.
      </p>
    </section>
  );
}

export function ClueTurn({
  match,
  index,
  onNext,
}: {
  match: Match;
  index: number;
  onNext: () => void;
}) {
  const ordered = match.round.clueOrder.map((id) =>
    match.players.find((player) => player.id === id)!,
  );
  return (
    <section className="play-card clue-card">
      <span className="eyebrow muted">
        CLUE {index + 1} OF {ordered.length} · SAY IT OUT LOUD
      </span>
      <div className="screen-icon">
        <MessageCircle size={32} strokeWidth={1.4} />
      </div>
      <h1 tabIndex={-1}>
        {ordered[index].name},<br />
        <span className="serif-italic">what’s your clue?</span>
      </h1>
      <p className="play-description">
        One short clue. English or Nepali.
        <br />
        Don’t say the word, spell it, or translate it.
      </p>
      <ol className="clue-order" aria-label="Clue order">
        {ordered.map((player, i) => (
          <li
            key={player.id}
            className={i === index ? "current" : i < index ? "finished" : ""}
            aria-current={i === index ? "step" : undefined}
          >
            {i < index ? <Check size={12} /> : <span>{i + 1}</span>}
            {player.name}
          </li>
        ))}
      </ol>
      <PrimaryButton onClick={onNext}>
        {index + 1 === ordered.length
          ? "All clues in — let’s discuss"
          : "Clue given — next player"}
      </PrimaryButton>
      <p className="card-footnote">
        No typing needed. The best clues happen around the table.
      </p>
    </section>
  );
}

export function Discussion({
  seconds,
  onVote,
}: {
  seconds: number;
  onVote: () => void;
}) {
  const [remainingMs, setRemainingMs] = useState(seconds * 1000);
  const [deadline, setDeadline] = useState<number | null>(
    () => Date.now() + seconds * 1000,
  );
  useEffect(() => {
    if (deadline === null) return;
    const update = () => {
      const remaining = Math.max(0, deadline - Date.now());
      setRemainingMs(remaining);
      if (!remaining) setDeadline(null);
    };
    update();
    const interval = window.setInterval(update, 200);
    return () => window.clearInterval(interval);
  }, [deadline]);
  const remaining = Math.ceil(remainingMs / 1000);
  const toggle = () => {
    if (deadline === null) setDeadline(Date.now() + remainingMs);
    else {
      setRemainingMs(Math.max(0, deadline - Date.now()));
      setDeadline(null);
    }
  };
  return (
    <section className="play-card discussion-card">
      <span className="eyebrow muted">THE PLOT THICKENS</span>
      <h1 tabIndex={-1}>
        A little suspicious,
        <br />
        <span className="serif-italic">aren’t we?</span>
      </h1>
      <p className="play-description">
        Who was a little too vague? A little too confident?
        <br />
        Make your case. Keep the word a secret.
      </p>
      <div
        className={`timer ${!remaining ? "timer-done" : ""}`}
        style={
          {
            "--progress": `${(remainingMs / (seconds * 1000)) * 100}%`,
          } as React.CSSProperties
        }
      >
        <span role="timer" aria-label={`${remaining} seconds remaining`}>
          {Math.floor(remaining / 60)
            .toString()
            .padStart(2, "0")}
          <span>:</span>
          {(remaining % 60).toString().padStart(2, "0")}
        </span>
        <small>
          {!remaining
            ? "TIME TO MAKE YOUR PICK"
            : deadline === null
              ? "TAKE YOUR TIME · PAUSED"
              : "LET THE DEBATE BEGIN"}
        </small>
      </div>
      {remaining > 0 ? (
        <button className="text-button pause-button" onClick={toggle}>
          {deadline === null ? <Play size={15} /> : <Pause size={15} />}
          {deadline === null ? "Resume timer" : "Pause timer"}
        </button>
      ) : (
        <p className="time-up" role="status">
          Time’s up. Ready to put a name to that hunch?
        </p>
      )}
      <PrimaryButton onClick={onVote}>Ready? Let’s vote</PrimaryButton>
      <p className="card-footnote">
        You can finish the discussion early. Votes stay private.
      </p>
    </section>
  );
}

export function Ballot({
  players,
  voter,
  onVote,
}: {
  players: Player[];
  voter: Player;
  onVote: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <section className="play-card ballot-card">
      <span className="eyebrow muted">
        {voter.name.toUpperCase()}’S PRIVATE BALLOT
      </span>
      <div className="screen-icon">
        <Vote size={32} strokeWidth={1.4} />
      </div>
      <h1 tabIndex={-1}>
        Who’s <span className="serif-italic">bluffing?</span>
      </h1>
      <p className="play-description">
        Go with your gut. Choose one suspect.
        <br />
        Once locked in, your vote can’t be changed.
      </p>
      <div
        className="ballot-options"
        role="group"
        aria-label="Choose a suspect"
      >
        {players
          .filter((player) => player.id !== voter.id)
          .map((player) => (
            <button
              key={player.id}
              className={selected === player.id ? "selected" : ""}
              aria-pressed={selected === player.id}
              onClick={() => setSelected(player.id)}
            >
              <span className="avatar">
                {player.name.slice(0, 1).toUpperCase()}
              </span>
              {player.name}
              <span className="ballot-check">
                {selected === player.id ? <Check size={15} /> : null}
              </span>
            </button>
          ))}
      </div>
      <PrimaryButton
        disabled={!selected}
        onClick={() => {
          if (selected) onVote(selected);
        }}
      >
        Lock in my vote
      </PrimaryButton>
      <p className="card-footnote">
        <LockKeyhole size={12} /> Your individual vote won’t be shown.
      </p>
    </section>
  );
}

export function RoundResult({
  match,
  outcome,
  onContinue,
}: {
  match: Match;
  outcome: Outcome;
  onContinue: () => void;
}) {
  const imposter = match.players.find(
    (player) => player.id === match.round.imposterId,
  )!;
  const accused = match.players.find(
    (player) => player.id === outcome.accusedId,
  );
  return (
    <section className="play-card result-card">
      <span className="eyebrow muted">
        ROUND {match.round.number} · THE TRUTH COMES OUT
      </span>
      <div className={`result-icon ${outcome.caught ? "caught" : ""}`}>
        {outcome.caught ? (
          <CheckCircle2 size={40} strokeWidth={1.4} />
        ) : (
          <Eyes />
        )}
      </div>
      <h1 tabIndex={-1}>
        {outcome.caught ? "Caught in the act." : "The imposter got away."}
      </h1>
      <p className="play-description">
        <strong>{imposter.name}</strong> was the imposter.
        <br />
        {outcome.tied
          ? "The vote was tied. No one was accused."
          : outcome.caught
            ? "The circle saw right through the bluff."
            : `The circle accused ${accused?.name} instead.`}
      </p>
      <div className="word-recap">
        <span>THE SECRET WORD WAS</span>
        <strong>{match.round.word.english}</strong>
        <span lang="ne">{match.round.word.nepali}</span>
      </div>
      <div className="vote-tally">
        <h2>The vote count</h2>
        {match.players.map((player) => (
          <div key={player.id}>
            <span>
              {player.name}
              {player.id === imposter.id && <small>IMPOSTER</small>}
            </span>
            <div className="tally-track">
              <i
                style={{
                  width: `${((outcome.voteCounts[player.id] ?? 0) / match.players.length) * 100}%`,
                }}
              />
            </div>
            <strong>{outcome.voteCounts[player.id] ?? 0}</strong>
          </div>
        ))}
      </div>
      <div className="round-award">
        {outcome.caught ? <ShieldCheck size={16} /> : <Sparkles size={16} />}
        {outcome.caught
          ? "Good instincts. +1 point to everyone except the imposter."
          : `A successful bluff. +2 points to ${imposter.name}.`}
      </div>
      <h2 className="scoreboard-heading">The standings</h2>
      <Scoreboard players={match.players} awards={outcome.awards} />
      <PrimaryButton onClick={onContinue}>
        {match.round.number === match.settings.rounds
          ? "See the final results"
          : `On to round ${match.round.number + 1}`}
      </PrimaryButton>
    </section>
  );
}

export function FinalResult({
  match,
  onAgain,
}: {
  match: Match;
  onAgain: () => void;
}) {
  const ranked = rankPlayers(match.players);
  const winners = ranked.filter((player) => player.score === ranked[0].score);
  return (
    <section className="play-card final-card">
      <span className="eyebrow muted">
        {match.settings.rounds} ROUNDS. PLENTY OF SIDE-EYE.
      </span>
      <div className="winner-icon">
        <Trophy size={43} strokeWidth={1.3} />
      </div>
      <h1 tabIndex={-1}>
        {winners.length > 1 ? (
          "Great minds. Shared glory."
        ) : (
          <>
            The circle has
            <br />a <span className="serif-italic">champion.</span>
          </>
        )}
      </h1>
      <p className="play-description">
        {winners.map((player) => player.name).join(" & ")}{" "}
        {winners.length > 1 ? "share the win" : "takes the win"} with{" "}
        <strong>{ranked[0].score} points.</strong>
        <br />
        <span lang="ne">एक राउन्ड अझै?</span> There’s always room for one more
        game.
      </p>
      <Scoreboard players={match.players} final />
      <PrimaryButton onClick={onAgain}>
        Same people, fresh suspicions
      </PrimaryButton>
      <p className="card-footnote">
        <Users size={13} /> Your player list stays. Scores start fresh.
      </p>
    </section>
  );
}

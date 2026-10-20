import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { ArrowRight, ShieldCheck, Trophy, X } from "lucide-react";
import { rankPlayers } from "./game";
import type { Player } from "./game";

export function Eyes({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`eyes ${className}`}
      viewBox="0 0 110 80"
      fill="none"
      aria-hidden="true"
    >
      <ellipse
        cx="39"
        cy="43"
        rx="22"
        ry="29"
        transform="rotate(-12 39 43)"
        fill="currentColor"
      />
      <ellipse
        cx="80"
        cy="35"
        rx="22"
        ry="29"
        transform="rotate(10 80 35)"
        fill="currentColor"
      />
      <ellipse cx="47" cy="44" rx="8" ry="12" fill="var(--ink)" />
      <ellipse cx="88" cy="36" rx="8" ry="12" fill="var(--ink)" />
    </svg>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled = false,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      className="primary-button"
      type={type}
      onClick={onClick}
      disabled={disabled}
    >
      <span>{children}</span>
      <ArrowRight size={19} aria-hidden="true" />
    </button>
  );
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="modal-title"
      onCancel={onClose}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-header">
        <h2 id="modal-title">{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function Rules() {
  return (
    <div className="rules-content">
      <p>
        One secret word. One person who doesn’t know it. Everyone acts like they
        belong.
      </p>
      <ol className="rules-list">
        <li>
          <span>01</span>
          <div>
            <strong>Take a private peek</strong>
            <p>
              Pass the phone around. Everyone gets the same English + Nepali
              word, except the imposter, who sees no word or category.
            </p>
          </div>
        </li>
        <li>
          <span>02</span>
          <div>
            <strong>Give one clue each</strong>
            <p>
              Say a short clue out loud on your turn. Don’t say or translate the
              secret word. Imposter? Listen, blend in, and bluff.
            </p>
          </div>
        </li>
        <li>
          <span>03</span>
          <div>
            <strong>Talk it out, then vote</strong>
            <p>
              Discuss who sounds suspicious. Pass the phone again to vote
              privately. You can’t vote for yourself.
            </p>
          </div>
        </li>
        <li>
          <span>04</span>
          <div>
            <strong>Reveal. Score. Repeat.</strong>
            <p>
              The player with the most votes is accused. Catch the imposter:
              everyone else gets 1 point. A wrong accusation or tied vote: the
              imposter gets 2 points. Highest total wins; shared wins count.
            </p>
          </div>
        </li>
      </ol>
      <div className="notice">
        <ShieldCheck size={19} />
        <p>
          No accounts, no uploads. Only your player names and setup are saved on
          this device. Refreshing ends the current game.
        </p>
      </div>
    </div>
  );
}

export function Scoreboard({
  players,
  awards,
  final = false,
}: {
  players: Player[];
  awards?: Record<string, number>;
  final?: boolean;
}) {
  const ranked = rankPlayers(players);
  return (
    <ol
      className="scoreboard"
      aria-label={final ? "Final standings" : "Scoreboard"}
    >
      {ranked.map((player) => {
        const rank = ranked.findIndex((p) => p.score === player.score) + 1;
        return (
          <li
            key={player.id}
            className={final && rank === 1 ? "winner-row" : ""}
          >
            <span className="rank">
              {final && rank === 1 ? (
                <Trophy size={18} />
              ) : (
                String(rank).padStart(2, "0")
              )}
            </span>
            <span className="score-name">
              {player.name}
              {final && rank === 1 && (
                <small>
                  {ranked.filter((p) => p.score === player.score).length > 1
                    ? "Joint winner"
                    : "Winner"}
                </small>
              )}
            </span>
            {!!awards?.[player.id] && (
              <span className="points-gained">+{awards[player.id]}</span>
            )}
            <strong aria-label={`${player.score} points`}>
              {player.score}
              <small>pts</small>
            </strong>
          </li>
        );
      })}
    </ol>
  );
}

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  LockKeyhole,
  Pause,
  Play,
  ShieldCheck,
  Trophy,
  UserRound,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Eyes, PrimaryButton, Scoreboard } from "../components";
import { PACKS } from "../data";
import type { Settings } from "../game";
import { rankPlayers } from "../game";
import { SUGGESTED_PLAYER_NAMES } from "../playerNames";
import type {
  PartyAction,
  PartyPlayer,
  PartyPublicInfo,
  PartySnapshot,
  PrivateRole,
} from "./protocol";

export const DEFAULT_PARTY_SETTINGS: Settings = {
  packIds: PACKS.map((pack) => pack.id),
  rounds: 5,
  discussionSeconds: 60,
};

type RoundProps = {
  snapshot: PartySnapshot;
  safe: boolean;
  onAction: (action: PartyAction) => void;
};

export function PartySettings({
  settings,
  disabled,
  onChange,
}: {
  settings: Settings;
  disabled: boolean;
  onChange: (settings: Settings) => void;
}) {
  return (
    <fieldset className="party-settings" disabled={disabled}>
      <legend>Make it your kind of game.</legend>
      <p className="party-help">
        Choose at least one word pack. No sample words, no spoilers.
      </p>
      <div className="party-packs">
        {PACKS.map((pack) => {
          const selected = settings.packIds.includes(pack.id);
          return (
            <button
              key={pack.id}
              type="button"
              aria-pressed={selected}
              disabled={disabled || (selected && settings.packIds.length === 1)}
              className={`party-pack ${selected ? "is-selected" : ""}`}
              onClick={() =>
                onChange({
                  ...settings,
                  packIds: selected
                    ? settings.packIds.filter((id) => id !== pack.id)
                    : [...settings.packIds, pack.id],
                })
              }
            >
              <span className="party-pack-name">
                {pack.name}
                <span aria-hidden="true">
                  {selected ? <Check size={16} /> : "+"}
                </span>
              </span>
              <span lang="ne">{pack.nepali}</span>
              <small>{pack.description}</small>
            </button>
          );
        })}
      </div>
      <div className="party-setting-options">
        <label>
          Rounds
          <select
            value={settings.rounds}
            onChange={(event) =>
              onChange({ ...settings, rounds: Number(event.target.value) })
            }
          >
            {[3, 5, 7].map((rounds) => (
              <option key={rounds} value={rounds}>
                {rounds} rounds
              </option>
            ))}
          </select>
        </label>
        <label>
          Discussion time
          <select
            value={settings.discussionSeconds}
            onChange={(event) =>
              onChange({
                ...settings,
                discussionSeconds: Number(event.target.value),
              })
            }
          >
            {[30, 60, 90, 120].map((seconds) => (
              <option key={seconds} value={seconds}>
                {seconds} seconds
              </option>
            ))}
          </select>
        </label>
      </div>
    </fieldset>
  );
}

export function PartyEntry({
  publicParty,
  disabled,
  busy,
  checking,
  onCreate,
  onJoin,
  onRefresh,
}: {
  publicParty: PartyPublicInfo | null;
  disabled: boolean;
  busy: boolean;
  checking: boolean;
  onCreate: (name: string, pin: string, settings: Settings) => Promise<void>;
  onJoin: (name: string, pin: string) => Promise<void>;
  onRefresh: () => void;
}) {
  const [mode, setMode] = useState<"join" | "create">("join");
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [settings, setSettings] = useState<Settings>(DEFAULT_PARTY_SETTINGS);
  const [validation, setValidation] = useState<string | null>(null);
  const [choice, setChoice] = useState(false);
  const creating =
    (choice ? mode : publicParty?.exists === false ? "create" : "join") ===
    "create";
  const activeMatch = !!publicParty?.exists && publicParty.phase !== "lobby";
  const unavailable = creating
    ? !!publicParty?.exists
    : publicParty?.exists === false ||
      activeMatch ||
      (publicParty?.playerCount ?? 0) >= 12;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || unavailable) return;
    if (!name.trim() || name.trim().length > 24) {
      setValidation("Choose a name between 1 and 24 characters.");
      return;
    }
    if (!/^[0-9]{6}$/.test(pin)) {
      setValidation("The party PIN must be exactly 6 digits.");
      return;
    }
    setValidation(null);
    if (creating) await onCreate(name.trim(), pin, settings);
    else await onJoin(name.trim(), pin);
    setPin("");
  }

  return (
    <div className="party-entry-layout">
      <section className="party-intro" aria-labelledby="party-intro-title">
        <span className="eyebrow">
          <span className="status-dot" /> SAME ROOM. YOUR OWN PHONE.
        </span>
        <h1 id="party-intro-title">
          Your people.
          <br />
          Your <span className="serif-italic">poker face.</span>
        </h1>
        <p>
          One secret word. One clueless imposter.
          <br />
          Keep your role on your phone. Bring the bluff to the room.
        </p>
        <div className="party-intro-art" aria-hidden="true">
          <Eyes />
          <span>
            act natural.
            <br />
            <span lang="ne">को हो?</span>
          </span>
        </div>
        <div className="party-facts">
          <span>
            <Users size={17} /> 3–12 people
          </span>
          <span>
            <ShieldCheck size={17} /> No accounts
          </span>
        </div>
        <p className="party-help">
          Gather in person. The host plays too. Clues and discussion happen out
          loud, not in a chat.
        </p>
      </section>
      <section
        className="party-card party-entry-card"
        aria-labelledby="party-entry-title"
        aria-busy={busy || checking}
      >
        <div
          className="party-mode-switch"
          role="group"
          aria-label="Enter a party"
        >
          <button
            type="button"
            aria-pressed={!creating}
            disabled={busy}
            onClick={() => {
              setChoice(true);
              setMode("join");
              setValidation(null);
            }}
          >
            Join the party
          </button>
          <button
            type="button"
            aria-pressed={creating}
            disabled={busy}
            onClick={() => {
              setChoice(true);
              setMode("create");
              setValidation(null);
            }}
          >
            Be the host
          </button>
        </div>
        <h2 id="party-entry-title">
          {creating ? "Get the circle together." : "You’re on the guest list."}
        </h2>
        <p className="party-help">
          {creating
            ? "Choose your name and a private 6-digit PIN to share in person."
            : "Ask your host for the PIN. Pick a name the room will recognize."}
        </p>
        <div className="party-availability" role="status">
          {checking
            ? "Checking the party…"
            : !publicParty
              ? "Party availability could not be checked. Refresh to try again."
              : publicParty.exists
                ? activeMatch
                  ? "A match is in progress. New players can join when the host returns to the lobby."
                  : `${publicParty.playerCount ?? 0}/12 people in the lobby. ${creating ? "There’s already a party. Join it, or ask its host to end it first." : (publicParty.playerCount ?? 0) >= 12 ? "The circle is full. Ask the host to make room, then refresh." : "The circle is gathering."}`
                : "No party is live. Be the host and start one."}
          <button
            className="party-link"
            type="button"
            disabled={disabled}
            onClick={onRefresh}
          >
            Refresh availability
          </button>
        </div>
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <label className="party-field" htmlFor="party-name">
            Your name
            <input
              id="party-name"
              placeholder={`e.g. ${SUGGESTED_PLAYER_NAMES[0]}`}
              list="party-name-suggestions"
              value={name}
              autoComplete="nickname"
              maxLength={24}
              required
              disabled={disabled}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <datalist id="party-name-suggestions">
            {SUGGESTED_PLAYER_NAMES.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <label className="party-field" htmlFor="party-pin">
            {creating ? "Choose a party PIN" : "Party PIN"}
            <input
              id="party-pin"
              className="party-pin-input"
              value={pin}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              required
              disabled={disabled}
              aria-describedby="party-pin-help"
              onChange={(event) =>
                setPin(event.target.value.replace(/[^0-9]/g, ""))
              }
            />
          </label>
          <p id="party-pin-help" className="party-help">
            Exactly 6 digits.{" "}
            {creating
              ? "Share it only with your group. You’ll be the host and a player."
              : "No sign-up. Your role and vote stay private."}
          </p>
          {creating && (
            <PartySettings
              settings={settings}
              disabled={disabled}
              onChange={setSettings}
            />
          )}
          {validation && (
            <p className="party-form-error" role="alert">
              {validation}
            </p>
          )}
          <PrimaryButton
            type="submit"
            disabled={
              disabled || unavailable || !name.trim() || pin.length !== 6
            }
          >
            {busy
              ? "Getting you in…"
              : creating
                ? "Create the party"
                : "Join the circle"}
          </PrimaryButton>
        </form>
        <p className="party-footnote">
          This browser saves a device token to restore your seat on refresh.
          Don’t clear site storage. The PIN and token never go in the URL.
        </p>
      </section>
    </div>
  );
}

export function PartyRoster({
  snapshot,
  onRemove,
  disabled = false,
}: {
  snapshot: PartySnapshot;
  onRemove?: (player: PartyPlayer) => void;
  disabled?: boolean;
}) {
  return (
    <ul className="party-roster" aria-label="Party players">
      {snapshot.players.map((player) => (
        <li key={player.id}>
          <span className="party-avatar" aria-hidden="true">
            {player.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="party-player-name">
            <strong>{player.name}</strong>
            <small>
              {player.id === snapshot.selfId ? "You" : "Player"}
              {player.id === snapshot.hostId ? " · Host" : ""}
            </small>
          </span>
          <span
            className={`party-presence ${player.connected ? "" : "is-offline"}`}
          >
            {player.connected ? <Wifi size={13} /> : <WifiOff size={13} />}
            <span>{player.connected ? "Here" : "Offline"}</span>
          </span>
          {onRemove && player.id !== snapshot.selfId && (
            <button
              type="button"
              className="party-remove"
              disabled={disabled}
              onClick={() => onRemove(player)}
              aria-label={`Remove ${player.name}`}
            >
              Remove
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function PartyLobby({
  snapshot,
  safe,
  onAction,
  onRemove,
}: RoundProps & { onRemove: (player: PartyPlayer) => void }) {
  const host = snapshot.selfId === snapshot.hostId;
  const [showPin, setShowPin] = useState(false);
  useEffect(() => {
    const hide = () => setShowPin(false);
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("blur", hide);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  const everyoneConnected = snapshot.players.every(
    (player) => player.connected,
  );
  return (
    <div className="party-lobby-layout">
      <section className="party-card" aria-labelledby="party-lobby-title">
        <span className="eyebrow muted">THE CIRCLE IS GATHERING</span>
        <h1 id="party-lobby-title">
          Good company.
          <br />
          <span className="serif-italic">Questionable alibis.</span>
        </h1>
        <p className="party-copy">
          {host
            ? "You’re hosting — and you’re playing. Ask everyone to open Ko Ho?, choose Own phones, and join with their name and your PIN."
            : "You’re in. Keep your own phone nearby while the host gathers the circle and picks the settings."}
        </p>
        {host && snapshot.pin && (
          <div className="party-invite">
            <div>
              <span className="eyebrow">YOUR PARTY PIN</span>
              <strong className="party-pin-display">
                {showPin ? snapshot.pin : "••••••"}
              </strong>
            </div>
            <button
              type="button"
              className="party-button"
              aria-pressed={showPin}
              onClick={() => setShowPin(!showPin)}
            >
              {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
              {showPin ? "Hide PIN" : "Show PIN"}
            </button>
            <p>Share in person, not in a public link.</p>
          </div>
        )}
        <div className="party-section-heading">
          <h2>The guest list</h2>
          <span>{snapshot.players.length}/12 players</span>
        </div>
        <PartyRoster
          snapshot={snapshot}
          disabled={!safe}
          onRemove={host ? onRemove : undefined}
        />
        <div className="party-callout">
          <ShieldCheck size={19} />
          <p>
            Every player gets only their own role — even the host. Clues and
            discussion happen out loud.
          </p>
        </div>
      </section>
      <section className="party-card" aria-labelledby="party-settings-title">
        <span className="eyebrow muted">
          A LITTLE NEPALI. A LITTLE SIDE-EYE.
        </span>
        <h2 id="party-settings-title">
          {host ? "Set the mood." : "Here’s the plan."}
        </h2>
        <p className="party-help">
          {host
            ? "Settings save to everyone’s phone as you choose them."
            : "The host chooses settings and starts the match."}
        </p>
        <PartySettings
          settings={snapshot.settings}
          disabled={!host || !safe}
          onChange={(settings) => onAction({ type: "settings", settings })}
        />
        {host ? (
          <>
            <PrimaryButton
              disabled={
                !safe || snapshot.players.length < 3 || !everyoneConnected
              }
              onClick={() => onAction({ type: "start" })}
            >
              Start the match <span lang="ne">— खेलौँ!</span>
            </PrimaryButton>
            <p className="party-footnote" role="status">
              {snapshot.players.length < 3
                ? `Need ${3 - snapshot.players.length} more ${snapshot.players.length === 2 ? "player" : "players"} to start.`
                : !everyoneConnected
                  ? "Waiting for everyone to reconnect before starting."
                  : "Everyone’s here. One imposter. Let’s play."}
            </p>
          </>
        ) : (
          <p className="party-wait" role="status">
            Waiting for the host to start the match…
          </p>
        )}
      </section>
    </div>
  );
}

export function PrivateRoleCard({
  role,
  revealed,
  disabled,
  onReveal,
  onHide,
  compact = false,
}: {
  role: PrivateRole;
  revealed: boolean;
  disabled: boolean;
  onReveal: () => void;
  onHide: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`party-private ${compact ? "party-private-compact" : ""} ${revealed ? "is-revealed" : ""}`}
    >
      {!revealed ? (
        <>
          <LockKeyhole size={compact ? 22 : 32} aria-hidden="true" />
          <h2>Your role is tucked away.</h2>
          <p>Check that no one’s looking at your screen.</p>
          <button
            className="party-button"
            type="button"
            disabled={disabled}
            onClick={onReveal}
          >
            <Eye size={17} />
            Reveal my role
          </button>
        </>
      ) : (
        <>
          <span className="eyebrow">FOR YOUR EYES ONLY</span>
          {role.isImposter ? (
            <>
              <Eyes />
              <h2>You’re the imposter.</h2>
              <p>No word. No category. Listen, blend in, and bluff.</p>
            </>
          ) : (
            <>
              <span className="party-secret-label">YOUR SECRET WORD</span>
              <strong className="party-secret-word">{role.word.english}</strong>
              <span className="party-secret-nepali" lang="ne">
                {role.word.nepali}
              </span>
              <p>Give a clue, not the word or its translation.</p>
            </>
          )}
          <button className="party-button" type="button" onClick={onHide}>
            <EyeOff size={17} />
            Hide my role
          </button>
        </>
      )}
      <small>
        Automatically hides when you leave this tab, switch apps, or open a
        dialog.
      </small>
    </div>
  );
}

export function PartyReady({
  snapshot,
  safe,
  onAction,
  onHide,
  seen,
}: RoundProps & { onHide: () => void; seen: boolean }) {
  const self = snapshot.players.find((player) => player.id === snapshot.selfId);
  const host = snapshot.selfId === snapshot.hostId;
  const ready = snapshot.players.filter((player) => player.ready).length;
  return (
    <div className="party-ready">
      <p className="party-help">
        {seen || self?.ready
          ? "Remember your role, then hide it and tell the circle you’re ready."
          : "Reveal your role first, then hide it and tell the circle you’re ready."}
      </p>
      {!self?.ready ? (
        <PrimaryButton
          disabled={!safe || !seen}
          onClick={() => {
            onHide();
            onAction({ type: "ready", roundNumber: snapshot.roundNumber });
          }}
        >
          Hide &amp; I’m ready
        </PrimaryButton>
      ) : (
        <p className="party-success">
          <CheckCircle2 size={18} />
          You’re ready. Keep a straight face.
        </p>
      )}
      <p className="party-wait" role="status">
        {ready}/{snapshot.players.length} ready
        {ready === snapshot.players.length
          ? ". The circle is set."
          : ". Waiting for the rest of the circle…"}
      </p>
      <ul className="party-ready-list" aria-label="Players ready">
        {snapshot.players.map((player) => (
          <li key={player.id}>
            <span>{player.name}</span>
            <span>
              {player.ready ? (
                <>
                  <Check size={14} />
                  Ready
                </>
              ) : (
                "Taking a peek"
              )}
            </span>
          </li>
        ))}
      </ul>
      {host ? (
        <PrimaryButton
          disabled={!safe || ready !== snapshot.players.length}
          onClick={() =>
            onAction({ type: "start-clues", roundNumber: snapshot.roundNumber })
          }
        >
          Start spoken clues
        </PrimaryButton>
      ) : (
        <p className="party-help">
          The host starts clues when everyone is ready.
        </p>
      )}
    </div>
  );
}

export function PartyClues({ snapshot, safe, onAction }: RoundProps) {
  const currentId = snapshot.clueOrder[snapshot.clueIndex];
  const current = snapshot.players.find((player) => player.id === currentId);
  const myTurn = currentId === snapshot.selfId;
  const mayAdvance = myTurn || snapshot.hostId === snapshot.selfId;
  return (
    <>
      <span className="eyebrow muted">
        CLUE {snapshot.clueIndex + 1} OF {snapshot.clueOrder.length}
      </span>
      <div className="party-turn-icon">
        <UserRound size={34} />
      </div>
      <h1>
        {myTurn ? "You’re up." : `${current?.name ?? "Your group"} is up.`}
      </h1>
      <p className="party-copy">
        {myTurn
          ? "Say one short clue out loud. Don’t say or translate the secret word. Imposter? Act like you belong."
          : "Listen to the clue. A little too vague? A little too confident? Remember it for the discussion."}
      </p>
      <ol className="party-clue-order" aria-label="Shuffled clue order">
        {snapshot.clueOrder.map((id, index) => (
          <li
            key={id}
            className={
              index === snapshot.clueIndex
                ? "is-current"
                : index < snapshot.clueIndex
                  ? "is-done"
                  : ""
            }
            aria-current={index === snapshot.clueIndex ? "step" : undefined}
          >
            <span>
              {index < snapshot.clueIndex ? (
                <Check size={15} />
              ) : (
                String(index + 1).padStart(2, "0")
              )}
            </span>
            <strong>
              {snapshot.players.find((player) => player.id === id)?.name}
              {id === snapshot.selfId ? " (you)" : ""}
            </strong>
            <small>
              {index < snapshot.clueIndex
                ? "Done"
                : index === snapshot.clueIndex
                  ? "Speaking"
                  : "Up next"}
            </small>
          </li>
        ))}
      </ol>
      {mayAdvance ? (
        <PrimaryButton
          disabled={!safe}
          onClick={() =>
            onAction({
              type: "next-clue",
              roundNumber: snapshot.roundNumber,
              clueIndex: snapshot.clueIndex,
            })
          }
        >
          {snapshot.clueIndex === snapshot.clueOrder.length - 1
            ? "Clue given — start discussion"
            : "Clue given — next person"}
        </PrimaryButton>
      ) : (
        <p className="party-wait" role="status">
          Waiting for {current?.name ?? "the speaker"} or the host to move the
          circle along…
        </p>
      )}
      <p className="party-footnote">
        Only the speaker or host can advance a turn.
      </p>
    </>
  );
}

function useDiscussionTime(snapshot: PartySnapshot) {
  const [clock, setClock] = useState({
    serverNow: snapshot.serverNow,
    elapsed: 0,
  });
  useEffect(() => {
    const started = performance.now();
    setClock({ serverNow: snapshot.serverNow, elapsed: 0 });
    const timer = window.setInterval(
      () =>
        setClock({
          serverNow: snapshot.serverNow,
          elapsed: performance.now() - started,
        }),
      200,
    );
    return () => window.clearInterval(timer);
  }, [snapshot.serverNow, snapshot.discussion.deadline]);
  const elapsed = clock.serverNow === snapshot.serverNow ? clock.elapsed : 0;
  const remaining =
    snapshot.discussion.deadline === null
      ? snapshot.discussion.remainingMs
      : snapshot.discussion.deadline - snapshot.serverNow - elapsed;
  return Math.max(0, Math.ceil(remaining / 1000));
}

export function PartyDiscussion({ snapshot, safe, onAction }: RoundProps) {
  const seconds = useDiscussionTime(snapshot);
  const host = snapshot.selfId === snapshot.hostId;
  const paused = snapshot.discussion.deadline === null;
  return (
    <>
      <span className="eyebrow muted">EVERYONE’S A LITTLE SUSPICIOUS</span>
      <h1>Talk it out.</h1>
      <p className="party-copy">
        Who sounded like they knew the word? Who was just borrowing everyone
        else’s confidence? Discuss out loud.
      </p>
      <div
        className={`party-timer ${seconds === 0 ? "is-finished" : ""}`}
        role="timer"
        aria-label={`${seconds} seconds remaining${paused ? ", paused" : ""}`}
      >
        <strong>
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </strong>
        <span>
          {seconds === 0
            ? "TIME’S UP — THE HOST STARTS THE VOTE"
            : paused
              ? "PAUSED BY THE HOST"
              : "TIME TO COMPARE YOUR SUSPICIONS"}
        </span>
      </div>
      <p className="party-help">
        {safe
          ? "One shared countdown, synchronized by the server."
          : "Last synced countdown. Reconnect to get the current time."}{" "}
        Voting never starts automatically.
      </p>
      {host ? (
        <div className="party-discussion-controls">
          <button
            className="party-button"
            type="button"
            disabled={!safe || seconds === 0}
            onClick={() =>
              onAction({
                type: paused ? "resume-timer" : "pause-timer",
                roundNumber: snapshot.roundNumber,
              })
            }
          >
            {paused ? <Play size={17} /> : <Pause size={17} />}
            {paused ? "Resume timer" : "Pause timer"}
          </button>
          <PrimaryButton
            disabled={!safe}
            onClick={() =>
              onAction({
                type: "start-vote",
                roundNumber: snapshot.roundNumber,
              })
            }
          >
            Start private voting
          </PrimaryButton>
        </div>
      ) : (
        <p className="party-wait" role="status">
          The host will open the private vote when the circle is ready.
        </p>
      )}
    </>
  );
}

export function PartyVote({ snapshot, safe, onAction }: RoundProps) {
  const [suspectId, setSuspectId] = useState<string | null>(null);
  const self = snapshot.players.find((player) => player.id === snapshot.selfId);
  const voted = snapshot.players.filter((player) => player.hasVoted).length;
  return (
    <>
      <span className="eyebrow muted">YOUR BALLOT. YOUR BUSINESS.</span>
      {self?.hasVoted ? (
        <>
          <div className="party-turn-icon">
            <LockKeyhole size={32} />
          </div>
          <h1>Your vote is locked.</h1>
          <p className="party-copy">
            No changing your mind now. Your choice stays private; only total
            vote counts are revealed after everyone votes.
          </p>
        </>
      ) : (
        <>
          <h1>Who’s the imposter?</h1>
          <p className="party-copy">
            Pick one suspect on your own phone. You can’t vote for yourself.
            Lock it in when you’re sure.
          </p>
          <div
            className="party-ballot"
            role="group"
            aria-label="Choose your suspect"
          >
            {snapshot.players
              .filter((player) => player.id !== snapshot.selfId)
              .map((player) => (
                <button
                  key={player.id}
                  type="button"
                  disabled={!safe}
                  className={suspectId === player.id ? "is-selected" : ""}
                  aria-pressed={suspectId === player.id}
                  onClick={() => setSuspectId(player.id)}
                >
                  <span className="party-avatar" aria-hidden="true">
                    {player.name.slice(0, 1).toUpperCase()}
                  </span>
                  <strong>{player.name}</strong>
                  <span className="party-ballot-check" aria-hidden="true">
                    {suspectId === player.id ? <Check size={17} /> : null}
                  </span>
                </button>
              ))}
          </div>
          <PrimaryButton
            disabled={!safe || !suspectId}
            onClick={() => {
              if (suspectId)
                onAction({
                  type: "vote",
                  roundNumber: snapshot.roundNumber,
                  suspectId,
                });
            }}
          >
            Lock my vote
          </PrimaryButton>
          <p className="party-footnote">
            Votes cannot be changed after they’re locked.
          </p>
        </>
      )}
      <p className="party-wait" role="status">
        {voted}/{snapshot.players.length} votes locked.{" "}
        {voted < snapshot.players.length
          ? "Waiting for everyone before the reveal…"
          : "Revealing the result…"}
      </p>
      <ul className="party-ready-list" aria-label="Voting progress">
        {snapshot.players.map((player) => (
          <li key={player.id}>
            <span>{player.name}</span>
            <span>
              {player.hasVoted ? (
                <>
                  <Check size={14} />
                  Voted
                </>
              ) : (
                "Still deciding"
              )}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function PartyResult({ snapshot, safe, onAction }: RoundProps) {
  const result = snapshot.result;
  if (!result)
    return (
      <p className="party-wait" role="status">
        Waiting for the confirmed round result…
      </p>
    );
  const { outcome, word } = result;
  const imposter = snapshot.players.find(
    (player) => player.id === result.imposterId,
  );
  const accused = snapshot.players.find(
    (player) => player.id === outcome.accusedId,
  );
  const host = snapshot.selfId === snapshot.hostId;
  return (
    <>
      <span className="eyebrow muted">
        ROUND {snapshot.roundNumber} · THE TRUTH COMES OUT
      </span>
      <div className="party-result-icon">
        {outcome.caught ? (
          <CheckCircle2 size={48} strokeWidth={1.4} />
        ) : (
          <Eyes />
        )}
      </div>
      <h1>
        {outcome.caught ? "Caught in the act." : "The imposter got away."}
      </h1>
      <p className="party-copy">
        <strong>{imposter?.name}</strong> was the imposter.
        <br />
        {outcome.tied
          ? "The vote was tied. No one was accused."
          : outcome.caught
            ? "The circle saw right through the bluff."
            : `The circle accused ${accused?.name} instead.`}
      </p>
      <div className="party-word-recap">
        <span className="eyebrow">THE SECRET WORD WAS</span>
        <strong>{word.english}</strong>
        <span lang="ne">{word.nepali}</span>
      </div>
      <section className="party-tally" aria-labelledby="party-tally-title">
        <h2 id="party-tally-title">The vote count</h2>
        {snapshot.players.map((player) => (
          <div key={player.id}>
            <span>
              {player.name}
              {player.id === result.imposterId && <small>IMPOSTER</small>}
            </span>
            <meter
              min={0}
              max={snapshot.players.length}
              value={outcome.voteCounts[player.id] ?? 0}
              aria-label={`Votes for ${player.name}`}
            />
            <strong>{outcome.voteCounts[player.id] ?? 0}</strong>
          </div>
        ))}
      </section>
      <p className="party-award">
        {outcome.caught
          ? "Good instincts. +1 point to everyone except the imposter."
          : `A successful bluff. +2 points to ${imposter?.name}.`}
      </p>
      <h2 className="party-subheading">The standings</h2>
      <Scoreboard players={snapshot.players} awards={outcome.awards} />
      {host ? (
        <PrimaryButton
          disabled={!safe}
          onClick={() =>
            onAction({ type: "next-round", roundNumber: snapshot.roundNumber })
          }
        >
          {snapshot.roundNumber === snapshot.settings.rounds
            ? "See the final results"
            : `On to round ${snapshot.roundNumber + 1}`}
        </PrimaryButton>
      ) : (
        <p className="party-wait" role="status">
          {snapshot.roundNumber === snapshot.settings.rounds
            ? "Waiting for the host to show the final standings…"
            : "Waiting for the host to start the next round…"}
        </p>
      )}
    </>
  );
}

export function PartyFinal({ snapshot, safe, onAction }: RoundProps) {
  const ranked = rankPlayers(snapshot.players);
  const winners = ranked.filter((player) => player.score === ranked[0]?.score);
  const host = snapshot.selfId === snapshot.hostId;
  return (
    <>
      <span className="eyebrow muted">
        {snapshot.settings.rounds} ROUNDS. PLENTY OF SIDE-EYE.
      </span>
      <div className="party-result-icon">
        <Trophy size={48} strokeWidth={1.4} />
      </div>
      <h1>
        {winners.length > 1
          ? "Great minds. Shared glory."
          : "The circle has a champion."}
      </h1>
      <p className="party-winners">
        {winners.map((player) => player.name).join(" & ")}
      </p>
      <p className="party-copy">
        Good bluffs. Better company. <span lang="ne">फेरि खेलौँ?</span>
      </p>
      <Scoreboard players={snapshot.players} final />
      {host ? (
        <>
          <PrimaryButton
            disabled={!safe}
            onClick={() => onAction({ type: "back-to-lobby" })}
          >
            One more game — back to lobby
          </PrimaryButton>
          <p className="party-footnote">
            Same circle and PIN. Fresh scores, roles, and word history.
          </p>
        </>
      ) : (
        <p className="party-wait" role="status">
          The host can bring everyone back to the lobby for a fresh game.
        </p>
      )}
    </>
  );
}

export function PartyRules() {
  return (
    <div className="rules-content">
      <p>
        Same room, separate phones. One secret word. One person who doesn’t know
        it.
      </p>
      <ol className="rules-list">
        <li>
          <span>01</span>
          <div>
            <strong>Join the circle</strong>
            <p>
              One person hosts and plays too. Everyone joins with a name and the
              host’s 6-digit PIN. No accounts needed. This browser saves a
              device token to restore your seat on refresh. Don’t clear site
              storage or switch browsers if you want to reconnect as yourself.
            </p>
          </div>
        </li>
        <li>
          <span>02</span>
          <div>
            <strong>Peek privately, then get ready</strong>
            <p>
              Your phone shows only your own role. Everyone gets the English and
              Nepali word except the imposter, who sees no word or category.
              Hide it, then tap ready. Even the host can’t see anyone else’s
              role.
            </p>
          </div>
        </li>
        <li>
          <span>03</span>
          <div>
            <strong>Bring the bluff to the room</strong>
            <p>
              Follow the shuffled speaking order. Say one short clue out loud —
              never the word or its translation. The speaker or host moves to
              the next turn. Then discuss out loud with the shared timer; the
              host can pause it and starts the vote.
            </p>
          </div>
        </li>
        <li>
          <span>04</span>
          <div>
            <strong>Vote on your own phone</strong>
            <p>
              Pick a suspect, then lock your private vote. No self-votes, no
              take-backs. The reveal happens only when everyone has voted. The
              unique highest vote count decides the accusation; a tie lets the
              imposter escape.
            </p>
          </div>
        </li>
        <li>
          <span>05</span>
          <div>
            <strong>Reveal. Score. Repeat.</strong>
            <p>
              Catch the imposter: everyone else gets 1 point. A wrong accusation
              or tie: the imposter gets 2. The host leads the next round.
              Highest total wins; shared wins count.
            </p>
          </div>
        </li>
      </ol>
      <div className="notice">
        <ShieldCheck size={19} />
        <p>
          Cloudflare keeps names, settings, roles, votes, scores, and game
          progress for this party. Roles and individual ballots are private; the
          result shows vote totals, not who voted for whom. If someone loses
          connection, wait for them to reconnect. If they’re gone for good, the
          host can reset to the lobby and remove them. Ending the party clears
          it; it also expires after 12 hours without a game action.
        </p>
      </div>
    </div>
  );
}

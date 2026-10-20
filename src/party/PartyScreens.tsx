import { useEffect, useId, useState } from "react";
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
import { DEFAULT_SETTINGS, rankPlayers } from "../game";
import { GameOptions } from "../GameOptions";
import { DiscussionTimeControl } from "../DiscussionTime";
import { copyText } from "../clipboard";
import { generatePin, normalizeRecoveryCode, normalizeRoomCode } from "./joining";
import { SUGGESTED_PLAYER_NAMES } from "../playerNames";
import type {
  PartyCommand,
  PartyPlayer,
  PartyPublicInfo,
  PartySnapshot,
  RecentRoom,
  RoomDirectoryInfo,
  PrivateRole,
} from "./protocol";

type RoundProps = {
  snapshot: PartySnapshot;
  safe: boolean;
  onAction: (action: PartyCommand) => void;
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
        <DiscussionTimeControl
          seconds={settings.discussionSeconds}
          disabled={disabled}
          onChange={(discussionSeconds) =>
            onChange({ ...settings, discussionSeconds })
          }
        />
      </div>
      <GameOptions
        settings={settings}
        onChange={onChange}
        disabled={disabled}
      />
    </fieldset>
  );
}

export function PartySecret({
  label,
  value,
  help,
  disabled = false,
  hidden = false,
}: {
  label: string;
  value: string;
  help: string;
  disabled?: boolean;
  hidden?: boolean;
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  useEffect(() => {
    const hide = () => {
      setShow(false);
      setCopyStatus(null);
    };
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("blur", hide);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  useEffect(() => {
    setShow(false);
    setCopyStatus(null);
  }, [value, hidden, disabled]);
  return (
    <div className="party-secret-control">
      <label className="party-field" htmlFor={id}>
        {label}
        <input
          id={id}
          type={show && !hidden && !disabled ? "text" : "password"}
          value={hidden || disabled ? "" : value}
          placeholder="Hidden"
          readOnly
          autoComplete="off"
          spellCheck={false}
          disabled={disabled || hidden}
          onFocus={(event) => event.currentTarget.select()}
        />
      </label>
      <div className="party-control-row">
        <button
          type="button"
          className="party-button"
          aria-pressed={show && !hidden && !disabled}
          disabled={disabled || hidden}
          onClick={() => setShow(!show)}
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
          {show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        </button>
        <button
          type="button"
          className="party-button"
          disabled={disabled || hidden}
          onClick={async () => {
            const copied = await copyText(value);
            setCopyStatus(
              copied
                ? "Copied. Keep it private."
                : "Copy is unavailable. Show the value, select it, then use your device’s Copy command.",
            );
          }}
        >
          Copy {label.toLowerCase()}
        </button>
      </div>
      <p className="party-help">{help}</p>
      {copyStatus && !hidden && !disabled && (
        <p className="party-help" role="status">
          {copyStatus}
        </p>
      )}
    </div>
  );
}

export function PartyPinField({
  value,
  onChange,
  disabled,
  creating = false,
  hidden = false,
}: {
  value: string;
  onChange: (pin: string) => void;
  disabled: boolean;
  creating?: boolean;
  hidden?: boolean;
}) {
  const id = useId();
  const [show, setShow] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  useEffect(() => {
    const hide = () => setShow(false);
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("blur", hide);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  useEffect(() => {
    if (hidden) {
      setShow(false);
      setCopyStatus(null);
    }
  }, [hidden]);
  return (
    <div>
      <label className="party-field" htmlFor={id}>
        {creating ? "Your party PIN" : "Party PIN"}
        <input
          id={id}
          className="party-pin-input"
          value={hidden ? "" : value}
          type={show && !hidden ? "text" : "password"}
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]{6}"
          minLength={6}
          maxLength={6}
          required
          disabled={disabled || hidden}
          aria-describedby={`${id}-help`}
          onChange={(event) => {
            setCopyStatus(null);
            onChange(event.target.value.replace(/[^0-9]/g, "").slice(0, 6));
          }}
        />
      </label>
      <div className="party-control-row">
        <button
          type="button"
          className="party-button"
          disabled={disabled || hidden}
          aria-pressed={show && !hidden}
          onClick={() => setShow(!show)}
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
          {show ? "Hide PIN" : "Show PIN"}
        </button>
        {creating && (
          <>
            <button
              type="button"
              className="party-button"
              disabled={disabled || hidden}
              onClick={() => {
                onChange(generatePin());
                setCopyStatus(null);
              }}
            >
              Generate another PIN
            </button>
            <button
              type="button"
              className="party-button"
              disabled={disabled || hidden || value.length !== 6}
              onClick={async () => {
                const copied = await copyText(value);
                setCopyStatus(
                  copied
                    ? "PIN copied. Share it only with your group."
                    : "Copy is unavailable. Show the PIN, select the digits, then use your device’s Copy command.",
                );
              }}
            >
              Copy PIN
            </button>
          </>
        )}
      </div>
      <p id={`${id}-help`} className="party-help" role="status">
        {value.length === 6
          ? "6 digits entered. "
          : `${value.length} of 6 digits entered. Enter all 6 digits to continue. `}
        {creating
          ? "A PIN is generated for you; you can change it. Share it in person, never in a public link."
          : "Ask your host for the PIN. It joins the lobby; it cannot recover hosting."}
      </p>
      {copyStatus && !hidden && (
        <p className="party-help" role="status">
          {copyStatus}
        </p>
      )}
    </div>
  );
}

export function PartyEntry({
  roomCode,
  initialPin,
  onPinConsumed,
  publicParty,
  directory,
  recentRooms,
  disabled,
  busy,
  checking,
  hideSecrets,
  onCreate,
  onJoin,
  onRecover,
  onRefresh,
  onRoomChange,
  onRemoveRecent,
}: {
  roomCode: string | null;
  initialPin: string | null;
  onPinConsumed: () => void;
  publicParty: PartyPublicInfo | null;
  directory: RoomDirectoryInfo | null;
  recentRooms: RecentRoom[];
  disabled: boolean;
  busy: boolean;
  checking: boolean;
  hideSecrets: boolean;
  onCreate: (name: string, pin: string, settings: Settings) => Promise<boolean>;
  onJoin: (roomCode: string, name: string, pin: string) => Promise<boolean>;
  onRecover: (roomCode: string, recoveryCode: string) => Promise<boolean>;
  onRefresh: () => void;
  onRoomChange: (roomCode: string | null) => void;
  onRemoveRecent: (roomCode: string) => void;
}) {
  const [mode, setMode] = useState<"join" | "create" | "recover">(
    roomCode ? "join" : "create",
  );
  const [targetCode, setTargetCode] = useState(roomCode ?? "");
  const [name, setName] = useState("");
  const [joinPin, setJoinPin] = useState(initialPin ?? "");
  const [createPin, setCreatePin] = useState(generatePin);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [validation, setValidation] = useState<string | null>(null);
  useEffect(() => {
    if (!initialPin) return;
    setJoinPin(initialPin);
    setMode("join");
    onPinConsumed();
  }, [initialPin, onPinConsumed]);
  const creating = mode === "create";
  const recovering = mode === "recover";
  const pin = creating ? createPin : joinPin;
  const code = normalizeRoomCode(targetCode);
  const validCode = !!code;
  const selectedParty = publicParty?.roomCode === code ? publicParty : null;
  const activeMatch = !!selectedParty?.exists && selectedParty.phase !== "lobby";
  const atCapacity = !!directory && directory.availableSlots === 0;
  const unavailable = creating
    ? atCapacity
    : selectedParty?.exists === false ||
      (!recovering && (activeMatch || (selectedParty?.playerCount ?? 0) >= 12));
  const invalid = (!creating && !validCode) || (recovering
    ? !normalizeRecoveryCode(recoveryCode)
    : !name.trim() || name.trim().length > 24 || !/^[0-9]{6}$/.test(pin));
  const disabledReason = unavailable
    ? creating
      ? "All room slots are occupied. Existing rooms still work; join one with its code or try creating later."
      : selectedParty?.exists === false
        ? "This room has ended or could not be found. Return Home or check the code with your host. Old invitations cannot reopen an ended room."
        : activeMatch
          ? "A game is in progress. Ask the host for New game, same players to reopen the lobby."
          : "This circle has 12 players. Ask the host to make room in the lobby."
    : !creating && !validCode
      ? "Enter the 8-character room code from your host or invitation."
      : recovering
        ? invalid
          ? "Enter your full private recovery code: 8 groups of 4 characters (0–9 and A–F). Spaces and dashes are accepted. The joining PIN does not work here."
          : "Ready to restore the original host’s seat."
        : !name.trim()
          ? "Enter your name and all 6 PIN digits to continue."
          : pin.length !== 6
            ? "Enter all 6 PIN digits to continue."
            : "Ready when you are. Your name becomes a player only after you submit successfully.";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || unavailable || invalid) return;
    setValidation(null);
    const success = recovering
      ? await onRecover(code, normalizeRecoveryCode(recoveryCode))
      : creating
        ? await onCreate(name.trim(), pin, settings)
        : await onJoin(code, name.trim(), pin);
    if (success) {
      setJoinPin("");
      setRecoveryCode("");
    } else {
      setValidation(
        "You haven’t entered the party. Check the message above, correct your details, and try again.",
      );
    }
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
        {!roomCode && recentRooms.length > 0 && (
          <section className="party-recents" aria-labelledby="party-recents-title">
            <h2 id="party-recents-title">Recent rooms on this device</h2>
            <p className="party-help">
              Resume your saved seat if the room is still active. This is not a public room list.
            </p>
            <ul>
              {recentRooms.map((room) => (
                <li key={room.roomCode}>
                  <button
                    type="button"
                    className="party-recent-resume"
                    disabled={disabled}
                    onClick={() => onRoomChange(room.roomCode)}
                  >
                    <strong>{room.roomCode}</strong>
                    <span>{room.playerName ? `Resume as ${room.playerName}` : "Open room"}</span>
                    <small>Visited {new Date(room.lastVisited).toLocaleDateString()}</small>
                  </button>
                  <button
                    type="button"
                    className="party-link"
                    aria-label={`Remove ${room.roomCode} from recent rooms only`}
                    disabled={busy}
                    onClick={() => onRemoveRecent(room.roomCode)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <p className="party-help">Removing a recent entry does not leave the party or erase its saved seat.</p>
          </section>
        )}
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
          {(
            [
              ["create", "Create a room"],
              ["join", "Join a room"],
              ["recover", "Recover hosting"],
            ] as const
          ).map(([next, label]) => (
            <button
              key={next}
              type="button"
              aria-pressed={mode === next}
              disabled={busy}
              onClick={() => {
                setMode(next);
                setValidation(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <h2 id="party-entry-title">
          {recovering
            ? "Find your host seat."
            : creating
              ? "Get the circle together."
              : "You’re on the guest list."}
        </h2>
        <p className="party-help">
          {recovering
            ? "Use the private recovery code you saved as host. This restores your original name, role, votes, and scores — no new player is added."
            : creating
              ? "Choose your name and a private 6-digit joining PIN. Your new room gets its own code and invitation."
              : "Use your host’s room code and PIN. An invitation fills these in; you still choose your name and press Join."}
        </p>
        <div className="party-availability" role="status">
          {checking
            ? "Checking room availability…"
            : creating
              ? directory
                ? `${directory.activeRooms} of ${directory.roomCap} room slots occupied. ${directory.availableSlots > 0 ? `${directory.availableSlots} available for a new room.` : "All slots are occupied. Joining an existing room is still available."}`
                : "Room capacity could not be checked. You can try creating; the server checks availability."
              : selectedParty
                ? selectedParty.exists
                  ? activeMatch
                    ? "A game is in progress. New players must wait for the lobby; the original host can still recover hosting."
                    : `${selectedParty.playerCount ?? 0}/12 people in this room’s lobby.`
                  : "Room not found or closed. Return Home to choose another room or create a new one."
                : roomCode === code
                  ? "Room availability could not be checked. Refresh to try again."
                  : "Enter a room code to join or recover that specific room. Room codes are not a public directory."}
          <button
            className="party-link"
            type="button"
            disabled={disabled}
            onClick={onRefresh}
          >
            Refresh availability
          </button>
          {!creating && selectedParty?.exists === false && (
            <button className="party-link" type="button" onClick={() => onRoomChange(null)}>
              Return Home
            </button>
          )}
        </div>
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          {!creating && (
            <label className="party-field" htmlFor="party-room-code">
              Room code
              <input
                id="party-room-code"
                className="party-room-code-input"
                value={targetCode}
                placeholder="e.g. ABCD2345"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={8}
                required
                disabled={disabled}
                aria-describedby="party-room-code-help"
                onChange={(event) => {
                  setTargetCode(event.target.value.toUpperCase());
                  setValidation(null);
                }}
              />
              <small id="party-room-code-help">8 letters and numbers. Ask your host; no rooms are publicly listed.</small>
            </label>
          )}
          {recovering ? (
            <>
              <label className="party-field" htmlFor="party-recovery">
                Private host recovery code
                <input
                  id="party-recovery"
                  type="password"
                  value={recoveryCode}
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="characters"
                  maxLength={64}
                  required
                  disabled={disabled}
                  aria-describedby="party-recovery-help"
                  onChange={(event) => setRecoveryCode(event.target.value)}
                />
              </label>
              <p className="party-help" id="party-recovery-help">
                Not the joining PIN. Recovery replaces the old host browser’s
                access and rotates this code. Save the replacement privately
                afterward. Never put recovery codes in a URL or share them with
                players.
              </p>
            </>
          ) : (
            <>
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
                {SUGGESTED_PLAYER_NAMES.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
              <PartyPinField
                key={mode}
                value={pin}
                onChange={creating ? setCreatePin : setJoinPin}
                disabled={disabled}
                creating={creating}
                hidden={hideSecrets}
              />
              {creating && (
                <PartySettings
                  settings={settings}
                  disabled={disabled}
                  onChange={setSettings}
                />
              )}
            </>
          )}
          {validation && (
            <p className="party-form-error" role="alert">
              {validation}
            </p>
          )}
          <p className="party-help" role="status">
            {disabledReason}
          </p>
          <PrimaryButton
            type="submit"
            disabled={disabled || unavailable || invalid}
          >
            {busy
              ? "Connecting…"
              : recovering
                ? "Recover my host seat"
                : creating
                  ? "Create the party"
                  : "Join the circle"}
          </PrimaryButton>
        </form>
        <p className="party-footnote">
          This browser saves a separate seat for each room. Don’t clear site
          storage. Invitations may include the joining PIN in a removable URL
          fragment; recovery codes and seat tokens never go in links.
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
}: RoundProps & {
  onRemove: (player: PartyPlayer) => void;
}) {
  const host = snapshot.selfId === snapshot.hostId;
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
            ? "You’re hosting — and you’re playing. Use Invite players above to share this room’s QR code or private joining link. Save your host recovery code from Manage party too."
            : "You’re in. Keep your own phone nearby while the host gathers the circle and picks the settings."}
        </p>
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
  const cycleIndex = snapshot.clueIndex % snapshot.clueOrder.length;
  const currentId = snapshot.clueOrder[cycleIndex];
  const current = snapshot.players.find((player) => player.id === currentId);
  const myTurn = currentId === snapshot.selfId;
  const mayAdvance = myTurn || snapshot.hostId === snapshot.selfId;
  const lastTurn =
    snapshot.clueIndex ===
    snapshot.clueOrder.length * snapshot.settings.clueCycles - 1;
  const lastInCycle = cycleIndex === snapshot.clueOrder.length - 1;
  return (
    <>
      <span className="eyebrow muted">
        CYCLE {snapshot.clueCycle} OF {snapshot.settings.clueCycles} · CLUE{" "}
        {cycleIndex + 1} OF {snapshot.clueOrder.length}
      </span>
      <div className="party-turn-icon">
        <UserRound size={34} />
      </div>
      <h1>
        {myTurn ? "You’re up." : `${current?.name ?? "Your group"} is up.`}
      </h1>
      <p className="party-copy">
        {myTurn
          ? snapshot.clueCycle === 2
            ? "One more clue, in the same order. Say something new out loud — never the secret word or its translation."
            : "Say one short clue out loud. Don’t say or translate the secret word. Imposter? Act like you belong."
          : "Listen to the clue. A little too vague? A little too confident? Remember it for the discussion."}
      </p>
      {snapshot.settings.clueCycles === 2 && (
        <p className="party-help">
          Two clue cycles are on. Everyone speaks twice in the same shuffled
          order, then discussion begins.
        </p>
      )}
      <ol
        className="party-clue-order"
        aria-label={`Clue order, cycle ${snapshot.clueCycle}`}
      >
        {snapshot.clueOrder.map((id, index) => (
          <li
            key={id}
            className={
              index === cycleIndex
                ? "is-current"
                : index < cycleIndex
                  ? "is-done"
                  : ""
            }
            aria-current={index === cycleIndex ? "step" : undefined}
          >
            <span>
              {index < cycleIndex ? (
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
              {index < cycleIndex
                ? "Done this cycle"
                : index === cycleIndex
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
          {lastTurn
            ? "Clue given — start discussion"
            : lastInCycle
              ? "Clue given — start cycle 2"
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

function usePartyCountdown(
  serverNow: number,
  deadline: number | null,
  remainingMs = 0,
) {
  const [clock, setClock] = useState({ serverNow, elapsed: 0 });
  useEffect(() => {
    const started = performance.now();
    setClock({ serverNow, elapsed: 0 });
    const timer = window.setInterval(
      () =>
        setClock({
          serverNow,
          elapsed: performance.now() - started,
        }),
      200,
    );
    return () => window.clearInterval(timer);
  }, [serverNow, deadline]);
  const elapsed = clock.serverNow === serverNow ? clock.elapsed : 0;
  const remaining =
    deadline === null ? remainingMs : deadline - serverNow - elapsed;
  return Math.max(0, Math.ceil(remaining / 1000));
}

export function PartyDiscussion({ snapshot, safe, onAction }: RoundProps) {
  const seconds = usePartyCountdown(
    snapshot.serverNow,
    snapshot.discussion.deadline,
    snapshot.discussion.remainingMs,
  );
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

export function PartyGuess({
  snapshot,
  safe,
  onAction,
  onSkip,
}: RoundProps & { onSkip: () => void }) {
  const [answer, setAnswer] = useState("");
  const seconds = usePartyCountdown(
    snapshot.serverNow,
    snapshot.guess?.deadline ?? null,
  );
  const guessing = snapshot.guess?.playerId === snapshot.selfId;
  const host = snapshot.selfId === snapshot.hostId;
  const imposter = snapshot.players.find(
    (player) => player.id === snapshot.guess?.playerId,
  );
  return (
    <>
      <span className="eyebrow muted">CAUGHT — ONE LAST CHANCE</span>
      <h1>
        {guessing
          ? "Can you name the word?"
          : `${imposter?.name ?? "The imposter"} has one last guess.`}
      </h1>
      <p className="party-copy">
        {guessing
          ? "The circle caught you. Submit one answer before time runs out. A correct guess earns you 2 points instead; a wrong answer or no answer gives everyone else 1 point."
          : "Keep the word to yourself — don’t say it out loud or show your screen. No points are awarded until this chance ends."}
      </p>
      <div
        className={`party-timer ${seconds === 0 ? "is-finished" : ""}`}
        role="timer"
        aria-label={`${seconds} seconds to guess`}
      >
        <strong>0:{String(seconds).padStart(2, "0")}</strong>
        <span>
          {seconds === 0
            ? "TIME’S UP — WAITING FOR THE SERVER RESULT"
            : "ONE ANSWER · 30 SECONDS"}
        </span>
      </div>
      {!safe && (
        <p className="party-help">
          Last synced countdown. Reconnect to submit or see the current result.
          The server deadline still applies.
        </p>
      )}
      {guessing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (safe && seconds > 0 && answer.trim())
              onAction({
                type: "guess-word",
                roundNumber: snapshot.roundNumber,
                guess: answer.trim(),
              });
          }}
        >
          <label className="party-field" htmlFor="party-last-guess">
            Your one guess
            <input
              id="party-last-guess"
              value={answer}
              maxLength={80}
              required
              autoComplete="off"
              spellCheck={false}
              disabled={!safe || seconds === 0}
              onChange={(event) => setAnswer(event.target.value)}
            />
          </label>
          <p className="party-help">
            English or Nepali is accepted. Use the whole word or phrase. You
            cannot change a submitted answer.
          </p>
          <PrimaryButton
            type="submit"
            disabled={!safe || seconds === 0 || !answer.trim()}
          >
            Submit my one guess
          </PrimaryButton>
        </form>
      ) : (
        <p className="party-wait" role="status">
          Waiting for the imposter’s private answer or the deadline. The secret
          word stays hidden until the result.
        </p>
      )}
      {host && (
        <button
          type="button"
          className="party-link"
          disabled={!safe || seconds === 0}
          onClick={onSkip}
        >
          End the last chance without a guess…
        </button>
      )}
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
        {outcome.guessResult === "correct"
          ? "Caught — but guessed it."
          : outcome.caught
            ? "Caught in the act."
            : "The imposter got away."}
      </h1>
      <p className="party-copy">
        <strong>{imposter?.name}</strong> was the imposter.
        <br />
        {outcome.guessResult === "correct"
          ? "The circle accused the imposter correctly, but their last-chance guess named the secret word."
          : outcome.guessResult === "incorrect"
            ? "The circle caught the imposter. Their last-chance guess was incorrect."
            : outcome.guessResult === "skipped"
              ? "The circle caught the imposter. The last chance ended without a correct guess."
              : outcome.tied
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
        {outcome.guessResult === "correct"
          ? `A successful last guess. +2 points to ${imposter?.name}; no points to the other players.`
          : outcome.caught
            ? "Good instincts. +1 point to everyone except the imposter."
            : `A successful escape. +2 points to ${imposter?.name}.`}
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

export function PartyFinal({ snapshot }: { snapshot: PartySnapshot }) {
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
      <p className="party-wait" role="status">
        {host
          ? "Ready for another game? Open Manage party above, then choose New game, same players. Nothing restarts until you confirm."
          : "The host can choose New game, same players to reopen the lobby. Your final standings stay here until then."}
      </p>
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
              One person hosts and plays too. Everyone opens that room’s invite
              or enters its 8-character room code, then joins with their own
              name and the host’s 6-digit PIN. Scanning an invitation does not
              add a player automatically. No player accounts are needed. This
              browser saves a separate device token for each room to restore
              your seat on refresh. Don’t clear site storage or switch browsers
              if you want to reconnect as yourself.
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
              the next turn. With two clue cycles enabled, repeat the same order
              once with new clues. Then discuss with the shared timer; the host
              can pause it and starts the vote.
            </p>
          </div>
        </li>
        <li>
          <span>04</span>
          <div>
            <strong>Vote on your own phone</strong>
            <p>
              Pick a suspect, then lock your private vote. No self-votes, no
              take-backs. The unique highest vote count decides the accusation;
              a tie lets the imposter escape. With last-chance guessing enabled,
              a caught imposter gets one private answer in 30 seconds before the
              secret word or scores are revealed. The host may end that chance.
            </p>
          </div>
        </li>
        <li>
          <span>05</span>
          <div>
            <strong>Reveal. Score. Repeat.</strong>
            <p>
              Catch the imposter: everyone else gets 1 point. A wrong accusation
              or tie: the imposter gets 2. A correct last-chance guess also
              earns the imposter 2 instead of awarding the other players; an
              incorrect or skipped guess leaves the imposter caught. The host
              leads the next round. Highest total wins; shared wins count.
            </p>
          </div>
        </li>
      </ol>
      <div className="notice">
        <ShieldCheck size={19} />
        <p>
          Cloudflare keeps this party’s names, settings, private roles and
          ballots, scores, and progress. Results show vote totals, not
          individual ballots. Keep this browser’s saved data to reconnect. Hosts
          can privately save a recovery code from Manage party, transfer hosting
          to a connected player, or start a confirmed New game, same players to
          reopen the lobby and remove missing players. Starting a fresh party
          invalidates all old seats; everyone else must rejoin with the new PIN.
          This party retains only the last 20 completed games and their totals,
          visible to admitted players through History. New game keeps that
          history; a fresh party clears it. Ending or expiring a room clears all
          personal state, completed-game history, and its recent-word storage.
          A party expires after 12 hours without a game action, or after 15
          continuous minutes with everyone disconnected. Owner administration
          is separate from hosting and requires the owner’s GitHub sign-in.
        </p>
      </div>
    </div>
  );
}

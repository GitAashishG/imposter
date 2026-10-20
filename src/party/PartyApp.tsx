import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CircleHelp,
  DoorOpen,
  History,
  Home,
  QrCode,
  Settings2,
  ShieldCheck,
  Trophy,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { Eyes, Modal, Scoreboard } from "../components";
import { DeviceOptions } from "../DeviceOptions";
import { PlayModeSwitch } from "../PlayModeSwitch";
import { ThemeToggle } from "../Appearance";
import { HistoryPanel } from "../HistoryPanel";
import { InviteLink } from "../InviteLink";
import { PARTY_API_URL, useParty } from "./useParty";
import { formatRecoveryCode, generatePin } from "./joining";
import type { PartyCommand, PartyPlayer } from "./protocol";
import {
  PartyClues,
  PartyDiscussion,
  PartyEntry,
  PartyFinal,
  PartyGuess,
  PartyLobby,
  PartyPinField,
  PartyReady,
  PartyResult,
  PartyRoster,
  PartyRules,
  PartySecret,
  PartyVote,
  PrivateRoleCard,
} from "./PartyScreens";
import "./party.css";

type PartyDialog =
  | { kind: "rules" | "scores" | "local" | "home" }
  | { kind: "invite" | "history"; gameId: string; partyId: string; roomCode: string }
  | { kind: "manage" | "new-game" | "end" | "leave" | "rotate"; gameId: string }
  | { kind: "fresh" | "rotate-pin"; gameId: string; pin: string }
  | { kind: "remove" | "transfer"; gameId: string; player: PartyPlayer }
  | { kind: "skip"; gameId: string; roundNumber: number };

const phaseNames = {
  lobby: "Lobby",
  role: "Private roles",
  clue: "Spoken clues",
  discussion: "Discussion",
  vote: "Private vote",
  guess: "Last-chance guess",
  result: "Round result",
  final: "Final standings",
};

function generateDifferentPin(current?: string) {
  let pin = generatePin();
  while (pin === current) pin = generatePin();
  return pin;
}

function dialogTitle(dialog: PartyDialog) {
  switch (dialog.kind) {
    case "rules":
      return "Own phones. Same circle.";
    case "scores":
      return "The standings";
    case "local":
      return "Switch to Pass & Play?";
    case "home":
      return "Choose another room?";
    case "invite":
      return "Invite players";
    case "history":
      return "This party’s history";
    case "rotate-pin":
      return "Replace the joining PIN?";
    case "manage":
      return "Manage party";
    case "new-game":
      return "New game, same players?";
    case "fresh":
      return "Start a fresh party?";
    case "end":
      return "End the party for everyone?";
    case "leave":
      return "Leave the circle?";
    case "rotate":
      return "Replace your recovery code?";
    case "transfer":
      return `Make ${dialog.player.name} the host?`;
    case "remove":
      return `Remove ${dialog.player.name}?`;
    case "skip":
      return "End the last chance?";
  }
}

export default function PartyApp({ onLocal, roomCode, onRoomChange, initialPin }: {
  onLocal: () => void;
  roomCode: string | null;
  onRoomChange: (roomCode: string | null) => void;
  initialPin: string | null;
}) {
  const party = useParty({ roomCode, onRoomChange });
  const { snapshot, session, status, busy, error } = party;
  const [pendingDialog, setDialog] = useState<PartyDialog | null>(null);
  const dialog = pendingDialog &&
    (!("gameId" in pendingDialog) || pendingDialog.gameId === snapshot?.gameId) &&
    (!("roomCode" in pendingDialog) ||
      (pendingDialog.roomCode === roomCode && pendingDialog.partyId === snapshot?.id))
    ? pendingDialog : null;
  const [consumedInvite, setConsumedInvite] = useState<string | null>(null);
  const inviteKey = roomCode && initialPin ? `${roomCode}:${initialPin}` : null;
  const [revealKey, setRevealKey] = useState<string | null>(null);
  const [seenKey, setSeenKey] = useState<string | null>(null);
  const [dismissedNotice, setDismissedNotice] = useState<string | null>(null);
  const host = !!snapshot && snapshot.hostId === snapshot.selfId;
  const safe = status === "online" && !busy;
  const roleKey = snapshot ? `${snapshot.gameId}:${snapshot.roundNumber}` : "";
  const privatePhase =
    !!snapshot &&
    ["role", "clue", "discussion", "vote", "guess"].includes(snapshot.phase);
  const revealed = revealKey === roleKey && privatePhase && !dialog && safe;
  const hostName = snapshot?.players.find(
    (player) => player.id === snapshot.hostId,
  )?.name;
  const selfName = snapshot?.players.find(
    (player) => player.id === snapshot.selfId,
  )?.name;
  const offlinePlayers =
    snapshot?.players.filter(
      (player) => !player.connected && player.id !== snapshot.selfId,
    ) ?? [];
  const noticeKey = snapshot?.notice
    ? `${snapshot.id}:${snapshot.notice.id}`
    : null;
  const snapshotNotice =
    noticeKey !== dismissedNotice ? snapshot?.notice?.message : null;
  const currentSpeaker =
    snapshot?.phase === "clue"
      ? snapshot.clueOrder[snapshot.clueIndex % snapshot.clueOrder.length]
      : null;
  const turnKey =
    snapshot?.phase === "clue" && currentSpeaker === snapshot.selfId
      ? `${snapshot.gameId}:${snapshot.roundNumber}:${snapshot.clueIndex}`
      : null;

  useEffect(() => {
    const hide = () => setRevealKey(null);
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("blur", hide);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);

  useEffect(() => {
    if (status !== "online") setRevealKey(null);
  }, [status]);

  const historyOpen = dialog?.kind === "history";
  useEffect(() => {
    if (historyOpen) void party.loadHistory();
  }, [historyOpen, snapshot?.completedGames, party.loadHistory]);

  useEffect(() => {
    setDialog(null);
    setRevealKey(null);
    setSeenKey(null);
  }, [roomCode, snapshot?.id]);

  useEffect(() => {
    // A long join form or result must not leave the next phase below the fold.
    window.scrollTo({ top: 0, behavior: "instant" });
    document
      .querySelector<HTMLElement>(".party-main")
      ?.focus({ preventScroll: true });
  }, [snapshot?.gameId, snapshot?.phase, snapshot?.roundNumber]);

  useEffect(() => {
    if (!snapshot || snapshot.phase === "lobby" || snapshot.phase === "final") {
      setRevealKey(null);
      setSeenKey(null);
    }
    setDialog((current) => {
      if (!current || !("gameId" in current)) return current;
      if (!snapshot || current.gameId !== snapshot.gameId) return null;
      if (current.kind !== "leave" && current.kind !== "history" && current.kind !== "invite" && !host) return null;
      if ("roomCode" in current &&
        (current.roomCode !== roomCode || current.partyId !== snapshot.id)) return null;
      if (
        (current.kind === "leave" || current.kind === "remove") &&
        snapshot.phase !== "lobby"
      )
        return null;
      if (
        current.kind === "skip" &&
        (snapshot.phase !== "guess" ||
          current.roundNumber !== snapshot.roundNumber)
      )
        return null;
      return current;
    });
  }, [
    snapshot?.gameId,
    snapshot?.phase,
    snapshot?.hostId,
    snapshot?.selfId,
    snapshot?.roundNumber,
    host,
    roomCode,
    snapshot?.id,
  ]);

  function openDialog(next: PartyDialog) {
    setRevealKey(null);
    setDialog(next);
  }

  function openManage() {
    if (snapshot && host)
      openDialog({ kind: "manage", gameId: snapshot.gameId });
  }

  function openPrivatePanel(kind: "history" | "invite") {
    if (!snapshot) return;
    openDialog({ kind, gameId: snapshot.gameId, partyId: snapshot.id, roomCode: snapshot.roomCode });
  }

  function goHome() {
    if (session) openDialog({ kind: "home" });
    else onRoomChange(null);
  }

  function send(command: PartyCommand) {
    if (!safe || !snapshot) return;
    setRevealKey(null);
    void party.act({ ...command, gameId: snapshot.gameId });
  }

  function confirmationCommand(): PartyCommand | null {
    if (
      !snapshot ||
      !dialog ||
      !("gameId" in dialog) ||
      dialog.gameId !== snapshot.gameId
    )
      return null;
    if (dialog.kind === "leave")
      return !host && snapshot.phase === "lobby" ? { type: "leave" } : null;
    if (!host) return null;
    switch (dialog.kind) {
      case "new-game":
        return { type: "new-game" };
      case "fresh":
        return /^[0-9]{6}$/.test(dialog.pin) && dialog.pin !== snapshot.pin
          ? { type: "fresh-party", pin: dialog.pin }
          : null;
      case "end":
        return { type: "end-party" };
      case "rotate":
        return { type: "rotate-recovery" };
      case "rotate-pin":
        return /^[0-9]{6}$/.test(dialog.pin) && dialog.pin !== snapshot.pin
          ? { type: "rotate-pin", pin: dialog.pin }
          : null;
      case "transfer":
        return snapshot.players.some(
          (player) =>
            player.id === dialog.player.id &&
            player.connected &&
            player.id !== snapshot.selfId,
        )
          ? { type: "transfer-host", playerId: dialog.player.id }
          : null;
      case "remove":
        return snapshot.phase === "lobby" &&
          snapshot.players.some(
            (player) =>
              player.id === dialog.player.id && player.id !== snapshot.hostId,
          )
          ? { type: "remove-player", playerId: dialog.player.id }
          : null;
      case "skip":
        return snapshot.phase === "guess" &&
          snapshot.roundNumber === dialog.roundNumber
          ? { type: "skip-guess", roundNumber: dialog.roundNumber }
          : null;
      default:
        return null;
    }
  }

  const command = confirmationCommand();
  async function confirm() {
    if (!safe || !command || !dialog || !("gameId" in dialog)) return;
    const submittedDialog = dialog;
    setRevealKey(null);
    const success = await party.act({
      ...command,
      gameId: submittedDialog.gameId,
    });
    if (success)
      setDialog((current) => (current === submittedDialog ? null : current));
  }

  const actionProps = snapshot ? { snapshot, safe, onAction: send } : null;

  return (
    <div className="party-shell">
      <header className="party-header">
        <div className="brand">
          <span className="brand-icon">
            <Eyes />
          </span>
          <span>
            Ko Ho<span className="brand-question">?</span>
            <small lang="ne">को हो?</small>
          </span>
        </div>
        <nav className="party-header-actions" aria-label="Party navigation">
          <button
            type="button"
            className="party-header-button"
            onClick={() => openDialog({ kind: "rules" })}
          >
            <CircleHelp size={17} />
            <span>How to play</span>
          </button>
          {snapshot && snapshot.phase !== "lobby" && (
            <button
              type="button"
              className="party-header-button"
              onClick={() => openDialog({ kind: "scores" })}
            >
              <Trophy size={17} />
              <span>Scores</span>
            </button>
          )}
          <ThemeToggle />
        </nav>
      </header>
      <div className="party-room-navigation" aria-label="Current room">
        <span>
          {roomCode ? <>Room <strong>{roomCode}</strong></> : <strong>Own Phones home</strong>}
        </span>
        {roomCode && (
          <button type="button" className="party-button" disabled={busy} onClick={goHome}>
            <Home size={16} /> Home / choose room
          </button>
        )}
      </div>
      <PlayModeSwitch
        mode="party"
        onChange={(next) => {
          if (next === "local") {
            if (session) openDialog({ kind: "local" });
            else onLocal();
          }
        }}
      />
      <DeviceOptions active={privatePhase} turnKey={turnKey} />

      <main className="party-main" tabIndex={-1} aria-label="Party game">
        {party.notice && (
          <div className="party-banner party-notice" role="status">
            <div>
              <strong>Party update</strong>
              <p>{party.notice}</p>
            </div>
            <button
              type="button"
              className="party-icon-button"
              aria-label="Dismiss party update"
              onClick={party.clearNotice}
            >
              <X size={19} />
            </button>
          </div>
        )}
        {snapshotNotice && snapshotNotice !== party.notice && (
          <div className="party-banner party-notice" role="status">
            <div>
              <strong>Party update</strong>
              <p>{snapshotNotice}</p>
            </div>
            <button
              type="button"
              className="party-icon-button"
              aria-label="Dismiss game update"
              onClick={() => setDismissedNotice(noticeKey)}
            >
              <X size={19} />
            </button>
          </div>
        )}
        {error && (
          <div className="party-banner party-error" role="alert">
            <div>
              <strong>Something needs your attention.</strong>
              <p>{error}</p>
            </div>
            <button
              type="button"
              className="party-icon-button"
              aria-label="Dismiss error"
              onClick={party.clearError}
            >
              <X size={19} />
            </button>
          </div>
        )}

        {snapshot && (
          <>
            <div
              className={`party-connection ${status === "online" ? "is-online" : "is-disconnected"}`}
              role="status"
              aria-live="polite"
            >
              <span>
                {status === "online" ? (
                  <Wifi size={16} />
                ) : (
                  <WifiOff size={16} />
                )}
                <strong>
                  {status === "online"
                    ? busy
                      ? "Saving your action…"
                      : "Connected to the circle"
                    : status === "connecting" || status === "checking"
                      ? "Reconnecting to the circle…"
                      : "Connection lost. Your saved seat is on this device."}
                </strong>
              </span>
              {status !== "online" ? (
                <>
                  <p>
                    Your screen may be out of date. Actions and private reveals
                    are disabled until you reconnect. Your seat can be restored
                    while this party remains active.
                  </p>
                  <button
                    type="button"
                    className="party-button"
                    disabled={
                      status === "connecting" || status === "checking" || busy
                    }
                    onClick={party.reconnect}
                  >
                    Reconnect now
                  </button>
                </>
              ) : (
                <small>
                  {host
                    ? "You’re hosting and playing"
                    : `Hosted by ${hostName ?? "your host"}`}
                </small>
              )}
            </div>
            <div className="party-management" aria-label="Party controls">
              <div>
                <strong>
                  {host
                    ? `You host as ${selfName ?? "yourself"}`
                    : `Hosted by ${hostName ?? "your host"}`}
                </strong>
                <p>
                  {host
                    ? "New game, fresh party, host recovery, and ending — all in one place."
                    : snapshot.phase === "lobby"
                      ? "Only the current host manages this party. Your private role stays yours."
                      : "Need to leave? Ask the host to reopen the lobby with New game, same players. That ends this game and clears scores; it does not end the party."}
                </p>
              </div>
              <div className="party-management-actions">
                <button
                  type="button"
                  className="party-button party-invite-button"
                  disabled={!safe}
                  onClick={() => openPrivatePanel("invite")}
                >
                  <QrCode size={18} /> Invite players
                </button>
              {host ? (
                <button
                  type="button"
                  className="party-button party-manage-button"
                  onClick={openManage}
                >
                  <Settings2 size={18} />
                  Manage party
                </button>
              ) : snapshot.phase === "lobby" ? (
                <button
                  type="button"
                  className="party-button"
                  disabled={!safe}
                  onClick={() =>
                    openDialog({ kind: "leave", gameId: snapshot.gameId })
                  }
                >
                  <DoorOpen size={16} />
                  Leave party
                </button>
              ) : null}
                <button
                  type="button"
                  className="party-button"
                  disabled={!safe}
                  onClick={() => openPrivatePanel("history")}
                >
                  <History size={17} /> History ({snapshot.completedGames})
                </button>
              </div>
            </div>
          </>
        )}

        {!party.configured ? (
          <section
            className="party-card party-empty"
            aria-labelledby="party-unavailable-title"
          >
            <WifiOff size={34} />
            <span className="eyebrow muted">OWN-PHONE PLAY IS UNAVAILABLE</span>
            <h1 id="party-unavailable-title">
              The party server isn’t connected.
            </h1>
            <p className="party-copy">
              This version of Ko Ho? has no configured multiplayer server.
              Own-phone play needs the Cloudflare party backend and{" "}
              <code>VITE_PARTY_API_URL</code>.
            </p>
            <p className="party-copy">
              You can still get the whole circle playing together on one phone.
            </p>
            <button type="button" className="party-button" onClick={onLocal}>
              <ArrowLeft size={17} />
              Play Pass &amp; Play
            </button>
          </section>
        ) : !snapshot && session ? (
          <section
            className="party-card party-empty"
            aria-busy={status === "connecting" || status === "checking"}
          >
            <Wifi size={34} />
            <h1>Finding your seat.</h1>
            <p className="party-copy">
              {status === "offline"
                ? "The party server could not be reached. Your saved session is still on this device. Reconnect to recover your own role, vote, and score if the party is still active."
                : "Restoring your saved session and syncing the latest party state…"}
            </p>
            <button
              className="party-button"
              type="button"
              disabled={
                status === "connecting" || status === "checking" || busy
              }
              onClick={party.reconnect}
            >
              Reconnect now
            </button>
            <p className="party-help">
              Keep this browser’s saved data. A private host recovery code can
              restore hosting in another browser; a joining PIN cannot restore
              an existing seat.
            </p>
          </section>
        ) : !snapshot ? (
          <PartyEntry
            key={roomCode ?? "home"}
            roomCode={roomCode}
            initialPin={inviteKey !== consumedInvite ? initialPin : null}
            onPinConsumed={() => setConsumedInvite(inviteKey)}
            directory={party.directory}
            recentRooms={party.recentRooms}
            onRoomChange={onRoomChange}
            onRemoveRecent={party.removeRecent}
            publicParty={party.publicParty}
            disabled={busy || status === "checking" || status === "connecting"}
            busy={busy}
            checking={status === "checking"}
            hideSecrets={!!dialog}
            onCreate={party.create}
            onJoin={party.join}
            onRecover={party.recover}
            onRefresh={() => {
              void party.refreshParty();
            }}
          />
        ) : (
          <>
            <div className="party-progress" aria-label="Match progress">
              <span>
                {snapshot.phase === "lobby"
                  ? "GET THE GANG TOGETHER"
                  : `ROUND ${snapshot.roundNumber} OF ${snapshot.settings.rounds}`}
              </span>
              <strong>{phaseNames[snapshot.phase]}</strong>
              {snapshot.phase !== "lobby" && (
                <div className="party-round-dots" aria-hidden="true">
                  {Array.from(
                    { length: snapshot.settings.rounds },
                    (_, index) => (
                      <i
                        className={
                          index < snapshot.roundNumber ? "is-filled" : ""
                        }
                        key={index}
                      />
                    ),
                  )}
                </div>
              )}
            </div>
            {offlinePlayers.length > 0 && (
              <div
                className="party-banner party-presence-warning"
                role="status"
              >
                <WifiOff size={18} />
                <div>
                  <strong>
                    {offlinePlayers.map((player) => player.name).join(", ")}{" "}
                    {offlinePlayers.length === 1 ? "is" : "are"} reconnecting.
                  </strong>
                  <p>
                    {snapshot.phase === "lobby"
                      ? "Everyone must be connected before the game starts."
                      : host
                        ? "Wait for them to return on the same browser. If they cannot return, Manage party → New game, same players ends this game and reopens the lobby so you can remove them."
                        : "Your current score and vote are saved. The host can reopen the lobby with New game, same players if someone cannot return; that ends this game and clears scores."}
                  </p>
                </div>
              </div>
            )}
            {snapshot.phase === "lobby" && actionProps ? (
              <PartyLobby
                key={`${snapshot.gameId}:${snapshot.hostId}`}
                {...actionProps}
                onRemove={(player) =>
                  openDialog({
                    kind: "remove",
                    player,
                    gameId: snapshot.gameId,
                  })
                }
              />
            ) : (
              actionProps && (
                <div
                  className={`party-game-layout ${snapshot.phase === "result" || snapshot.phase === "final" ? "party-game-results" : ""}`}
                >
                  <section
                    className="party-card party-play-card"
                    aria-label={phaseNames[snapshot.phase]}
                    aria-busy={busy}
                  >
                    {snapshot.phase === "role" && (
                      <>
                        <span className="eyebrow muted">
                          ROUND {snapshot.roundNumber} · A LITTLE SECRET
                        </span>
                        <h1>Keep this to yourself.</h1>
                        <p className="party-copy">
                          Take a private peek on your own phone. Not even the
                          host knows who’s bluffing.
                        </p>
                        {snapshot.ownRole && (
                          <PrivateRoleCard
                            role={snapshot.ownRole}
                            revealed={revealed}
                            disabled={!safe}
                            onReveal={() => {
                              setSeenKey(roleKey);
                              setRevealKey(roleKey);
                            }}
                            onHide={() => setRevealKey(null)}
                          />
                        )}
                        <PartyReady
                          {...actionProps}
                          seen={seenKey === roleKey}
                          onHide={() => setRevealKey(null)}
                        />
                      </>
                    )}
                    {snapshot.phase === "clue" && (
                      <PartyClues {...actionProps} />
                    )}
                    {snapshot.phase === "discussion" && (
                      <PartyDiscussion {...actionProps} />
                    )}
                    {snapshot.phase === "vote" && (
                      <PartyVote key={roleKey} {...actionProps} />
                    )}
                    {snapshot.phase === "guess" && (
                      <PartyGuess
                        key={roleKey}
                        {...actionProps}
                        onSkip={() =>
                          openDialog({
                            kind: "skip",
                            gameId: snapshot.gameId,
                            roundNumber: snapshot.roundNumber,
                          })
                        }
                      />
                    )}
                    {snapshot.phase === "result" && (
                      <PartyResult {...actionProps} />
                    )}
                    {snapshot.phase === "final" && (
                      <PartyFinal snapshot={snapshot} />
                    )}
                  </section>
                  {privatePhase && (
                    <aside
                      className="party-game-sidebar"
                      aria-label="Your role and the circle"
                    >
                      {snapshot.phase !== "role" &&
                        snapshot.phase !== "guess" &&
                        snapshot.ownRole && (
                          <PrivateRoleCard
                            role={snapshot.ownRole}
                            compact
                            revealed={revealed}
                            disabled={!safe}
                            onReveal={() => {
                              setSeenKey(roleKey);
                              setRevealKey(roleKey);
                            }}
                            onHide={() => setRevealKey(null)}
                          />
                        )}
                      <section className="party-card party-circle-card">
                        <div className="party-section-heading">
                          <h2>The circle</h2>
                          <span>{snapshot.players.length} players</span>
                        </div>
                        <PartyRoster snapshot={snapshot} />
                        <p className="party-help">
                          <ShieldCheck size={15} />
                          Your role and ballot stay private. Names, scores, and
                          readiness are shared.
                          {snapshot.phase === "guess"
                            ? " The caught imposter is now known; the word is still private."
                            : ""}
                        </p>
                      </section>
                    </aside>
                  )}
                </div>
              )
            )}
          </>
        )}
      </main>

      <footer className="party-footer">
        <span>
          A little Nepali. A little American. All <span lang="ne">रमाइलो</span>.
        </span>
        <span>Same room. Your own phone. No accounts.</span>
        {party.configured && (
          <a className="party-link" href={`${PARTY_API_URL}/admin`} target="_blank" rel="noopener noreferrer">
            Admin · owner sign-in
          </a>
        )}
      </footer>

      {dialog && (
        <Modal title={dialogTitle(dialog)} onClose={() => setDialog(null)}>
          <div className="party-dialog-content">
            {error && (
              <p className="party-form-error" role="alert">
                {error}
              </p>
            )}
            {dialog.kind === "rules" ? (
              <PartyRules />
            ) : dialog.kind === "scores" ? (
              snapshot ? (
                <Scoreboard
                  players={snapshot.players}
                  final={snapshot.phase === "final"}
                />
              ) : (
                <p className="modal-description">
                  Join a party to see the standings.
                </p>
              )
            ) : dialog.kind === "history" && snapshot ? (
              <HistoryPanel
                history={party.history}
                loading={party.historyLoading}
                error={party.historyError}
                onRetry={() => { void party.loadHistory(); }}
              />
            ) : dialog.kind === "invite" && snapshot ? (
              <>
                <p className="modal-description">
                  Room <strong>{snapshot.roomCode}</strong> · {snapshot.players.length}/12 players
                  {snapshot.phase === "lobby" ? " · Joining is open." : " · New players must wait for the lobby."}
                </p>
                {!safe ? (
                  <p className="party-help">Reconnect before sharing the latest invitation.</p>
                ) : (
                  <>
                    <InviteLink roomCode={snapshot.roomCode} pin={host ? snapshot.pin : undefined} />
                    {host && snapshot.pin && (
                      <PartySecret
                        key={snapshot.pin}
                        label="Joining PIN"
                        value={snapshot.pin}
                        help="Share only with your group. This PIN admits players; it does not grant hosting or owner administration."
                        disabled={!safe}
                      />
                    )}
                    {!host && <p className="party-help">Ask the host for the joining PIN; only the host receives it.</p>}
                  </>
                )}
              </>
            ) : dialog.kind === "local" || dialog.kind === "home" ? (
              <>
                <p className="modal-description">
                  This does not leave or end your own-phone party. The room
                  keeps running and your saved seat stays in this browser.
                  Return through Recent rooms while it remains active. If
                  everyone disconnects, the party expires after 15 minutes.
                </p>
                {host && (
                  <p className="party-form-error">
                    You’re the host. Transfer hosting from Manage party before
                    leaving if the group wants to keep playing, or end the party
                    if everyone is done.
                  </p>
                )}
                <div className="modal-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setDialog(null)}
                  >
                    Stay here
                  </button>
                  <button
                    className="party-button"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setDialog(null);
                      if (dialog.kind === "home") onRoomChange(null);
                      else onLocal();
                    }}
                  >
                    {dialog.kind === "home" ? "Go to room home" : "Switch to Pass & Play"}
                  </button>
                </div>
              </>
            ) : dialog.kind === "manage" && snapshot && host ? (
              <>
                <p className="modal-description">
                  You’re hosting as {selfName}. Choose what happens to this
                  group. No game or party changes until you confirm.
                </p>
                {!safe && (
                  <p className="party-help">
                    Reconnect and wait for any current action to finish before
                    changing the party or viewing private credentials.
                  </p>
                )}
                <div className="party-manage-actions">
                  <button
                    type="button"
                    className="party-manage-choice"
                    disabled={!safe}
                    onClick={() =>
                      openDialog({ kind: "new-game", gameId: snapshot.gameId })
                    }
                  >
                    <strong>New game, same players</strong>
                    <span>
                      End this scored game and reopen the lobby. Keep players,
                      PIN, settings, completed-game totals, and recent-word
                      history; clear current-game scores and rounds.
                    </span>
                  </button>
                  <button
                    type="button"
                    className="party-manage-choice"
                    disabled={!safe}
                    onClick={() =>
                      openDialog({
                        kind: "fresh",
                        gameId: snapshot.gameId,
                        pin: generateDifferentPin(snapshot.pin),
                      })
                    }
                  >
                    <strong>Start a fresh party</strong>
                    <span>
                      Replace this party in the same room and clear its history
                      and seats. Keep your host name and settings; everyone else
                      rejoins with a new PIN.
                    </span>
                  </button>
                  <button
                    type="button"
                    className="party-manage-choice party-manage-danger"
                    disabled={!safe}
                    onClick={() =>
                      openDialog({ kind: "end", gameId: snapshot.gameId })
                    }
                  >
                    <strong>End party</strong>
                    <span>
                      Disconnect everyone and clear this party’s personal state.
                      Nothing new starts.
                    </span>
                  </button>
                </div>
                <section className="party-manage-section" aria-labelledby="party-joining-pin-title">
                  <h3 id="party-joining-pin-title">Replace the joining PIN</h3>
                  <p className="party-help">
                    Stop old PIN-bearing invitations from admitting new players.
                    Everyone already admitted keeps their seat, role, votes,
                    scores, and history. Share the replacement through Invite players.
                  </p>
                  <button
                    type="button"
                    className="party-button"
                    disabled={!safe}
                    onClick={() => openDialog({
                      kind: "rotate-pin",
                      gameId: snapshot.gameId,
                      pin: generateDifferentPin(snapshot.pin),
                    })}
                  >
                    Replace joining PIN…
                  </button>
                </section>
                <section
                  className="party-manage-section"
                  aria-labelledby="party-host-transfer-title"
                >
                  <h3 id="party-host-transfer-title">Hand over hosting</h3>
                  <p className="party-help">
                    Keep this game, roles, votes, and scores unchanged. The new
                    host must be connected. You stay as a regular player; the
                    old recovery code stops working.
                  </p>
                  <ul className="party-transfer-list">
                    {snapshot.players
                      .filter((player) => player.id !== snapshot.selfId)
                      .map((player) => (
                        <li key={player.id}>
                          <span>
                            {player.name}
                            <small>
                              {player.connected
                                ? "Connected"
                                : "Offline — reconnect first"}
                            </small>
                          </span>
                          <button
                            type="button"
                            className="party-button"
                            disabled={!safe || !player.connected}
                            onClick={() =>
                              openDialog({
                                kind: "transfer",
                                gameId: snapshot.gameId,
                                player,
                              })
                            }
                          >
                            Make host…
                          </button>
                        </li>
                      ))}
                  </ul>
                  {snapshot.players.length === 1 && (
                    <p className="party-help">
                      Another player must join and connect before you can hand
                      over hosting.
                    </p>
                  )}
                </section>
                <section
                  className="party-manage-section"
                  aria-labelledby="party-recovery-title"
                >
                  <h3 id="party-recovery-title">
                    Save your private host recovery code
                  </h3>
                  <p className="party-help">
                    Keep this somewhere private before you need it. Anyone with
                    the full code can take over your host seat, including your
                    private role. The joining PIN never grants hosting. Recover
                    hosting restores your existing seat and replaces the old
                    browser’s access.
                  </p>
                  {snapshot.hostRecoveryCode ? (
                    <PartySecret
                      key={snapshot.hostRecoveryCode}
                      label="Recovery code"
                      value={formatRecoveryCode(snapshot.hostRecoveryCode)}
                      help="Only the current host receives this code. Show and save it privately, or copy it to a safe place. It hides when you switch apps or close this dialog."
                      disabled={!safe}
                    />
                  ) : (
                    <p className="party-help">
                      Waiting for your private host credentials to sync.
                    </p>
                  )}
                  <button
                    type="button"
                    className="party-button"
                    disabled={!safe}
                    onClick={() =>
                      openDialog({ kind: "rotate", gameId: snapshot.gameId })
                    }
                  >
                    Replace recovery code…
                  </button>
                </section>
              </>
            ) : (
              <>
                <p className="modal-description">
                  {dialog.kind === "rotate-pin"
                    ? "The old joining PIN and PIN-bearing invitations stop working immediately. Already admitted players stay connected with the same roles, votes, scores, and completed-game history. The room code and your private host recovery code do not change. Confirm the new PIN, then share a new invitation."
                    : dialog.kind === "new-game"
                      ? "This ends the current game for everyone and clears its scores, roles, ballots, and rounds. Completed-game history and totals are retained; an unfinished game is not recorded. The same players return to the lobby with the same PIN and settings. Recent-word history stays to reduce repeats. No round starts until the host starts it from the lobby."
                      : dialog.kind === "fresh"
                        ? "This replaces the party in the same room and invalidates every old saved seat, including yours. Your host name and settings carry into a new lobby; only you enter it automatically. Everyone else must join the same room again with the new PIN. Scores, roles, votes, completed-game history, and party totals are cleared. Recent-word history is retained."
                        : dialog.kind === "end"
                          ? "Everyone will be disconnected. This room closes and its roles, ballots, scores, names, saved seats, completed-game history, and recent-word storage are cleared. Old room links cannot reopen it. No new party starts."
                        : dialog.kind === "leave"
                          ? "Your seat will be removed from this lobby. You’ll need the PIN to join again before the next game starts."
                          : dialog.kind === "remove"
                            ? `${dialog.player.name} will be removed from the lobby and their saved seat will stop working. They can join again with the PIN before the game starts.`
                            : dialog.kind === "transfer"
                              ? `${dialog.player.name} becomes the host immediately. You remain a regular player with the same role, vote, and score. This game continues unchanged. Your current recovery code stops working; only the new host receives the replacement.`
                              : dialog.kind === "rotate"
                                ? "Your current recovery code stops working immediately. Your seat, role, scores, and game stay unchanged. Afterward, open Manage party to show and save the new private code."
                                : dialog.kind === "skip"
                                  ? "This immediately ends the imposter’s last chance without an answer. Everyone except the imposter receives 1 point and the secret word is revealed. An answer already accepted by the server takes precedence."
                                  : "The party has changed. Close this dialog to view the latest state."}
                </p>
                {(dialog.kind === "fresh" || dialog.kind === "rotate-pin") && (
                  <>
                    <PartyPinField
                      value={dialog.pin}
                      creating
                      disabled={!safe}
                      onChange={(pin) =>
                        setDialog((current) =>
                          current?.kind === dialog.kind && "pin" in current
                            ? { ...current, pin }
                            : current,
                        )
                      }
                    />
                    {dialog.pin === snapshot?.pin && (
                      <p className="party-form-error" role="status">
                        Choose a different joining PIN.
                      </p>
                    )}
                  </>
                )}
                {dialog.kind === "transfer" &&
                  !snapshot?.players.some(
                    (player) =>
                      player.id === dialog.player.id && player.connected,
                  ) && (
                    <p className="party-form-error" role="status">
                      This player is no longer connected. Wait for them to
                      reconnect or choose someone else.
                    </p>
                  )}
                <div className="modal-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={busy}
                    onClick={() => setDialog(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    disabled={!safe || !command}
                    onClick={() => {
                      void confirm();
                    }}
                  >
                    {busy
                      ? "Working…"
                      : dialog.kind === "new-game"
                        ? "Confirm new game, same players"
                        : dialog.kind === "fresh"
                          ? "Confirm fresh party"
                          : dialog.kind === "rotate-pin"
                            ? "Replace joining PIN"
                          : dialog.kind === "end"
                            ? "End party for everyone"
                            : dialog.kind === "leave"
                              ? "Leave party"
                              : dialog.kind === "remove"
                                ? "Remove player"
                                : dialog.kind === "transfer"
                                  ? "Transfer hosting"
                                  : dialog.kind === "rotate"
                                    ? "Replace recovery code"
                                    : dialog.kind === "skip"
                                      ? "End last chance"
                                      : "Confirm"}
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

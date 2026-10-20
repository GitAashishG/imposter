import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CircleHelp,
  DoorOpen,
  RotateCcw,
  ShieldCheck,
  Trophy,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { Eyes, Modal, Scoreboard } from "../components";
import { useParty } from "./useParty";
import type { PartyAction, PartyPlayer } from "./protocol";
import {
  PartyClues,
  PartyDiscussion,
  PartyEntry,
  PartyFinal,
  PartyLobby,
  PartyReady,
  PartyResult,
  PartyRoster,
  PartyRules,
  PartyVote,
  PrivateRoleCard,
} from "./PartyScreens";
import "./party.css";

type PartyDialog =
  | { kind: "rules" | "scores" | "abort" | "end" | "leave" | "local" }
  | { kind: "remove"; player: PartyPlayer };

const phaseNames = {
  lobby: "Lobby",
  role: "Private roles",
  clue: "Spoken clues",
  discussion: "Discussion",
  vote: "Private vote",
  result: "Round result",
  final: "Final standings",
};

export default function PartyApp({ onLocal }: { onLocal: () => void }) {
  const party = useParty();
  const { snapshot, session, status, busy, error } = party;
  const [dialog, setDialog] = useState<PartyDialog | null>(null);
  const [revealKey, setRevealKey] = useState<string | null>(null);
  const [seenKey, setSeenKey] = useState<string | null>(null);
  const host = !!snapshot && snapshot.hostId === snapshot.selfId;
  const safe = status === "online" && !busy;
  const roleKey = snapshot ? `${snapshot.id}:${snapshot.roundNumber}` : "";
  const privatePhase =
    !!snapshot &&
    ["role", "clue", "discussion", "vote"].includes(snapshot.phase);
  const revealed = revealKey === roleKey && privatePhase && !dialog && safe;
  const hostName = snapshot?.players.find(
    (player) => player.id === snapshot.hostId,
  )?.name;
  const offlinePlayers =
    snapshot?.players.filter(
      (player) => !player.connected && player.id !== snapshot.selfId,
    ) ?? [];

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

  useEffect(() => {
    if (!snapshot || snapshot.phase === "lobby" || snapshot.phase === "final") {
      setRevealKey(null);
      setSeenKey(null);
    }
  }, [snapshot?.id, snapshot?.phase]);

  function openDialog(next: PartyDialog) {
    setRevealKey(null);
    setDialog(next);
  }

  function send(action: PartyAction) {
    if (!safe) return;
    setRevealKey(null);
    void party.act(action);
  }

  async function confirm(action: PartyAction) {
    if (!safe) return;
    setRevealKey(null);
    await party.act(action);
    setDialog(null);
  }

  const actionProps = snapshot ? { snapshot, safe, onAction: send } : null;
  const dialogTitle =
    dialog?.kind === "rules"
      ? "Own phones. Same circle."
      : dialog?.kind === "scores"
        ? "The standings"
        : dialog?.kind === "abort"
          ? "Reset this match?"
          : dialog?.kind === "end"
            ? "End the party for everyone?"
            : dialog?.kind === "leave"
              ? "Leave the circle?"
              : dialog?.kind === "remove"
                ? `Remove ${dialog.player.name}?`
                : "Switch to Pass & Play?";

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
          <span className="party-mode-label">OWN PHONES</span>
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
          <button
            type="button"
            className="party-header-button"
            onClick={() =>
              session ? openDialog({ kind: "local" }) : onLocal()
            }
          >
            <ArrowLeft size={17} />
            <span>Pass &amp; Play</span>
          </button>
        </nav>
      </header>

      <main className="party-main">
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
          <div
            className={`party-connection ${status === "online" ? "is-online" : "is-disconnected"}`}
            role="status"
            aria-live="polite"
          >
            <span>
              {status === "online" ? <Wifi size={16} /> : <WifiOff size={16} />}
              <strong>
                {status === "online"
                  ? busy
                    ? "Saving your action…"
                    : "Connected to the circle"
                  : status === "connecting" || status === "checking"
                    ? "Reconnecting to the circle…"
                    : "Connection lost. Your seat is saved."}
              </strong>
            </span>
            {status !== "online" ? (
              <>
                <p>
                  Your screen may be out of date. Actions and private reveals
                  are disabled until you reconnect.
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
              Own-phone play needs the Cloudflare party backend to be deployed
              and its address set in <code>VITE_PARTY_API_URL</code>.
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
                ? "The party server could not be reached. Your saved session is still on this device. Reconnect to recover your own role, vote, and score."
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
              Keep this browser’s saved data. Opening another browser won’t
              restore your identity.
            </p>
          </section>
        ) : !snapshot ? (
          <PartyEntry
            publicParty={party.publicParty}
            disabled={busy || status === "checking" || status === "connecting"}
            busy={busy}
            checking={status === "checking"}
            onCreate={party.create}
            onJoin={party.join}
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
                      ? "Everyone must be connected before the match starts."
                      : host
                        ? "Wait for them to return on the same browser. If someone is gone for good, reset to the lobby, then remove them."
                        : "Your host can reset to the lobby if someone can’t return. Your current score and vote are saved."}
                  </p>
                </div>
              </div>
            )}
            {snapshot.phase === "lobby" && actionProps ? (
              <PartyLobby
                {...actionProps}
                onRemove={(player) => openDialog({ kind: "remove", player })}
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
                    {snapshot.phase === "result" && (
                      <PartyResult {...actionProps} />
                    )}
                    {snapshot.phase === "final" && (
                      <PartyFinal {...actionProps} />
                    )}
                  </section>
                  {privatePhase && (
                    <aside
                      className="party-game-sidebar"
                      aria-label="Your role and the circle"
                    >
                      {snapshot.phase !== "role" && snapshot.ownRole && (
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
                        </p>
                      </section>
                    </aside>
                  )}
                </div>
              )
            )}
            <div className="party-management" aria-label="Party controls">
              {host ? (
                <>
                  {snapshot.phase !== "lobby" && snapshot.phase !== "final" && (
                    <button
                      type="button"
                      className="party-link"
                      disabled={!safe}
                      onClick={() => openDialog({ kind: "abort" })}
                    >
                      <RotateCcw size={15} />
                      Reset to lobby
                    </button>
                  )}
                  <button
                    type="button"
                    className="party-link party-danger-link"
                    disabled={!safe}
                    onClick={() => openDialog({ kind: "end" })}
                  >
                    <DoorOpen size={15} />
                    End party for everyone
                  </button>
                </>
              ) : snapshot.phase === "lobby" ? (
                <button
                  type="button"
                  className="party-link"
                  disabled={!safe}
                  onClick={() => openDialog({ kind: "leave" })}
                >
                  <DoorOpen size={15} />
                  Leave party
                </button>
              ) : (
                <p>Need to leave? Ask the host to reset to the lobby first.</p>
              )}
            </div>
          </>
        )}
      </main>

      <footer className="party-footer">
        <span>
          A little Nepali. A little American. All <span lang="ne">रमाइलो</span>.
        </span>
        <span>Same room. Your own phone. No accounts.</span>
      </footer>

      {dialog && (
        <Modal title={dialogTitle} onClose={() => setDialog(null)}>
          <div className="party-dialog-content">
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
            ) : dialog.kind === "local" ? (
              <>
                <p className="modal-description">
                  Your own-phone party will keep running. This does not leave or
                  end it. Your saved seat stays in this browser so you can
                  switch back and reconnect.
                </p>
                {host && (
                  <p className="party-form-error">
                    You’re the host. The group can’t move through host-led
                    phases while you’re away. End the party first if everyone is
                    done.
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
                    onClick={onLocal}
                  >
                    Switch to Pass &amp; Play
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="modal-description">
                  {dialog.kind === "abort"
                    ? "This ends the current match for everyone and resets all scores and word history. The roster, PIN, and settings stay, so you can remove missing players or start fresh."
                    : dialog.kind === "end"
                      ? "Everyone will be disconnected and all roles, votes, scores, and saved seats for this party will be cleared. You can create a new party afterward."
                      : dialog.kind === "leave"
                        ? "Your seat will be removed from this lobby. You’ll need the PIN to join again, and can only rejoin before the match starts."
                        : dialog.kind === "remove"
                          ? `${dialog.player.name} will be removed from the lobby and their saved seat will stop working. They can join again with the PIN before the match starts.`
                          : ""}
                </p>
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
                    disabled={
                      !safe ||
                      !snapshot ||
                      (dialog.kind === "leave" && snapshot.phase !== "lobby") ||
                      (dialog.kind === "remove" &&
                        (snapshot.phase !== "lobby" ||
                          !snapshot.players.some(
                            (player) => player.id === dialog.player.id,
                          )))
                    }
                    onClick={() => {
                      if (dialog.kind === "abort")
                        void confirm({ type: "back-to-lobby" });
                      else if (dialog.kind === "end")
                        void confirm({ type: "end-party" });
                      else if (dialog.kind === "leave")
                        void confirm({ type: "leave" });
                      else if (dialog.kind === "remove")
                        void confirm({
                          type: "remove-player",
                          playerId: dialog.player.id,
                        });
                    }}
                  >
                    {busy
                      ? "Working…"
                      : dialog.kind === "abort"
                        ? "Reset match"
                        : dialog.kind === "end"
                          ? "End party"
                          : dialog.kind === "leave"
                            ? "Leave party"
                            : "Remove player"}
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

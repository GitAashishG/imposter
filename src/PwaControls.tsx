import { useEffect, useState } from "react";
import {
  CircleCheck,
  CloudOff,
  Download,
  Info,
  PackageCheck,
  Share,
  SquarePlus,
  TriangleAlert,
  Wifi,
} from "lucide-react";
import { Modal } from "./components";
import { usePwa } from "./pwa";
import "./pwa.css";

export function PwaControls({ gameActive }: { gameActive: boolean }) {
  const pwa = usePwa();
  const [helpOpen, setHelpOpen] = useState(false);

  // A multiplayer round can start asynchronously; never leave guidance over roles.
  useEffect(() => {
    if (gameActive) setHelpOpen(false);
  }, [gameActive]);

  if (gameActive) return null;

  const status = pwa.offlineReady
    ? {
        tone: "ready",
        Icon: CircleCheck,
        headline: "Offline Pass & Play ready.",
        detail: "Own Phones still needs internet.",
      }
    : pwa.offlineError
      ? {
          tone: "error",
          Icon: CloudOff,
          headline: "Offline Pass & Play unavailable.",
          detail:
            "This browser couldn’t save it for offline use. Own Phones always needs internet.",
        }
      : {
          tone: "pending",
          Icon: Wifi,
          headline: "Offline Pass & Play not confirmed yet.",
          detail: "Stay connected for now. Own Phones always needs internet.",
        };
  const StatusIcon = status.Icon;

  function requestInstall() {
    if (pwa.installPromptAvailable) void pwa.install();
    else setHelpOpen(true);
  }

  return (
    <section className="pwa-controls" aria-label="Offline play and app install">
      <p className={`pwa-status pwa-status-${status.tone}`} role="status">
        <StatusIcon size={16} aria-hidden="true" />
        <span>
          <strong>{status.headline}</strong> {status.detail}
        </span>
      </p>
      {pwa.updateReady && (
        <p className="pwa-status pwa-status-update" role="status">
          <PackageCheck size={16} aria-hidden="true" />
          <span>
            <strong>Update ready.</strong> Finish your game, close every Ko Ho
            tab and installed app window, then reopen Ko Ho.
          </span>
        </p>
      )}
      <div className="pwa-actions">
        {!pwa.installed && (
          <button
            type="button"
            className="pwa-button pwa-install-button"
            onClick={requestInstall}
            disabled={pwa.installing}
            aria-busy={pwa.installing}
            aria-haspopup={pwa.installPromptAvailable ? undefined : "dialog"}
          >
            <Download size={15} aria-hidden="true" />
            {pwa.installing ? "Installing…" : "Install app"}
          </button>
        )}
        <button
          type="button"
          className="pwa-button"
          onClick={() => setHelpOpen(true)}
          aria-haspopup="dialog"
        >
          <Info size={15} aria-hidden="true" />
          Offline tips
        </button>
      </div>

      {helpOpen && (
        <Modal
          title="Keep Ko Ho on this device."
          onClose={() => setHelpOpen(false)}
        >
          <div className="pwa-help">
            <p className="modal-description">
              {pwa.offlineReady
                ? "Offline Pass & Play is ready here: one shared phone works without a connection. Own Phones always needs internet."
                : pwa.offlineError
                  ? "Offline Pass & Play couldn’t be saved in this browser, so keep a connection. Own Phones always needs internet."
                  : "Offline Pass & Play isn’t confirmed on this device yet. Stay connected until the status says ready. Own Phones always needs internet."}
            </p>

            {pwa.installed ? (
              <p className="pwa-help-installed">
                <CircleCheck size={15} aria-hidden="true" />
                You’re using the installed Ko Ho app.
              </p>
            ) : (
              <section
                className="pwa-help-section"
                aria-labelledby="pwa-install-heading"
              >
                <h3 id="pwa-install-heading">
                  {pwa.ios ? "Install on iPhone or iPad" : "Install the app"}
                </h3>
                {pwa.installPromptAvailable && (
                  <>
                    <button
                      type="button"
                      className="pwa-button pwa-install-button pwa-native-install"
                      onClick={() => void pwa.install()}
                      disabled={pwa.installing}
                      aria-busy={pwa.installing}
                    >
                      <Download size={15} aria-hidden="true" />
                      {pwa.installing ? "Installing…" : "Install Ko Ho"}
                    </button>
                    <p className="pwa-help-or">Or use your browser menu:</p>
                  </>
                )}
                {pwa.ios ? (
                  <ol className="pwa-steps">
                    <li>
                      In Safari, tap <strong>Share</strong>{" "}
                      <Share size={14} aria-hidden="true" /> (or{" "}
                      <strong>More</strong>, then <strong>Share</strong>).
                    </li>
                    <li>
                      Tap <strong>Add to Home Screen</strong>{" "}
                      <SquarePlus size={14} aria-hidden="true" />.
                    </li>
                    <li>
                      Keep <strong>Open as Web App</strong> on if it appears.
                    </li>
                    <li>
                      Tap <strong>Add</strong>, then open Ko Ho from your Home
                      Screen.
                    </li>
                  </ol>
                ) : (
                  <ol className="pwa-steps">
                    <li>
                      Open the browser menu (<strong>⋮</strong> or{" "}
                      <strong>⋯</strong>), or the install icon in the address
                      bar.
                    </li>
                    <li>
                      Choose <strong>Install app</strong> or{" "}
                      <strong>Add to Home screen</strong>.
                    </li>
                    <li>
                      Confirm, then open Ko Ho from your home screen, dock, or
                      app list.
                    </li>
                  </ol>
                )}
                {!pwa.ios && (
                  <p className="pwa-help-note">
                    Some browsers can’t install web apps. You can still play in
                    a tab.
                  </p>
                )}
              </section>
            )}

            {pwa.updateReady && (
              <p className="pwa-status pwa-status-update">
                <PackageCheck size={16} aria-hidden="true" />
                <span>
                  <strong>Update ready.</strong> Finish your game, close every
                  Ko Ho tab and installed app window, then reopen Ko Ho. It
                  won’t interrupt a game.
                </span>
              </p>
            )}

            <div className="pwa-caveats">
              <TriangleAlert size={16} aria-hidden="true" />
              <ul>
                <li>
                  Closing or refreshing an unfinished Pass & Play game loses it.
                  Finish first.
                </li>
                <li>
                  The installed app and this browser may keep separate setup,
                  history, and Own Phones seats.
                </li>
                <li>
                  Updates apply only after every Ko Ho tab and app window is
                  closed and reopened.
                </li>
              </ul>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setHelpOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { MonitorSmartphone, Vibrate } from "lucide-react";

interface Preferences {
  keepAwake: boolean;
  vibrate: boolean;
}
const KEY = "ko-ho-device-options-v1";

function loadPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return {
      keepAwake: value?.keepAwake === true,
      vibrate: value?.vibrate === true,
    };
  } catch {
    return { keepAwake: false, vibrate: false };
  }
}

export function DeviceOptions({
  active,
  turnKey,
}: {
  active: boolean;
  turnKey: string | null;
}) {
  const [preferences, setPreferences] = useState(loadPreferences);
  const wakeSupported = "wakeLock" in navigator;
  const vibrationSupported = typeof navigator.vibrate === "function";
  const sentinel = useRef<WakeLockSentinel | null>(null);
  const lastTurn = useRef<string | null>(null);
  const [wakeStatus, setWakeStatus] = useState<
    "idle" | "requesting" | "held" | "released" | "denied"
  >("idle");
  const [vibrationStatus, setVibrationStatus] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  function change(next: Preferences) {
    setPreferences(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* Visit-only options still work. */
    }
  }

  useEffect(() => {
    let disposed = false;
    let pending = false;
    const release = () => {
      const current = sentinel.current;
      sentinel.current = null;
      if (current && !current.released)
        void current.release().catch(() => undefined);
    };
    const acquire = async () => {
      if (
        disposed ||
        !wakeSupported ||
        !preferences.keepAwake ||
        !active ||
        document.visibilityState !== "visible" ||
        pending ||
        sentinel.current
      )
        return;
      pending = true;
      setWakeStatus("requesting");
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (disposed || document.visibilityState !== "visible") {
          await lock.release();
          return;
        }
        sentinel.current = lock;
        setWakeStatus("held");
        lock.addEventListener("release", () => {
          if (sentinel.current === lock) {
            sentinel.current = null;
            if (!disposed) setWakeStatus("released");
          }
        });
      } catch {
        if (!disposed) setWakeStatus("denied");
      } finally {
        pending = false;
      }
    };
    const visibility = () => {
      if (document.visibilityState !== "visible") {
        release();
        setWakeStatus("released");
      } else void acquire();
    };
    setWakeStatus("idle");
    void acquire();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", visibility);
      release();
    };
  }, [active, preferences.keepAwake, wakeSupported, retry]);

  useEffect(() => {
    if (!turnKey || lastTurn.current === turnKey) return;
    lastTurn.current = turnKey;
    if (
      preferences.vibrate &&
      vibrationSupported &&
      !navigator.vibrate([80, 40, 80])
    ) {
      setVibrationStatus(
        "This browser declined the turn vibration. Keep the game visible.",
      );
    }
  }, [turnKey, preferences.vibrate, vibrationSupported]);

  useEffect(
    () => () => {
      if (vibrationSupported) navigator.vibrate(0);
    },
    [vibrationSupported],
  );

  const wakeMessage = !wakeSupported
    ? "Screen wake lock is not available in this browser."
    : !preferences.keepAwake
      ? "Off. Your usual screen timeout applies."
      : !active
        ? "Ready — the screen stays awake during a game, not in the lobby."
        : wakeStatus === "held"
          ? "Keeping this screen awake while you play."
          : wakeStatus === "requesting"
            ? "Requesting screen wake lock…"
            : wakeStatus === "denied"
              ? "The browser or device declined wake lock. Battery saving may prevent it."
              : "Wake lock is paused. Return to this tab, or retry.";

  return (
    <details className="device-options">
      <summary>
        <MonitorSmartphone size={16} aria-hidden="true" />
        <span>This phone’s options</span>
        <small>screen & turn alerts</small>
      </summary>
      <div className="device-options-body">
        <div className="device-option-row">
          <label>
            <input
              type="checkbox"
              checked={preferences.keepAwake}
              disabled={!wakeSupported}
              onChange={(event) =>
                change({ ...preferences, keepAwake: event.target.checked })
              }
            />
            <span>Keep screen awake while playing</span>
          </label>
          <p role="status" aria-live="polite">
            {wakeMessage}
          </p>
          {wakeSupported &&
            preferences.keepAwake &&
            active &&
            (wakeStatus === "denied" || wakeStatus === "released") && (
              <button
                type="button"
                className="device-retry"
                onClick={() => setRetry((value) => value + 1)}
              >
                Retry wake lock
              </button>
            )}
        </div>
        <div className="device-option-row">
          <label>
            <input
              type="checkbox"
              checked={preferences.vibrate}
              disabled={!vibrationSupported}
              onChange={(event) => {
                change({ ...preferences, vibrate: event.target.checked });
                setVibrationStatus(null);
              }}
            />
            <span>
              <Vibrate size={15} aria-hidden="true" />
              Vibrate when it’s my clue turn
            </span>
          </label>
          <p>
            {vibrationSupported
              ? "Optional, private turn alerts. Some devices, including iPhones, do not provide browser vibration; silent mode can also suppress it."
              : "Browser vibration is not available on this device. Turn order remains visible on screen."}
          </p>
          {vibrationSupported && preferences.vibrate && (
            <button
              type="button"
              className="device-retry"
              onClick={() =>
                setVibrationStatus(
                  navigator.vibrate([80, 40, 80])
                    ? "Vibration request accepted. Hardware and device settings determine whether you feel it."
                    : "This browser declined vibration. Try again after interacting with the game.",
                )
              }
            >
              Test vibration
            </button>
          )}
          {vibrationStatus && <p role="status">{vibrationStatus}</p>}
        </div>
      </div>
    </details>
  );
}

import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  CookingPot,
  Globe2,
  Heart,
  Minus,
  Mountain,
  Plus,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { PACKS } from "./data";
import type { PackId } from "./data";
import { validateSetup } from "./game";
import type { Settings } from "./game";
import { Eyes, PrimaryButton } from "./components";
import { SUGGESTED_PLAYER_NAMES } from "./playerNames";

export interface Preferences {
  names: string[];
  settings: Settings;
}
const DEFAULTS: Preferences = {
  names: SUGGESTED_PLAYER_NAMES.slice(0, 4),
  settings: {
    packIds: ["everyday", "culture", "diaspora", "classic"],
    rounds: 5,
    discussionSeconds: 60,
  },
};
const STORAGE_KEY = "ko-ho-setup-v1";

export function loadPreferences(): Preferences {
  try {
    const raw: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "null",
    );
    if (
      !raw ||
      typeof raw !== "object" ||
      !("names" in raw) ||
      !("settings" in raw)
    )
      return DEFAULTS;
    const { names, settings } = raw;
    if (
      !Array.isArray(names) ||
      !names.every((name) => typeof name === "string") ||
      !settings ||
      typeof settings !== "object"
    )
      return DEFAULTS;
    const value = settings as Settings;
    if (!Array.isArray(value.packIds) || validateSetup(names, value))
      return DEFAULTS;
    return { names, settings: value };
  } catch {
    return DEFAULTS;
  }
}

export function savePreferences(preferences: Preferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    /* The game also works with storage disabled. */
  }
}

const packIcons = {
  everyday: CookingPot,
  culture: Mountain,
  diaspora: Globe2,
  classic: Sparkles,
};

export default function Setup({
  initial,
  onStart,
}: {
  initial: Preferences;
  onStart: (preferences: Preferences) => void;
}) {
  const [names, setNames] = useState(initial.names);
  const [settings, setSettings] = useState(initial.settings);
  const [error, setError] = useState<string | null>(null);

  function togglePack(id: PackId) {
    const packIds = settings.packIds.includes(id)
      ? settings.packIds.filter((pack) => pack !== id)
      : [...settings.packIds, id];
    if (!packIds.length) {
      setError("Keep at least one word pack in the mix.");
      return;
    }
    setError(null);
    setSettings({ ...settings, packIds });
  }

  function start(event: React.FormEvent) {
    event.preventDefault();
    const message = validateSetup(names, settings);
    setError(message);
    if (!message)
      onStart({ names: names.map((name) => name.trim()), settings });
  }

  return (
    <main className="setup-layout">
      <section className="intro" aria-labelledby="intro-title">
        <div className="eyebrow">
          <span className="status-dot" /> THE GET-TOGETHER JUST GOT INTERESTING
        </div>
        <h1 id="intro-title">
          Your people.
          <br />
          One <span className="serif-italic">imposter.</span>
        </h1>
        <p className="intro-copy">
          Someone in the circle is bluffing.
          <br />
          The rest of you? Figure out <span lang="ne">को हो?</span>
        </p>
        <div className="hero-art" aria-hidden="true">
          <span className="art-orbit orbit-one" />
          <span className="art-orbit orbit-two" />
          <div className="art-card back-card">
            <span className="card-kicker">YOU KNOW THE WORD.</span>
            <div className="word-lines">
              <i />
              <i />
              <i />
            </div>
            <span className="tiny-star">✳</span>
          </div>
          <div className="art-card front-card">
            <span className="card-kicker">YOU? JUST ACT NATURAL.</span>
            <Eyes />
            <span className="art-imposter">THE IMPOSTER</span>
          </div>
          <span className="art-note">
            trust no one.
            <svg viewBox="0 0 80 40">
              <path
                d="M4 4Q20 36 69 22M59 14l13 7-11 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
          </span>
          <span className="spark spark-one">✧</span>
          <span className="spark spark-two">✳</span>
        </div>
        <div className="culture-note">
          <Heart size={17} />
          <p>
            Made for the <strong>“one more game”</strong> crowd.
            <br />A little Nepali. A little American. All{" "}
            <span lang="ne">रमाइलो</span>.
          </p>
        </div>
        <div className="quick-facts">
          <span>
            <Users size={16} /> 3–12 players
          </span>
          <span>
            <ShieldCheck size={16} /> One phone. No sign-up.
          </span>
        </div>
      </section>

      <section className="setup-card" aria-labelledby="setup-title">
        <div className="setup-heading">
          <div>
            <span className="eyebrow muted">
              GOOD COMPANY. QUESTIONABLE ALIBIS.
            </span>
            <h2 id="setup-title">Get the gang together.</h2>
          </div>
          <span className="edition-tag">
            PARTY MODE <ArrowUpRight size={12} />
          </span>
        </div>
        <form onSubmit={start}>
          <fieldset className="players-fieldset">
            <legend>
              <span className="section-number">01</span> Who’s playing?{" "}
              <span className="count-badge">{names.length}</span>
            </legend>
            <p className="field-hint">Real names. Nicknames. That one dai.</p>
            <div className="player-inputs">
              {names.map((name, index) => (
                <div className="player-input" key={index}>
                  <span className="player-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <input
                    aria-label={`Player ${index + 1} name`}
                    maxLength={24}
                    autoComplete="off"
                    value={name}
                    onFocus={(event) => event.target.select()}
                    onChange={(event) => {
                      setNames(
                        names.map((value, i) =>
                          i === index ? event.target.value : value,
                        ),
                      );
                      setError(null);
                    }}
                  />
                  {names.length > 3 && (
                    <button
                      type="button"
                      className="remove-player"
                      aria-label={`Remove player ${index + 1}`}
                      onClick={() => {
                        setNames(names.filter((_, i) => i !== index));
                        setError(null);
                      }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              className="add-player"
              disabled={names.length >= 12}
              onClick={() => {
                const used = new Set(
                  names.map((name) => name.trim().toLowerCase()),
                );
                const suggestion = SUGGESTED_PLAYER_NAMES.find(
                  (name) => !used.has(name.toLowerCase()),
                );
                let n = names.length + 1;
                while (used.has(`player ${n}`)) n++;
                setNames([...names, suggestion ?? `Player ${n}`]);
                setError(null);
              }}
            >
              <Plus size={15} />{" "}
              {names.length >= 12
                ? "The circle is full (12 max)"
                : "Add a player"}
            </button>
          </fieldset>

          <fieldset className="packs-fieldset">
            <legend>
              <span className="section-number">02</span> Pick your mix{" "}
              <span className="optional-label">choose a few, or all</span>
            </legend>
            <div className="pack-grid">
              {PACKS.map((pack) => {
                const Icon = packIcons[pack.id];
                const selected = settings.packIds.includes(pack.id);
                return (
                  <button
                    key={pack.id}
                    type="button"
                    className={`pack-card pack-${pack.id} ${selected ? "selected" : ""}`}
                    aria-pressed={selected}
                    onClick={() => togglePack(pack.id)}
                  >
                    <span className="pack-top">
                      <Icon size={21} strokeWidth={1.6} />
                      <span className="pack-check">
                        {selected ? (
                          <Check size={11} strokeWidth={3} />
                        ) : (
                          <Plus size={11} />
                        )}
                      </span>
                    </span>
                    <strong>{pack.name}</strong>
                    <span className="pack-nepali" lang="ne">
                      {pack.nepali}
                    </span>
                    <span className="pack-description">{pack.description}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="rounds-fieldset">
            <legend>
              <span className="section-number">03</span> Make it a game
            </legend>
            <div className="options-row">
              <div>
                <label id="rounds-label">Rounds</label>
                <div
                  className="segmented"
                  role="group"
                  aria-labelledby="rounds-label"
                >
                  {[3, 5, 7].map((rounds) => (
                    <button
                      key={rounds}
                      type="button"
                      aria-pressed={settings.rounds === rounds}
                      onClick={() => setSettings({ ...settings, rounds })}
                    >
                      {rounds}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="discussion-time">Discussion time</label>
                <select
                  id="discussion-time"
                  value={settings.discussionSeconds}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      discussionSeconds: Number(event.target.value),
                    })
                  }
                >
                  {[30, 60, 90, 120].map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds < 60
                        ? `${seconds} seconds`
                        : `${seconds / 60} ${seconds === 60 ? "minute" : "minutes"}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="imposter-note">
              <span className="mini-face">
                <Minus size={12} />
                <Minus size={12} />
              </span>{" "}
              1 imposter. A whole room of suspects.
            </div>
          </fieldset>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <PrimaryButton type="submit">
            Let’s play <span lang="ne">— खेलौँ!</span>
          </PrimaryButton>
          <p className="start-footnote">Pass the phone, not the secret.</p>
        </form>
      </section>
    </main>
  );
}

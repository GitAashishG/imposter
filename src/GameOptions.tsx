import type { Settings } from "./game";

export function GameOptions({
  settings,
  onChange,
  disabled = false,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="game-options" disabled={disabled}>
      <legend>Optional twists</legend>
      <div className="clue-cycle-choice">
        <div>
          <strong id="clue-cycles-label">Clue cycles</strong>
          <p>
            Give everyone one clue, or go around the circle twice before
            discussing.
          </p>
        </div>
        <div
          role="group"
          aria-labelledby="clue-cycles-label"
          className="rule-segmented"
        >
          {([1, 2] as const).map((clueCycles) => (
            <button
              key={clueCycles}
              type="button"
              aria-pressed={settings.clueCycles === clueCycles}
              onClick={() => onChange({ ...settings, clueCycles })}
            >
              {clueCycles === 1 ? "Once" : "Twice"}
            </button>
          ))}
        </div>
      </div>
      <label className="last-chance-choice">
        <input
          type="checkbox"
          checked={settings.lastChanceGuess}
          onChange={(event) =>
            onChange({ ...settings, lastChanceGuess: event.target.checked })
          }
        />
        <span>
          <strong>Last-chance imposter guess</strong>
          <small>
            When caught, the imposter gets one English or Nepali guess in 30
            seconds. Get it right to escape with 2 points; otherwise the group
            scores.
          </small>
        </span>
      </label>
      <p className="rule-default-note">
        Standard rules: one clue cycle, no last-chance guess.
      </p>
    </fieldset>
  );
}

import { Check, Hand, Smartphone } from "lucide-react";

export type PlayMode = "local" | "party";

const modes = [
  { id: "local", label: "Pass & Play", detail: "One shared phone", icon: Hand },
  {
    id: "party",
    label: "Own Phones",
    detail: "A phone for everyone",
    icon: Smartphone,
  },
] as const;

export function PlayModeSwitch({
  mode,
  onChange,
}: {
  mode: PlayMode;
  onChange: (next: PlayMode) => void;
}) {
  return (
    <section className="mode-picker" aria-label="Choose how to play">
      <p className="mode-picker-label">YOUR CIRCLE. YOUR WAY.</p>
      <div className="play-mode-switch" role="group" aria-label="Play mode">
        {modes.map(({ id, label, detail, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className="play-mode-option"
            aria-pressed={mode === id}
            onClick={() => {
              if (mode !== id) onChange(id);
            }}
          >
            <Icon size={23} strokeWidth={1.6} aria-hidden="true" />
            <span>
              <strong>{label}</strong>
              <small>{detail}</small>
            </span>
            <span className="mode-selected" aria-hidden="true">
              {mode === id && <Check size={13} strokeWidth={2.5} />}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

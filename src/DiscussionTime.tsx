import { useEffect, useId, useState } from "react";

export function DiscussionTimeControl({ seconds, onChange, disabled = false }: {
  seconds: number;
  onChange: (seconds: number) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const minutes = Math.min(15, Math.max(1, Math.round(seconds / 60)));
  const [draft, setDraft] = useState(String(minutes));
  useEffect(() => setDraft(String(minutes)), [minutes]);

  function commit(value: string) {
    const next = Number(value);
    if (!disabled && Number.isInteger(next) && next >= 1 && next <= 15 && next * 60 !== seconds) onChange(next * 60);
  }

  return <div className="discussion-time-control">
    <div className="discussion-time-heading"><label htmlFor={id}>Discussion time</label><output htmlFor={id}>{draft} {draft === "1" ? "minute" : "minutes"}</output></div>
    <input id={id} type="range" min={1} max={15} step={1} value={draft} disabled={disabled} aria-valuetext={`${draft} ${draft === "1" ? "minute" : "minutes"}`} onChange={(event) => setDraft(event.target.value)} onPointerUp={(event) => commit(event.currentTarget.value)} onPointerCancel={() => setDraft(String(minutes))} onKeyUp={(event) => commit(event.currentTarget.value)} onBlur={(event) => commit(event.currentTarget.value)} />
    <div className="discussion-time-bounds" aria-hidden="true"><span>1 min</span><span>15 min</span></div>
    <small>Whole-minute steps. Use the slider or arrow keys.</small>
  </div>;
}

"use client";

// Slice 21c, Decision 10: the range choice over the Barber Ledger's Summary and Payout history.
// The options are slice 20's presets (`presetRange`), so every range ends today or before, plus
// any the page adds (the ledger's picked business date). Presentation only: the page owns the
// choice and makes the requests. Slice 22, Decision 2: a sixth choice, Custom, opens From and To
// and an Apply that `customOption` checks with the same `parseRange` the routes use.

import { useState } from "react";
import { PRESETS, parseRange, presetRange, type Preset } from "@/lib/date-range";

export type RangeOption = { key: string; label: string; from: string; to: string };

const PRESET_LABELS: Record<Preset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This week",
  thisMonth: "This month",
  last7Days: "Last 7 days",
};

/** Slice 20's presets as options, in its order. `today` is the Manila business date. */
export function presetOptions(today: string): RangeOption[] {
  return PRESETS.map((name) => ({ key: name, label: PRESET_LABELS[name], ...presetRange(name, today) }));
}

export const CUSTOM_KEY = "custom";

/** A Custom range as an option, or the error `parseRange` gives (the routes' own wording). */
export function customOption(from: string, to: string, today: string): RangeOption | { error: string } {
  const parsed = parseRange(from, to, today);
  if (!parsed.ok) return { error: parsed.error };
  return { key: CUSTOM_KEY, label: "Custom", from, to };
}

// Business dates are YYYY-MM-DD calendar dates, so they are formatted as dates, not instants.
const day = (iso: string) =>
  new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

/** "Sun, Nov 15, 2026" or "Mon, Nov 9, 2026 to Sun, Nov 15, 2026". */
export function rangeText(from: string, to: string) {
  return from === to ? day(from) : `${day(from)} to ${day(to)}`;
}

export function DateRangeBar({ options, selected, onSelect, label, busy = false, today, onCustom }: {
  options: RangeOption[];
  selected: string;
  onSelect: (key: string) => void;
  /** What the range drives, for screen readers ("Dates for the summary and the payout history"). */
  label: string;
  busy?: boolean;
  /** With `onCustom`, the bar offers Custom; `today` is the Manila business date (the fields' max). */
  today?: string;
  onCustom?: (option: RangeOption) => void;
}) {
  const current = options.find((option) => option.key === selected) ?? options[0];
  const canCustom = Boolean(onCustom && today);
  const [editing, setEditing] = useState(false);
  const [from, setFrom] = useState(current.from);
  const [to, setTo] = useState(current.to);
  const [error, setError] = useState<string | null>(null);

  function apply() {
    const result = customOption(from, to, today!);
    if ("error" in result) {
      setError(result.error); // the figures keep the range they show
      return;
    }
    setError(null);
    setEditing(false);
    onCustom!(result);
  }

  return (
    <div className="space-y-2">
      <div role="group" aria-label={label} className="rz-seg flex-wrap">
        {options.filter((option) => option.key !== CUSTOM_KEY).map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={option.key === current.key}
            onClick={() => { setEditing(false); setError(null); onSelect(option.key); }}
            className="rz-seg-item flex-1 whitespace-nowrap px-3 pointer-coarse:min-h-11"
          >
            {option.label}
          </button>
        ))}
        {canCustom && (
          <button
            type="button"
            aria-pressed={current.key === CUSTOM_KEY || editing}
            aria-expanded={editing}
            onClick={() => { setFrom(current.from); setTo(current.to); setError(null); setEditing((open) => !open); }}
            className="rz-seg-item flex-1 whitespace-nowrap px-3 pointer-coarse:min-h-11"
          >
            Custom
          </button>
        )}
      </div>
      {editing && canCustom && (
        <div className="flex flex-col sm:flex-row sm:items-end gap-2">
          <label className="text-xs text-dust space-y-1">
            <span className="block">From</span>
            <input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} className="rz-field w-auto py-1.5 pointer-coarse:min-h-11 sm:text-sm" />
          </label>
          <label className="text-xs text-dust space-y-1">
            <span className="block">To</span>
            <input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} className="rz-field w-auto py-1.5 pointer-coarse:min-h-11 sm:text-sm" />
          </label>
          <button type="button" onClick={apply} className="rz-btn rz-btn-secondary text-sm pointer-coarse:min-h-11">Apply</button>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-crimson-ink">{error}</p>}
      <p aria-live="polite" className="text-xs text-dust tabular-nums">
        {rangeText(current.from, current.to)}
        {busy && <span> · Loading…</span>}
      </p>
    </div>
  );
}

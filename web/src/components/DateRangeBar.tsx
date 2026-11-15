"use client";

// Slice 21c, Decision 10: the range choice over the Barber Ledger's Summary and Payout history.
// The options are slice 20's presets (`presetRange`), so every range ends today or before, plus
// any the page adds (the ledger's picked business date). Presentation only: the page owns the
// choice and makes the requests. A custom from and to is not offered (the spec's first cut).

import { PRESETS, presetRange, type Preset } from "@/lib/date-range";

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

// Business dates are YYYY-MM-DD calendar dates, so they are formatted as dates, not instants.
const day = (iso: string) =>
  new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

/** "Sun, Nov 15, 2026" or "Mon, Nov 9, 2026 to Sun, Nov 15, 2026". */
export function rangeText(from: string, to: string) {
  return from === to ? day(from) : `${day(from)} to ${day(to)}`;
}

export function DateRangeBar({ options, selected, onSelect, label, busy = false }: {
  options: RangeOption[];
  selected: string;
  onSelect: (key: string) => void;
  /** What the range drives, for screen readers ("Dates for the summary and the payout history"). */
  label: string;
  busy?: boolean;
}) {
  const current = options.find((option) => option.key === selected) ?? options[0];
  return (
    <div className="space-y-2">
      <div role="group" aria-label={label} className="rz-seg flex-wrap">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={option.key === current.key}
            onClick={() => onSelect(option.key)}
            className="rz-seg-item flex-1 whitespace-nowrap px-3 pointer-coarse:min-h-11"
          >
            {option.label}
          </button>
        ))}
      </div>
      <p aria-live="polite" className="text-xs text-dust tabular-nums">
        {rangeText(current.from, current.to)}
        {busy && <span> · Loading…</span>}
      </p>
    </div>
  );
}

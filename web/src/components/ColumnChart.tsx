"use client";

// Column chart for the owner's trend charts on /insights: one value per column.
// Hover, a tap or the arrow keys show the same tooltip, and "Show as table" lists every value,
// so nothing depends on hovering. Columns are at most 24px wide with a 4px rounded top;
// emphasised columns are red and the rest are context grey (red-500 vs zinc-500 on the card:
// both above 3:1 contrast, and told apart under colour blindness; the emphasised day's axis
// label is also bold).
import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";

export type Column = {
  key: string;
  axisLabel: string; // short label under the column ("13", "Tue", "2p")
  label: string; // full label for the tooltip and the table ("Tue, Oct 13")
  value: number; // column height
  valueText: string; // formatted value ("₱1,230.00")
  detail?: string; // second line in the tooltip and the table ("5 paid sales")
  emphasis?: boolean;
};

type Props = {
  columns: Column[];
  unit: "peso" | "count";
  summary: string; // what the chart shows, read by screen readers
  labelHeading: string; // table heading for the labels ("Day")
  valueHeading: string; // table heading for the values ("Revenue")
  labelEvery?: number; // show every nth axis label, counted back from the last column
  height?: number; // plot height in px
};

export function ColumnChart({ columns, unit, summary, labelHeading, valueHeading, labelEvery = 1, height = 176 }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const hintId = useId();
  const count = columns.length;
  const ticks = niceTicks(Math.max(0, ...columns.map((c) => c.value)), unit);
  const top = ticks[ticks.length - 1];
  const emphasisIndex = columns.findIndex((c) => c.emphasis);
  const hasEmphasis = emphasisIndex >= 0;
  // Keyboard reading starts on the emphasised column, else the last one.
  const startIndex = hasEmphasis ? emphasisIndex : count - 1;
  const hasDetail = columns.some((c) => c.detail);
  const current = active !== null ? columns[active] : null;

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.floor(((event.clientX - box.left) / box.width) * count);
    setActive(Math.min(count - 1, Math.max(0, index)));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const from = active ?? startIndex;
    const next = { ArrowLeft: from - 1, ArrowRight: from + 1, Home: 0, End: count - 1 }[event.key];
    if (next === undefined) {
      if (event.key === "Escape") setActive(null);
      return;
    }
    event.preventDefault();
    setActive(Math.min(count - 1, Math.max(0, next)));
  };

  if (count === 0) return null;

  // Keep the tooltip inside the chart near the left and right edges.
  const position = active !== null ? (active + 0.5) / count : 0;
  const shift = position < 0.2 ? -15 : position > 0.8 ? -85 : -50;

  return (
    <figure className="space-y-2">
      <div className="relative" style={{ height }}>
        {/* Gridlines and y-axis labels, behind the columns. */}
        <div aria-hidden="true">
          {ticks.map((tick) => (
            <div
              key={tick}
              className="absolute inset-x-0 flex items-center gap-2"
              style={{ bottom: `${(tick / top) * 100}%`, transform: "translateY(50%)" }}
            >
              <span className="w-10 shrink-0 text-right text-xs text-zinc-400 tabular-nums">{formatTick(tick, unit)}</span>
              <span className="h-px flex-1 bg-[#232734]" />
            </div>
          ))}
        </div>

        {/* One band per value; the whole band is the hover and tap target. */}
        <div
          tabIndex={0}
          role="group"
          aria-roledescription="chart"
          aria-label={summary}
          aria-describedby={hintId}
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={(event) => { if (event.pointerType === "mouse") setActive(null); }}
          onFocus={() => setActive((a) => a ?? startIndex)}
          onBlur={() => setActive(null)}
          onKeyDown={onKeyDown}
          className="absolute inset-y-0 right-0 left-12 flex items-end rounded-sm touch-pan-y"
        >
          {columns.map((column, index) => (
            <div
              key={column.key}
              className={`flex h-full flex-1 items-end justify-center ${active === index ? "bg-white/5" : ""}`}
            >
              <div
                className={`w-3/5 max-w-6 rounded-t-sm ${!hasEmphasis || column.emphasis ? "bg-red-500" : "bg-zinc-500"} ${active === index ? "brightness-125" : ""}`}
                style={{ height: `${top > 0 ? (column.value / top) * 100 : 0}%`, minHeight: column.value > 0 ? 2 : 0 }}
              />
            </div>
          ))}
        </div>

        {current && (
          <div
            className="pointer-events-none absolute top-1 z-10 w-max max-w-48 rounded-lg border border-[#2c3140] bg-[#0b0c10] px-2.5 py-1.5 text-xs shadow-lg"
            style={{ left: `calc(3rem + (100% - 3rem) * ${position})`, transform: `translateX(${shift}%)` }}
          >
            <div className="font-semibold text-white tabular-nums">{current.valueText}</div>
            <div className="text-zinc-400">{current.label}</div>
            {current.detail && <div className="text-zinc-400">{current.detail}</div>}
          </div>
        )}
      </div>

      {/* x-axis labels */}
      <div aria-hidden="true" className="ml-12 flex">
        {columns.map((column, index) => (
          <span
            key={column.key}
            className={`flex-1 text-center text-xs tabular-nums ${column.emphasis ? "font-bold text-white" : "text-zinc-400"}`}
          >
            {(count - 1 - index) % labelEvery === 0 ? column.axisLabel : ""}
          </span>
        ))}
      </div>

      <p id={hintId} className="sr-only">Use the left and right arrow keys to read each column.</p>
      <p aria-live="polite" className="sr-only">
        {current ? `${current.label}: ${current.valueText}${current.detail ? `, ${current.detail}` : ""}` : ""}
      </p>

      <details>
        <summary className="inline-flex min-h-6 cursor-pointer items-center text-xs text-zinc-400 hover:text-white pointer-coarse:min-h-11">
          Show as table
        </summary>
        <table className="mt-2 w-full text-xs tabular-nums">
          <thead>
            <tr className="text-zinc-400">
              <th className="py-1 text-left font-semibold">{labelHeading}</th>
              <th className="py-1 text-right font-semibold">{valueHeading}</th>
              {hasDetail && <th className="py-1 text-right font-semibold">Details</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#232734]">
            {columns.map((column) => (
              <tr key={column.key}>
                <td className="py-1 text-zinc-300">{column.label}</td>
                <td className="py-1 text-right text-white">{column.valueText}</td>
                {hasDetail && <td className="py-1 text-right text-zinc-400">{column.detail ?? ""}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

// Three or four round-numbered ticks from 0 to at least the largest value (whole numbers for counts).
function niceTicks(max: number, unit: Props["unit"]) {
  if (max <= 0) return [0, unit === "count" ? 1 : 100];
  const rough = max / 3;
  const power = 10 ** Math.floor(Math.log10(rough));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power;
  if (unit === "count") step = Math.max(1, Math.ceil(step));
  const steps = Math.ceil(max / step);
  return Array.from({ length: steps + 1 }, (_, i) => Number((i * step).toFixed(2)));
}

// Compact from 1,000 up (₱0, ₱500, ₱1K, ₱1.5K). Written out by hand so the server render and the
// browser always agree.
function formatTick(value: number, unit: Props["unit"]) {
  const text = value >= 1000 ? `${Number((value / 1000).toFixed(1))}K` : String(Number(value.toFixed(1)));
  return unit === "peso" ? `₱${text}` : text;
}

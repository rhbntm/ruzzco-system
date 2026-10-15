"use client";

// Column chart for the owner's trend charts on /insights: one value per column.
// Hover, a tap or the arrow keys show the same tooltip, and "Show as table" lists every value,
// so nothing depends on hovering. Columns are at most 24px wide with a 3px rounded top and grow
// in from the baseline; emphasised columns are crimson and the rest are context grey
// (crimson-bright vs dust-2 on the panel: both above 3:1 contrast, and told apart under colour
// blindness; the emphasised day's axis label is also bold).
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
  delay?: number; // ms before the columns start to grow (presentation mode lets the headline land first)
  // A dashed level across the plot to read the columns against ("the 14 days before: ₱1,000 a day").
  // Its words are in the summary too; the line itself is hidden from screen readers.
  reference?: { value: number; label: string };
  // A tag pinned over one column (by key) once the columns have grown, hidden while the tooltip shows.
  callout?: { key: string; text: string };
};

export function ColumnChart({ columns, unit, summary, labelHeading, valueHeading, labelEvery = 1, height = 176, delay = 0, reference, callout }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const hintId = useId();
  const count = columns.length;
  const highest = Math.max(0, ...columns.map((c) => c.value), reference?.value ?? 0);
  // Headroom over the tallest column, so a callout tag stays inside the plot.
  const ticks = niceTicks(callout ? highest * 1.2 : highest, unit);
  const top = ticks[ticks.length - 1];
  const calloutIndex = callout ? columns.findIndex((c) => c.key === callout.key) : -1;
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

  // Keep the tooltip (and the callout tag) inside the chart near the left and right edges.
  const edgeShift = (at: number) => (at < 0.2 ? -15 : at > 0.8 ? -85 : -50);
  const position = active !== null ? (active + 0.5) / count : 0;
  const shift = edgeShift(position);
  const calloutAt = (calloutIndex + 0.5) / count;

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
              <span className="w-10 shrink-0 text-right text-xs text-dust tabular-nums">{formatTick(tick, unit)}</span>
              <span className="h-px flex-1 bg-seam" />
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
              className={`flex h-full flex-1 items-end justify-center transition-colors duration-150 ${active === index ? "bg-white/5" : ""}`}
            >
              <div
                className={`w-3/5 max-w-6 rounded-t-[3px] origin-bottom transition-[filter] duration-150 ${!hasEmphasis || column.emphasis ? "bg-crimson-bright" : "bg-dust-2"} ${active === index ? "brightness-125" : ""}`}
                style={{
                  height: `${top > 0 ? (column.value / top) * 100 : 0}%`,
                  minHeight: column.value > 0 ? 2 : 0,
                  animation: `rz-grow 640ms var(--ease-out-expo) ${delay + Math.min(index * 18, 360)}ms both`,
                }}
              />
            </div>
          ))}
        </div>

        {reference && top > 0 && (
          // Drawn over the columns (dashed, so they show through) and out of the pointer's way.
          <div aria-hidden="true" className="pointer-events-none absolute right-0 left-12" style={{ bottom: `${(reference.value / top) * 100}%` }}>
            <div
              className="border-t border-dashed border-bone-2/60 origin-left"
              style={{ animation: `rz-grow-x 700ms var(--ease-out-expo) ${delay + 420}ms both` }}
            />
            <span
              className="absolute right-0 bottom-1 max-w-[70%] truncate rounded-sm bg-panel/85 px-1 text-[0.6875rem] leading-4 text-bone-2 tabular-nums"
              style={{ animation: `rz-fade 400ms ease-out ${delay + 820}ms both` }}
            >
              {reference.label}
            </span>
          </div>
        )}

        {callout && calloutIndex >= 0 && top > 0 && (
          // Positioned by the outer box, animated by the inner one (an animation would override the shift).
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-10"
            style={{
              left: `calc(3rem + (100% - 3rem) * ${calloutAt})`,
              bottom: `calc(${(columns[calloutIndex].value / top) * 100}% + 6px)`,
              transform: `translateX(${edgeShift(calloutAt)}%)`,
              visibility: active !== null ? "hidden" : undefined,
            }}
          >
            <div
              className="w-max rounded-md border border-seam-strong bg-panel-3 px-2 py-0.5 text-xs font-semibold text-bone tabular-nums shadow-[0_8px_18px_-10px_rgb(0_0_0/0.95)]"
              style={{ animation: `rz-drop 360ms var(--ease-out-expo) ${delay + 760}ms both` }}
            >
              {callout.text}
            </div>
          </div>
        )}

        {current && (
          <div
            className="animate-fade pointer-events-none absolute top-1 z-10 w-max max-w-48 rounded-lg border border-seam-strong bg-panel-3 px-2.5 py-1.5 text-xs shadow-[0_12px_28px_-12px_rgb(0_0_0/0.95)]"
            style={{ left: `calc(3rem + (100% - 3rem) * ${position})`, transform: `translateX(${shift}%)` }}
          >
            <div className="font-semibold text-bone tabular-nums">{current.valueText}</div>
            <div className="text-dust">{current.label}</div>
            {current.detail && <div className="text-dust">{current.detail}</div>}
          </div>
        )}
      </div>

      {/* x-axis labels */}
      <div aria-hidden="true" className="ml-12 flex">
        {columns.map((column, index) => (
          <span
            key={column.key}
            className={`flex-1 text-center text-xs tabular-nums ${column.emphasis ? "font-bold text-bone" : "text-dust"}`}
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
        <summary className="inline-flex min-h-6 cursor-pointer items-center text-xs font-medium text-dust hover:text-bone transition-colors pointer-coarse:min-h-11">
          Show as table
        </summary>
        <table className="rz-table mt-2 text-xs">
          <thead>
            <tr>
              <th className="text-left">{labelHeading}</th>
              <th className="text-right">{valueHeading}</th>
              {hasDetail && <th className="text-right">Details</th>}
            </tr>
          </thead>
          <tbody>
            {columns.map((column) => (
              <tr key={column.key}>
                <td className="py-1.5 text-bone-2">{column.label}</td>
                <td className="py-1.5 text-right text-bone">{column.valueText}</td>
                {hasDetail && <td className="py-1.5 text-right text-dust">{column.detail ?? ""}</td>}
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

// Slices 9 and 10: turns the comparison saved with a forecast run into what the owner's panel shows.
// Pure functions, no I/O, so the grouping, names and wording are testable without a browser.
import type { Comparison } from "@/lib/forecast";

// Plain names for the owner. A method key not listed here is ignored, so a later method
// cannot break the panel.
export const METHOD_NAMES: Record<string, string> = {
  average: "Plain average",
  weekday: "Average for that weekday",
  last7: "Average of the last 7 open days",
  naive: "Repeat the last open day's count",
  linear: "Straight-line model (linear regression)",
  gboost: "Gradient boosting model",
  random_forest: "Random Forest",
  random_forest_last7: "Random Forest + last-7 input",
};

// Groups in display order (slice 9 Decision 2).
const GROUPS: { title: string; methods: string[] }[] = [
  { title: "Simple guesses", methods: ["average", "weekday", "last7", "naive"] },
  { title: "Other models", methods: ["linear", "gboost"] },
  { title: "Random Forest", methods: ["random_forest", "random_forest_last7"] },
];

export type ComparisonRow = { method: string; name: string; mean: number; spread: number | null; served: boolean };
export type ComparisonGroup = { title: string; rows: ComparisonRow[] };
export type ComparisonView = { basisLine: string; groups: ComparisonGroup[] };

export function basisLine(comparison: Pick<Comparison, "basis" | "test_from">, formatDate: (iso: string) => string) {
  return comparison.basis === "test"
    ? `Test weeks from ${formatDate(comparison.test_from)}`
    : "Reference weeks: already seen when the inputs were chosen, so not evidence";
}

export function buildComparisonView(
  comparison: Comparison | null | undefined,
  formatDate: (iso: string) => string = (iso) => iso
): ComparisonView | null {
  if (!comparison) return null;
  const groups = GROUPS.map((group) => ({
    title: group.title,
    rows: group.methods
      .filter((method) => method in comparison.mean)
      .map((method) => ({
        method,
        name: METHOD_NAMES[method],
        mean: comparison.mean[method],
        spread: method in comparison.spread ? comparison.spread[method] : null,
        served: method === comparison.served,
      })),
  })).filter((group) => group.rows.length > 0);
  if (groups.length === 0) return null;
  return { basisLine: basisLine(comparison, formatDate), groups };
}

// One plain line per method, for the detailed report (slice 10).
export const METHOD_NOTES: Record<string, string> = {
  average: "Guesses the same number every day: the average of all open days it has seen.",
  weekday: "Guesses the average for that day of the week (all past Mondays for a Monday, and so on).",
  last7: "Guesses the average of the last 7 open days before the day being guessed.",
  naive: "Guesses that today will look like the last open day.",
  linear: "A straight-line model fitted on the calendar features. Shown for comparison only.",
  gboost: "A gradient boosting model on the same calendar features. Shown for comparison only.",
  random_forest: "Many decision trees that vote, using the calendar features (weekday, payday, month and so on).",
  random_forest_last7: "The same Random Forest, plus the average of the last 7 open days as an extra input.",
};

// Methods that are shown for comparison only and never become the best simple method.
export const COMPARISON_ONLY = new Set(["linear", "gboost"]);

export type RankedRow = { method: string; name: string; mean: number; served: boolean; note: string };
export type WeekRow = { label: string; mae: Record<string, number> };
export type ReportView = {
  basisLine: string;
  ranked: RankedRow[]; // smallest error first
  maxMean: number; // for bar lengths
  groups: ComparisonGroup[];
  spread: Record<string, number>; // week-to-week swing per method
  weeks: WeekRow[] | null; // null on runs saved before slice 10
  methodsInTable: string[]; // table columns, in group order
};

export function buildReportView(
  comparison: Comparison | null | undefined,
  formatDate: (iso: string) => string = (iso) => iso
): ReportView | null {
  const base = buildComparisonView(comparison, formatDate);
  if (!comparison || !base) return null;
  const rows = base.groups.flatMap((g) => g.rows);
  const ranked = [...rows]
    .sort((a, b) => a.mean - b.mean)
    .map((r) => ({ method: r.method, name: r.name, mean: r.mean, served: r.served, note: METHOD_NOTES[r.method] ?? "" }));
  const methodsInTable = rows.map((r) => r.method);
  const weeks = comparison.weeks
    ? comparison.weeks.map((w) => ({ label: `${formatDate(w.start)} to ${formatDate(w.end)}`, mae: w.mae }))
    : null;
  return { basisLine: base.basisLine, ranked, maxMean: Math.max(...ranked.map((r) => r.mean), 0), groups: base.groups, spread: comparison.spread, weeks, methodsInTable };
}

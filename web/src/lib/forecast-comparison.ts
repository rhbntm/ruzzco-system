// Slice 9: turns the comparison saved with a forecast run into what the owner's panel shows.
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

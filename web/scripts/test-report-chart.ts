/**
 * Slice 27: how the Reports chart groups days (src/lib/report-chart.ts) and the previous period
 * (src/lib/report.ts). Pure: invented figures, no database.
 *
 *   npm run test:report-chart
 */
import { DAILY_CHART_MAX, chartBuckets, mondayOf, type DayFigure } from "../src/lib/report-chart";
import { datesBetween, parseRange } from "../src/lib/date-range";
import { addDays } from "../src/lib/forecast";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// Every date of a range with an invented revenue (centavos included) and sales count.
const daysOf = (from: string, to: string): DayFigure[] => datesBetween(from, to).map((date, i) => ({ date, revenue: 100 + (i % 7) * 12.35, sales: (i % 5) + 1 }));
const cents = (n: number) => Math.round(n * 100);
const total = (list: { revenue: number }[]) => list.reduce((s, d) => s + cents(d.revenue), 0);

console.log("Monday of a date");
check("a Monday is its own Monday", mondayOf("2026-11-16") === "2026-11-16");
check("a Sunday belongs to the Monday before", mondayOf("2026-11-22") === "2026-11-16");
check("across a month end", mondayOf("2026-03-01") === "2026-02-23");
check("across a year end", mondayOf("2026-01-01") === "2025-12-29");

console.log("\nDaily up to 62 dates, weekly beyond");
const d62 = daysOf("2026-01-01", addDays("2026-01-01", 61));
const d63 = daysOf("2026-01-01", addDays("2026-01-01", 62));
check("62 dates: one column per date", d62.length === 62 && chartBuckets(d62).unit === "day" && chartBuckets(d62).buckets.length === 62);
check("63 dates: by week", d63.length === 63 && chartBuckets(d63).unit === "week");
check("DAILY_CHART_MAX is 62", DAILY_CHART_MAX === 62);
const one = chartBuckets(daysOf("2026-11-16", "2026-11-16"));
check("a one-day range: one daily column", one.unit === "day" && one.buckets.length === 1);

console.log("\nWeeks: Monday to Sunday, trimmed to the range");
// Thu 2026-01-01 .. Wed 2026-04-01: 91 dates.
const span = daysOf("2026-01-01", "2026-04-01");
const weeks = chartBuckets(span).buckets;
check("the first week is trimmed to the range's first date (Thu Jan 1 to Sun Jan 4)", weeks[0].from === "2026-01-01" && weeks[0].to === "2026-01-04" && weeks[0].key === "2025-12-29");
check("full weeks run Monday to Sunday", weeks.slice(1, -1).every((w) => mondayOf(w.from) === w.from && datesBetween(w.from, w.to).length === 7));
check("the last week is trimmed to the range's last date (Mon Mar 30 to Wed Apr 1)", weeks[weeks.length - 1].from === "2026-03-30" && weeks[weeks.length - 1].to === "2026-04-01");
check("every date in exactly one week", weeks.reduce((n, w) => n + datesBetween(w.from, w.to).length, 0) === span.length);
check("the columns add up to the range's revenue, to the centavo", total(weeks) === total(span), `${total(weeks)} vs ${total(span)}`);
check("the columns add up to the range's paid sales", weeks.reduce((n, w) => n + w.sales, 0) === span.reduce((n, d) => n + d.sales, 0));

console.log("\nThe chart never changes the figures");
const before = JSON.stringify(span);
chartBuckets(span);
check("grouping leaves the daily figures as they were", JSON.stringify(span) === before);
const daily = chartBuckets(d62).buckets;
check("daily columns are the days themselves", daily.every((b, i) => b.from === d62[i].date && b.revenue === d62[i].revenue && b.sales === d62[i].sales));

console.log("\nRange limits (the routes' parseRange)");
const today = "2026-11-16";
check("366 dates is a valid range", parseRange(addDays(today, -365), today, today).ok === true);
check("367 dates is refused", parseRange(addDays(today, -366), today, today).ok === false);
check("a range ending after today is refused", parseRange(today, addDays(today, 1), today).ok === false);
const longest = daysOf(addDays(today, -365), today);
check("366 dates chart as weeks that still add up", chartBuckets(longest).unit === "week" && total(chartBuckets(longest).buckets) === total(longest));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}

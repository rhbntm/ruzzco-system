/**
 * Slice 20: the range helper (src/lib/date-range.ts). Pure; needs nothing.
 *
 *   npm run test:date-range
 *
 * A range is `from`..`to`, Manila business dates, both included, at most 366 dates, never after
 * today; queried with `gte` the start of `from` and `lt` the start of the day after `to`.
 */
import { manilaToday } from "../src/lib/business-date";
import { MAX_RANGE_DATES, PRESETS, parseRange, presetRange, type DateRange, type RangeError } from "../src/lib/date-range";
import { presetOptions, rangeText } from "../src/components/DateRangeBar";

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

const TODAY = "2026-11-15"; // a Sunday
const ok = (r: DateRange | RangeError): r is DateRange => r.ok;
const refused = (r: DateRange | RangeError, status: number) => !r.ok && r.status === status;
const show = (r: DateRange | RangeError) => (r.ok ? `${r.first.date}..${r.last.date} (${r.dates.length})` : `${r.status} ${r.error}`);

console.log("Valid ranges");
const week = parseRange("2026-11-09", "2026-11-15", TODAY);
check("Monday to Sunday: 7 dates, both ends included, oldest first", ok(week) && week.dates.length === 7 && week.dates[0] === "2026-11-09" && week.dates[6] === "2026-11-15", show(week));
const one = parseRange("2026-11-10", "2026-11-10", TODAY);
check("a one-day range (from = to) holds that date only", ok(one) && one.dates.join() === "2026-11-10", show(one));
const month = parseRange("2026-10-25", "2026-11-03", TODAY);
check("a range crossing a month end", ok(month) && month.dates.length === 10 && month.dates.includes("2026-10-31") && month.dates.includes("2026-11-01"), show(month));
const year = parseRange("2025-12-30", "2026-01-02", TODAY);
check("a range crossing a year end", ok(year) && year.dates.join() === "2025-12-30,2025-12-31,2026-01-01,2026-01-02", show(year));
const leap = parseRange("2024-02-28", "2024-03-01", TODAY);
check("29 February is one of the dates in a leap year", ok(leap) && leap.dates.join() === "2024-02-28,2024-02-29,2024-03-01", show(leap));
const dates = ok(month) ? month.dates : [];
check("dates are consecutive with no gap or repeat", dates.every((d, i) => i === 0 || Date.parse(d) - Date.parse(dates[i - 1]) === 86_400_000));

console.log("\nRefused");
check("from after to → 400", refused(parseRange("2026-11-10", "2026-11-09", TODAY), 400));
for (const bad of ["2026-02-30", "2026-13-01", "2026-1-05", "", "2026-11-10T00:00", "yesterday"]) {
  check(`impossible date "${bad}" as from → 400`, refused(parseRange(bad, "2026-11-10", TODAY), 400));
  check(`impossible date "${bad}" as to → 400`, refused(parseRange("2026-11-01", bad, TODAY), 400));
}

console.log("\nMaximum length (366 dates, both ends counted)");
check("MAX_RANGE_DATES is 366", MAX_RANGE_DATES === 366);
const y2025 = parseRange("2025-01-01", "2026-01-01", TODAY);
check("2025-01-01..2026-01-01 = 366 dates → accepted", ok(y2025) && y2025.dates.length === 366, show(y2025));
check("2025-01-01..2026-01-02 = 367 dates → 400", refused(parseRange("2025-01-01", "2026-01-02", TODAY), 400));
const acrossLeap = parseRange("2023-03-01", "2024-02-29", TODAY);
check("2023-03-01..2024-02-29 (across 29 Feb) = 366 dates → accepted", ok(acrossLeap) && acrossLeap.dates.length === 366, show(acrossLeap));
check("2023-03-01..2024-03-01 (across 29 Feb) = 367 dates → 400", refused(parseRange("2023-03-01", "2024-03-01", TODAY), 400));
const leapYear = parseRange("2024-01-01", "2024-12-31", TODAY);
check("the whole of 2024 (366 dates) → accepted", ok(leapYear) && leapYear.dates.length === 366, show(leapYear));
check("2024-01-01..2025-01-01 = 367 dates → 400", refused(parseRange("2024-01-01", "2025-01-01", TODAY), 400));

console.log("\nNever after today (Manila)");
check("to = today → accepted", ok(parseRange("2026-11-01", TODAY, TODAY)));
const tomorrow = parseRange("2026-11-01", "2026-11-16", TODAY);
check("to = tomorrow → 422 \"That date has not happened yet\"", refused(tomorrow, 422) && !tomorrow.ok && tomorrow.error === "That date has not happened yet", show(tomorrow));
check("from and to both tomorrow → 422", refused(parseRange("2026-11-16", "2026-11-16", TODAY), 422));
// today from an instant: 23:59 Manila is still the same UTC date; 00:00 Manila is the previous UTC date.
const lateEvening = new Date("2026-11-15T23:59:00.000+08:00");
const midnight = new Date("2026-11-16T00:00:00.000+08:00");
check("23:59 Manila: today is that Manila date (UTC date is the same)", manilaToday(lateEvening) === "2026-11-15" && lateEvening.toISOString().slice(0, 10) === "2026-11-15");
check("00:00 Manila: today is the new Manila date although the UTC date is the previous one", manilaToday(midnight) === "2026-11-16" && midnight.toISOString().slice(0, 10) === "2026-11-15");
check("at 23:59 Manila the next date is still refused", refused(parseRange("2026-11-16", "2026-11-16", manilaToday(lateEvening)), 422));
check("at 00:00 Manila the new date is accepted (not the UTC date)", ok(parseRange("2026-11-16", "2026-11-16", manilaToday(midnight))));
check("at 00:00 Manila the day after is still refused", refused(parseRange("2026-11-16", "2026-11-17", manilaToday(midnight)), 422));
check("the order of checks: from after to wins over the future (400)", refused(parseRange("2026-11-20", "2026-11-19", TODAY), 400));

console.log("\nQuery bounds: gte 00:00:00.000 +08:00 on from, lt 00:00:00.000 +08:00 on the day after to");
for (const [from, to, after] of [["2026-11-09", "2026-11-15", "2026-11-16"], ["2025-12-30", "2026-01-02", "2026-01-03"], ["2024-02-28", "2024-02-29", "2024-03-01"], ["2026-11-10", "2026-11-10", "2026-11-11"]]) {
  const r = parseRange(from, to, TODAY);
  check(`${from}..${to}: start = ${from}T00:00:00.000+08:00`, ok(r) && r.bounds.start.getTime() === new Date(`${from}T00:00:00.000+08:00`).getTime(), ok(r) ? r.bounds.start.toISOString() : "");
  check(`${from}..${to}: end (exclusive) = ${after}T00:00:00.000+08:00`, ok(r) && r.bounds.end.getTime() === new Date(`${after}T00:00:00.000+08:00`).getTime(), ok(r) ? r.bounds.end.toISOString() : "");
  check(`${from}..${to}: @db.Date bounds ${from} (gte) and ${after} (lt)`, ok(r) && r.bounds.dateStart.toISOString() === `${from}T00:00:00.000Z` && r.bounds.dateEnd.toISOString() === `${after}T00:00:00.000Z`);
}
const bounded = parseRange("2026-11-09", "2026-11-15", TODAY);
if (ok(bounded)) {
  const inside = (at: string) => { const t = new Date(at).getTime(); return t >= bounded.bounds.start.getTime() && t < bounded.bounds.end.getTime(); };
  check("23:59:59.999 the day before from is out", !inside("2026-11-08T23:59:59.999+08:00"));
  check("00:00:00.000 on from is in", inside("2026-11-09T00:00:00.000+08:00"));
  check("23:59:59.999 on to is in", inside("2026-11-15T23:59:59.999+08:00"));
  check("00:00:00.000 the day after to is out", !inside("2026-11-16T00:00:00.000+08:00"));
}

console.log("\nPresets (end at today)");
type P = { from: string; to: string };
const same = (p: P, from: string, to: string) => p.from === from && p.to === to;
const fmt = (p: P) => `${p.from}..${p.to}`;
// [today, label, today, yesterday, thisWeek, thisMonth, last7Days]
const cases: [string, string, P, P, P, P, P][] = [
  ["2026-11-16", "a Monday", { from: "2026-11-16", to: "2026-11-16" }, { from: "2026-11-15", to: "2026-11-15" }, { from: "2026-11-16", to: "2026-11-16" }, { from: "2026-11-01", to: "2026-11-16" }, { from: "2026-11-10", to: "2026-11-16" }],
  ["2026-11-15", "a Sunday", { from: "2026-11-15", to: "2026-11-15" }, { from: "2026-11-14", to: "2026-11-14" }, { from: "2026-11-09", to: "2026-11-15" }, { from: "2026-11-01", to: "2026-11-15" }, { from: "2026-11-09", to: "2026-11-15" }],
  ["2026-12-01", "the 1st (a Tuesday)", { from: "2026-12-01", to: "2026-12-01" }, { from: "2026-11-30", to: "2026-11-30" }, { from: "2026-11-30", to: "2026-12-01" }, { from: "2026-12-01", to: "2026-12-01" }, { from: "2026-11-25", to: "2026-12-01" }],
  ["2026-12-31", "the last day of a month and year (a Thursday)", { from: "2026-12-31", to: "2026-12-31" }, { from: "2026-12-30", to: "2026-12-30" }, { from: "2026-12-28", to: "2026-12-31" }, { from: "2026-12-01", to: "2026-12-31" }, { from: "2026-12-25", to: "2026-12-31" }],
  ["2028-02-29", "29 February (a Tuesday)", { from: "2028-02-29", to: "2028-02-29" }, { from: "2028-02-28", to: "2028-02-28" }, { from: "2028-02-28", to: "2028-02-29" }, { from: "2028-02-01", to: "2028-02-29" }, { from: "2028-02-23", to: "2028-02-29" }],
  ["2027-01-01", "1 January (a Friday)", { from: "2027-01-01", to: "2027-01-01" }, { from: "2026-12-31", to: "2026-12-31" }, { from: "2026-12-28", to: "2027-01-01" }, { from: "2027-01-01", to: "2027-01-01" }, { from: "2026-12-26", to: "2027-01-01" }],
  ["2028-03-01", "1 March after 29 Feb (a Wednesday)", { from: "2028-03-01", to: "2028-03-01" }, { from: "2028-02-29", to: "2028-02-29" }, { from: "2028-02-28", to: "2028-03-01" }, { from: "2028-03-01", to: "2028-03-01" }, { from: "2028-02-24", to: "2028-03-01" }],
];
for (const [today, label, t, y, w, m, l7] of cases) {
  const got = { today: presetRange("today", today), yesterday: presetRange("yesterday", today), thisWeek: presetRange("thisWeek", today), thisMonth: presetRange("thisMonth", today), last7Days: presetRange("last7Days", today) };
  check(`${label}: Today`, same(got.today, t.from, t.to), fmt(got.today));
  check(`${label}: Yesterday`, same(got.yesterday, y.from, y.to), fmt(got.yesterday));
  check(`${label}: This week = Monday to today`, same(got.thisWeek, w.from, w.to), fmt(got.thisWeek));
  check(`${label}: This month = the 1st to today`, same(got.thisMonth, m.from, m.to), fmt(got.thisMonth));
  check(`${label}: Last 7 days = today and the 6 before`, same(got.last7Days, l7.from, l7.to), fmt(got.last7Days));
  check(`${label}: every preset is a valid range for that today`, Object.values(got).every((p) => parseRange(p.from, p.to, today).ok));
}

console.log("\nThe range bar's options (slice 21c)");
{
  const today = "2026-11-15"; // a Sunday
  const options = presetOptions(today);
  check("one option per preset, in the presets' order", options.map((o) => o.key).join() === PRESETS.join());
  check("each option is its preset's range", options.every((o) => { const r = presetRange(o.key as (typeof PRESETS)[number], today); return o.from === r.from && o.to === r.to; }));
  check("every option is a valid range that ends today or before", options.every((o) => parseRange(o.from, o.to, today).ok && o.to <= today));
  check("every option has its own label", new Set(options.map((o) => o.label)).size === options.length && options.every((o) => o.label.length > 0));
  check("a one-day range is printed as one date", rangeText(today, today) === "Sun, Nov 15, 2026", rangeText(today, today));
  check("a longer range names both ends", rangeText("2026-11-09", today) === "Mon, Nov 9, 2026 to Sun, Nov 15, 2026", rangeText("2026-11-09", today));
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}

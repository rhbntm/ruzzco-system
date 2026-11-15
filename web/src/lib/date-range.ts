import { parseBusinessDate, type BusinessDay } from "@/lib/business-date";

// Slice 20: a range of Manila business dates, `from` and `to` both included. A sale counts in a
// range exactly when it counts on one of its days (countsInRange), so a range's figures are the
// sum of its days'. Pure: no Prisma, no I/O; `today` (manilaToday()) is passed in.

/** At most 366 calendar dates, counting both `from` and `to`. */
export const MAX_RANGE_DATES = 366;

const DAY_MS = 24 * 60 * 60 * 1000;
const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Every date from `from` to `to`, both included, oldest first (both already valid). */
export function datesBetween(from: string, to: string): string[] {
  const length = Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS) + 1;
  return Array.from({ length: Math.max(length, 0) }, (_, i) => shift(from, i));
}

export type DateRange = {
  ok: true;
  first: BusinessDay;
  last: BusinessDay;
  dates: string[]; // oldest first
  /** Query bounds: `gte: start, lt: end` on timestamps; `gte: dateStart, lt: dateEnd` on @db.Date columns. */
  bounds: { start: Date; end: Date; dateStart: Date; dateEnd: Date };
};
export type RangeError = { ok: false; status: 400 | 422; error: string };

export function parseRange(from: string, to: string, today: string): DateRange | RangeError {
  const first = parseBusinessDate(from);
  const last = parseBusinessDate(to);
  if (!first || !last) return { ok: false, status: 400, error: "from and to must be real calendar dates (YYYY-MM-DD)" };
  if (first.date > last.date) return { ok: false, status: 400, error: "from must not be after to" };
  const length = Math.round((last.dateValue.getTime() - first.dateValue.getTime()) / DAY_MS) + 1;
  if (length > MAX_RANGE_DATES) return { ok: false, status: 400, error: `A range holds at most ${MAX_RANGE_DATES} dates` };
  // Business dates compare as strings (YYYY-MM-DD).
  if (last.date > today) return { ok: false, status: 422, error: "That date has not happened yet" };
  const dates = datesBetween(first.date, last.date);
  const next = parseBusinessDate(shift(last.date, 1))!;
  return { ok: true, first, last, dates, bounds: { start: first.start, end: last.end, dateStart: first.dateValue, dateEnd: next.dateValue } };
}

export const PRESETS = ["today", "yesterday", "thisWeek", "thisMonth", "last7Days"] as const;
export type Preset = (typeof PRESETS)[number];

/** Every preset ends at today or before: "This week" is Monday to today, "This month" the 1st to today. */
export function presetRange(name: Preset, today: string): { from: string; to: string } {
  switch (name) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const yesterday = shift(today, -1);
      return { from: yesterday, to: yesterday };
    }
    case "thisWeek": {
      const sinceMonday = (new Date(`${today}T00:00:00.000Z`).getUTCDay() + 6) % 7;
      return { from: shift(today, -sinceMonday), to: today };
    }
    case "thisMonth":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "last7Days":
      return { from: shift(today, -6), to: today };
  }
}

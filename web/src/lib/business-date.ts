// Ruzzco's business date is the Asia/Manila calendar date (UTC+8, no DST).
// A business date D covers [start of D in Manila, start of D+1 in Manila): query with
// `gte: start, lt: end`, never `lte`, so a sale at 00:00:00.000 belongs to exactly one day.

const MANILA_OFFSET = "+08:00";
const DAY_MS = 24 * 60 * 60 * 1000;

export type BusinessDay = {
  date: string; // YYYY-MM-DD
  start: Date; // inclusive
  end: Date; // exclusive: start of the next Manila day
  dateValue: Date; // for @db.Date columns (businessDate, reconciliationDate)
};

// Returns null for anything that is not a real calendar date. JS Date rolls "2026-02-30"
// over to March 2, so the parsed value is checked against the input.
export function parseBusinessDate(date: string): BusinessDay | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const dateValue = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(dateValue.getTime()) || dateValue.toISOString().slice(0, 10) !== date) return null;
  const start = new Date(`${date}T00:00:00.000${MANILA_OFFSET}`);
  return { date, start, end: new Date(start.getTime() + DAY_MS), dateValue };
}

export function isBusinessDate(date: string) {
  return parseBusinessDate(date) !== null;
}

// Today's business date in Manila, whatever the server's or device's timezone.
export function manilaToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now);
}

// Slice 12: the home panel's chart of expected customers per day, from the same saved days as the
// table below it. Pure, so the columns and the summary are testable without a browser.
// Slice 14: also the home panel's horizons (client-safe: no Prisma here).
import type { Column } from "@/components/ColumnChart";

export type ForecastDay = { date: string; customers: number | null; revenue: string };

// Slice 14: a refresh saves the longest horizon; the home panel shows the first 7, 14 or 30 days.
export const FORECAST_HORIZONS = [7, 14, 30] as const;
export type ForecastHorizon = (typeof FORECAST_HORIZONS)[number];
export const MAX_FORECAST_DAYS = 30;

// Written out by hand (not Intl) so the server render and the browser always agree.
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// A YYYY-MM-DD business date read as a calendar date, not an instant.
function parts(iso: string) {
  const date = new Date(`${iso}T00:00:00Z`);
  return { weekday: WEEKDAYS[date.getUTCDay()], month: MONTHS[date.getUTCMonth()], day: date.getUTCDate() };
}

const longLabel = (iso: string) => {
  const { weekday, month, day } = parts(iso);
  return `${weekday}, ${month} ${day}`;
};

// ₱2,374.85: two decimals with thousands separators.
function pesos(value: number) {
  const [whole, cents] = value.toFixed(2).split(".");
  return `₱${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents}`;
}

// Slice 14: up to a week the axis names the weekday; longer views name the day of the month and
// label every 2nd (up to 14 days) or 5th column so the axis stays readable. Tooltips keep the full date.
export function forecastChart(days: ForecastDay[]): { columns: Column[]; summary: string; labelEvery: number } {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const long = sorted.length > 7;
  const labelEvery = sorted.length > 14 ? 5 : long ? 2 : 1;
  const columns = sorted.map((day) => ({
    key: day.date,
    axisLabel: long ? String(parts(day.date).day) : parts(day.date).weekday,
    label: longLabel(day.date),
    value: day.customers ?? 0,
    valueText: day.customers === null ? "—" : `${day.customers.toFixed(1)} customers`,
    detail: `${pesos(Number(day.revenue))} expected revenue`,
  }));
  if (sorted.length === 0) return { columns, summary: "No forecast days.", labelEvery };

  const range = `${longLabel(sorted[0].date)} to ${longLabel(sorted[sorted.length - 1].date)}`;
  // The first of the highest days, when there is a number at all.
  const busiest = sorted.reduce<ForecastDay | null>(
    (best, day) => (day.customers !== null && (best === null || day.customers > best.customers!) ? day : best),
    null
  );
  const summary = busiest
    ? `Expected customers per day, ${range}. Busiest day: ${longLabel(busiest.date)}, ${busiest.customers!.toFixed(1)} customers.`
    : `Expected customers per day, ${range}.`;
  return { columns, summary, labelEvery };
}

/**
 * Slice 27: how the Reports revenue chart groups a range's days. Pure (no I/O), so it is tested
 * without a database (npm run test:report-chart).
 *
 * Up to DAILY_CHART_MAX dates: one column per Manila business date. More: one column per week,
 * Monday to Sunday, trimmed to the range (the first and last weeks may be shorter). A week's
 * column is the sum of its days, so no sale is counted twice or dropped. This is presentation
 * only: every total, average and "best day" on the page uses the exact range and its days.
 */
export const DAILY_CHART_MAX = 62;

export type DayFigure = { date: string; revenue: number; sales: number };
export type ChartBucket = { key: string; from: string; to: string; revenue: number; sales: number };

/** The Monday on or before a YYYY-MM-DD business date (calendar arithmetic, no time zone). */
export function mondayOf(date: string): string {
  const at = new Date(`${date}T00:00:00Z`);
  const back = (at.getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
  return new Date(at.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}

/** `daily` is every date of the range, oldest first (as rangeFigures gives them). */
export function chartBuckets(daily: readonly DayFigure[]): { unit: "day" | "week"; buckets: ChartBucket[] } {
  if (daily.length <= DAILY_CHART_MAX) {
    return { unit: "day", buckets: daily.map((d) => ({ key: d.date, from: d.date, to: d.date, revenue: d.revenue, sales: d.sales })) };
  }
  const buckets: ChartBucket[] = [];
  for (const d of daily) {
    const key = mondayOf(d.date);
    const last = buckets[buckets.length - 1];
    if (last && last.key === key) {
      last.to = d.date;
      // Summed in centavos, so the columns add up exactly to the range's revenue.
      last.revenue = Math.round(last.revenue * 100 + d.revenue * 100) / 100;
      last.sales += d.sales;
    } else {
      buckets.push({ key, from: d.date, to: d.date, revenue: d.revenue, sales: d.sales });
    }
  }
  return { unit: "week", buckets };
}

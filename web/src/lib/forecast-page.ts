// Slice 28: what the Forecast page (/forecast) shows, worked out from the saved run only.
// Pure (no React, no Prisma) so the day list, the totals and the takeaways are testable without a browser.
import type { SerializedForecast } from "@/lib/forecast";
import { COMPARISON_ONLY, type ReportView } from "@/lib/forecast-comparison";

type Run = NonNullable<SerializedForecast["run"]>;

// The page shows the next 7 saved days; the Dashboard keeps 7, 14 and 30 (decision D1).
export const FORECAST_PAGE_DAYS = 7;

// Experimental variants: trained and compared, never served (the forecast uses plain Random Forest).
// Local on purpose; lib/forecast-comparison.ts stays as it is.
const EXPERIMENTAL = new Set(["random_forest_last7"]);

// The same filter, order and sums as ForecastPanel, so the totals match the Dashboard at 7 days.
export function forecastPageDays(forecast: Pick<SerializedForecast, "run" | "days"> | null, today: string) {
  const days = (forecast?.days ?? []).filter((day) => day.date >= today).slice(0, FORECAST_PAGE_DAYS);
  const totalCustomers = days.reduce((sum, day) => sum + (day.customers ?? 0), 0);
  const totalRevenue = days.reduce((sum, day) => sum + Number(day.revenue), 0);
  const stale = forecast?.run ? forecast.run.createdOn < today : false;
  return { days, totalCustomers, totalRevenue, stale };
}

export type ForecastTakeaways = {
  trust: string;
  compare: string | null;
  weeks: string | null;
};

// One plain sentence per evaluation section, built only from saved fields (decision D4).
// Never says a method is "best".
export function forecastTakeaways(
  run: Pick<Run, "weeksRfWon" | "weeksTested">,
  view: ReportView | null
): ForecastTakeaways {
  const trust = `Random Forest did better than the best simple guess in ${run.weeksRfWon} of ${run.weeksTested} test weeks.`;
  if (!view || view.ranked.length === 0) return { trust, compare: null, weeks: null };

  const lowest = view.ranked[0];
  const served = view.ranked.find((row) => row.served);
  const usedLine = served ? ` The forecast uses ${served.name}.` : "";
  let compare: string;
  if (lowest.served) {
    compare = "The forecast uses the method with the lowest typical miss.";
  } else if (COMPARISON_ONLY.has(lowest.method)) {
    compare = `Lowest typical miss: ${lowest.name}, for comparison only (${lowest.mean.toFixed(2)} customers a day).${usedLine}`;
  } else if (EXPERIMENTAL.has(lowest.method)) {
    compare = `Lowest typical miss: ${lowest.name}, an experimental variant that is not used for the forecast (${lowest.mean.toFixed(2)} customers a day).${usedLine}`;
  } else {
    compare = `Lowest typical miss: ${lowest.name} (${lowest.mean.toFixed(2)} customers a day).${usedLine}`;
  }

  const count = view.weeks?.length ?? 0;
  const weeks = view.weeks
    ? `${count} test ${count === 1 ? "week" : "weeks"}; lower is better. The swing shows how much each method's miss changed from week to week.`
    : null;
  return { trust, compare, weeks };
}

/**
 * Slice 24: how the forecast's pesos are produced, in one place, so the Dashboard panel, the
 * Forecast page and Insights word it the same way. Pure: no React, no database.
 *
 * The Random Forest model predicts customers per day. Revenue is not a target of the model: the
 * ml-service multiplies each day's predicted customers by the average amount paid per customer in
 * its training data (avg_ticket) and stores the result. Nothing here recomputes or changes a
 * stored figure; the worked example only shows the saved numbers side by side.
 */
import type { SerializedForecast } from "@/lib/forecast";

/** The column and tooltip name for the peso figure: an estimate, never "predicted". */
export const REVENUE_LABEL = "Est. revenue";
export const REVENUE_NOUN = "estimated revenue";

/** The two sentences shown under the Dashboard's forecast table. */
export function revenueNote(avgTicket: string, peso: (value: number) => string): string {
  return `The model predicts customers only. Estimated revenue is worked out from that prediction: customers × ${peso(Number(avgTicket))}, the average paid per customer in the logbook above.`;
}

export type RevenueExample = {
  date: string;
  customers: number;
  avgTicket: number;
  /** The stored revenue for that day, exactly as saved (not recomputed). */
  revenue: number;
  dataFrom: string;
  dataTo: string;
};

/**
 * The first saved day from `today` with a customer figure, as a worked example of the stored
 * calculation; null without a saved run or such a day.
 */
export function revenueExample(forecast: SerializedForecast | null, today: string): RevenueExample | null {
  const run = forecast?.run;
  const day = forecast?.days.find((d) => d.date >= today && d.customers !== null);
  if (!run || !day || day.customers === null) return null;
  return {
    date: day.date,
    customers: day.customers,
    avgTicket: Number(run.avgTicket),
    revenue: Number(day.revenue),
    dataFrom: run.dataFrom,
    dataTo: run.dataTo,
  };
}

/** Whether the stored revenue equals customers × average to the centavo (how the ml-service builds it). */
export function exampleChecksOut(example: RevenueExample): boolean {
  return Math.abs(Math.round(example.customers * example.avgTicket * 100) - Math.round(example.revenue * 100)) <= 1;
}

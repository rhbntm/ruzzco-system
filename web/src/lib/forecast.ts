// Slice 7: the owner's 7-day forecast. The ml-service builds every feature and runs the model;
// this file only asks it for a start date and a number of days, checks the answer, and saves it
// so the dashboard still has numbers when the service is down. Never reads or writes transactions.
import { z } from "zod";
import type { DailyRevenueForecast, ForecastRun } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isBusinessDate, manilaToday, parseBusinessDate } from "@/lib/business-date";

const DEFAULT_ML_SERVICE_URL = "http://localhost:8001";
const TIMEOUT_MS = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

const isoDate = z.string().refine(isBusinessDate, "must be a real calendar date (YYYY-MM-DD)");
const nonNegative = z.number().finite().nonnegative();
const count = z.number().int().nonnegative();

const forecastResponseSchema = z.object({
  model_version: z.string().min(1),
  trained_at: z.string().min(1),
  data_from: isoDate,
  data_to: isoDate,
  training_days: count,
  avg_ticket: z.number().finite().positive(),
  evaluation: z.object({
    weeks_tested: z.number().int().positive(),
    rf_mae: nonNegative,
    best_baseline: z.string().min(1),
    best_baseline_mae: nonNegative,
    weeks_rf_won: count,
  }),
  days: z.array(z.object({ date: isoDate, customers: nonNegative, revenue: nonNegative })),
});

export type ForecastResponse = z.infer<typeof forecastResponseSchema>;

export function addDays(date: string, days: number) {
  return new Date(parseBusinessDate(date)!.dateValue.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

// Checks the service's answer: the shape, exactly `days` entries, and consecutive dates from `start`.
export function parseForecastResponse(body: unknown, start: string, days: number) {
  const parsed = forecastResponseSchema.safeParse(body);
  if (!parsed.success) return { ok: false as const, error: z.prettifyError(parsed.error) };
  const rows = parsed.data.days;
  if (rows.length !== days) return { ok: false as const, error: `expected ${days} days, got ${rows.length}` };
  const wrong = rows.findIndex((row, i) => row.date !== addDays(start, i));
  if (wrong !== -1) return { ok: false as const, error: `day ${wrong + 1} is ${rows[wrong].date}, expected ${addDays(start, wrong)}` };
  return { ok: true as const, data: parsed.data };
}

export class ForecastServiceError extends Error {}

// Asks the ml-service for `days` days from `start`. Throws ForecastServiceError when the service
// is unreachable, slow (5 s), answers with an error, or sends something that fails the checks.
export async function fetchForecast(start: string, days: number): Promise<ForecastResponse> {
  const base = process.env.ML_SERVICE_URL || DEFAULT_ML_SERVICE_URL;
  const url = `${base.replace(/\/$/, "")}/forecast?start=${start}&days=${days}`;
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new ForecastServiceError(`service unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new ForecastServiceError(`service answered ${response.status}`);
  const body = await response.json().catch(() => null);
  const parsed = parseForecastResponse(body, start, days);
  if (!parsed.ok) throw new ForecastServiceError(`invalid response: ${parsed.error}`);
  return parsed.data;
}

// Saves one run and its days in a single transaction. Each date has one row (unique
// forecastDate), so a later run overwrites the dates it covers instead of adding more.
export async function saveForecast(forecast: ForecastResponse) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.forecastRun.create({
      data: {
        modelVersion: forecast.model_version,
        dataFrom: parseBusinessDate(forecast.data_from)!.dateValue,
        dataTo: parseBusinessDate(forecast.data_to)!.dateValue,
        trainingDays: forecast.training_days,
        avgTicket: forecast.avg_ticket.toFixed(2),
        typicalErrorCustomers: forecast.evaluation.rf_mae.toFixed(2),
        bestBaseline: forecast.evaluation.best_baseline,
        bestBaselineError: forecast.evaluation.best_baseline_mae.toFixed(2),
        weeksRfWon: forecast.evaluation.weeks_rf_won,
        weeksTested: forecast.evaluation.weeks_tested,
      },
    });
    const days = [];
    for (const day of forecast.days) {
      const values = {
        predictedHeadcount: Math.round(day.customers),
        predictedRevenue: day.revenue.toFixed(2),
        confidenceLowerBound: null,
        confidenceUpperBound: null,
        generatedAt: run.createdAt,
        runId: run.id,
      };
      days.push(
        await tx.dailyRevenueForecast.upsert({
          where: { forecastDate: parseBusinessDate(day.date)!.dateValue },
          create: { forecastDate: parseBusinessDate(day.date)!.dateValue, ...values },
          update: values,
        })
      );
    }
    return { run, days };
  });
}

// The latest run and the saved days from today (Manila) for 7 days. Database only.
export async function latestForecast(today = manilaToday()) {
  const run = await prisma.forecastRun.findFirst({ orderBy: { createdAt: "desc" } });
  const days = await prisma.dailyRevenueForecast.findMany({
    where: {
      forecastDate: { gte: parseBusinessDate(today)!.dateValue, lt: parseBusinessDate(addDays(today, 7))!.dateValue },
      runId: { not: null },
    },
    orderBy: { forecastDate: "asc" },
  });
  return { run, days };
}

export function serializeForecast(run: ForecastRun | null, days: DailyRevenueForecast[]) {
  return {
    run: run && {
      id: run.id,
      createdAt: run.createdAt.toISOString(),
      createdOn: manilaToday(run.createdAt),
      modelVersion: run.modelVersion,
      dataFrom: run.dataFrom.toISOString().slice(0, 10),
      dataTo: run.dataTo.toISOString().slice(0, 10),
      trainingDays: run.trainingDays,
      avgTicket: run.avgTicket.toFixed(2),
      typicalErrorCustomers: run.typicalErrorCustomers.toFixed(2),
      bestBaseline: run.bestBaseline,
      bestBaselineError: run.bestBaselineError.toFixed(2),
      weeksRfWon: run.weeksRfWon,
      weeksTested: run.weeksTested,
    },
    days: days.map((day) => ({
      date: day.forecastDate.toISOString().slice(0, 10),
      customers: day.predictedHeadcount,
      revenue: day.predictedRevenue.toFixed(2),
    })),
  };
}

export type SerializedForecast = ReturnType<typeof serializeForecast>;

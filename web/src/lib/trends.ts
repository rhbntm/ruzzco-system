// The owner's trend charts on /insights: paid sales over the N business days up to a date,
// with the N days before for comparison. Read-only. A sale counts on the same business day as
// in End-of-Day Cash (countsInRange); flagged sales waiting for a date review count nowhere.
import { Prisma, type PaymentMethod } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseBusinessDate, type BusinessDay } from "@/lib/business-date";
import { addDays } from "@/lib/forecast";
import { countedBusinessDate, countHeldForReview, countsInRange } from "@/lib/time-review";

export const TREND_RANGES = [7, 14, 30] as const;
export type TrendRange = (typeof TREND_RANGES)[number];
export const DEFAULT_TREND_RANGE: TrendRange = 14;

export function parseTrendRange(value: unknown): TrendRange {
  const days = Number(value);
  return (TREND_RANGES as readonly number[]).includes(days) ? (days as TrendRange) : DEFAULT_TREND_RANGE;
}

type Decimal = Prisma.Decimal;
const ZERO = new Prisma.Decimal(0);
const PAYMENT_METHODS: PaymentMethod[] = ["CASH", "GCASH", "MAYA", "QRPH"];
// Hour of the day in Manila (0-23) for a sale's timestamp.
const manilaHour = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", hourCycle: "h23" });

export type Trends = {
  first: string;
  last: string;
  days: TrendRange;
  daily: { date: string; revenue: Decimal; sales: number }[]; // every day in the range, oldest first
  hours: { hour: number; sales: number }[]; // Manila hour the sale was rung up, at least 10 AM-10 PM
  byBarber: { name: string; revenue: Decimal; sales: number }[]; // highest revenue first
  byService: { name: string; sales: number }[]; // most sold first
  byMethod: { method: PaymentMethod; revenue: Decimal }[];
  totals: { revenue: Decimal; sales: number; tips: Decimal; openDays: number };
  previous: { first: string; last: string; revenue: Decimal; sales: number };
  heldForReview: number; // flagged sales stated in the range, waiting for a date review
  hourExcluded: number; // date-corrected sales: their phone time is not trusted, so not in the hours chart
};

const amountOf = (sale: { amountPaid: Decimal | null; totalAmount: Decimal }) => sale.amountPaid ?? sale.totalAmount;

export async function loadTrends(lastDay: BusinessDay, days: TrendRange): Promise<Trends> {
  const firstDay = parseBusinessDate(addDays(lastDay.date, -(days - 1)))!;
  const previousFirst = parseBusinessDate(addDays(lastDay.date, -(2 * days - 1)))!;
  const previousLast = parseBusinessDate(addDays(lastDay.date, -days))!;

  const [sales, previousSales, heldForReview] = await Promise.all([
    prisma.transaction.findMany({
      where: { ...countsInRange(firstDay, lastDay), paymentStatus: "PAID" },
      select: {
        transactionTime: true,
        timeFlag: true,
        timeReviewedBusinessDate: true,
        amountPaid: true,
        totalAmount: true,
        tipAmount: true,
        paymentMethod: true,
        barber: { select: { fullName: true } },
        items: { select: { service: { select: { name: true } } } },
      },
    }),
    prisma.transaction.findMany({
      where: { ...countsInRange(previousFirst, previousLast), paymentStatus: "PAID" },
      select: { amountPaid: true, totalAmount: true },
    }),
    countHeldForReview(firstDay, lastDay),
  ]);

  const daily = new Map<string, { revenue: Decimal; sales: number }>();
  for (let i = 0; i < days; i++) daily.set(addDays(firstDay.date, i), { revenue: ZERO, sales: 0 });
  const hours = new Map<number, number>();
  const byBarber = new Map<string, { revenue: Decimal; sales: number }>();
  const byService = new Map<string, number>();
  const byMethod = new Map<PaymentMethod, Decimal>(PAYMENT_METHODS.map((m) => [m, ZERO]));
  let revenue = ZERO;
  let tips = ZERO;
  let hourExcluded = 0;

  for (const sale of sales) {
    const amount = amountOf(sale);
    revenue = revenue.add(amount);
    tips = tips.add(sale.tipAmount);

    const date = countedBusinessDate(sale);
    const day = daily.get(date);
    if (day) daily.set(date, { revenue: day.revenue.add(amount), sales: day.sales + 1 });

    if (sale.timeFlag) hourExcluded++;
    else {
      const hour = Number(manilaHour.format(sale.transactionTime));
      hours.set(hour, (hours.get(hour) ?? 0) + 1);
    }

    const barber = byBarber.get(sale.barber.fullName) ?? { revenue: ZERO, sales: 0 };
    byBarber.set(sale.barber.fullName, { revenue: barber.revenue.add(amount), sales: barber.sales + 1 });

    for (const item of sale.items) byService.set(item.service.name, (byService.get(item.service.name) ?? 0) + 1);

    byMethod.set(sale.paymentMethod, (byMethod.get(sale.paymentMethod) ?? ZERO).add(amount));
  }

  // Opening hours (10 AM-10 PM) always show; earlier or later hours only when a sale was rung up then.
  const soldHours = [...hours.keys()];
  const firstHour = Math.min(10, ...soldHours);
  const lastHour = Math.max(21, ...soldHours);

  const dailyList = [...daily.entries()].map(([date, d]) => ({ date, ...d }));
  return {
    first: firstDay.date,
    last: lastDay.date,
    days,
    daily: dailyList,
    hours: Array.from({ length: lastHour - firstHour + 1 }, (_, i) => ({ hour: firstHour + i, sales: hours.get(firstHour + i) ?? 0 })),
    byBarber: [...byBarber.entries()].map(([name, b]) => ({ name, ...b })).sort((a, b) => b.revenue.comparedTo(a.revenue) || a.name.localeCompare(b.name)),
    byService: [...byService.entries()].map(([name, count]) => ({ name, sales: count })).sort((a, b) => b.sales - a.sales || a.name.localeCompare(b.name)),
    byMethod: PAYMENT_METHODS.map((method) => ({ method, revenue: byMethod.get(method) ?? ZERO })),
    totals: { revenue, sales: sales.length, tips, openDays: dailyList.filter((d) => d.sales > 0).length },
    previous: {
      first: previousFirst.date,
      last: previousLast.date,
      revenue: previousSales.reduce((sum, sale) => sum.add(amountOf(sale)), ZERO),
      sales: previousSales.length,
    },
    heldForReview,
    hourExcluded,
  };
}

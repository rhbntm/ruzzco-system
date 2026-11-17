/**
 * Slice 27: the Reports page's figures over a date range. Read-only, and built only on
 * `rangeFigures` (the ledger Summary's and the Dashboard's path), so a figure here equals the same
 * figure there for the same dates (npm run test:report-parity). Revenue and sale counts are per
 * sale; per-service figures come from `serviceLines` (items and menu-price value).
 */
import { Prisma, type PaymentMethod } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseBusinessDate } from "@/lib/business-date";
import { datesBetween, type DateRange } from "@/lib/date-range";
import { addDays } from "@/lib/forecast";
import { rangeFigures } from "@/lib/range-figures";
import { countHeldForReview } from "@/lib/time-review";

type Decimal = Prisma.Decimal;
const ZERO = new Prisma.Decimal(0);
const PAYMENT_METHODS: PaymentMethod[] = ["CASH", "GCASH", "MAYA", "QRPH"];

export type Report = {
  first: string;
  last: string;
  days: number; // dates in the range
  daily: { date: string; revenue: Decimal; sales: number }[]; // every date, oldest first
  hours: { hour: number; sales: number }[]; // consecutive hours, at least 10 AM-10 PM
  hourExcluded: number;
  byBarber: { name: string; revenue: Decimal; sales: number }[]; // highest revenue first
  byService: { name: string; items: number; listed: Decimal }[]; // service items, most first
  byMethod: { method: PaymentMethod; revenue: Decimal }[];
  totals: { revenue: Decimal; sales: number; tips: Decimal; openDays: number };
  previous: { first: string; last: string; revenue: Decimal; sales: number };
  heldForReview: number;
};

/** The same number of dates just before the range. */
export function previousRange(first: string, days: number) {
  return { first: addDays(first, -days), last: addDays(first, -1) };
}

export async function loadReport(range: DateRange): Promise<Report> {
  const first = range.first.date;
  const last = range.last.date;
  const days = datesBetween(first, last).length;
  const prev = previousRange(first, days);
  const [now, before, heldForReview] = await Promise.all([
    rangeFigures(range.first, range.last, "LIST_PRICE"),
    rangeFigures(parseBusinessDate(prev.first)!, parseBusinessDate(prev.last)!, "LIST_PRICE"),
    countHeldForReview(range.first, range.last),
  ]);
  const { total, perDate } = now;
  const ids = [...total.byBarber.keys()];
  const names = ids.length === 0 ? [] : await prisma.barber.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
  const nameOf = new Map(names.map((b) => [b.id, b.fullName]));

  const daily = [...perDate.entries()].map(([date, b]) => ({ date, revenue: b.revenue, sales: b.count }));
  const soldHours = [...total.hours.keys()];
  const firstHour = Math.min(10, ...soldHours);
  const lastHour = Math.max(21, ...soldHours);
  const methodRevenue: Record<PaymentMethod, Decimal> = { CASH: total.cash, GCASH: total.gcash, MAYA: total.maya, QRPH: total.qrph };

  return {
    first,
    last,
    days,
    daily,
    hours: Array.from({ length: lastHour - firstHour + 1 }, (_, i) => ({ hour: firstHour + i, sales: total.hours.get(firstHour + i) ?? 0 })),
    hourExcluded: total.hourExcluded,
    byBarber: ids
      .map((id) => ({ name: nameOf.get(id) ?? "Unknown barber", revenue: total.byBarber.get(id)!.revenue, sales: total.byBarber.get(id)!.count }))
      .sort((a, b) => b.revenue.comparedTo(a.revenue) || a.name.localeCompare(b.name)),
    byService: [...total.services.entries()]
      .map(([name, s]) => ({ name, items: s.count, listed: s.listSales }))
      .sort((a, b) => b.items - a.items || a.name.localeCompare(b.name)),
    byMethod: PAYMENT_METHODS.map((method) => ({ method, revenue: methodRevenue[method] ?? ZERO })),
    totals: { revenue: total.revenue, sales: total.count, tips: total.tips, openDays: daily.filter((d) => d.sales > 0).length },
    previous: { first: prev.first, last: prev.last, revenue: before.total.revenue, sales: before.total.count },
    heldForReview,
  };
}

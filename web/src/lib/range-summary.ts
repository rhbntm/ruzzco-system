import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DateRange } from "@/lib/date-range";
import { rangeFigures } from "@/lib/range-figures";
import { countHeldForReview } from "@/lib/time-review";
import { latestRevisionPerDate, leftForShop, remainingToPay, serviceGap } from "@/lib/ledger-summary";

// Slice 21a: moved unchanged out of the ledger-summary route, so the route and the owner
// dashboard on `/` call the same calculation and can never disagree.

const ZERO = new Prisma.Decimal(0);
const money = (value: Prisma.Decimal) => value.toFixed(2);

// Slice 20: the legacy answer's shape for any range, from one query per table (rangeFigures).
// Per day it adds up exactly what the legacy path adds up: computeExpected, totalsForDate, the
// day's items, the latest petty cash and the stored paid amounts; remaining is the sum of each
// day's clamped balance. Read-only.
export async function rangeSummary(range: DateRange, commissionBase: "LIST_PRICE" | "AMOUNT_PAID") {
  const { first, last, dates, bounds } = range;
  const [figures, reconciliations, ledgerRows, heldForReview] = await Promise.all([
    rangeFigures(first, last, commissionBase),
    prisma.shiftReconciliation.findMany({
      where: { reconciliationDate: { gte: bounds.dateStart, lt: bounds.dateEnd } },
      select: { reconciliationDate: true, revision: true, pettyCashAmount: true },
    }),
    prisma.dailyPayoutLedger.findMany({
      where: { businessDate: { gte: bounds.dateStart, lt: bounds.dateEnd } },
      select: { businessDate: true, cashPaid: true, gcashPaid: true },
    }),
    countHeldForReview(first, last),
  ]);

  const petty = latestRevisionPerDate(
    reconciliations.map((r) => ({ date: r.reconciliationDate.toISOString().slice(0, 10), revision: r.revision, amount: r.pettyCashAmount }))
  );
  const paidByDate = new Map<string, Prisma.Decimal>();
  for (const row of ledgerRows) {
    const key = row.businessDate.toISOString().slice(0, 10);
    paidByDate.set(key, (paidByDate.get(key) ?? ZERO).add(row.cashPaid).add(row.gcashPaid));
  }

  let pettyCash = ZERO, owed = ZERO, paid = ZERO, remaining = ZERO;
  let pettyCashMissingDays = 0;
  const perDay: { date: string; revenue: string; commissions: string }[] = [];
  for (const date of dates) {
    const day = figures.perDate.get(date)!;
    const dayPetty = petty.get(date)?.amount;
    if (dayPetty === undefined) pettyCashMissingDays++;
    pettyCash = pettyCash.add(dayPetty ?? ZERO);
    const dayOwed = day.commissions.add(day.tips);
    const dayPaid = paidByDate.get(date) ?? ZERO;
    owed = owed.add(dayOwed);
    paid = paid.add(dayPaid);
    remaining = remaining.add(remainingToPay(dayOwed, dayPaid));
    perDay.push({ date, revenue: money(day.revenue), commissions: money(day.commissions) });
  }

  const { total } = figures;
  const serviceRows = [...total.services.entries()]
    .map(([name, entry]) => ({ name, count: entry.count, listSales: entry.listSales }))
    .sort((a, b) => b.listSales.comparedTo(a.listSales) || a.name.localeCompare(b.name));
  const serviceSales = serviceRows.reduce((sum, row) => sum.add(row.listSales), ZERO);

  return {
    success: true,
    date: first.date,
    period: "range",
    from: first.date,
    to: last.date,
    commissionBase,
    sales: { cash: money(total.cash), gcash: money(total.gcash), maya: money(total.maya), qrph: money(total.qrph), total: money(total.revenue), count: total.count },
    shared: { commissions: money(total.commissions), tips: money(total.tips), pettyCash: money(pettyCash), pettyCashRecorded: pettyCashMissingDays === 0 },
    leftForShop: money(leftForShop(total.revenue, total.commissions, pettyCash)),
    payouts: { owed: money(owed), paid: money(paid), remaining: money(remaining) },
    services: serviceRows.map((row) => ({ name: row.name, count: row.count, listSales: money(row.listSales) })),
    serviceGap: money(serviceGap(total.revenue, serviceSales)),
    days: dates.length === 1 ? [] : perDay,
    pettyCashMissingDays,
    heldForReview,
  };
}

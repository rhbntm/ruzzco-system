import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { serverError } from "@/lib/api";
import { hasOwnerAccess, ownerRequiredResponse } from "@/lib/owner-access";
import { isBusinessDate, parseBusinessDate } from "@/lib/business-date";
import { computeExpected } from "@/lib/reconciliation";
import { totalsForDate } from "@/lib/payout-totals";
import { countsOnDay } from "@/lib/time-review";
import { latestRevisionPerDate, leftForShop, listPriceOf, periodDates, remainingToPay, serviceGap } from "@/lib/ledger-summary";

export const dynamic = "force-dynamic";

// Slice 10: read-only. Never creates or updates a row (the payouts GET does; this must not).
const querySchema = z.object({
  date: z.string().refine(isBusinessDate, "date must be a real calendar date (YYYY-MM-DD)"),
  period: z.enum(["day", "week", "month"]).default("day"),
  commissionBase: z.enum(["LIST_PRICE", "AMOUNT_PAID"]).default("LIST_PRICE"),
});

const ZERO = new Prisma.Decimal(0);
const money = (value: Prisma.Decimal) => value.toFixed(2);

export async function GET(request: NextRequest) {
  if (!hasOwnerAccess(request)) return ownerRequiredResponse();
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ success: false, error: "date, period and commissionBase must be valid" }, { status: 400 });
  const { date, period, commissionBase } = parsed.data;

  try {
    const dates = periodDates(date, period);
    const days = dates.map((d) => parseBusinessDate(d)!);
    const first = days[0];
    const last = days[days.length - 1];

    const [reconciliations, ledgerRows, heldForReview] = await Promise.all([
      prisma.shiftReconciliation.findMany({
        where: { reconciliationDate: { gte: first.dateValue, lte: last.dateValue } },
        select: { reconciliationDate: true, revision: true, pettyCashAmount: true },
      }),
      prisma.dailyPayoutLedger.findMany({
        where: { businessDate: { gte: first.dateValue, lte: last.dateValue } },
        select: { businessDate: true, cashPaid: true, gcashPaid: true },
      }),
      prisma.transaction.count({
        where: { timeFlag: { not: null }, timeReviewedAt: null, transactionTime: { gte: first.start, lt: last.end } },
      }),
    ]);

    const petty = latestRevisionPerDate(
      reconciliations.map((r) => ({ date: r.reconciliationDate.toISOString().slice(0, 10), revision: r.revision, amount: r.pettyCashAmount }))
    );
    const paidByDate = new Map<string, Prisma.Decimal>();
    for (const row of ledgerRows) {
      const key = row.businessDate.toISOString().slice(0, 10);
      paidByDate.set(key, (paidByDate.get(key) ?? ZERO).add(row.cashPaid).add(row.gcashPaid));
    }

    let cash = ZERO, gcash = ZERO, maya = ZERO, qrph = ZERO, revenue = ZERO, count = 0;
    let commissions = ZERO, tips = ZERO, pettyCash = ZERO, owed = ZERO, paid = ZERO, remaining = ZERO;
    let pettyCashMissingDays = 0;
    const services = new Map<string, { count: number; listSales: Prisma.Decimal }>();
    const perDay: { date: string; revenue: string; commissions: string }[] = [];

    for (const day of days) {
      const [expected, byBarber, items] = await Promise.all([
        computeExpected(day, 0),
        totalsForDate(day.date, commissionBase),
        prisma.transactionItem.findMany({
          where: { transaction: { ...countsOnDay(day), paymentStatus: "PAID" } },
          select: { service: { select: { name: true } }, transaction: { select: { listPrice: true, amountPaid: true, totalAmount: true } } },
        }),
      ]);
      let dayCommissions = ZERO;
      let dayTips = ZERO;
      for (const totals of byBarber.values()) {
        dayCommissions = dayCommissions.add(totals.viewCommission);
        dayTips = dayTips.add(totals.tips);
      }
      const dayPetty = petty.get(day.date)?.amount;
      if (dayPetty === undefined) pettyCashMissingDays++;

      cash = cash.add(expected.cashSales);
      gcash = gcash.add(expected.gcashTotal);
      maya = maya.add(expected.mayaTotal);
      qrph = qrph.add(expected.qrphTotal);
      revenue = revenue.add(expected.totalRevenue);
      count += expected.transactionCount;
      commissions = commissions.add(dayCommissions);
      tips = tips.add(dayTips);
      pettyCash = pettyCash.add(dayPetty ?? ZERO);
      const dayOwed = dayCommissions.add(dayTips);
      const dayPaid = paidByDate.get(day.date) ?? ZERO;
      owed = owed.add(dayOwed);
      paid = paid.add(dayPaid);
      remaining = remaining.add(remainingToPay(dayOwed, dayPaid));
      for (const item of items) {
        const entry = services.get(item.service.name) ?? { count: 0, listSales: ZERO };
        services.set(item.service.name, { count: entry.count + 1, listSales: entry.listSales.add(listPriceOf(item.transaction)) });
      }
      perDay.push({ date: day.date, revenue: money(expected.totalRevenue), commissions: money(dayCommissions) });
    }

    const serviceRows = [...services.entries()]
      .map(([name, entry]) => ({ name, count: entry.count, listSales: entry.listSales }))
      .sort((a, b) => b.listSales.comparedTo(a.listSales) || a.name.localeCompare(b.name));
    const serviceSales = serviceRows.reduce((sum, row) => sum.add(row.listSales), ZERO);

    return NextResponse.json({
      success: true,
      date,
      period,
      from: first.date,
      to: last.date,
      commissionBase,
      sales: { cash: money(cash), gcash: money(gcash), maya: money(maya), qrph: money(qrph), total: money(revenue), count },
      shared: { commissions: money(commissions), tips: money(tips), pettyCash: money(pettyCash), pettyCashRecorded: pettyCashMissingDays === 0 },
      leftForShop: money(leftForShop(revenue, commissions, pettyCash)),
      payouts: { owed: money(owed), paid: money(paid), remaining: money(remaining) },
      services: serviceRows.map((row) => ({ name: row.name, count: row.count, listSales: money(row.listSales) })),
      serviceGap: money(serviceGap(revenue, serviceSales)),
      days: period === "day" ? [] : perDay,
      pettyCashMissingDays,
      heldForReview,
    });
  } catch (error) {
    return serverError("[GET /api/v1/reports/ledger-summary]", error, "Could not load the summary");
  }
}

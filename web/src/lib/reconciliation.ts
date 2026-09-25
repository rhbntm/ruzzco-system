import { Prisma, type ShiftReconciliation } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BusinessDay } from "@/lib/business-date";

const ZERO = new Prisma.Decimal(0);

export type ExpectedTotals = {
  cashSales: Prisma.Decimal;
  cashTips: Prisma.Decimal;
  cashPayouts: Prisma.Decimal;
  pettyCash: Prisma.Decimal;
  expectedDrawerCash: Prisma.Decimal;
  gcashTotal: Prisma.Decimal;
  mayaTotal: Prisma.Decimal;
  digitalTotal: Prisma.Decimal;
  totalRevenue: Prisma.Decimal;
  transactionCount: number;
};

export type StaleReason = "EXPECTED_CASH_CHANGED" | "LATE_SYNCED_TRANSACTIONS";

export type Staleness = {
  stale: boolean;
  staleReasons: StaleReason[];
  lateSyncedCount: number; // sales in the window that reached the server after reconciledAt
  expectedCashDelta: Prisma.Decimal; // live expected drawer cash minus the saved one
};

const inWindow = (day: BusinessDay) => ({ transactionTime: { gte: day.start, lt: day.end } });

// The one definition of expected drawer cash, used by GET and POST:
//   cash sales + cash-sale tips - cash payouts marked paid - petty cash
// GCash and Maya sales are digital and never enter the drawer; unpaid payout rows and
// gcashPaid never leave it. Revenue is amountPaid (totalAmount for legacy sales), tips excluded.
export async function computeExpected(day: BusinessDay, pettyCash: Prisma.Decimal.Value): Promise<ExpectedTotals> {
  const [transactions, payouts] = await Promise.all([
    prisma.transaction.findMany({
      where: inWindow(day),
      select: { totalAmount: true, amountPaid: true, paymentMethod: true, tipAmount: true },
    }),
    prisma.dailyPayoutLedger.aggregate({
      where: { businessDate: day.dateValue, paidAt: { not: null } },
      _sum: { cashPaid: true },
    }),
  ]);

  let cashSales = ZERO;
  let cashTips = ZERO;
  let gcashTotal = ZERO;
  let mayaTotal = ZERO;
  for (const tx of transactions) {
    const amount = tx.amountPaid ?? tx.totalAmount;
    if (tx.paymentMethod === "CASH") {
      cashSales = cashSales.add(amount);
      cashTips = cashTips.add(tx.tipAmount);
    } else if (tx.paymentMethod === "GCASH") gcashTotal = gcashTotal.add(amount);
    else if (tx.paymentMethod === "MAYA") mayaTotal = mayaTotal.add(amount);
  }
  const petty = new Prisma.Decimal(pettyCash);
  const cashPayouts = payouts._sum.cashPaid ?? ZERO;
  const digitalTotal = gcashTotal.add(mayaTotal);
  return {
    cashSales,
    cashTips,
    cashPayouts,
    pettyCash: petty,
    expectedDrawerCash: cashSales.add(cashTips).sub(cashPayouts).sub(petty),
    gcashTotal,
    mayaTotal,
    digitalTotal,
    totalRevenue: cashSales.add(digitalTotal),
    transactionCount: transactions.length,
  };
}

// A saved revision is a frozen snapshot; this reports whether the day has moved on since.
// The net delta can be zero while the sale set changed, so late syncs count on their own.
export async function computeStaleness(
  day: BusinessDay,
  saved: Pick<ShiftReconciliation, "expectedCash" | "reconciledAt">,
  live: ExpectedTotals
): Promise<Staleness> {
  const lateSyncedCount = await prisma.transaction.count({
    where: { ...inWindow(day), syncedAt: { gt: saved.reconciledAt } },
  });
  const expectedCashDelta = live.expectedDrawerCash.sub(saved.expectedCash);
  const staleReasons: StaleReason[] = [];
  if (!expectedCashDelta.isZero()) staleReasons.push("EXPECTED_CASH_CHANGED");
  if (lateSyncedCount > 0) staleReasons.push("LATE_SYNCED_TRANSACTIONS");
  return { stale: staleReasons.length > 0, staleReasons, lateSyncedCount, expectedCashDelta };
}

export function latestRevision(day: BusinessDay) {
  return prisma.shiftReconciliation.findFirst({
    where: { reconciliationDate: day.dateValue },
    orderBy: { revision: "desc" },
  });
}

// ── Response shapes (money as fixed-2 strings) ───────────────────────────────

export function serializeExpected(t: ExpectedTotals) {
  return {
    cashTotal: t.cashSales.toFixed(2),
    cashTips: t.cashTips.toFixed(2),
    cashPayouts: t.cashPayouts.toFixed(2),
    pettyCash: t.pettyCash.toFixed(2),
    expectedDrawerCash: t.expectedDrawerCash.toFixed(2),
    gcashTotal: t.gcashTotal.toFixed(2),
    mayaTotal: t.mayaTotal.toFixed(2),
    digitalTotal: t.digitalTotal.toFixed(2),
    totalRevenue: t.totalRevenue.toFixed(2),
    transactionCount: t.transactionCount,
  };
}

export function serializeSaved(r: ShiftReconciliation) {
  return {
    id: Number(r.id),
    revision: r.revision,
    expectedCash: r.expectedCash.toFixed(2),
    pettyCashAmount: r.pettyCashAmount.toFixed(2),
    pettyCashNote: r.pettyCashNote,
    countedCash: r.countedCash.toFixed(2),
    variance: r.variance.toFixed(2),
    gcashTotal: r.gcashTotal.toFixed(2),
    mayaTotal: r.mayaTotal.toFixed(2),
    digitalTotal: r.gcashTotal.add(r.mayaTotal).toFixed(2),
    totalRevenue: r.totalRevenue.toFixed(2),
    note: r.note,
    reconciledAt: r.reconciledAt,
  };
}

export function serializeStaleness(s: Staleness) {
  return { ...s, expectedCashDelta: s.expectedCashDelta.toFixed(2) };
}

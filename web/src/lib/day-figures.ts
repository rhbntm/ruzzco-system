import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BusinessDay } from "@/lib/business-date";
import { computeExpected, computeStaleness, latestRevision } from "@/lib/reconciliation";
import { totalsForDate } from "@/lib/payout-totals";
import { isAdditionalOwed, lastEntry, remainingToPay } from "@/lib/payout-entries";
import { countHeldForReview, countsOnDay } from "@/lib/time-review";

// One business day's figures for the owner's Insights page, moved unchanged from
// src/app/insights/page.tsx (slice 20) so the slice 21 owner dashboard can read them too.
// Every money figure comes from the code End-of-Day Cash (computeExpected) and the Barber
// Ledger (totalsForDate) already use, so the pages agree. Read-only.

type Decimal = Prisma.Decimal;
const ZERO = new Prisma.Decimal(0);

export type BarberRow = {
  id: string;
  name: string;
  active: boolean;
  sales: number;
  revenue: Decimal;
  commission: Decimal;
  tips: Decimal;
  earned: Decimal;
  cashPaid: Decimal;
  gcashPaid: Decimal;
  paidOut: Decimal;
  remaining: Decimal;
  additionalOwed: boolean;
};

export async function loadDay(day: BusinessDay) {
  // Petty cash is only recorded with a saved count, so the live figures use the latest
  // revision's, exactly as End-of-Day Cash does.
  const saved = await latestRevision(day);
  const expected = await computeExpected(day, saved?.pettyCashAmount ?? 0);
  const [staleness, totals, sales, ledgerRows, entries, barbers, heldForReview] = await Promise.all([
    saved ? computeStaleness(day, saved, expected) : Promise.resolve(null),
    totalsForDate(day.date, "LIST_PRICE"),
    prisma.transaction.findMany({
      where: { ...countsOnDay(day), paymentStatus: "PAID" },
      select: { barberId: true, totalAmount: true, amountPaid: true },
    }),
    prisma.dailyPayoutLedger.findMany({
      where: { businessDate: day.dateValue },
      select: { barberId: true, cashPaid: true, gcashPaid: true },
    }),
    // Slice 18: the owed amount stored on each payout entry, for the additional-owed rule.
    prisma.payoutEntry.findMany({
      where: { businessDate: day.dateValue },
      select: { barberId: true, owedAtEntry: true, recordedAt: true },
      orderBy: { recordedAt: "asc" },
    }),
    prisma.barber.findMany({ select: { id: true, fullName: true, isActive: true }, orderBy: { fullName: "asc" } }),
    countHeldForReview(day),
  ]);

  const salesByBarber = new Map<string, { count: number; revenue: Decimal }>();
  for (const tx of sales) {
    const current = salesByBarber.get(tx.barberId) ?? { count: 0, revenue: ZERO };
    salesByBarber.set(tx.barberId, { count: current.count + 1, revenue: current.revenue.add(tx.amountPaid ?? tx.totalAmount) });
  }
  const ledgerByBarber = new Map(ledgerRows.map((row) => [row.barberId, row]));

  // The ledger's roster rule: every active barber, plus anyone with sales or a payout row on this date.
  const rows: BarberRow[] = barbers
    .filter((barber) => barber.isActive || totals.has(barber.id) || ledgerByBarber.has(barber.id))
    .map((barber) => {
      const total = totals.get(barber.id);
      const ledger = ledgerByBarber.get(barber.id);
      const commission = total?.commission ?? ZERO;
      const tips = total?.tips ?? ZERO;
      const earned = commission.add(tips);
      const cashPaid = ledger?.cashPaid ?? ZERO;
      const gcashPaid = ledger?.gcashPaid ?? ZERO;
      const paidOut = cashPaid.add(gcashPaid);
      return {
        id: barber.id,
        name: barber.fullName,
        active: barber.isActive,
        sales: salesByBarber.get(barber.id)?.count ?? 0,
        revenue: salesByBarber.get(barber.id)?.revenue ?? ZERO,
        commission,
        tips,
        earned,
        cashPaid,
        gcashPaid,
        paidOut,
        // As on the ledger page: left to pay, never below zero.
        remaining: remainingToPay(earned, paidOut),
        // As on the ledger: fully paid at the last entry, then more sales counted on this date.
        additionalOwed: isAdditionalOwed(earned, paidOut, lastEntry(entries.filter((e) => e.barberId === barber.id))?.owedAtEntry ?? null),
      };
    });

  return {
    saved,
    expected,
    staleness,
    rows,
    tipsTotal: [...totals.values()].reduce((sum, total) => sum.add(total.tips), ZERO),
    heldForReview,
    pendingQrph: expected.gatewaySales.filter((sale) => sale.status !== "PAID").length,
  };
}

export type DayData = Awaited<ReturnType<typeof loadDay>>;

export async function loadDaySafely(day: BusinessDay): Promise<DayData | null> {
  try {
    return await loadDay(day);
  } catch (error) {
    console.error("[insights] day query failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

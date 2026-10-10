import type { Prisma, TimeReviewChoice } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { manilaToday, parseBusinessDate, type BusinessDay } from "@/lib/business-date";

// Which sales count on a business day, and the owner's date review for flagged sales (L5).
//
// A sale counts on Manila business day D when either:
//   - it is not flagged and its transactionTime falls in D, or
//   - it is flagged, the owner reviewed it, and the confirmed date is D.
// A flagged sale that has not been reviewed counts on no day: not in revenue, expected
// drawer cash, commission or payouts. Each sale therefore counts on at most one day.

export function countsOnDay(day: BusinessDay): Prisma.TransactionWhereInput {
  return {
    OR: [
      { timeFlag: null, transactionTime: { gte: day.start, lt: day.end } },
      { timeFlag: { not: null }, timeReviewedBusinessDate: day.dateValue },
    ],
  };
}

export type NeedsReviewSale = {
  id: string;
  barberName: string;
  paymentMethod: string;
  amount: string;
  tipAmount: string;
  flag: string;
  skewSeconds: number | null;
  transactionTime: Date;
  receivedAt: Date;
  statedDate: string; // Manila date of transactionTime
  receivedDate: string; // Manila date the server received it
};

/**
 * Flagged sales still waiting for review that touch day D: stated on D or received on D.
 * Shown on that day's reconciliation so the owner sees them from either side.
 */
export async function listNeedsReview(day: BusinessDay): Promise<NeedsReviewSale[]> {
  const rows = await prisma.transaction.findMany({
    where: {
      timeFlag: { not: null },
      timeReviewedAt: null,
      OR: [
        { transactionTime: { gte: day.start, lt: day.end } },
        { syncedAt: { gte: day.start, lt: day.end } },
      ],
    },
    select: {
      id: true,
      paymentMethod: true,
      totalAmount: true,
      amountPaid: true,
      tipAmount: true,
      timeFlag: true,
      clockSkewSeconds: true,
      transactionTime: true,
      syncedAt: true,
      barber: { select: { fullName: true } },
    },
    orderBy: { syncedAt: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    barberName: row.barber.fullName,
    paymentMethod: row.paymentMethod,
    amount: (row.amountPaid ?? row.totalAmount).toFixed(2),
    tipAmount: row.tipAmount.toFixed(2),
    flag: row.timeFlag!,
    skewSeconds: row.clockSkewSeconds,
    transactionTime: row.transactionTime,
    receivedAt: row.syncedAt,
    statedDate: manilaToday(row.transactionTime),
    receivedDate: manilaToday(row.syncedAt),
  }));
}

/** Flagged, unreviewed sales stated on day D (held out of that day's figures). */
export function countHeldForReview(day: BusinessDay) {
  return prisma.transaction.count({
    where: { timeFlag: { not: null }, timeReviewedAt: null, transactionTime: { gte: day.start, lt: day.end } },
  });
}

export type ReviewResult =
  | { status: "reviewed" | "unchanged"; businessDate: string; choice: TimeReviewChoice }
  | { status: "not_found" | "not_flagged" | "future_date" | "already_reviewed"; businessDate?: string; choice?: TimeReviewChoice };

/**
 * Records the owner's date for a flagged sale. Only the review fields change: the sale's
 * timestamp, amounts and commission snapshot stay as they are.
 * - Same choice again: no change (idempotent).
 * - A different choice after a review: refused, so money already counted on a day (and
 *   maybe paid out) never moves silently.
 * - Keeping a stated date that is still in the future: refused; use the received date.
 */
export async function reviewSaleDate(transactionId: string, choice: TimeReviewChoice, now = new Date()): Promise<ReviewResult> {
  const sale = await prisma.transaction.findUnique({
    where: { id: transactionId },
    select: { timeFlag: true, transactionTime: true, syncedAt: true, timeReviewedAt: true, timeReviewChoice: true, timeReviewedBusinessDate: true },
  });
  if (!sale) return { status: "not_found" };
  if (!sale.timeFlag) return { status: "not_flagged" };

  const reviewed = (s: { timeReviewChoice: TimeReviewChoice | null; timeReviewedBusinessDate: Date | null }): ReviewResult =>
    s.timeReviewChoice === choice
      ? { status: "unchanged", choice, businessDate: s.timeReviewedBusinessDate!.toISOString().slice(0, 10) }
      : { status: "already_reviewed", choice: s.timeReviewChoice ?? undefined, businessDate: s.timeReviewedBusinessDate?.toISOString().slice(0, 10) };
  if (sale.timeReviewedAt) return reviewed(sale);

  const businessDate = manilaToday(choice === "STATED_DATE" ? sale.transactionTime : sale.syncedAt);
  if (businessDate > manilaToday(now)) return { status: "future_date", businessDate };

  // Conditional on "not reviewed yet", so two owners' taps cannot both apply.
  const updated = await prisma.transaction.updateMany({
    where: { id: transactionId, timeReviewedAt: null },
    data: { timeReviewedAt: now, timeReviewChoice: choice, timeReviewedBusinessDate: parseBusinessDate(businessDate)!.dateValue },
  });
  if (updated.count === 0) {
    const current = await prisma.transaction.findUniqueOrThrow({
      where: { id: transactionId },
      select: { timeReviewChoice: true, timeReviewedBusinessDate: true },
    });
    return reviewed(current);
  }
  return { status: "reviewed", businessDate, choice };
}

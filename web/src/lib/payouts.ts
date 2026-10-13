import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BusinessDay } from "@/lib/business-date";
import { commissionFor } from "@/lib/commission";
import { countsOnDay } from "@/lib/time-review";

export type CommissionBaseView = "LIST_PRICE" | "AMOUNT_PAID";
export type BarberTotals = { commission: Prisma.Decimal; viewCommission: Prisma.Decimal; tips: Prisma.Decimal };
const ZERO = new Prisma.Decimal(0);

// Totals come only from the snapshots stored on each sale, never from Barber.commissionRate,
// so a rate change cannot rewrite a past day. `commission` is the canonical LIST_PRICE total
// (sum of barberCommissionAmount); `viewCommission` is the requested base, for display only.
// Read-only: the payout ledger route and the owner's /insights page share it.
export async function payoutTotalsForDay(day: BusinessDay, commissionBase: CommissionBaseView) {
  const transactions = await prisma.transaction.findMany({
    // Only PAID sales are owed; a QRPH sale joins its day's totals once the gateway confirms it.
    // countsOnDay: a flagged sale's commission waits for the owner's date review (L5).
    where: { ...countsOnDay(day), paymentStatus: "PAID" },
    select: {
      barberId: true,
      totalAmount: true,
      amountPaid: true,
      tipAmount: true,
      barberCommissionAmount: true,
      commissionRate: true,
    },
  });
  const byBarber = new Map<string, BarberTotals>();
  for (const tx of transactions) {
    const view = commissionBase === "LIST_PRICE"
      ? tx.barberCommissionAmount
      : commissionFor(tx.amountPaid ?? tx.totalAmount, tx.commissionRate);
    const current = byBarber.get(tx.barberId) ?? { commission: ZERO, viewCommission: ZERO, tips: ZERO };
    byBarber.set(tx.barberId, {
      commission: current.commission.add(tx.barberCommissionAmount),
      viewCommission: current.viewCommission.add(view),
      tips: current.tips.add(tx.tipAmount),
    });
  }
  return byBarber;
}

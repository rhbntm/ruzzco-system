/**
 * The sale insert of POST /api/v1/transactions/sync, moved out of the route unchanged (slice 16)
 * so its rollback can be tested against MySQL directly (test:sync-rejections T12).
 *
 * The mismatch log (when there is one), the transaction, its line item and its commission log are
 * written in one $transaction: a failed insert never leaves an orphan log or a partial sale. The
 * caller decides what a thrown error means (isSaleDataError → that sale is INVALID; a unique
 * violation → already recorded; anything else is rethrown).
 */
import { Prisma, type DiscountType, type PaymentMethod, type TimeFlag } from "@prisma/client";
import { prisma } from "./prisma";

// Errors caused by the sale's own data (unknown service, value too long, value out of
// range). They fail the same way on every retry, so they reject that sale only.
// Anything else (connection loss, deadlock) is transient and still fails the request.
export function isSaleDataError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2003" || error.code === "P2000" || error.code === "P2020")
  );
}

export type SaleToRecord = {
  id: string;
  barberId: string;
  cashierId: string | null;
  assignmentId: string | null;
  userId: string | null;
  serviceId: string;
  totalAmount: number;
  listPrice: number;
  discountType: DiscountType;
  discountAmount: number;
  amountPaid: number;
  tipAmount: number;
  customAmount: boolean;
  customAmountNote: string | null;
  commissionAmount: Prisma.Decimal;
  commissionRate: Prisma.Decimal;
  commissionBase: "LIST_PRICE";
  paymentMethod: PaymentMethod;
  paymentReference: string | null;
  transactionTime: Date;
  timeFlag: TimeFlag | null;
  clockSkewSeconds: number | null;
  /** The claimed barber differs from the assignment's: logged with the sale, in the same transaction. */
  mismatch: { deviceKey: string; claimedBarberId: string } | null;
};

export async function recordSale(sale: SaleToRecord): Promise<void> {
  await prisma.$transaction([
    ...(sale.mismatch
      ? [
          prisma.syncMismatchLog.create({
            data: {
              transactionId: sale.id,
              deviceKey: sale.mismatch.deviceKey,
              claimedBarberId: sale.mismatch.claimedBarberId,
              resolvedBarberId: sale.barberId,
            },
          }),
        ]
      : []),
    prisma.transaction.create({
      data: {
        id: sale.id,
        barberId: sale.barberId,
        cashierId: sale.cashierId,
        assignmentId: sale.assignmentId,
        userId: sale.userId,
        totalAmount: sale.totalAmount,
        listPrice: sale.listPrice,
        discountType: sale.discountType,
        discountAmount: sale.discountAmount,
        amountPaid: sale.amountPaid,
        tipAmount: sale.tipAmount,
        customAmount: sale.customAmount,
        customAmountNote: sale.customAmountNote,
        barberCommissionAmount: sale.commissionAmount,
        commissionRate: sale.commissionRate,
        commissionBase: sale.commissionBase,
        paymentMethod: sale.paymentMethod,
        paymentReference: sale.paymentReference,
        // Only the gateway (webhook or status check) can mark a QRPH sale PAID.
        paymentStatus: sale.paymentMethod === "QRPH" ? "PENDING" : "PAID",
        transactionTime: sale.transactionTime,
        syncedAt: new Date(),
        timeFlag: sale.timeFlag,
        clockSkewSeconds: sale.clockSkewSeconds,
        items: {
          create: {
            serviceId: sale.serviceId,
            priceAtSale: sale.totalAmount,
          },
        },
        commissionLogs: {
          create: {
            barberId: sale.barberId,
            amount: sale.commissionAmount,
          },
        },
      },
    }),
  ]);
}

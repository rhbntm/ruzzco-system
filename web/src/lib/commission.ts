import { Prisma } from "@prisma/client";

/**
 * Commission on `base` at `rate`, rounded to centavos half-up. The only commission
 * calculation: sync snapshots with it and the payout ledger's AMOUNT_PAID view uses it.
 * Decimal arithmetic, never JS floats (Math.round(2.01 * 0.5 * 100) / 100 gives 1.00).
 */
export function commissionFor(base: Prisma.Decimal.Value, rate: Prisma.Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(base).mul(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

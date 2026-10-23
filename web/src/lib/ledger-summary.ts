import { Prisma } from "@prisma/client";

// Slice 10: the arithmetic behind the ledger's summary. Pure functions, no I/O, so periods and
// totals are testable with invented numbers.

export type Period = "day" | "week" | "month";

const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The Manila business dates a period covers, oldest first. A business date is a plain
 * YYYY-MM-DD, so this works on UTC calendar arithmetic. Weeks run Monday to Sunday; a month is
 * the calendar month containing `date`. `date` must already be a valid business date.
 */
export function periodDates(date: string, period: Period): string[] {
  const at = Date.parse(`${date}T00:00:00.000Z`);
  if (period === "day") return [date];
  if (period === "week") {
    const sinceMonday = (new Date(at).getUTCDay() + 6) % 7;
    const monday = at - sinceMonday * DAY_MS;
    return Array.from({ length: 7 }, (_, i) => iso(monday + i * DAY_MS));
  }
  const d = new Date(at);
  const first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  const length = Math.round((next - first) / DAY_MS);
  return Array.from({ length }, (_, i) => iso(first + i * DAY_MS));
}

/** What is left for the shop: revenue - commissions - petty cash. Tips are not in revenue, so they are not subtracted. */
export function leftForShop(revenue: Prisma.Decimal, commissions: Prisma.Decimal, pettyCash: Prisma.Decimal) {
  return revenue.sub(commissions).sub(pettyCash);
}

/** Per-day remaining to pay, never negative; a period sums its days so an overpaid day cannot hide another's balance. */
export function remainingToPay(owed: Prisma.Decimal, paid: Prisma.Decimal) {
  const remaining = owed.sub(paid);
  return remaining.isNegative() ? new Prisma.Decimal(0) : remaining;
}

/**
 * The "Discounts" line: revenue minus the services' list-price sales, so negative by the
 * discounts given (list price minus amount paid, e.g. a loyalty haircut). A custom amount is its
 * own list price and adds nothing.
 */
export function serviceGap(revenue: Prisma.Decimal, serviceSales: Prisma.Decimal) {
  return revenue.sub(serviceSales);
}

/**
 * A service row's amount for one sale: the sale's list price (slice 13), so a discount shows on
 * the "Discounts" line instead of lowering the service row. A sale stored before list prices
 * existed (slice 4) falls back to what was paid, the same amount revenue counts, so it adds
 * nothing to the discounts line. One service per sale, so the sale's list price is its item's.
 */
export function listPriceOf(sale: {
  listPrice: Prisma.Decimal.Value | null;
  amountPaid: Prisma.Decimal.Value | null;
  totalAmount: Prisma.Decimal.Value;
}): Prisma.Decimal {
  return new Prisma.Decimal(sale.listPrice ?? sale.amountPaid ?? sale.totalAmount);
}

/** Latest revision per reconciliation date. */
export function latestRevisionPerDate<T extends { date: string; revision: number }>(rows: T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const current = latest.get(row.date);
    if (!current || row.revision > current.revision) latest.set(row.date, row);
  }
  return latest;
}

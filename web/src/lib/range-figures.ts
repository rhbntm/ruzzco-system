import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { BusinessDay } from "@/lib/business-date";
import { datesBetween } from "@/lib/date-range";
import { commissionFor } from "@/lib/commission";
import { serviceLines } from "@/lib/ledger-summary";
import type { Base } from "@/lib/payout-totals";
import { countedBusinessDate, countsInRange } from "@/lib/time-review";

// Slice 20: the figures of business days first..last (inclusive) from one transaction query,
// bucketed by the day each sale counts on (countedBusinessDate). Per day it equals what
// computeExpected (sales by method, revenue, count), totalsForDate (commissions, tips) and the
// ledger summary's item query (services) give for that day; only PAID sales count, and a
// flagged sale counts only on its reviewed date. Read-only.

const ZERO = new Prisma.Decimal(0);

export type RangeBarber = {
  commission: Prisma.Decimal; // canonical: sum of the stored list-price snapshots
  viewCommission: Prisma.Decimal; // the requested base, for display
  tips: Prisma.Decimal;
  count: number;
  revenue: Prisma.Decimal;
};

export type RangeBucket = {
  cash: Prisma.Decimal;
  gcash: Prisma.Decimal;
  maya: Prisma.Decimal;
  qrph: Prisma.Decimal;
  revenue: Prisma.Decimal;
  count: number;
  commissions: Prisma.Decimal; // requested base
  canonicalCommission: Prisma.Decimal;
  tips: Prisma.Decimal;
  services: Map<string, { count: number; listSales: Prisma.Decimal }>;
  byBarber: Map<string, RangeBarber>;
  /** Slice 27: paid sales by the Manila hour they were rung up; flagged sales (phone time not trusted) in hourExcluded. */
  hours: Map<number, number>;
  hourExcluded: number;
};

export function emptyBucket(): RangeBucket {
  return {
    cash: ZERO, gcash: ZERO, maya: ZERO, qrph: ZERO, revenue: ZERO, count: 0,
    commissions: ZERO, canonicalCommission: ZERO, tips: ZERO, services: new Map(), byBarber: new Map(),
    hours: new Map(), hourExcluded: 0,
  };
}

const manilaHour = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", hourCycle: "h23" });

type Sale = {
  barberId: string;
  paymentMethod: string;
  totalAmount: Prisma.Decimal;
  amountPaid: Prisma.Decimal | null;
  listPrice: Prisma.Decimal | null;
  tipAmount: Prisma.Decimal;
  barberCommissionAmount: Prisma.Decimal;
  commissionRate: Prisma.Decimal;
  items: { priceAtSale: Prisma.Decimal; service: { name: string } }[];
  transactionTime: Date;
  timeFlag: string | null;
};

function add(bucket: RangeBucket, sale: Sale, commissionBase: Base) {
  const amount = sale.amountPaid ?? sale.totalAmount;
  const view = commissionBase === "LIST_PRICE" ? sale.barberCommissionAmount : commissionFor(amount, sale.commissionRate);
  bucket.count++;
  if (sale.paymentMethod === "QRPH") bucket.qrph = bucket.qrph.add(amount);
  else if (sale.paymentMethod === "CASH") bucket.cash = bucket.cash.add(amount);
  else if (sale.paymentMethod === "GCASH") bucket.gcash = bucket.gcash.add(amount);
  else if (sale.paymentMethod === "MAYA") bucket.maya = bucket.maya.add(amount);
  bucket.revenue = bucket.cash.add(bucket.gcash).add(bucket.maya).add(bucket.qrph);
  bucket.commissions = bucket.commissions.add(view);
  bucket.canonicalCommission = bucket.canonicalCommission.add(sale.barberCommissionAmount);
  bucket.tips = bucket.tips.add(sale.tipAmount);
  // Per service: items counted, listed values from serviceLines (slice 23), never the whole
  // sale's list price once per item. The sale's money above is counted once.
  for (const line of serviceLines(sale)) {
    const entry = bucket.services.get(line.name) ?? { count: 0, listSales: ZERO };
    bucket.services.set(line.name, { count: entry.count + 1, listSales: entry.listSales.add(line.listed) });
  }
  // Busy hours (slice 27, additive): a flagged sale's phone time is not trusted, so it has no hour.
  if (sale.timeFlag) bucket.hourExcluded++;
  else {
    const hour = Number(manilaHour.format(sale.transactionTime));
    bucket.hours.set(hour, (bucket.hours.get(hour) ?? 0) + 1);
  }
  const barber = bucket.byBarber.get(sale.barberId) ?? { commission: ZERO, viewCommission: ZERO, tips: ZERO, count: 0, revenue: ZERO };
  bucket.byBarber.set(sale.barberId, {
    commission: barber.commission.add(sale.barberCommissionAmount),
    viewCommission: barber.viewCommission.add(view),
    tips: barber.tips.add(sale.tipAmount),
    count: barber.count + 1,
    revenue: barber.revenue.add(amount),
  });
}

/** Per date (every date of the range, oldest first) and in total. */
export async function rangeFigures(first: BusinessDay, last: BusinessDay, commissionBase: Base) {
  const dates = datesBetween(first.date, last.date);
  const sales = await prisma.transaction.findMany({
    where: { ...countsInRange(first, last), paymentStatus: "PAID" },
    select: {
      barberId: true,
      paymentMethod: true,
      totalAmount: true,
      amountPaid: true,
      listPrice: true,
      tipAmount: true,
      barberCommissionAmount: true,
      commissionRate: true,
      timeFlag: true,
      transactionTime: true,
      timeReviewedBusinessDate: true,
      items: { select: { priceAtSale: true, service: { select: { name: true } } } },
    },
  });
  const perDate = new Map<string, RangeBucket>(dates.map((date) => [date, emptyBucket()]));
  const total = emptyBucket();
  for (const sale of sales) {
    const bucket = perDate.get(countedBusinessDate(sale));
    if (!bucket) continue; // countsInRange already keeps the range; never count a sale outside it
    add(bucket, sale, commissionBase);
    add(total, sale, commissionBase);
  }
  return { perDate, total };
}

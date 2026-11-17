import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DateRange } from "@/lib/date-range";
import { isPageSize, SALES_PAGE_SIZE } from "@/lib/paginate";
import { manilaToday } from "@/lib/business-date";
import { countedBusinessDate, countsInRange } from "@/lib/time-review";

// Slice 22, Decisions 3, 4, 5, 7 and 8: the owner's Sales list. Read-only. A sale is in the range
// when it counts on one of its days (countsInRange); a flagged sale not yet reviewed counts on no
// day, so it is listed on the Manila date the PC received it, marked, and left out of the totals.

export const SALE_METHODS = ["CASH", "GCASH", "MAYA", "QRPH"] as const;
export const SALE_STATUSES = ["PAID", "PENDING", "EXPIRED", "FAILED"] as const;
export const SALE_KINDS = ["all", "custom", "loyalty"] as const;

export type SalesFilters = {
  barberId?: string;
  method?: (typeof SALE_METHODS)[number];
  status?: (typeof SALE_STATUSES)[number];
  serviceId?: string;
  kind: (typeof SALE_KINDS)[number];
};

export type ParsedSalesQuery = { filters: SalesFilters; page: number; pageSize: number };

/** The filters, page and pageSize from the query string, or the message for a 400. Pure. */
export function parseSalesQuery(params: URLSearchParams): ParsedSalesQuery | { error: string } {
  const pick = <T extends string>(name: string, allowed: readonly T[]): T | undefined | "bad" => {
    const value = params.get(name);
    if (value === null || value === "" || value === "all") return undefined;
    return (allowed as readonly string[]).includes(value) ? (value as T) : "bad";
  };
  const method = pick("method", SALE_METHODS);
  const status = pick("status", SALE_STATUSES);
  const kind = pick("kind", SALE_KINDS);
  if (method === "bad") return { error: "method must be CASH, GCASH, MAYA or QRPH" };
  if (status === "bad") return { error: "status must be PAID, PENDING, EXPIRED or FAILED" };
  if (kind === "bad") return { error: "kind must be all, custom or loyalty" };

  let page = 1;
  const rawPage = params.get("page");
  if (rawPage !== null && rawPage !== "") {
    if (!/^\d+$/.test(rawPage)) return { error: "page must be a whole number" };
    page = Math.max(1, Number(rawPage));
  }
  let pageSize: number = SALES_PAGE_SIZE;
  const rawSize = params.get("pageSize");
  if (rawSize !== null && rawSize !== "") {
    const size = Number(rawSize);
    if (!isPageSize(size)) return { error: "pageSize must be 10, 25, 50 or 100" };
    pageSize = size;
  }
  return {
    filters: {
      barberId: params.get("barberId") || undefined,
      serviceId: params.get("serviceId") || undefined,
      method,
      status,
      kind: kind ?? "all",
    },
    page,
    pageSize,
  };
}

/** A page past the last answers the last page. Pure. */
export function clampPage(page: number, count: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(count / pageSize));
  return { page: Math.min(Math.max(1, page), pageCount), pageCount };
}

/**
 * The sales of a range: those that count on a day of it, plus flagged sales not yet reviewed that
 * the PC received within it (listed, never counted).
 */
function inRange(range: DateRange): Prisma.TransactionWhereInput {
  const { first, last } = range;
  return {
    OR: [
      countsInRange(first, last),
      { timeFlag: { not: null }, timeReviewedAt: null, syncedAt: { gte: first.start, lt: last.end } },
    ],
  };
}

function filterWhere(filters: SalesFilters): Prisma.TransactionWhereInput {
  const and: Prisma.TransactionWhereInput[] = [];
  if (filters.barberId) and.push({ barberId: filters.barberId });
  if (filters.method) and.push({ paymentMethod: filters.method });
  if (filters.status) and.push({ paymentStatus: filters.status });
  if (filters.serviceId) and.push({ items: { some: { serviceId: filters.serviceId } } });
  if (filters.kind === "custom") and.push({ customAmount: true });
  // A loyalty sale is one with a discount (slice 16 allows no other discount).
  if (filters.kind === "loyalty") and.push({ discountAmount: { gt: 0 } });
  return { AND: and };
}

const ZERO = new Prisma.Decimal(0);
const two = (value: Prisma.Decimal | null | undefined) => (value ?? ZERO).toFixed(2);

export async function listSales(range: DateRange, query: ParsedSalesQuery) {
  const where: Prisma.TransactionWhereInput = { AND: [inRange(range), filterWhere(query.filters)] };
  const counted: Prisma.TransactionWhereInput = { AND: [where, countsInRange(range.first, range.last), { paymentStatus: "PAID" }] };
  const [count, paid, legacy] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.aggregate({
      where: counted,
      _sum: { amountPaid: true, tipAmount: true, barberCommissionAmount: true },
      _count: true,
    }),
    // Older rows may have no amountPaid; totalAmount is what was paid then.
    prisma.transaction.aggregate({ where: { AND: [counted, { amountPaid: null }] }, _sum: { totalAmount: true } }),
  ]);
  const amountPaid = (paid._sum.amountPaid ?? ZERO).add(legacy._sum.totalAmount ?? ZERO);

  const { page, pageCount } = clampPage(query.page, count, query.pageSize);
  const rows = await prisma.transaction.findMany({
    where,
    orderBy: [{ transactionTime: "desc" }, { id: "asc" }],
    skip: (page - 1) * query.pageSize,
    take: query.pageSize,
    select: {
      id: true,
      transactionTime: true,
      syncedAt: true,
      amountPaid: true,
      totalAmount: true,
      listPrice: true,
      discountAmount: true,
      tipAmount: true,
      customAmount: true,
      customAmountNote: true,
      paymentMethod: true,
      paymentStatus: true,
      paymentReference: true,
      barberCommissionAmount: true,
      commissionRate: true,
      commissionBase: true,
      timeFlag: true,
      timeReviewedAt: true,
      timeReviewChoice: true,
      timeReviewedBusinessDate: true,
      barber: { select: { fullName: true } },
      user: { select: { username: true } },
      // Every service of the sale (slice 23), by name (items have no recording order); one row per sale.
      items: { select: { service: { select: { name: true } } }, orderBy: { service: { name: "asc" } } },
    },
  });

  return {
    page,
    pageCount,
    pageSize: query.pageSize,
    totals: {
      count,
      paidCount: paid._count,
      amountPaid: amountPaid.toFixed(2),
      tips: two(paid._sum.tipAmount),
      commission: two(paid._sum.barberCommissionAmount),
      notCounted: count - paid._count,
    },
    sales: rows.map((row) => {
      const underReview = row.timeFlag !== null && row.timeReviewedAt === null;
      return {
        id: row.id,
        time: row.transactionTime.toISOString(),
        // The day it counts on; an unreviewed flagged sale counts on none and is listed on the
        // date the PC received it.
        countsOn: underReview ? null : countedBusinessDate(row),
        listedOn: underReview ? manilaToday(row.syncedAt) : countedBusinessDate(row),
        barberName: row.barber.fullName,
        // "Haircut + Shave" for a sale of several services (slice 23).
        serviceName: row.items.length > 0 ? row.items.map((item) => item.service.name).join(" + ") : null,
        serviceNames: row.items.map((item) => item.service.name),
        amountPaid: two(row.amountPaid ?? row.totalAmount),
        listPrice: row.listPrice ? row.listPrice.toFixed(2) : null,
        discount: two(row.discountAmount),
        tip: two(row.tipAmount),
        paymentMethod: row.paymentMethod,
        paymentStatus: row.paymentStatus,
        paymentReference: row.paymentReference,
        customAmount: row.customAmount,
        customAmountNote: row.customAmountNote,
        loyalty: row.discountAmount.gt(0),
        commission: two(row.barberCommissionAmount),
        commissionRate: row.commissionRate.toFixed(2),
        commissionBase: row.commissionBase,
        receivedAt: row.syncedAt.toISOString(),
        account: row.user?.username ?? null,
        timeFlag: row.timeFlag,
        timeReview: underReview ? "UNDER_REVIEW" : row.timeReviewChoice,
        counted: row.paymentStatus === "PAID" && !underReview,
      };
    }),
  };
}

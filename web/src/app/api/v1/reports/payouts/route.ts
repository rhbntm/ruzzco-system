import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { commissionFor } from "@/lib/commission";
import { hasOwnerAccess, ownerRequiredResponse } from "@/lib/owner-access";
import { isBusinessDate, parseBusinessDate } from "@/lib/business-date";

export const dynamic = "force-dynamic";

const businessDate = z.string().refine(isBusinessDate, "date must be a real calendar date (YYYY-MM-DD)");

const querySchema = z.object({
  date: businessDate,
  commissionBase: z.enum(["LIST_PRICE", "AMOUNT_PAID"]).default("LIST_PRICE"),
});

const paymentSchema = z.object({
  date: businessDate,
  barberId: z.string().min(1),
  commissionBase: z.enum(["LIST_PRICE", "AMOUNT_PAID"]).default("LIST_PRICE"),
  cashPaid: z.number().nonnegative().multipleOf(0.01),
  gcashPaid: z.number().nonnegative().multipleOf(0.01),
  paid: z.boolean(),
});

// Callers pass dates already validated by the schemas above.
const businessDay = (date: string) => parseBusinessDate(date)!;
const dateValue = (date: string) => businessDay(date).dateValue;

type Base = "LIST_PRICE" | "AMOUNT_PAID";
type BarberTotals = { commission: Prisma.Decimal; viewCommission: Prisma.Decimal; tips: Prisma.Decimal };
const ZERO = new Prisma.Decimal(0);

// Totals come only from the snapshots stored on each sale, never from Barber.commissionRate,
// so a rate change cannot rewrite a past day. `commission` is the canonical LIST_PRICE total
// (sum of barberCommissionAmount); `viewCommission` is the requested base, for display only.
async function totalsForDate(date: string, commissionBase: Base) {
  const day = businessDay(date);
  const transactions = await prisma.transaction.findMany({
    where: { transactionTime: { gte: day.start, lt: day.end } },
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

// Refreshes the stored rows with the canonical LIST_PRICE totals, whatever base is viewed.
// A row covers every active barber, plus any barber (active or not) with sales or an
// existing row on this date: isActive limits the roster, never historical earnings.
async function syncLedgerRows(date: string, totals: Map<string, BarberTotals>) {
  const businessDate = dateValue(date);
  const [activeBarbers, existingRows] = await Promise.all([
    prisma.barber.findMany({ where: { isActive: true }, select: { id: true } }),
    prisma.dailyPayoutLedger.findMany({ where: { businessDate }, select: { barberId: true } }),
  ]);
  const barberIds = new Set([
    ...activeBarbers.map((b) => b.id),
    ...totals.keys(),
    ...existingRows.map((r) => r.barberId),
  ]);
  for (const barberId of barberIds) {
    const total = totals.get(barberId);
    const commissionTotal = total?.commission ?? ZERO;
    const tipTotal = total?.tips ?? ZERO;
    const totalOwed = commissionTotal.add(tipTotal);
    // Payment fields (cashPaid, gcashPaid, paidAt) are only written by POST.
    await prisma.dailyPayoutLedger.upsert({
      where: { barberId_businessDate: { barberId, businessDate } },
      create: { barberId, businessDate, commissionTotal, tipTotal, totalOwed },
      update: { commissionTotal, tipTotal, totalOwed },
    });
  }
  return prisma.dailyPayoutLedger.findMany({
    where: { businessDate },
    include: { barber: { select: { fullName: true } } },
    orderBy: { barber: { fullName: "asc" } },
  });
}

function serialize(rows: Array<{
  id: bigint; barberId: string; businessDate: Date; commissionTotal: Prisma.Decimal; tipTotal: Prisma.Decimal;
  cashPaid: Prisma.Decimal; gcashPaid: Prisma.Decimal; paidAt: Date | null; barber: { fullName: string };
}>, commissionBase: Base, totals: Map<string, BarberTotals>) {
  return rows.map((row) => {
    // LIST_PRICE shows the stored canonical total; AMOUNT_PAID is computed for display only.
    const commission = commissionBase === "LIST_PRICE"
      ? row.commissionTotal
      : totals.get(row.barberId)?.viewCommission ?? ZERO;
    const totalOwed = commission.add(row.tipTotal);
    const paid = row.cashPaid.add(row.gcashPaid);
    return {
      id: Number(row.id),
      barberId: row.barberId,
      barberName: row.barber.fullName,
      businessDate: row.businessDate.toISOString().slice(0, 10),
      commissionTotal: commission.toFixed(2),
      tipTotal: row.tipTotal.toFixed(2),
      totalOwed: totalOwed.toFixed(2),
      cashPaid: row.cashPaid.toFixed(2),
      gcashPaid: row.gcashPaid.toFixed(2),
      paidAt: row.paidAt,
      paid: Boolean(row.paidAt),
      additionalOwed: Boolean(row.paidAt && totalOwed.gt(paid)),
      commissionBase,
    };
  });
}

export async function GET(request: NextRequest) {
  if (!hasOwnerAccess(request)) return ownerRequiredResponse();
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ success: false, error: "date and valid commissionBase are required" }, { status: 400 });
  const totals = await totalsForDate(parsed.data.date, parsed.data.commissionBase);
  const rows = await syncLedgerRows(parsed.data.date, totals);
  return NextResponse.json({ success: true, date: parsed.data.date, commissionBase: parsed.data.commissionBase, expenseSharing: "SHOP_ONLY", rows: serialize(rows, parsed.data.commissionBase, totals) });
}

export async function POST(request: NextRequest) {
  if (!hasOwnerAccess(request)) return ownerRequiredResponse();
  const parsed = paymentSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid payout payload", details: parsed.error.flatten() }, { status: 400 });
  const { date, barberId, commissionBase, cashPaid, gcashPaid, paid } = parsed.data;
  const totals = await totalsForDate(date, commissionBase);
  const rows = await syncLedgerRows(date, totals);
  const current = rows.find((row) => row.barberId === barberId);
  if (!current) return NextResponse.json({ success: false, error: "Unknown barber" }, { status: 404 });
  const updated = await prisma.dailyPayoutLedger.update({
    where: { barberId_businessDate: { barberId, businessDate: dateValue(date) } },
    data: { cashPaid, gcashPaid, paidAt: paid ? new Date() : null },
    include: { barber: { select: { fullName: true } } },
  });
  return NextResponse.json({ success: true, row: serialize([updated], commissionBase, totals)[0] });
}

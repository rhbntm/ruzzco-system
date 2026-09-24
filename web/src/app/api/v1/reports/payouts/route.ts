import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hasOwnerAccess, ownerRequiredResponse } from "@/lib/owner-access";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  commissionBase: z.enum(["LIST_PRICE", "AMOUNT_PAID"]).default("LIST_PRICE"),
});

const paymentSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  barberId: z.string().min(1),
  commissionBase: z.enum(["LIST_PRICE", "AMOUNT_PAID"]).default("LIST_PRICE"),
  cashPaid: z.number().nonnegative().multipleOf(0.01),
  gcashPaid: z.number().nonnegative().multipleOf(0.01),
  paid: z.boolean(),
});

function dayBounds(date: string) {
  return {
    start: new Date(`${date}T00:00:00+08:00`),
    end: new Date(`${date}T00:00:00+08:00`).getTime() + 24 * 60 * 60 * 1000,
  };
}

function dateValue(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

async function totalsForDate(date: string, commissionBase: "LIST_PRICE" | "AMOUNT_PAID") {
  const bounds = dayBounds(date);
  const transactions = await prisma.transaction.findMany({
    where: { transactionTime: { gte: bounds.start, lt: new Date(bounds.end) } },
    select: {
      barberId: true,
      totalAmount: true,
      listPrice: true,
      amountPaid: true,
      tipAmount: true,
      barber: { select: { commissionRate: true } },
    },
  });
  const byBarber = new Map<string, { commissionTotal: number; tipTotal: number }>();
  for (const tx of transactions) {
    const base = commissionBase === "LIST_PRICE"
      ? Number(tx.listPrice ?? tx.totalAmount)
      : Number(tx.amountPaid ?? tx.totalAmount);
    const commission = Math.round(base * Number(tx.barber.commissionRate) * 100) / 100;
    const current = byBarber.get(tx.barberId) ?? { commissionTotal: 0, tipTotal: 0 };
    current.commissionTotal = Math.round((current.commissionTotal + commission) * 100) / 100;
    current.tipTotal = Math.round((current.tipTotal + Number(tx.tipAmount ?? 0)) * 100) / 100;
    byBarber.set(tx.barberId, current);
  }
  return byBarber;
}

async function syncLedgerRows(date: string, commissionBase: "LIST_PRICE" | "AMOUNT_PAID") {
  const totals = await totalsForDate(date, commissionBase);
  const barbers = await prisma.barber.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" } });
  for (const barber of barbers) {
    const total = totals.get(barber.id) ?? { commissionTotal: 0, tipTotal: 0 };
    const existing = await prisma.dailyPayoutLedger.findUnique({
      where: { barberId_businessDate: { barberId: barber.id, businessDate: dateValue(date) } },
      select: { cashPaid: true, gcashPaid: true, paidAt: true },
    });
    const totalOwed = Math.round((total.commissionTotal + total.tipTotal) * 100) / 100;
    await prisma.dailyPayoutLedger.upsert({
      where: { barberId_businessDate: { barberId: barber.id, businessDate: dateValue(date) } },
      create: {
        barberId: barber.id,
        businessDate: dateValue(date),
        commissionTotal: total.commissionTotal,
        tipTotal: total.tipTotal,
        totalOwed,
      },
      update: {
        commissionTotal: total.commissionTotal,
        tipTotal: total.tipTotal,
        totalOwed,
        cashPaid: existing?.cashPaid ?? 0,
        gcashPaid: existing?.gcashPaid ?? 0,
        paidAt: existing?.paidAt ?? null,
      },
    });
  }
  return prisma.dailyPayoutLedger.findMany({
    where: { businessDate: dateValue(date) },
    include: { barber: { select: { fullName: true } } },
    orderBy: { barber: { fullName: "asc" } },
  });
}

function serialize(rows: Array<{
  id: bigint; barberId: string; businessDate: Date; commissionTotal: unknown; tipTotal: unknown;
  totalOwed: unknown; cashPaid: unknown; gcashPaid: unknown; paidAt: Date | null; barber: { fullName: string };
}>, commissionBase: string) {
  return rows.map((row) => {
    const totalOwed = Number(row.totalOwed);
    const paid = Number(row.cashPaid) + Number(row.gcashPaid);
    return {
      id: Number(row.id),
      barberId: row.barberId,
      barberName: row.barber.fullName,
      businessDate: row.businessDate.toISOString().slice(0, 10),
      commissionTotal: Number(row.commissionTotal).toFixed(2),
      tipTotal: Number(row.tipTotal).toFixed(2),
      totalOwed: totalOwed.toFixed(2),
      cashPaid: Number(row.cashPaid).toFixed(2),
      gcashPaid: Number(row.gcashPaid).toFixed(2),
      paidAt: row.paidAt,
      paid: Boolean(row.paidAt),
      additionalOwed: Boolean(row.paidAt && totalOwed > paid + 0.005),
      commissionBase,
    };
  });
}

export async function GET(request: NextRequest) {
  if (!hasOwnerAccess(request)) return ownerRequiredResponse();
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ success: false, error: "date and valid commissionBase are required" }, { status: 400 });
  const rows = await syncLedgerRows(parsed.data.date, parsed.data.commissionBase);
  return NextResponse.json({ success: true, date: parsed.data.date, commissionBase: parsed.data.commissionBase, expenseSharing: "SHOP_ONLY", rows: serialize(rows, parsed.data.commissionBase) });
}

export async function POST(request: NextRequest) {
  if (!hasOwnerAccess(request)) return ownerRequiredResponse();
  const parsed = paymentSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid payout payload", details: parsed.error.flatten() }, { status: 400 });
  const { date, barberId, commissionBase, cashPaid, gcashPaid, paid } = parsed.data;
  const rows = await syncLedgerRows(date, commissionBase);
  const current = rows.find((row) => row.barberId === barberId);
  if (!current) return NextResponse.json({ success: false, error: "Unknown barber" }, { status: 404 });
  const updated = await prisma.dailyPayoutLedger.update({
    where: { barberId_businessDate: { barberId, businessDate: dateValue(date) } },
    data: { cashPaid, gcashPaid, paidAt: paid ? new Date() : null },
    include: { barber: { select: { fullName: true } } },
  });
  return NextResponse.json({ success: true, row: serialize([updated], commissionBase)[0] });
}

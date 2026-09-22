import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const reconcileSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  countedCash: z
    .number()
    .nonnegative("Counted cash cannot be negative")
    .max(1_000_000, "Counted cash exceeds sanity limit (₱1,000,000)")
    .multipleOf(0.01),
  note: z.string().max(500).optional(),
});

/**
 * GET /api/v1/reports/reconciliation?date=YYYY-MM-DD
 * Returns the expected totals (from synced transactions) and the saved
 * reconciliation record for that date if one exists.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date");

  if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return NextResponse.json(
      { success: false, error: "date query param required (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  const startOfDay = new Date(`${dateParam}T00:00:00.000Z`);
  const endOfDay = new Date(`${dateParam}T23:59:59.999Z`);

  try {
    const [transactions, saved] = await Promise.all([
      prisma.transaction.findMany({
        where: { transactionTime: { gte: startOfDay, lte: endOfDay } },
        select: { totalAmount: true, paymentMethod: true },
      }),
      prisma.shiftReconciliation.findUnique({
        where: { reconciliationDate: new Date(dateParam) },
      }),
    ]);

    let expectedCash = 0;
    let gcashTotal = 0;
    for (const tx of transactions) {
      const amount = Number(tx.totalAmount);
      if (tx.paymentMethod === "CASH") expectedCash += amount;
      else gcashTotal += amount;
    }
    const totalRevenue = expectedCash + gcashTotal;

    return NextResponse.json({
      success: true,
      date: dateParam,
      expected: {
        cashTotal: expectedCash.toFixed(2),
        gcashTotal: gcashTotal.toFixed(2),
        totalRevenue: totalRevenue.toFixed(2),
        transactionCount: transactions.length,
      },
      saved: saved
        ? {
            id: Number(saved.id),
            expectedCash: Number(saved.expectedCash).toFixed(2),
            countedCash: Number(saved.countedCash).toFixed(2),
            variance: Number(saved.variance).toFixed(2),
            gcashTotal: Number(saved.gcashTotal).toFixed(2),
            totalRevenue: Number(saved.totalRevenue).toFixed(2),
            note: saved.note,
            reconciledAt: saved.reconciledAt,
          }
        : null,
    });
  } catch (error) {
    console.error("[GET /api/v1/reports/reconciliation]", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/v1/reports/reconciliation
 * Saves (or overwrites) the physical drawer count for a date, computing the
 * variance against expected cash-on-hand from synced transactions.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = reconcileSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { date, countedCash, note } = parsed.data;

    // Server-side future-date guard. The UI has max={todayStr} but that's trivially
    // bypassed. We compute "today" in PHT (UTC+8) so the boundary is correct for the
    // shop's timezone regardless of where the request originates.
    const phtNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const todayPHT = phtNow.toISOString().slice(0, 10); // YYYY-MM-DD in PHT
    if (date > todayPHT) {
      return NextResponse.json(
        { success: false, error: "Reconciliation date cannot be in the future" },
        { status: 422 }
      );
    }

    const startOfDay = new Date(`${date}T00:00:00.000Z`);
    const endOfDay = new Date(`${date}T23:59:59.999Z`);

    // Compute expected totals from synced transactions
    const transactions = await prisma.transaction.findMany({
      where: { transactionTime: { gte: startOfDay, lte: endOfDay } },
      select: { totalAmount: true, paymentMethod: true },
    });

    let expectedCash = 0;
    let gcashTotal = 0;
    for (const tx of transactions) {
      const amount = Number(tx.totalAmount);
      if (tx.paymentMethod === "CASH") expectedCash += amount;
      else gcashTotal += amount;
    }
    const totalRevenue = expectedCash + gcashTotal;
    const variance = countedCash - expectedCash;

    // Upsert — one record per date
    const record = await prisma.shiftReconciliation.upsert({
      where: { reconciliationDate: new Date(date) },
      create: {
        reconciliationDate: new Date(date),
        expectedCash,
        countedCash,
        variance,
        gcashTotal,
        totalRevenue,
        note: note ?? null,
      },
      update: {
        expectedCash,
        countedCash,
        variance,
        gcashTotal,
        totalRevenue,
        note: note ?? null,
        reconciledAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      record: {
        id: Number(record.id),
        date,
        expectedCash: Number(record.expectedCash).toFixed(2),
        countedCash: Number(record.countedCash).toFixed(2),
        variance: Number(record.variance).toFixed(2),
        gcashTotal: Number(record.gcashTotal).toFixed(2),
        totalRevenue: Number(record.totalRevenue).toFixed(2),
        note: record.note,
        reconciledAt: record.reconciledAt,
      },
    });
  } catch (error) {
    console.error("[POST /api/v1/reports/reconciliation]", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

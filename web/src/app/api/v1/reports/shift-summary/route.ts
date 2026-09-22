import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/v1/reports/shift-summary?date=YYYY-MM-DD
 * Returns the EOD cash reconciliation totals for a given date.
 * Cash-on-hand equals cashTotal (GCash is digital, not in the drawer).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date");

  if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return NextResponse.json(
      { success: false, error: "date query param is required (format: YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  const startOfDay = new Date(`${dateParam}T00:00:00.000Z`);
  const endOfDay = new Date(`${dateParam}T23:59:59.999Z`);

  try {
    const transactions = await prisma.transaction.findMany({
      where: {
        transactionTime: { gte: startOfDay, lte: endOfDay },
      },
      select: {
        totalAmount: true,
        paymentMethod: true,
      },
    });

    let cashTotal = 0;
    let gcashTotal = 0;

    for (const tx of transactions) {
      const amount = Number(tx.totalAmount);
      if (tx.paymentMethod === "CASH") {
        cashTotal += amount;
      } else if (tx.paymentMethod === "GCASH") {
        gcashTotal += amount;
      }
    }

    const totalRevenue = cashTotal + gcashTotal;

    return NextResponse.json({
      success: true,
      date: dateParam,
      totalTransactions: transactions.length,
      totalRevenue: totalRevenue.toFixed(2),
      cashTotal: cashTotal.toFixed(2),
      gcashTotal: gcashTotal.toFixed(2),
      // Cash on hand = cash collected — GCash goes straight to mobile wallet
      cashOnHand: cashTotal.toFixed(2),
    });
  } catch (error) {
    console.error("[GET /api/v1/reports/shift-summary]", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

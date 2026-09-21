import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncBatchSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();
    const parseResult = syncBatchSchema.safeParse(rawBody);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid sync payload format",
          issues: parseResult.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { transactions } = parseResult.data;

    let processedCount = 0;
    let duplicatesSkipped = 0;
    const syncedIds: string[] = [];

    // Pre-fetch all barber commission rates to avoid multiple queries
    const barbers = await prisma.barber.findMany({
      select: { id: true, commissionRate: true },
    });
    const barberRates = new Map<string, number>(
      barbers.map((b) => [b.id, Number(b.commissionRate)])
    );

    // Extract all IDs to check existing transactions in one query
    const incomingIds = transactions.map((t) => t.id);
    const existingTransactions = await prisma.transaction.findMany({
      where: { id: { in: incomingIds } },
      select: { id: true },
    });
    const existingIdSet = new Set(existingTransactions.map((t) => t.id));

    // Process each transaction with strict idempotency
    for (const item of transactions) {
      // If already recorded in MySQL, treat as safely synced (idempotent skip)
      if (existingIdSet.has(item.id)) {
        duplicatesSkipped++;
        syncedIds.push(item.id);
        continue;
      }

      // Reject unknown barber IDs — the client catalog cache always has valid IDs.
      // Silently defaulting to 0.5 commission would produce incorrect commission records.
      if (!barberRates.has(item.barberId)) {
        return NextResponse.json(
          {
            success: false,
            error: `Unknown barberId: "${item.barberId}". Refresh the POS catalog and retry.`,
            invalidTransactionId: item.id,
          },
          { status: 400 }
        );
      }

      const commissionRate = barberRates.get(item.barberId)!;
      const commissionAmount = Math.round(item.totalAmount * commissionRate * 100) / 100;


      // Insert transaction, line item, and commission log atomically
      await prisma.transaction.create({
        data: {
          id: item.id,
          barberId: item.barberId,
          totalAmount: item.totalAmount,
          barberCommissionAmount: commissionAmount,
          paymentMethod: item.paymentMethod,
          paymentReference: item.paymentReference ?? null,
          transactionTime: new Date(item.transactionTime),
          syncedAt: new Date(),
          items: {
            create: {
              serviceId: item.serviceId,
              priceAtSale: item.totalAmount,
            },
          },
          commissionLogs: {
            create: {
              barberId: item.barberId,
              amount: commissionAmount,
            },
          },
        },
      });

      existingIdSet.add(item.id);
      processedCount++;
      syncedIds.push(item.id);
    }

    return NextResponse.json({
      success: true,
      processedCount,
      duplicatesSkipped,
      syncedIds,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Batch sync error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal batch sync error",
      },
      { status: 500 }
    );
  }
}

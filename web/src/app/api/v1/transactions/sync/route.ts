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

    // Pre-build a deviceKey → cashierId map for keys present in this batch
    const deviceKeys = [
      ...new Set(
        transactions
          .map((t) => t.deviceKey)
          .filter((k): k is string => typeof k === "string")
      ),
    ];
    const deviceCashierMap = new Map<string, string>();
    if (deviceKeys.length > 0) {
      const assignments = await prisma.deviceAssignment.findMany({
        where: { deviceKey: { in: deviceKeys }, revokedAt: null },
        select: { deviceKey: true, barberId: true },
        orderBy: { assignedAt: "desc" },
      });
      // Take the most recent active binding per deviceKey
      for (const a of assignments) {
        if (!deviceCashierMap.has(a.deviceKey)) {
          deviceCashierMap.set(a.deviceKey, a.barberId);
        }
      }
    }

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

      // Resolve authoritative barberId and cashierId from the device binding.
      // When a device has an active server-side binding, the bound barberId is
      // the authoritative source — the client payload is overridden. This closes
      // the commission misattribution vector: a tampered client cannot claim a
      // different barber's commission as long as the device key is bound.
      let resolvedBarberId = item.barberId;
      let cashierId: string | null = null;

      if (item.deviceKey && deviceCashierMap.has(item.deviceKey)) {
        const boundBarberId = deviceCashierMap.get(item.deviceKey)!;
        cashierId = boundBarberId;
        if (boundBarberId !== item.barberId) {
          // Persist tamper evidence before proceeding. Awaited deliberately —
          // this is the durable record; console.warn alone is lost on restart.
          console.warn(
            `[sync] barberId mismatch for tx ${item.id}: client sent "${item.barberId}", ` +
            `binding says "${boundBarberId}". Persisting to sync_mismatch_logs.`
          );
          await prisma.syncMismatchLog.create({
            data: {
              transactionId: item.id,
              deviceKey: item.deviceKey!, // always a string here: checked by outer if
              claimedBarberId: item.barberId,
              resolvedBarberId: boundBarberId,
            },
          });
        }
        resolvedBarberId = boundBarberId;
      }

      // Re-validate resolvedBarberId in case the bound barber was removed
      if (!barberRates.has(resolvedBarberId)) {
        return NextResponse.json(
          {
            success: false,
            error: `Resolved barberId "${resolvedBarberId}" is not a known active barber. Re-bind device and retry.`,
            invalidTransactionId: item.id,
          },
          { status: 400 }
        );
      }

      const resolvedCommissionRate = barberRates.get(resolvedBarberId)!;
      const commissionAmount = Math.round(item.totalAmount * resolvedCommissionRate * 100) / 100;

      // Insert transaction, line item, and commission log atomically
      await prisma.transaction.create({
        data: {
          id: item.id,
          barberId: resolvedBarberId,
          cashierId,
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
              barberId: resolvedBarberId,
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

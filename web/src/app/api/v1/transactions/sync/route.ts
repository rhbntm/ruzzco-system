import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { syncBatchSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

type RejectReason = "DEVICE_MISMATCH" | "ASSIGNMENT_UNAVAILABLE";

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

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
    // Not inserted and not marked synced: the phone keeps them queued.
    const rejected: { id: string; reason: RejectReason }[] = [];

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

    // Load every assignment the new sales reference, active or revoked. A sale is
    // attributed to the assignment it was made under, never to the device's
    // current binding, so a later rebind cannot move it.
    const pending = transactions.filter((t) => !existingIdSet.has(t.id));
    const referencedIds = [...new Set(pending.map((t) => t.assignmentId).filter((id): id is string => !!id))];
    const assignmentSelect = { id: true, deviceKey: true, barberId: true } as const;
    const assignments = new Map(
      (await prisma.deviceAssignment.findMany({ where: { id: { in: referencedIds } }, select: assignmentSelect }))
        .map((a) => [a.id, a])
    );

    // An assignment made offline and then superseded before it reached /bind is only
    // known through its sales. Record it as historical (already revoked): sync never
    // creates or disturbs the device's active binding.
    const missing = new Map<string, { id: string; deviceKey: string; barberId: string }>();
    for (const item of pending) {
      if (item.assignmentId && item.deviceKey && !assignments.has(item.assignmentId) && !missing.has(item.assignmentId)) {
        missing.set(item.assignmentId, { id: item.assignmentId, deviceKey: item.deviceKey, barberId: item.barberId });
      }
    }
    if (missing.size > 0) {
      for (const record of missing.values()) {
        // Validated before the insert: skipDuplicates would otherwise swallow the FK error.
        if (!barberRates.has(record.barberId)) {
          return NextResponse.json(
            {
              success: false,
              error: `Unknown barberId: "${record.barberId}". Refresh the POS catalog and retry.`,
            },
            { status: 400 }
          );
        }
      }
      const revokedAt = new Date();
      // skipDuplicates: a concurrent sync or bind may have created the same id; the
      // existing row wins and everyone resolves against it after the re-read.
      await prisma.deviceAssignment.createMany({
        data: [...missing.values()].map((record) => ({ ...record, revokedAt })),
        skipDuplicates: true,
      });
      const registered = await prisma.deviceAssignment.findMany({
        where: { id: { in: [...missing.keys()] } },
        select: assignmentSelect,
      });
      for (const a of registered) assignments.set(a.id, a);
    }

    // Process each transaction with strict idempotency
    for (const item of transactions) {
      // If already recorded in MySQL, treat as safely synced (idempotent skip).
      // Its attribution is never recalculated.
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

      // Resolve attribution. Assignment-backed sales take the barber of the assignment
      // they were made under; the claimed barberId is only checked against it.
      // Legacy sales (no assignmentId) keep their sale-time barberId and have no
      // verified cashier; the device's current binding is never consulted.
      let resolvedBarberId = item.barberId;
      let cashierId: string | null = null;
      let mismatch = false;

      if (item.assignmentId) {
        const assignment = assignments.get(item.assignmentId);
        if (!assignment) {
          rejected.push({ id: item.id, reason: "ASSIGNMENT_UNAVAILABLE" });
          continue;
        }
        if (assignment.deviceKey !== item.deviceKey) {
          console.warn(`[sync] tx ${item.id} references assignment ${assignment.id} from a different device. Rejected.`);
          rejected.push({ id: item.id, reason: "DEVICE_MISMATCH" });
          continue;
        }
        resolvedBarberId = assignment.barberId;
        cashierId = assignment.barberId;
        mismatch = item.barberId !== assignment.barberId;
      }

      if (!barberRates.has(resolvedBarberId)) {
        return NextResponse.json(
          {
            success: false,
            error: `Resolved barberId "${resolvedBarberId}" is not a known barber.`,
            invalidTransactionId: item.id,
          },
          { status: 400 }
        );
      }

      const resolvedCommissionRate = barberRates.get(resolvedBarberId)!;
      const amountPaid = item.amountPaid ?? item.totalAmount;
      // Custom amount: list price is the entered amount (also fixes older queued payloads that carried the service price).
      const listPrice = item.customAmount ? amountPaid : (item.listPrice ?? item.totalAmount);
      const tipAmount = item.tipAmount ?? 0;
      const commissionBase = "LIST_PRICE" as const;
      const commissionAmount = Math.round(listPrice * resolvedCommissionRate * 100) / 100;

      if (mismatch) {
        console.warn(
          `[sync] barberId mismatch for tx ${item.id}: client sent "${item.barberId}", ` +
          `assignment says "${resolvedBarberId}". Persisting to sync_mismatch_logs.`
        );
      }

      // Mismatch log, transaction, line item and commission log commit together, so a
      // failed insert never leaves an orphan log.
      try {
        await prisma.$transaction([
          ...(mismatch
            ? [
                prisma.syncMismatchLog.create({
                  data: {
                    transactionId: item.id,
                    deviceKey: item.deviceKey!, // required by the schema when assignmentId is present
                    claimedBarberId: item.barberId,
                    resolvedBarberId,
                  },
                }),
              ]
            : []),
          prisma.transaction.create({
            data: {
              id: item.id,
              barberId: resolvedBarberId,
              cashierId,
              assignmentId: item.assignmentId ?? null,
              totalAmount: item.totalAmount,
              listPrice,
              discountType: item.discountType,
              discountAmount: item.discountAmount,
              amountPaid,
              tipAmount,
              customAmount: item.customAmount,
              customAmountNote: item.customAmountNote ?? null,
              barberCommissionAmount: commissionAmount,
              commissionBase,
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
          }),
        ]);
      } catch (error) {
        // An overlapping sync inserted this id first: the client UUID is the
        // idempotency key, so it is already safely recorded.
        if (!isUniqueViolation(error)) throw error;
        existingIdSet.add(item.id);
        duplicatesSkipped++;
        syncedIds.push(item.id);
        continue;
      }

      existingIdSet.add(item.id);
      processedCount++;
      syncedIds.push(item.id);
    }

    return NextResponse.json({
      success: true,
      processedCount,
      duplicatesSkipped,
      syncedIds,
      rejected,
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

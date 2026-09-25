import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { commissionFor } from "@/lib/commission";
import {
  syncBatchSchema,
  syncTransactionItemSchema,
  type SyncRejectReason,
  type SyncTransactionItem,
} from "@/lib/schemas";

export const dynamic = "force-dynamic";

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

// Errors caused by the sale's own data (unknown service, value too long, value out of
// range). They fail the same way on every retry, so they reject that sale only.
// Anything else (connection loss, deadlock) is transient and still fails the request.
function isSaleDataError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2003" || error.code === "P2000" || error.code === "P2020")
  );
}

// One entry per item in the request, in order. `item` is null when the item is
// malformed; `id` is then whatever string id it carried, if any.
type Entry = { id: string | null; item: SyncTransactionItem | null };

function toEntry(raw: unknown): Entry {
  const parsed = syncTransactionItemSchema.safeParse(raw);
  if (parsed.success) return { id: parsed.data.id, item: parsed.data };
  const rawId = typeof raw === "object" && raw !== null ? (raw as { id?: unknown }).id : undefined;
  return { id: typeof rawId === "string" ? rawId : null, item: null };
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

    const entries = parseResult.data.transactions.map(toEntry);

    let processedCount = 0;
    let duplicatesSkipped = 0;
    const syncedIds: string[] = [];
    // Never inserted, never in syncedIds. The phone keeps each one, marks it as rejected
    // with this reason, and stops retrying it automatically. `id` is null only for a
    // malformed item that carried no string id.
    const rejected: { id: string | null; reason: SyncRejectReason }[] = [];
    const reject = (id: string | null, reason: SyncRejectReason) => {
      console.warn(`[sync] rejected ${id ?? "(item without id)"}: ${reason}`);
      rejected.push({ id, reason });
    };

    // Pre-fetch all barber commission rates to avoid multiple queries. Inactive barbers
    // included: a sale made before deactivation is still recorded and payable.
    const barbers = await prisma.barber.findMany({
      select: { id: true, commissionRate: true },
    });
    const barberRates = new Map<string, Prisma.Decimal>(
      barbers.map((b) => [b.id, b.commissionRate])
    );

    // Extract all IDs to check existing transactions in one query
    const incomingIds = entries.map((e) => e.id).filter((id): id is string => id !== null);
    const existingTransactions = await prisma.transaction.findMany({
      where: { id: { in: incomingIds } },
      select: { id: true },
    });
    const existingIdSet = new Set(existingTransactions.map((t) => t.id));

    // Load every assignment the new sales reference, active or revoked. A sale is
    // attributed to the assignment it was made under, never to the device's
    // current binding, so a later rebind cannot move it.
    const pending = entries
      .filter((e) => e.item && !existingIdSet.has(e.item.id))
      .map((e) => e.item as SyncTransactionItem);
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
      // Only from a sale whose barber exists: skipDuplicates would swallow the FK error,
      // and a sale with an unknown barber is rejected below anyway.
      if (
        item.assignmentId && item.deviceKey && barberRates.has(item.barberId) &&
        !assignments.has(item.assignmentId) && !missing.has(item.assignmentId)
      ) {
        missing.set(item.assignmentId, { id: item.assignmentId, deviceKey: item.deviceKey, barberId: item.barberId });
      }
    }
    if (missing.size > 0) {
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

    // Process each transaction independently with strict idempotency: a sale that cannot
    // be recorded is rejected on its own and never affects the others in the batch.
    for (const { id: entryId, item } of entries) {
      // If already recorded in MySQL, treat as safely synced (idempotent skip), even if
      // this copy of the payload is malformed. Its attribution is never recalculated.
      if (entryId !== null && existingIdSet.has(entryId)) {
        duplicatesSkipped++;
        syncedIds.push(entryId);
        continue;
      }

      if (!item) {
        reject(entryId, "INVALID");
        continue;
      }

      // Reject unknown barber IDs — the client catalog cache always has valid IDs.
      // Silently defaulting to 0.5 commission would produce incorrect commission records.
      if (!barberRates.has(item.barberId)) {
        reject(item.id, "UNKNOWN_BARBER");
        continue;
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
          reject(item.id, "ASSIGNMENT_UNAVAILABLE");
          continue;
        }
        if (assignment.deviceKey !== item.deviceKey) {
          reject(item.id, "DEVICE_MISMATCH");
          continue;
        }
        resolvedBarberId = assignment.barberId;
        cashierId = assignment.barberId;
        mismatch = item.barberId !== assignment.barberId;
      }

      if (!barberRates.has(resolvedBarberId)) {
        reject(item.id, "UNKNOWN_BARBER");
        continue;
      }

      // The rate is the barber's rate now, when the server first records the sale. It is
      // stored with the sale and never recalculated (duplicates are skipped above).
      const commissionRate = barberRates.get(resolvedBarberId)!;
      const amountPaid = item.amountPaid ?? item.totalAmount;
      // Custom amount: list price is the entered amount (also fixes older queued payloads that carried the service price).
      const listPrice = item.customAmount ? amountPaid : (item.listPrice ?? item.totalAmount);
      const tipAmount = item.tipAmount ?? 0;
      const commissionBase = "LIST_PRICE" as const;
      const commissionAmount = commissionFor(listPrice, commissionRate);

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
              commissionRate,
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
        if (isSaleDataError(error)) {
          // Rolled back with its mismatch log: a rejected sale leaves no rows behind.
          reject(item.id, "INVALID");
          continue;
        }
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

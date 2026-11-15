import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { commissionFor } from "@/lib/commission";
import { readJson, serverError } from "@/lib/api";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { checkSalePrice, decimalCentavos } from "@/lib/price-check";
import { isSaleDataError, recordSale } from "@/lib/record-sale";
import { gatewayStatus } from "@/lib/gateway";
import { detectTimeAnomaly } from "@/lib/time-anomaly";
import { authenticateDevice, deviceNotApprovedResponse } from "@/lib/device-auth";
import {
  syncBatchSchema,
  syncTransactionItemSchema,
  type SyncRejectReason,
  type SyncTransactionItem,
} from "@/lib/schemas";

export const dynamic = "force-dynamic";

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
    // Only an approved phone may send sales (slice 15). Refused as a whole, before anything is
    // read or written: the phone keeps every sale queued and sends them once approved.
    const deviceKey = await authenticateDevice(request);
    if (!deviceKey) return deviceNotApprovedResponse();

    // A body that is not JSON is a bad outer shape too: 400, like a failed schema check.
    const body = await readJson(request, "Invalid sync payload format");
    if (!body.ok) return body.response;
    const parseResult = syncBatchSchema.safeParse(body.data);

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
    // Server time is the reference for suspicious phone timestamps (L5). One reading per
    // request, so every sale in it is judged against the same clock.
    const serverNow = new Date();
    const sentAt = parseResult.data.sentAt ? new Date(parseResult.data.sentAt) : undefined;
    // Read once per request. A QRPH sale is only stored when the gateway can charge it;
    // otherwise it would sit PENDING forever with no way to pay.
    const qrphAvailable = gatewayStatus().state === "on";

    let processedCount = 0;
    let duplicatesSkipped = 0;
    const syncedIds: string[] = [];
    // Never inserted, never in syncedIds. The phone keeps each one, marks it as rejected
    // with this reason, and stops retrying it automatically. `id` is null only for a
    // malformed item that carried no string id.
    const rejected: { id: string | null; reason: SyncRejectReason }[] = [];
    // `why` (the price check's detail) goes to the server log only, never to the phone.
    const reject = (id: string | null, reason: SyncRejectReason, why?: string) => {
      console.warn(`[sync] rejected ${id ?? "(item without id)"}: ${reason}${why ? ` (${why})` : ""}`);
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

    // The price list (slice 16): each new sale's service, read once, inactive services included
    // (a sale made just before a service was switched off is still valid). In centavos.
    const serviceIds = [...new Set(pending.map((t) => t.serviceId))];
    const servicePrices = new Map(
      (await prisma.service.findMany({ where: { id: { in: serviceIds } }, select: { id: true, standardPrice: true } }))
        .map((service) => [service.id, decimalCentavos(service.standardPrice)])
    );

    // The signed-in account on each sale (slice 19, Decision 12) is stored only when it names an
    // existing user, and otherwise dropped. It never decides attribution, cashierId, commission
    // or payouts, and a userId whose barber differs from the assignment's is still stored as sent.
    const claimedUserIds = [...new Set(pending.map((t) => t.userId).filter((id): id is string => !!id))];
    const knownUserIds = new Set(
      claimedUserIds.length === 0
        ? []
        : (await prisma.user.findMany({ where: { id: { in: claimedUserIds } }, select: { id: true } })).map((u) => u.id)
    );

    // An assignment made offline and then superseded before it reached /bind is only
    // known through its sales. Record it as historical (already revoked): sync never
    // creates or disturbs the device's active binding. Only for this phone's own sales.
    const missing = new Map<string, { id: string; deviceKey: string; barberId: string }>();
    for (const item of pending) {
      // Only from a sale whose barber exists: skipDuplicates would swallow the FK error,
      // and a sale with an unknown barber is rejected below anyway.
      if (
        item.assignmentId && item.deviceKey === deviceKey && barberRates.has(item.barberId) &&
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

      // A sale is this phone's only if it carries the authenticated device key. A legacy sale
      // with no device key at all (older than device keys) came in this phone's request, so it
      // counts as this phone's; it keeps its stamped barberId below.
      if ((item.deviceKey ?? deviceKey) !== deviceKey) {
        reject(item.id, "DEVICE_MISMATCH");
        continue;
      }

      // Gateway off or misconfigured: refuse the QRPH sale. The phone keeps it as "needs
      // attention"; Retry once QR Ph is back on records it and opens the QR payment.
      if (item.paymentMethod === "QRPH" && !qrphAvailable) {
        reject(item.id, "GATEWAY_DISABLED");
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

      // Price check (slice 16), after the device, gateway, barber and assignment checks, so a
      // sale that fails several keeps the reason it had before. An unknown service is INVALID
      // here (it used to fail at the insert, also after those checks). The amounts it returns
      // are the ones stored: what is checked is what is stored.
      const price = checkSalePrice(item, servicePrices.get(item.serviceId) ?? null);
      if (!price.ok) {
        reject(item.id, price.reason, price.why);
        continue;
      }
      const { listPrice, amountPaid } = price.amounts;

      // The rate is the barber's rate now, when the server first records the sale. It is
      // stored with the sale and never recalculated (duplicates are skipped above).
      const commissionRate = barberRates.get(resolvedBarberId)!;
      const tipAmount = item.tipAmount ?? 0;
      const commissionBase = "LIST_PRICE" as const;
      const commissionAmount = commissionFor(listPrice, commissionRate);
      // Recorded, never rejected: the sale keeps its own timestamp and waits for the owner
      // to confirm its business day. Duplicates were skipped above, so a flag is set once.
      const anomaly = detectTimeAnomaly({ transactionTime: new Date(item.transactionTime), sentAt, serverNow });

      if (mismatch) {
        console.warn(
          `[sync] barberId mismatch for tx ${item.id}: client sent "${item.barberId}", ` +
          `assignment says "${resolvedBarberId}". Persisting to sync_mismatch_logs.`
        );
      }

      // Mismatch log, transaction, line item and commission log commit together, so a
      // failed insert never leaves an orphan log (src/lib/record-sale.ts).
      try {
        await recordSale({
          id: item.id,
          barberId: resolvedBarberId,
          cashierId,
          assignmentId: item.assignmentId ?? null,
          userId: item.userId && knownUserIds.has(item.userId) ? item.userId : null,
          serviceId: item.serviceId,
          totalAmount: price.amounts.totalAmount,
          listPrice,
          discountType: item.discountType,
          discountAmount: item.discountAmount,
          amountPaid,
          tipAmount,
          customAmount: item.customAmount,
          customAmountNote: item.customAmountNote ?? null,
          commissionAmount,
          commissionRate,
          commissionBase,
          paymentMethod: item.paymentMethod,
          paymentReference: item.paymentReference ?? null,
          transactionTime: new Date(item.transactionTime),
          timeFlag: anomaly?.flag ?? null,
          clockSkewSeconds: anomaly?.skewSeconds ?? null,
          // deviceKey is required by the schema when assignmentId is present
          mismatch: mismatch ? { deviceKey: item.deviceKey!, claimedBarberId: item.barberId } : null,
        });
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
    return serverError("Batch sync error:", error, "Internal batch sync error");
  }
}

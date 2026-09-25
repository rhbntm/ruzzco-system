import { db, generateUUID, getOrCreateDeviceKey, type LocalDeviceBinding, type LocalTransaction } from "@/lib/db";

/**
 * Shared POS sync lifecycle, used by /pos and /shift-log.
 *
 * Attribution model: every sale carries the assignmentId (and device key) of the
 * binding that was active when it was made. The server attributes the sale to that
 * assignment's barber, so the order of binds and syncs cannot move a sale.
 *
 * Order, always:
 *   A. registerPendingAssignment() — make the device's current assignment active via /bind.
 *   B. sync queued sales — except those under a current assignment /bind has not accepted yet.
 *      Sales under older assignments go now; the server records those assignments as revoked.
 *   C. verifyCurrentAssignment() — on load/reconnect, drop a local binding the server no longer honours.
 *
 * Only one pending bind is kept: the current assignment. Older assignments need no queue,
 * because each queued sale carries everything needed to register its own assignment.
 *
 * Per-sale results: the server answers each sale on its own. Sales in `syncedIds` are marked
 * synced; sales in `rejected` stay in Dexie unchanged, get `syncError`, and are excluded from
 * automatic sync until the user retries them (clearRejection). A rejected sale never blocks
 * the others, and nothing about it (barber, assignment, amount, id) is ever rewritten.
 */

const PENDING_KEY = "ruzzco_pending_bind";

export type PendingBind = { deviceKey: string; barberId: string; assignmentId?: string };

export function readPendingBind(): PendingBind | null {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(PENDING_KEY) : null;
    return raw ? (JSON.parse(raw) as PendingBind) : null;
  } catch {
    return null;
  }
}

export function writePendingBind(pending: PendingBind) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Storage unavailable: sales still carry their assignment and self-register on sync.
  }
}

function clearPendingBindIfSame(pending: PendingBind) {
  const current = readPendingBind();
  if (current && current.assignmentId === pending.assignmentId && current.barberId === pending.barberId) {
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch {
      // ignore
    }
  }
}

/** Removes the local binding only if it is still the given assignment. */
async function clearLocalBindingIfSame(deviceKey: string, assignmentId: string | undefined) {
  const local = await db.deviceBindings.get(deviceKey);
  if (local && local.assignmentId === assignmentId) {
    await db.deviceBindings.delete(deviceKey);
    return true;
  }
  return false;
}

/**
 * Starts a new assignment for this device: generated on the phone, stored with the
 * binding, and queued as the pending bind. Works offline.
 */
export async function createLocalAssignment(barber: { id: string; fullName: string }): Promise<LocalDeviceBinding> {
  const binding: LocalDeviceBinding = {
    deviceKey: getOrCreateDeviceKey(),
    barberId: barber.id,
    barberName: barber.fullName,
    assignedAt: new Date().toISOString(),
    assignmentId: generateUUID(),
  };
  await db.deviceBindings.put(binding);
  writePendingBind({ deviceKey: binding.deviceKey, barberId: binding.barberId, assignmentId: binding.assignmentId });
  return binding;
}

/**
 * Bindings saved before assignment ids existed get one, registered like a fresh bind,
 * so every new sale is assignment-backed. Same barber, so attribution is unchanged.
 */
export async function ensureAssignmentId(binding: LocalDeviceBinding): Promise<LocalDeviceBinding> {
  if (binding.assignmentId) return binding;
  const upgraded: LocalDeviceBinding = { ...binding, assignmentId: generateUUID() };
  await db.deviceBindings.put(upgraded);
  writePendingBind({ deviceKey: upgraded.deviceKey, barberId: upgraded.barberId, assignmentId: upgraded.assignmentId });
  return upgraded;
}

export type RegisterResult = {
  status: "none" | "registered" | "rejected" | "retry";
  /** The local binding was dropped; the POS must ask for a barber again. */
  bindingCleared: boolean;
};

/** Step A: make the pending (current) assignment active on the server. */
export async function registerPendingAssignment(): Promise<RegisterResult> {
  const pending = readPendingBind();
  if (!pending) return { status: "none", bindingCleared: false };
  try {
    const res = await fetch("/api/v1/devices/bind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pending),
    });
    if (res.ok) {
      clearPendingBindIfSame(pending);
      return { status: "registered", bindingCleared: false };
    }
    if (res.status >= 400 && res.status < 500) {
      // 409 ASSIGNMENT_REVOKED / ASSIGNMENT_CONFLICT / BARBER_INACTIVE, 404 unknown barber,
      // 400 malformed: this assignment can never become active. Sales already made under
      // it still sync to its barber; new sales need a new binding.
      clearPendingBindIfSame(pending);
      const bindingCleared = await clearLocalBindingIfSame(pending.deviceKey, pending.assignmentId);
      return { status: "rejected", bindingCleared };
    }
    return { status: "retry", bindingCleared: false };
  } catch {
    return { status: "retry", bindingCleared: false };
  }
}

const REJECT_LABELS: Record<string, string> = {
  INVALID: "Invalid sale data",
  UNKNOWN_BARBER: "Unknown barber",
  DEVICE_MISMATCH: "Device/assignment mismatch",
  ASSIGNMENT_UNAVAILABLE: "Barber assignment not found",
};

/** Understandable text for a stored rejection reason (unknown reasons are shown as-is). */
export function rejectLabel(reason: string | undefined): string {
  return (reason && REJECT_LABELS[reason]) || reason || "Rejected";
}

/** A mismatch can't be fixed by retrying: the assignment doesn't belong to this device. */
export function needsReview(reason: string | undefined): boolean {
  return reason === "DEVICE_MISMATCH";
}

/** Unsynced sale the server refused: kept, not auto-retried, shown to the user. */
export function isRejected(tx: Pick<LocalTransaction, "synced" | "syncError">): boolean {
  return tx.synced === 0 && !!tx.syncError;
}

/** Sales in the automatic sync queue (unsynced, not rejected). */
export function countPending(): Promise<number> {
  return db.transactions.where("synced").equals(0).filter((t) => !t.syncError).count();
}

/** Sales that need the user's attention, newest first. */
export async function listRejected(): Promise<LocalTransaction[]> {
  const rejected = await db.transactions.where("synced").equals(0).filter((t) => !!t.syncError).toArray();
  return rejected.sort((a, b) => b.transactionTime.localeCompare(a.transactionTime));
}

/**
 * Explicit retry, step 1: put a rejected sale back in the automatic queue. Only the
 * rejection flag is cleared; the sale itself is untouched. The caller then runs syncNow(),
 * and the server may reject it again (it stays visible if so).
 */
export async function clearRejection(id: string): Promise<boolean> {
  const changed = await db.transactions.where("id").equals(id).modify((t) => {
    if (t.synced === 0) delete t.syncError;
  });
  return changed > 0;
}

/** One line for the sync toast; mentions sales that need attention. */
export function summarizeSync(outcome: SyncOutcome): string {
  const parts: string[] = [];
  if (outcome.status === "synced") {
    parts.push(`Synced ${outcome.processed} new, ${outcome.duplicates} verified`);
  } else if (outcome.attention === 0 && outcome.held === 0) {
    parts.push("All transactions are synced");
  }
  if (outcome.held > 0) parts.push(`${outcome.held} queued until barber assignment reaches the server`);
  if (outcome.attention > 0) parts.push(`${outcome.attention} need attention`);
  return parts.join(" · ");
}

export type SyncOutcome = {
  status: "offline" | "empty" | "synced" | "failed";
  processed: number;
  duplicates: number;
  /** Queued under the current assignment, waiting for /bind to accept it. */
  held: number;
  /** Refused by the server in this run; now marked rejected locally. */
  rejected: number;
  /** All rejected sales on this device after this run (including earlier ones). */
  attention: number;
  bind: RegisterResult;
};

/** Steps A then B. */
export async function syncNow(): Promise<SyncOutcome> {
  const outcome: SyncOutcome = {
    status: "offline",
    processed: 0,
    duplicates: 0,
    held: 0,
    rejected: 0,
    attention: 0,
    bind: { status: "none", bindingCleared: false },
  };
  if (typeof window === "undefined" || !navigator.onLine) return outcome;

  outcome.bind = await registerPendingAssignment();

  // Re-read: step A may have cleared it. Whatever is still pending is the current
  // assignment, and its sales must not reach the server before its /bind does.
  const heldAssignmentId = readPendingBind()?.assignmentId;
  const unsynced = await db.transactions.where("synced").equals(0).toArray();
  // Rejected sales are not retried automatically; only an explicit retry re-queues them.
  const queued = unsynced.filter((t) => !t.syncError);
  const toSend = queued.filter((t) => !(heldAssignmentId && t.assignmentId === heldAssignmentId));
  outcome.held = queued.length - toSend.length;
  outcome.attention = unsynced.length - queued.length;
  if (toSend.length === 0) {
    outcome.status = "empty";
    return outcome;
  }

  const currentDeviceKey = getOrCreateDeviceKey();
  const payload = {
    transactions: toSend.map((t) => ({
      id: t.id,
      barberId: t.barberId,
      serviceId: t.serviceId,
      totalAmount: t.totalAmount,
      listPrice: t.listPrice ?? t.price,
      discountType: t.discountType ?? "NONE",
      discountAmount: t.discountAmount ?? 0,
      amountPaid: t.amountPaid ?? t.totalAmount,
      tipAmount: t.tipAmount ?? 0,
      customAmount: t.customAmount ?? false,
      customAmountNote: t.customAmountNote ?? null,
      paymentMethod: t.paymentMethod,
      paymentReference: t.paymentReference ?? null,
      transactionTime: t.transactionTime,
      // Sale-time device key; legacy sales without one fall back to the current key.
      deviceKey: t.deviceKey ?? currentDeviceKey,
      assignmentId: t.assignmentId,
    })),
  };

  try {
    const response = await fetch("/api/v1/transactions/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Sync failed: HTTP ${response.status}`);
    const result = await response.json();
    if (result.success && Array.isArray(result.syncedIds)) {
      const rejections: { id: string; reason: string }[] = (Array.isArray(result.rejected) ? result.rejected : [])
        .filter((r: { id?: unknown; reason?: unknown }) => typeof r?.id === "string" && typeof r?.reason === "string");
      await db.transaction("rw", db.transactions, async () => {
        const syncedAt = new Date().toISOString();
        for (const id of result.syncedIds) {
          await db.transactions.where("id").equals(id).modify((t) => {
            t.synced = 1;
            t.syncedAt = syncedAt;
            delete t.syncError;
          });
        }
        // Keep the sale exactly as it is; only record why the server refused it.
        for (const { id, reason } of rejections) {
          await db.transactions.where("id").equals(id).modify((t) => {
            if (t.synced === 0) t.syncError = reason;
          });
        }
      });
      outcome.status = "synced";
      outcome.processed = result.processedCount ?? 0;
      outcome.duplicates = result.duplicatesSkipped ?? 0;
      outcome.rejected = rejections.length;
      outcome.attention += rejections.length;
    } else {
      outcome.status = "failed";
    }
  } catch (err) {
    console.error("Sync error:", err);
    outcome.status = "failed";
  }
  return outcome;
}

/**
 * Step C: confirm the server still honours the local binding. Returns true if the
 * local binding was dropped and the POS must ask for a barber again.
 */
export async function verifyCurrentAssignment(): Promise<boolean> {
  if (typeof window === "undefined" || !navigator.onLine) return false;
  const deviceKey = getOrCreateDeviceKey();
  const local = await db.deviceBindings.get(deviceKey);
  if (!local) return false;
  // Still waiting for /bind: the server cannot know it yet.
  if (readPendingBind()?.assignmentId && readPendingBind()?.assignmentId === local.assignmentId) return false;
  try {
    const res = await fetch(`/api/v1/devices/binding?deviceKey=${encodeURIComponent(deviceKey)}`);
    if (!res.ok) return false;
    const data = await res.json();
    const stale = !data.bound || (local.assignmentId !== undefined && data.assignment?.id !== local.assignmentId);
    if (!stale) return false;
    return clearLocalBindingIfSame(deviceKey, local.assignmentId);
  } catch {
    return false;
  }
}

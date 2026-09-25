import { db, generateUUID, getOrCreateDeviceKey, type LocalDeviceBinding } from "@/lib/db";

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

export type SyncOutcome = {
  status: "offline" | "empty" | "synced" | "failed";
  processed: number;
  duplicates: number;
  /** Queued under the current assignment, waiting for /bind to accept it. */
  held: number;
  /** Refused by the server (e.g. device mismatch); still queued locally. */
  rejected: number;
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
    bind: { status: "none", bindingCleared: false },
  };
  if (typeof window === "undefined" || !navigator.onLine) return outcome;

  outcome.bind = await registerPendingAssignment();

  // Re-read: step A may have cleared it. Whatever is still pending is the current
  // assignment, and its sales must not reach the server before its /bind does.
  const heldAssignmentId = readPendingBind()?.assignmentId;
  const queued = await db.transactions.where("synced").equals(0).toArray();
  const toSend = queued.filter((t) => !(heldAssignmentId && t.assignmentId === heldAssignmentId));
  outcome.held = queued.length - toSend.length;
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
      await db.transaction("rw", db.transactions, async () => {
        for (const id of result.syncedIds) {
          await db.transactions.update(id, { synced: 1, syncedAt: new Date().toISOString() });
        }
      });
      outcome.status = "synced";
      outcome.processed = result.processedCount ?? 0;
      outcome.duplicates = result.duplicatesSkipped ?? 0;
      outcome.rejected = Array.isArray(result.rejected) ? result.rejected.length : 0;
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

import { db, generateUUID, getOrCreateDeviceKey, type LocalDeviceBinding, type LocalTransaction } from "@/lib/db";
import { REQUEST_TIMEOUT_MS, fetchWithTimeout } from "@/lib/fetch-timeout";

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
 *
 * One run at a time: syncNow() calls never overlap. A call made while a run is in progress
 * waits for it and then runs once more (calls that pile up share that one extra run), so a
 * sale saved or retried mid-run is still picked up. Queued sales go SYNC_CHUNK_SIZE per request.
 *
 * Approved phones only (slice 15): bind and sync carry the phone's key and secret in headers.
 * Without a secret, nothing is sent; a 401 DEVICE_NOT_APPROVED leaves every sale queued as it
 * is (no syncError) and the outcome reports them as waiting for approval.
 */

/** Sales per sync request. The server accepts up to SYNC_BATCH_MAX (src/lib/schemas.ts). */
export const SYNC_CHUNK_SIZE = 50;

const PENDING_KEY = "ruzzco_pending_bind";

// ── Phone approval (slice 15) ────────────────────────────────────────────────
// Bind and sync need this phone's secret, which it gets once, when Bayani or Mart types the
// approval PIN on it. Until then sales stay queued here, untouched. A 401 DEVICE_NOT_APPROVED
// (revoked, or the server lost the approval) sets the waiting flag; the secret is kept, so a
// server-side slip never wipes every phone's secret at once. The next accepted bind or sync,
// or a new approval, clears the flag.

const SECRET_KEY = "ruzzco_device_secret";
const NOT_APPROVED_KEY = "ruzzco_device_not_approved";
const APPROVAL_EVENT = "ruzzco-approval-change";

function storageGet(key: string): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the phone stays waiting; its sales stay queued.
  }
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new Event(APPROVAL_EVENT));
  }
}

function getDeviceSecret(): string | null {
  return storageGet(SECRET_KEY);
}

/** True while the phone can't send sales: never approved, or the server refused it last time. */
export function isWaitingForApproval(): boolean {
  return !getDeviceSecret() || storageGet(NOT_APPROVED_KEY) === "1";
}

/** For useSyncExternalStore: fires when the approval state changes (here or in another tab). */
export function subscribeApproval(callback: () => void) {
  window.addEventListener(APPROVAL_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(APPROVAL_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function markNotApproved() {
  if (storageGet(NOT_APPROVED_KEY) !== "1") storageSet(NOT_APPROVED_KEY, "1");
}

function markAccepted() {
  if (storageGet(NOT_APPROVED_KEY) !== null) storageSet(NOT_APPROVED_KEY, null);
}

/** Headers for bind and sync: this phone's key and secret. Never part of a sale. */
function deviceHeaders(secret: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Ruzzco-Device": getOrCreateDeviceKey(),
    Authorization: `Bearer ${secret}`,
  };
}

async function isNotApproved(res: Response) {
  if (res.status !== 401) return false;
  const body = await res.clone().json().catch(() => null);
  return body?.code === "DEVICE_NOT_APPROVED";
}

export type ApproveResult = { ok: true } | { ok: false; error: string };

/** Approves this phone with the approval PIN or the owner PIN, typed on the phone itself. */
export async function approveThisDevice(pin: string, label?: string): Promise<ApproveResult> {
  try {
    const res = await fetchWithTimeout("/api/v1/devices/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceKey: getOrCreateDeviceKey(), pin, ...(label?.trim() ? { label: label.trim() } : {}) }),
    }, REQUEST_TIMEOUT_MS.bind);
    const data = await res.json().catch(() => null);
    if (res.ok && typeof data?.secret === "string") {
      storageSet(SECRET_KEY, data.secret);
      markAccepted();
      return { ok: true };
    }
    if (res.status === 401) return { ok: false, error: "Wrong PIN." };
    return { ok: false, error: data?.error ?? `Approval failed (HTTP ${res.status}).` };
  } catch {
    return { ok: false, error: "Can't reach the shop PC. Try again when it's on." };
  }
}

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
  /** waiting: this phone isn't approved yet; the pending bind is kept for after approval. */
  status: "none" | "registered" | "rejected" | "retry" | "waiting";
  /** The local binding was dropped; the POS must ask for a barber again. */
  bindingCleared: boolean;
};

/** Step A: make the pending (current) assignment active on the server. */
export async function registerPendingAssignment(): Promise<RegisterResult> {
  const pending = readPendingBind();
  if (!pending) return { status: "none", bindingCleared: false };
  const secret = getDeviceSecret();
  if (!secret) return { status: "waiting", bindingCleared: false };
  try {
    const res = await fetchWithTimeout("/api/v1/devices/bind", {
      method: "POST",
      headers: deviceHeaders(secret),
      body: JSON.stringify(pending),
    }, REQUEST_TIMEOUT_MS.bind);
    if (res.ok) {
      markAccepted();
      clearPendingBindIfSame(pending);
      return { status: "registered", bindingCleared: false };
    }
    // Not approved (or revoked): the binding is fine, the phone isn't. Keep everything.
    if (await isNotApproved(res)) {
      markNotApproved();
      return { status: "waiting", bindingCleared: false };
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
  GATEWAY_DISABLED: "QR Ph is switched off on the server",
};

/** Understandable text for a stored rejection reason (unknown reasons are shown as-is). */
export function rejectLabel(reason: string | undefined): string {
  return (reason && REJECT_LABELS[reason]) || reason || "Rejected";
}

/** A mismatch can't be fixed by retrying: the assignment doesn't belong to this device. */
export function needsReview(reason: string | undefined): boolean {
  return reason === "DEVICE_MISMATCH";
}

/** Extra guidance under a rejection, or null. */
export function rejectHint(reason: string | undefined): string | null {
  if (reason === "DEVICE_MISMATCH") return "Needs review. Retrying will not fix this by itself.";
  if (reason === "GATEWAY_DISABLED") return "Retry when QR Ph is back on; the QR payment opens after it syncs.";
  return null;
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

export type RetryResult = {
  outcome: SyncOutcome;
  /** Set when the retried sale is a QRPH sale that is now on the server: take its QR payment. */
  qrCharge?: { id: string; amount: number };
};

/**
 * Explicit Retry of a rejected sale: re-queue it unchanged (clearRejection), run the normal
 * sync, and report whether a QRPH sale now needs its QR payment. The server creates at most
 * one charge per sale, so opening the payment again is always safe.
 */
export async function retryRejected(id: string): Promise<RetryResult> {
  await clearRejection(id);
  const outcome = await syncNow();
  const sale = await db.transactions.get(id);
  if (sale?.paymentMethod === "QRPH" && sale.synced === 1) {
    return { outcome, qrCharge: { id: sale.id, amount: Number(sale.totalAmount) } };
  }
  return { outcome };
}

/** One line for the sync toast; mentions sales that need attention. */
export function summarizeSync(outcome: SyncOutcome): string {
  const parts: string[] = [];
  if (outcome.status === "synced") {
    parts.push(`Synced ${outcome.processed} new, ${outcome.duplicates} verified`);
  } else if (outcome.status !== "waiting" && outcome.attention === 0 && outcome.held === 0) {
    parts.push("All transactions are synced");
  }
  if (outcome.waiting > 0) parts.push(`${outcome.waiting} waiting for approval`);
  if (outcome.held > 0) parts.push(`${outcome.held} queued until barber assignment reaches the server`);
  if (outcome.attention > 0) parts.push(`${outcome.attention} need attention`);
  if (parts.length === 0 && outcome.status === "waiting") parts.push("This phone isn't approved yet");
  return parts.join(" · ");
}

export type SyncOutcome = {
  /** waiting: this phone isn't approved (yet, or any more); nothing was sent. */
  status: "offline" | "empty" | "synced" | "failed" | "waiting";
  processed: number;
  duplicates: number;
  /** Queued under the current assignment, waiting for /bind to accept it. */
  held: number;
  /** Queued and not sent because this phone isn't approved; they stay in the queue untouched. */
  waiting: number;
  /** Refused by the server in this run; now marked rejected locally. */
  rejected: number;
  /** All rejected sales on this device after this run (including earlier ones). */
  attention: number;
  bind: RegisterResult;
};

let running: Promise<SyncOutcome> | null = null;
let rerun: Promise<SyncOutcome> | null = null;

/** Steps A then B, one run at a time (see the header). */
export function syncNow(): Promise<SyncOutcome> {
  if (!running) {
    running = runSync().finally(() => {
      running = null;
    });
    return running;
  }
  if (!rerun) {
    rerun = running
      .catch(() => undefined)
      .then(() => {
        rerun = null;
        return syncNow();
      });
  }
  return rerun;
}

async function runSync(): Promise<SyncOutcome> {
  const outcome: SyncOutcome = {
    status: "offline",
    processed: 0,
    duplicates: 0,
    held: 0,
    waiting: 0,
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

  // Not approved: nothing is sent. Sales stay queued exactly as they are (no syncError).
  const secret = getDeviceSecret();
  if (!secret || outcome.bind.status === "waiting") {
    outcome.waiting = toSend.length;
    outcome.status = "waiting";
    return outcome;
  }
  if (toSend.length === 0) {
    outcome.status = "empty";
    return outcome;
  }

  const currentDeviceKey = getOrCreateDeviceKey();
  for (let start = 0; start < toSend.length; start += SYNC_CHUNK_SIZE) {
    const sent = await sendChunk(toSend.slice(start, start + SYNC_CHUNK_SIZE), currentDeviceKey, secret, outcome);
    if (sent === "waiting") {
      // Earlier chunks are already marked; the rest stay queued, untouched, for after approval.
      outcome.waiting = toSend.length - start;
      outcome.status = "waiting";
      return outcome;
    }
    if (sent === "failed") {
      // Earlier chunks are already marked; the rest stay queued for the next run.
      outcome.status = "failed";
      return outcome;
    }
  }
  outcome.status = "synced";
  return outcome;
}

/** Sends one chunk and applies the per-sale results to Dexie. */
async function sendChunk(
  chunk: LocalTransaction[],
  currentDeviceKey: string,
  secret: string,
  outcome: SyncOutcome
): Promise<"sent" | "failed" | "waiting"> {
  const payload = {
    // This phone's clock right now. The server compares it with its own to spot a wrong
    // phone clock; the sales keep their own timestamps either way.
    sentAt: new Date().toISOString(),
    transactions: chunk.map((t) => ({
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
    const response = await fetchWithTimeout("/api/v1/transactions/sync", {
      method: "POST",
      headers: deviceHeaders(secret),
      body: JSON.stringify(payload),
    }, REQUEST_TIMEOUT_MS.sync);
    // Not approved (or revoked): not a per-sale rejection. Nothing in the chunk is touched.
    if (await isNotApproved(response)) {
      markNotApproved();
      return "waiting";
    }
    if (!response.ok) throw new Error(`Sync failed: HTTP ${response.status}`);
    const result = await response.json();
    if (result.success && Array.isArray(result.syncedIds)) {
      markAccepted();
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
      outcome.processed += result.processedCount ?? 0;
      outcome.duplicates += result.duplicatesSkipped ?? 0;
      outcome.rejected += rejections.length;
      outcome.attention += rejections.length;
      return "sent";
    }
    return "failed";
  } catch (err) {
    console.error("Sync error:", err);
    return "failed";
  }
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
    const res = await fetchWithTimeout(
      `/api/v1/devices/binding?deviceKey=${encodeURIComponent(deviceKey)}`,
      {},
      REQUEST_TIMEOUT_MS.bindingCheck
    );
    if (!res.ok) return false;
    const data = await res.json();
    const stale = !data.bound || (local.assignmentId !== undefined && data.assignment?.id !== local.assignmentId);
    if (!stale) return false;
    return clearLocalBindingIfSame(deviceKey, local.assignmentId);
  } catch {
    return false;
  }
}

import { db } from "@/lib/db";
import { parseQrListRecord, qrIdsToClearOnMove, type QrListRecord } from "@/lib/payment-qr-plan";

/**
 * The phone's record of its last payment-QR list (slice 19 §7, S4): which barber the server sent
 * it for and which methods that barber had. localStorage, no Dexie change. Kept apart from
 * payment-qr-cache.ts so sync.ts (switchBarber) can clear it without an import cycle.
 */

const LIST_KEY = "ruzzco_payment_qr_list";
const LIST_EVENT = "ruzzco-qr-list-change";

/** The raw stored value (a stable string, for useSyncExternalStore). */
export function readQrListRaw(): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(LIST_KEY) : null;
  } catch {
    return null;
  }
}

export function readQrList(): QrListRecord | null {
  return parseQrListRecord(readQrListRaw());
}

export function writeQrList(record: QrListRecord | null) {
  try {
    if (record === null) localStorage.removeItem(LIST_KEY);
    else localStorage.setItem(LIST_KEY, JSON.stringify(record));
  } catch {
    // Storage unavailable: the modal says "unavailable" rather than "not set up".
  }
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new Event(LIST_EVENT));
  }
}

export function subscribeQrList(callback: () => void) {
  window.addEventListener(LIST_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(LIST_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/** After an owner-PIN move: the old barber's cached QRs and the list record go at once. */
export async function forgetBarberQrs(oldBarberId: string | null | undefined) {
  writeQrList(null);
  try {
    const ids = qrIdsToClearOnMove((await db.paymentQrs.toCollection().primaryKeys()) as string[], oldBarberId);
    if (ids.length > 0) await db.paymentQrs.bulkDelete(ids);
  } catch {
    // The next refresh deletes them anyway (they are not in the new barber's list).
  }
}

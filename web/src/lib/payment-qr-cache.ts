import { db, type LocalPaymentQr } from "@/lib/db";
import { planQrRefresh, qrCacheId, readQrListAnswer, type ServerQr } from "@/lib/payment-qr-plan";
import { writeQrList } from "@/lib/payment-qr-list";
import { deviceAuthHeaders } from "@/lib/sync";

/**
 * Copies this phone's barber's payment QRs into IndexedDB so the GCash/Maya modal shows them
 * offline (slice 6). IndexedDB, not the Cache API: the phones use LAN HTTP, which is not a secure
 * context. Downloads only what changed (by sha256). If the server can't be reached, or one
 * image fails, the cache keeps what it has. Display only: nothing here touches a sale.
 *
 * Slice 19 §7 (S4): the routes need this phone's approval headers (nothing is called without
 * them) and send only the barber on its active assignment. After each list the phone records
 * which barber it was for, and deletes every cached QR that isn't in it, so another barber's
 * QR never stays on the phone.
 */

let inFlight: Promise<void> | null = null;
let again = false;

/**
 * Safe to call often (load, bind, reconnect): overlapping calls share one run, followed by one
 * more when a call came in meanwhile (after a barber change, the list must be the new barber's).
 */
export function refreshPaymentQrs(): Promise<void> {
  if (inFlight) {
    again = true;
    return inFlight;
  }
  inFlight = (async () => {
    try {
      do {
        again = false;
        await run();
      } while (again);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

async function run() {
  if (typeof window === "undefined" || !navigator.onLine) return;
  const headers = deviceAuthHeaders();
  if (!headers) return; // not approved: keep the cache as it is
  let server: ServerQr[];
  try {
    const res = await fetch("/api/v1/payment-qrs", { cache: "no-store", headers });
    if (!res.ok) return;
    const answer = readQrListAnswer(await res.json());
    if (!answer) return;
    server = answer.qrs;
    writeQrList(answer.record);
  } catch {
    return; // offline or unreachable: keep the cache as it is
  }

  const cached = await db.paymentQrs.toArray();
  const plan = planQrRefresh(server, cached.map((c) => ({ id: c.id, sha256: c.sha256 })));
  if (plan.remove.length > 0) await db.paymentQrs.bulkDelete(plan.remove);

  for (const qr of plan.download) {
    try {
      const res = await fetch(`/api/v1/payment-qrs/${encodeURIComponent(qr.barberId)}/${qr.method}`, { cache: "no-store", headers });
      if (!res.ok) continue;
      const entry: LocalPaymentQr = {
        id: qrCacheId(qr.barberId, qr.method),
        barberId: qr.barberId,
        method: qr.method,
        sha256: qr.sha256,
        contentType: qr.contentType,
        dataUrl: await toDataUrl(await res.blob()),
      };
      await db.paymentQrs.put(entry);
    } catch {
      // Keep the previous copy of this one; the next refresh retries it.
    }
  }
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

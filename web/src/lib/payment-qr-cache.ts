import { db, type LocalPaymentQr } from "@/lib/db";
import { planQrRefresh, qrCacheId, type ServerQr } from "@/lib/payment-qr-plan";

/**
 * Copies the barbers' payment QRs into IndexedDB so the GCash/Maya modal shows them offline
 * (slice 6). IndexedDB, not the Cache API: the phones use LAN HTTP, which is not a secure
 * context. Downloads only what changed (by sha256). If the server can't be reached, or one
 * image fails, the cache keeps what it has. Display only: nothing here touches a sale.
 */

let inFlight: Promise<void> | null = null;

/** Safe to call often (load, bind, reconnect): overlapping calls share one run. */
export function refreshPaymentQrs(): Promise<void> {
  if (!inFlight) inFlight = run().finally(() => { inFlight = null; });
  return inFlight;
}

async function run() {
  if (typeof window === "undefined" || !navigator.onLine) return;
  let server: ServerQr[];
  try {
    const res = await fetch("/api/v1/payment-qrs", { cache: "no-store" });
    if (!res.ok) return;
    const body = await res.json();
    if (!body?.success || !Array.isArray(body.qrs)) return;
    server = body.qrs;
  } catch {
    return; // offline or unreachable: keep the cache as it is
  }

  const cached = await db.paymentQrs.toArray();
  const plan = planQrRefresh(server, cached.map((c) => ({ id: c.id, sha256: c.sha256 })));
  if (plan.remove.length > 0) await db.paymentQrs.bulkDelete(plan.remove);

  for (const qr of plan.download) {
    try {
      const res = await fetch(`/api/v1/payment-qrs/${encodeURIComponent(qr.barberId)}/${qr.method}`, { cache: "no-store" });
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

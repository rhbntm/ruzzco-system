import { REQUEST_TIMEOUT_MS, fetchWithTimeout } from "@/lib/fetch-timeout";

/**
 * Asks the server whether QR Ph (PayMongo test mode) can take a payment right now: 200 = on,
 * anything else (404 when switched off or misconfigured, an error, a timeout, offline) = no.
 * The POS calls it right before ringing a QRPH sale, so a QR Ph button left on screen after
 * the switch was turned off cannot create a sale the server would refuse.
 */
export async function checkQrphAvailable(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout("/api/v1/payments/qrph", { cache: "no-store" }, REQUEST_TIMEOUT_MS.bindingCheck);
    return res.ok;
  } catch {
    return false;
  }
}

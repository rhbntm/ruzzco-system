/**
 * Decides how to bring the phone's payment QR cache in line with the server (slice 6).
 * Pure: no Dexie, no fetch, so `npm run test:qr-cache` runs it without a browser.
 *
 * The server lists QRs for active barbers only, so anything cached that the server no longer
 * lists (removed by the owner, or its barber deactivated) is deleted. Call this only with a
 * list the server actually returned: an unreachable server must never empty the cache.
 */

export type QrMethod = "GCASH" | "MAYA";
export type ServerQr = { barberId: string; method: QrMethod; sha256: string; contentType: string };
export type CachedQrRef = { id: string; sha256: string };
export type QrRefreshPlan = { download: ServerQr[]; remove: string[] };

export const qrCacheId = (barberId: string, method: QrMethod) => `${barberId}:${method}`;

export function planQrRefresh(server: ServerQr[], cached: CachedQrRef[]): QrRefreshPlan {
  const cachedSha = new Map(cached.map((c) => [c.id, c.sha256]));
  const listed = new Set(server.map((q) => qrCacheId(q.barberId, q.method)));
  return {
    // New on the server, or replaced since the phone cached it.
    download: server.filter((q) => cachedSha.get(qrCacheId(q.barberId, q.method)) !== q.sha256),
    remove: cached.filter((c) => !listed.has(c.id)).map((c) => c.id),
  };
}

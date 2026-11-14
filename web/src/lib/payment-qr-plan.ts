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

// ── Barber-bound cache (slice 19 §7, S4) ─────────────────────────────────────

/**
 * The last list the server sent this phone: which barber it was for (the barber on the phone's
 * active assignment, or null without one) and which methods that barber had. Kept in
 * localStorage; cleared when the phone moves to another barber.
 */
export type QrListRecord = { barberId: string | null; methods: QrMethod[] };

/** A list answer the phone may cache from: phone scope only (an owner answer lists every barber). */
export function readQrListAnswer(body: unknown): { record: QrListRecord; qrs: ServerQr[] } | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { success?: unknown; scope?: unknown; barberId?: unknown; qrs?: unknown };
  if (b.success !== true || b.scope !== "phone" || !Array.isArray(b.qrs)) return null;
  const barberId = typeof b.barberId === "string" ? b.barberId : null;
  // Anything for another barber is ignored, so it can never reach the cache.
  const qrs = (b.qrs as ServerQr[]).filter((q) => barberId !== null && q?.barberId === barberId && (q.method === "GCASH" || q.method === "MAYA"));
  return { record: { barberId, methods: [...new Set(qrs.map((q) => q.method))] }, qrs };
}

/** Cache ids to delete when the phone moves away from `oldBarberId` (an owner-PIN move). */
export function qrIdsToClearOnMove(cachedIds: string[], oldBarberId: string | null | undefined): string[] {
  if (!oldBarberId) return [];
  return cachedIds.filter((id) => id.startsWith(`${oldBarberId}:`));
}

export type QrModalState =
  | { kind: "qr"; dataUrl: string }
  | { kind: "not_set_up" }
  | { kind: "unavailable" };

/**
 * What the GCash/Maya modal shows for the phone's current barber. The cached QR only when it is
 * that barber's; "not set up" only when the last list for that barber had no QR for the method;
 * otherwise "unavailable" (never loaded, or the download failed). Never another barber's QR.
 */
export function qrModalState(input: {
  barberId: string | null | undefined;
  method: QrMethod;
  cached: { barberId: string; method: QrMethod; dataUrl: string } | null | undefined;
  list: QrListRecord | null;
}): QrModalState {
  const { barberId, method, cached, list } = input;
  if (!barberId) return { kind: "unavailable" };
  if (cached && cached.barberId === barberId && cached.method === method && cached.dataUrl) return { kind: "qr", dataUrl: cached.dataUrl };
  if (list && list.barberId === barberId && !list.methods.includes(method)) return { kind: "not_set_up" };
  return { kind: "unavailable" };
}

/** The stored list record, or null when missing or unreadable. */
export function parseQrListRecord(raw: string | null): QrListRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { barberId?: unknown; methods?: unknown };
    const barberId = typeof value.barberId === "string" ? value.barberId : null;
    const methods = Array.isArray(value.methods) ? value.methods.filter((m): m is QrMethod => m === "GCASH" || m === "MAYA") : [];
    return { barberId, methods };
  } catch {
    return null;
  }
}

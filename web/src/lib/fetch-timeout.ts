// fetch that gives up after `ms`. Used by the phones (bind, sync, binding check, catalog), so a
// hung LAN connection fails like being offline instead of leaving the POS waiting forever.
// AbortController + setTimeout rather than AbortSignal.timeout(), which older phone
// browsers lack. A timed-out request rejects; the caller treats it as a failed attempt.
export async function fetchWithTimeout(input: string, init: RequestInit = {}, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export const REQUEST_TIMEOUT_MS = {
  bind: 10_000,
  bindingCheck: 10_000,
  catalog: 10_000,
  // One chunk of sales. If the server saved them but the answer was lost, the next sync
  // gets them back as duplicates: the client UUID makes a resend safe.
  sync: 30_000,
};

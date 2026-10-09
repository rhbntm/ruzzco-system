// Limits wrong owner PIN attempts on POST /api/v1/owner/unlock.
//
// Two limits, both counted over the last 15 minutes:
// - per client: 5 wrong PINs lock that client for 15 minutes.
// - shop-wide: 30 wrong PINs lock every client for 15 minutes. The client key comes from
//   x-forwarded-for, which a client can set itself, so the shop-wide limit is what caps a
//   guesser who changes that header. It also means repeated guessing can lock Mart out for
//   15 minutes; the per-client limit makes that take several devices or deliberate effort.
// While a lock is on, even the correct PIN is refused, and refused attempts are not counted.
// A correct PIN clears that client's count. Counts live in memory: a server restart clears them.

export type PinLimits = { perClient: number; shopWide: number; windowMs: number; lockMs: number };

export const DEFAULT_PIN_LIMITS: PinLimits = {
  perClient: 5,
  shopWide: 30,
  windowMs: 15 * 60 * 1000,
  lockMs: 15 * 60 * 1000,
};

type ClientState = { failures: number[]; lockedUntil: number };

export function createPinLimiter(limits: PinLimits = DEFAULT_PIN_LIMITS, now: () => number = Date.now) {
  const clients = new Map<string, ClientState>();
  let shopFailures: number[] = [];
  let shopLockedUntil = 0;

  const recent = (times: number[], at: number) => times.filter((t) => at - t < limits.windowMs);

  // Milliseconds until this client may try again, or 0 when it may try now.
  function retryAfter(client: string) {
    const at = now();
    const clientLock = clients.get(client)?.lockedUntil ?? 0;
    return Math.max(0, clientLock - at, shopLockedUntil - at);
  }

  function recordFailure(client: string) {
    const at = now();
    const state = clients.get(client) ?? { failures: [], lockedUntil: 0 };
    state.failures = [...recent(state.failures, at), at];
    if (state.failures.length >= limits.perClient) {
      state.lockedUntil = at + limits.lockMs;
      state.failures = [];
    }
    clients.set(client, state);

    shopFailures = [...recent(shopFailures, at), at];
    if (shopFailures.length >= limits.shopWide) {
      shopLockedUntil = at + limits.lockMs;
      shopFailures = [];
    }

    // Keep the map small: drop clients with nothing recent and no lock.
    for (const [key, value] of clients) {
      if (value.lockedUntil <= at && recent(value.failures, at).length === 0) clients.delete(key);
    }
  }

  function recordSuccess(client: string) {
    clients.delete(client);
  }

  return { retryAfter, recordFailure, recordSuccess };
}

// One limiter per server process. Kept on globalThis so dev hot reloads don't reset it.
const globalForPin = globalThis as unknown as { ownerPinLimiter?: ReturnType<typeof createPinLimiter> };
export const ownerPinLimiter = (globalForPin.ownerPinLimiter ??= createPinLimiter());

// The first x-forwarded-for entry. Next sets it from the socket address when the client
// didn't send one; a client that sends its own is still capped by the shop-wide limit.
export function pinClientKey(headers: Headers) {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

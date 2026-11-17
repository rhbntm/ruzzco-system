// Limits wrong PIN attempts on POST /api/v1/owner/unlock and POST /api/v1/devices/approve
// (one limiter each, separate counters). POST /api/v1/devices/bind, which takes only the owner
// PIN (to move a phone to another barber), shares the owner-unlock limiter.
//
// Two limits, both counted over the last 15 minutes:
// - per client: 5 wrong PINs lock that client for 15 minutes.
// - shop-wide: 30 wrong PINs lock every client for 15 minutes. The client key comes from
//   x-forwarded-for, which a client can set itself, so the shop-wide limit is what caps a
//   guesser who changes that header. It also means repeated guessing can lock Mart out for
//   15 minutes; the per-client limit makes that take several devices or deliberate effort.
// While a lock is on, even the correct PIN is refused, and refused attempts are not counted.
// A correct PIN clears that client's count. The counts the routes use live in the database (rate-limit-db.ts), so a restart or a new serverless instance keeps them; createPinLimiter keeps them in memory.

import { DEFAULT_PIN_LIMITS, type PinLimits } from "./pin-limits";
import { createDbPinLimiter } from "./rate-limit-db";

export { DEFAULT_PIN_LIMITS, type PinLimits };

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

// The limiters the routes use are kept in the database (rate-limit-db.ts), not in memory: on a
// serverless host every request can land on a new instance, which would reset an in-memory count.
// createPinLimiter above is the same rule in memory (used by the unit tests).
// Phone approval (POST /api/v1/devices/approve) has its own counters, same limits.
// Staff sign-in (slice 19, Decision 6) has its own counters, same limits, keyed by username
// instead of client: 5 wrong passwords lock that username, 30 shop-wide lock every sign-in.
// Unknown usernames count the same. Someone on the shop Wi-Fi can therefore lock a barber's
// username for 15 minutes; offline sign-in on that barber's own phone still works.
export const ownerPinLimiter = createDbPinLimiter("owner-pin");
export const devicePinLimiter = createDbPinLimiter("device-pin");
export const loginLimiter = createDbPinLimiter("login");

export function tooManyLoginsResponse(waitMs: number) {
  const minutes = Math.ceil(waitMs / 60000);
  return Response.json(
    { success: false, code: "TOO_MANY", error: `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` },
    { status: 429, headers: { "Retry-After": String(Math.ceil(waitMs / 1000)) } }
  );
}

export function tooManyPinsResponse(waitMs: number) {
  const minutes = Math.ceil(waitMs / 60000);
  return Response.json(
    { success: false, error: `Too many wrong PINs. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` },
    { status: 429, headers: { "Retry-After": String(Math.ceil(waitMs / 1000)) } }
  );
}

// The first x-forwarded-for entry. Next sets it from the socket address when the client
// didn't send one; a client that sends its own is still capped by the shop-wide limit.
export function pinClientKey(headers: Headers) {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

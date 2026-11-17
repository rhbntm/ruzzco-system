import { prisma } from "@/lib/prisma";
import { DEFAULT_PIN_LIMITS, type PinLimits } from "./pin-limits";

// The wrong-PIN / wrong-password limiter kept in the database. Same rules as the in-memory
// limiter in pin-attempts.ts (per client N wrong tries lock that client; M wrong tries shop-wide
// lock everyone; a lock refuses even the correct secret; a correct one clears the client's
// count), but the counts live in `rate_limit_events` / `rate_limit_locks`, so they hold across
// serverless instances and restarts.
//
// Errors are not swallowed: a caller that can't reach the database fails the request (closed),
// never skips the limit. Attempts are counted after the check, so a burst of parallel guesses
// that all pass the check before any is recorded can overshoot the limit by the burst size.

const SHOP = "shop";
const clientScope = (client: string) => `c:${client.slice(0, 90)}`;

export type DbPinLimiter = {
  retryAfter(client: string): Promise<number>;
  recordFailure(client: string): Promise<void>;
  recordSuccess(client: string): Promise<void>;
};

export function createDbPinLimiter(name: string, limits: PinLimits = DEFAULT_PIN_LIMITS, now: () => number = Date.now): DbPinLimiter {
  async function retryAfter(client: string) {
    const at = now();
    const locks = await prisma.rateLimitLock.findMany({
      where: { limiter: name, scope: { in: [clientScope(client), SHOP] }, lockedUntil: { gt: new Date(at) } },
      select: { lockedUntil: true },
    });
    return locks.reduce((max, lock) => Math.max(max, lock.lockedUntil.getTime() - at), 0);
  }

  async function lockIfOver(scope: string, limit: number, at: number) {
    const count = await prisma.rateLimitEvent.count({
      where: { limiter: name, scope, at: { gt: new Date(at - limits.windowMs) } },
    });
    if (count < limit) return;
    const lockedUntil = new Date(at + limits.lockMs);
    await prisma.$transaction([
      prisma.rateLimitLock.upsert({
        where: { limiter_scope: { limiter: name, scope } },
        create: { limiter: name, scope, lockedUntil },
        update: { lockedUntil },
      }),
      prisma.rateLimitEvent.deleteMany({ where: { limiter: name, scope } }),
    ]);
  }

  async function recordFailure(client: string) {
    const at = now();
    const when = new Date(at);
    const scope = clientScope(client);
    await prisma.rateLimitEvent.createMany({
      data: [
        { limiter: name, scope, at: when },
        { limiter: name, scope: SHOP, at: when },
      ],
    });
    await lockIfOver(scope, limits.perClient, at);
    await lockIfOver(SHOP, limits.shopWide, at);
    // Housekeeping now and then: events past the window and locks that have ended.
    if (Math.random() < 0.05) {
      await prisma.rateLimitEvent.deleteMany({ where: { at: { lt: new Date(at - limits.windowMs) } } });
      await prisma.rateLimitLock.deleteMany({ where: { lockedUntil: { lt: when } } });
    }
  }

  async function recordSuccess(client: string) {
    await prisma.rateLimitEvent.deleteMany({ where: { limiter: name, scope: clientScope(client) } });
  }

  return { retryAfter, recordFailure, recordSuccess };
}

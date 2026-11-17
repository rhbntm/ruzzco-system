/**
 * Tests the database-backed PIN/password limiter (src/lib/rate-limit-db.ts) with a fake clock and
 * scratch limiter names (removed at the end). Needs MySQL only, no dev server.
 *
 *   npm run test:rate-limit-db
 */
import { prisma } from "../src/lib/prisma";
import { DEFAULT_PIN_LIMITS } from "../src/lib/pin-limits";
import { createDbPinLimiter } from "../src/lib/rate-limit-db";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const { perClient, shopWide, lockMs, windowMs } = DEFAULT_PIN_LIMITS;
const NAMES = ["t-a", "t-b", "t-shop"];

async function cleanup() {
  await prisma.rateLimitEvent.deleteMany({ where: { limiter: { in: NAMES } } });
  await prisma.rateLimitLock.deleteMany({ where: { limiter: { in: NAMES } } });
}

async function main() {
  await cleanup();
  let clock = Date.now();
  const advance = (ms: number) => (clock += ms);
  const a = createDbPinLimiter("t-a", DEFAULT_PIN_LIMITS, () => clock);
  const a2 = createDbPinLimiter("t-a", DEFAULT_PIN_LIMITS, () => clock); // another "instance": same database
  const b = createDbPinLimiter("t-b", DEFAULT_PIN_LIMITS, () => clock);

  console.log("per client");
  for (let i = 0; i < perClient - 1; i++) await a.recordFailure("1.1.1.1");
  check(`${perClient - 1} wrong tries: not locked`, (await a.retryAfter("1.1.1.1")) === 0);
  await a.recordFailure("1.1.1.1");
  check(`${perClient} wrong tries lock the client`, (await a.retryAfter("1.1.1.1")) > 0);
  check("the lock is seen by another instance (the same database)", (await a2.retryAfter("1.1.1.1")) > 0);
  check("another client is not locked", (await a.retryAfter("2.2.2.2")) === 0);
  check("another limiter is not locked", (await b.retryAfter("1.1.1.1")) === 0);
  advance(lockMs - 1000);
  check("still locked just before it ends", (await a.retryAfter("1.1.1.1")) > 0);
  advance(2000);
  check("free after the lock ends", (await a.retryAfter("1.1.1.1")) === 0);

  console.log("window and success");
  await a.recordFailure("3.3.3.3");
  await a.recordFailure("3.3.3.3");
  advance(windowMs + 1000);
  for (let i = 0; i < perClient - 1; i++) await a.recordFailure("3.3.3.3");
  check("tries older than the window don't count", (await a.retryAfter("3.3.3.3")) === 0);
  await a.recordSuccess("3.3.3.3");
  await a.recordFailure("3.3.3.3");
  check("a correct secret clears the client's count", (await a.retryAfter("3.3.3.3")) === 0);

  console.log("shop-wide");
  const s = createDbPinLimiter("t-shop", DEFAULT_PIN_LIMITS, () => clock);
  for (let i = 0; i < shopWide; i++) await s.recordFailure(`10.0.0.${i}`); // one try each, never per-client
  check(`${shopWide} wrong tries from different clients lock everyone`, (await s.retryAfter("brand-new-client")) > 0);
  check("the shop lock refuses a client that never failed", (await s.retryAfter("another")) > 0);

  console.log("scope names");
  check("a client called 'shop' is not the shop-wide scope", (await a.retryAfter("shop")) === 0);
  await a.recordFailure("x".repeat(500));
  check("a very long client key is accepted (cut to fit)", true);
}

main()
  .catch((error) => { failures.push(`crashed: ${error instanceof Error ? error.message : String(error)}`); console.error(error); })
  .finally(async () => {
    await cleanup().catch(() => {});
    await prisma.$disconnect();
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) { console.log(failures.map((f) => `  - ${f}`).join("\n")); process.exit(1); }
  });

/**
 * Tests the owner PIN attempt limiter (src/lib/pin-attempts.ts) with a fake clock.
 * No server or database needed.
 *
 *   npm run test:pin-attempts
 */
import { DEFAULT_PIN_LIMITS, createPinLimiter, pinClientKey } from "../src/lib/pin-attempts";

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const MINUTE = 60 * 1000;
const { perClient, shopWide, lockMs, windowMs } = DEFAULT_PIN_LIMITS;

function setup() {
  let clock = 1_000_000;
  const limiter = createPinLimiter(DEFAULT_PIN_LIMITS, () => clock);
  return { limiter, advance: (ms: number) => (clock += ms) };
}

console.log("Per client");
{
  const { limiter, advance } = setup();
  for (let i = 0; i < perClient - 1; i++) limiter.recordFailure("a");
  check(`${perClient - 1} wrong PINs: still allowed`, limiter.retryAfter("a") === 0);
  limiter.recordFailure("a");
  check(`${perClient} wrong PINs: locked for 15 minutes`, limiter.retryAfter("a") === lockMs);
  check("another client is not locked", limiter.retryAfter("b") === 0);
  advance(lockMs - 1);
  check("still locked 1 ms before the end", limiter.retryAfter("a") === 1);
  advance(1);
  check("unlocked after 15 minutes", limiter.retryAfter("a") === 0);
  limiter.recordFailure("a");
  check("the count starts again after a lock", limiter.retryAfter("a") === 0);
}
{
  const { limiter, advance } = setup();
  for (let i = 0; i < perClient - 1; i++) limiter.recordFailure("a");
  advance(windowMs);
  limiter.recordFailure("a");
  check("wrong PINs older than 15 minutes don't count", limiter.retryAfter("a") === 0);
}
{
  const { limiter } = setup();
  for (let i = 0; i < perClient - 1; i++) limiter.recordFailure("a");
  limiter.recordSuccess("a");
  limiter.recordFailure("a");
  check("a correct PIN clears the client's count", limiter.retryAfter("a") === 0);
}

console.log("\nShop-wide");
{
  const { limiter, advance } = setup();
  for (let i = 0; i < shopWide; i++) limiter.recordFailure(`spoofed-${i}`);
  check(`${shopWide} wrong PINs from changing clients lock everyone`, limiter.retryAfter("mart") === lockMs);
  advance(lockMs);
  check("everyone unlocked after 15 minutes", limiter.retryAfter("mart") === 0);
}
{
  const { limiter, advance } = setup();
  for (let i = 0; i < shopWide - 1; i++) limiter.recordFailure(`spoofed-${i}`);
  advance(windowMs);
  limiter.recordFailure("late");
  check("shop-wide count only covers the last 15 minutes", limiter.retryAfter("mart") === 0);
}

console.log("\nClient key");
check("first x-forwarded-for entry", pinClientKey(new Headers({ "x-forwarded-for": "192.168.1.20, 10.0.0.1" })) === "192.168.1.20");
check("no header gives one shared key", pinClientKey(new Headers()) === "unknown");
check("minutes in the message round up", Math.ceil((lockMs - 30 * 1000) / MINUTE) === 15);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}

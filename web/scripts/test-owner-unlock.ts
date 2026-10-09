/**
 * Integration test for the owner PIN attempt limit on POST /api/v1/owner/unlock.
 *
 *   npm run dev                  (in another terminal; OWNER_PIN in web/.env)
 *   npm run test:owner-unlock    (TEST_BASE_URL overrides http://localhost:3000)
 *
 * Uses a made-up x-forwarded-for per run, so only that test client is locked. Each run adds
 * 5 wrong PINs to the shop-wide count (30 in 15 minutes locks everyone), so run it at most
 * 5 times in 15 minutes; restarting the dev server clears the counts.
 */
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { DEFAULT_PIN_LIMITS } from "../src/lib/pin-attempts";

loadEnvConfig(process.cwd());

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const RUN = randomUUID().slice(0, 8);
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

async function unlock(pin: string, client: string) {
  const res = await fetch(`${BASE}/api/v1/owner/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": client },
    body: JSON.stringify({ pin }),
  });
  const body = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
  return { status: res.status, body, retryAfter: res.headers.get("retry-after"), cookie: res.headers.get("set-cookie") };
}

async function main() {
  console.log(`Owner unlock limit test against ${BASE} (run ${RUN})`);
  const health = await fetch(`${BASE}/api/v1/health`).catch(() => null);
  if (!health?.ok) throw new Error(`Dev server not reachable at ${BASE}. Start it with \`npm run dev\`.`);
  const pin = process.env.OWNER_PIN;
  if (!pin) throw new Error("OWNER_PIN is not set in web/.env");
  const wrong = `${pin}-wrong`;
  const target = `test-unlock-${RUN}`;
  const other = `test-unlock-other-${RUN}`;

  console.log("\nCorrect PIN");
  const first = await unlock(pin, other);
  check("correct PIN answers 200 and sets the cookie", first.status === 200 && Boolean(first.cookie), `got ${first.status}`);

  console.log("\nWrong PINs");
  const statuses: number[] = [];
  for (let i = 0; i < DEFAULT_PIN_LIMITS.perClient; i++) statuses.push((await unlock(wrong, target)).status);
  check(`${DEFAULT_PIN_LIMITS.perClient} wrong PINs each answer 401`, statuses.every((s) => s === 401), statuses.join(","));

  const locked = await unlock(wrong, target);
  check("next attempt answers 429", locked.status === 429, `got ${locked.status}`);
  check("429 has Retry-After of about 15 minutes", Number(locked.retryAfter) > 14 * 60 && Number(locked.retryAfter) <= 15 * 60, `got ${locked.retryAfter}`);
  check("429 explains the wait", /Too many wrong PINs\. Try again in 15 minutes\./.test(locked.body?.error ?? ""), locked.body?.error);

  const lockedCorrect = await unlock(pin, target);
  check("the correct PIN is refused while locked", lockedCorrect.status === 429 && !lockedCorrect.cookie, `got ${lockedCorrect.status}`);

  const otherClient = await unlock(pin, other);
  check("another client can still unlock", otherClient.status === 200, `got ${otherClient.status}`);
}

main()
  .catch((error) => {
    failures.push(`crashed: ${error instanceof Error ? error.message : String(error)}`);
    console.error(error);
  })
  .finally(() => {
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
      for (const f of failures) console.log(`  FAIL ${f}`);
      process.exit(1);
    }
  });

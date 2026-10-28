/**
 * Owner session (slice 15) and the owner PIN attempt limit on POST /api/v1/owner/unlock.
 * First the signed cookie on its own (src/lib/owner-access.ts, no server): expiry, a PIN or
 * secret change, forged and pre-slice cookies. Then the real routes: unlock, an owner route with
 * a signed, forged or pre-slice cookie, lock, and the wrong-PIN limit.
 *
 *   npm run dev                  (in another terminal; OWNER_PIN in web/.env)
 *   npm run test:owner-unlock    (TEST_BASE_URL overrides http://localhost:3000)
 *
 * Uses a made-up x-forwarded-for per run, so only that test client is locked. Each run adds
 * 5 wrong PINs to the shop-wide count (30 in 15 minutes locks everyone), so run it at most
 * 5 times in 15 minutes; restarting the dev server clears the counts.
 */
import { createHash, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { DEFAULT_PIN_LIMITS } from "../src/lib/pin-attempts";
import { OWNER_SESSION_MS, isOwnerCookie, ownerCookieValue } from "../src/lib/owner-access";

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

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
// The cookie value before slice 15: sha256 of a fixed prefix and the PIN.
const preSliceCookie = (pin: string) => sha256(`ruzzco-owner:${pin}`);

function sessionChecks() {
  console.log("Signed owner session (no server)");
  const saved = { pin: process.env.OWNER_PIN, secret: process.env.OWNER_SESSION_SECRET };
  try {
    process.env.OWNER_PIN = "246810";
    process.env.OWNER_SESSION_SECRET = "a".repeat(64);
    const now = 1_800_000_000_000;
    const cookie = ownerCookieValue(now);
    check("the cookie is <expiresAt>.<signature>", /^\d+\.[0-9a-f]{64}$/.test(cookie) && cookie.startsWith(`${now + OWNER_SESSION_MS}.`), cookie);
    check("it reveals neither the PIN nor its hash", !cookie.includes("246810") && !cookie.includes(sha256("246810")));
    check("a fresh cookie is accepted", isOwnerCookie(cookie, now));
    check("still accepted a minute before 12 h", isOwnerCookie(cookie, now + OWNER_SESSION_MS - 60_000));
    check("refused at 12 h", !isOwnerCookie(cookie, now + OWNER_SESSION_MS));
    const [expiresAt, signature] = cookie.split(".");
    check("a later expiry with the same signature is refused", !isOwnerCookie(`${Number(expiresAt) + OWNER_SESSION_MS}.${signature}`, now));
    check("a changed signature is refused", !isOwnerCookie(`${expiresAt}.${signature.replace(/.$/, (c) => (c === "0" ? "1" : "0"))}`, now));
    check("a pre-slice cookie (sha256 of the PIN) is refused", !isOwnerCookie(preSliceCookie("246810"), now));
    check("an empty or malformed cookie is refused", !isOwnerCookie("", now) && !isOwnerCookie(undefined, now) && !isOwnerCookie("x.y", now));
    process.env.OWNER_PIN = "135790";
    check("changing the PIN ends the session", !isOwnerCookie(cookie, now));
    process.env.OWNER_PIN = "246810";
    process.env.OWNER_SESSION_SECRET = "b".repeat(64);
    check("changing the secret ends the session", !isOwnerCookie(cookie, now));
    delete process.env.OWNER_SESSION_SECRET;
    check("without OWNER_SESSION_SECRET no session is issued or accepted", ownerCookieValue(now) === "" && !isOwnerCookie(cookie, now));
  } finally {
    process.env.OWNER_PIN = saved.pin;
    if (saved.secret === undefined) delete process.env.OWNER_SESSION_SECRET;
    else process.env.OWNER_SESSION_SECRET = saved.secret;
  }
}

async function ownerRoute(cookie: string) {
  const res = await fetch(`${BASE}/api/v1/devices`, { headers: cookie ? { Cookie: cookie } : {} });
  return res.status;
}

async function main() {
  sessionChecks();
  console.log(`\nOwner unlock against ${BASE} (run ${RUN})`);
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
  const setCookie = first.cookie ?? "";
  const cookie = setCookie.split(";")[0];
  const value = cookie.split("=")[1] ?? "";
  check("the cookie is HttpOnly, SameSite=Strict, 12 h", /HttpOnly/i.test(setCookie) && /SameSite=Strict/i.test(setCookie) && /Max-Age=43200/i.test(setCookie), setCookie);
  check("the value is signed and doesn't reveal the PIN", /^\d+\.[0-9a-f]{64}$/.test(value) && !value.includes(pin) && value !== preSliceCookie(pin));
  check("the signed cookie opens an owner route", (await ownerRoute(cookie)) === 200);
  check("no cookie: 401", (await ownerRoute("")) === 401);
  check("a pre-slice cookie (sha256 of the PIN) is refused", (await ownerRoute(`ruzzco_owner_access=${preSliceCookie(pin)}`)) === 401);
  const [expiresAt] = value.split(".");
  check("a forged signature is refused", (await ownerRoute(`ruzzco_owner_access=${expiresAt}.${"0".repeat(64)}`)) === 401);
  check("an expired cookie is refused", (await ownerRoute(`ruzzco_owner_access=${Date.now() - 1000}.${value.split(".")[1]}`)) === 401);

  console.log("\nLock");
  const lockPlain = await fetch(`${BASE}/api/v1/owner/lock`, { method: "POST", headers: { "Content-Type": "text/plain", Cookie: cookie }, body: "{}" });
  check("lock refuses a non-JSON Content-Type (415)", lockPlain.status === 415, `got ${lockPlain.status}`);
  const lock = await fetch(`${BASE}/api/v1/owner/lock`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: "{}" });
  const cleared = lock.headers.get("set-cookie") ?? "";
  check("lock answers 200 and clears the cookie on this device", lock.status === 200 && /^ruzzco_owner_access=;/.test(cleared) && /Max-Age=0/i.test(cleared), cleared);
  const plainUnlock = await fetch(`${BASE}/api/v1/owner/unlock`, { method: "POST", headers: { "Content-Type": "text/plain", "x-forwarded-for": other }, body: JSON.stringify({ pin }) });
  check("unlock refuses a non-JSON Content-Type (415)", plainUnlock.status === 415, `got ${plainUnlock.status}`);

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

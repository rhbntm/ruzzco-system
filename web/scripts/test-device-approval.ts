/**
 * Approved phones (slice 15): POST /api/v1/devices/approve, GET /api/v1/devices,
 * POST /api/v1/devices/revoke, and the device check on bind and sync, against a running dev
 * server. The limiter's counting is tested without the server (as in test-pin-attempts), so this
 * suite sends only one wrong approval PIN and one wrong unlock per run: the approval route's
 * shop-wide lock (30 wrong PINs in 15 minutes) would stop every later suite from approving its
 * scratch devices.
 *
 *   npm run dev                      (in another terminal; OWNER_PIN, DEVICE_APPROVAL_PIN and
 *                                     OWNER_SESSION_SECRET in web/.env, the two PINs different)
 *   npm run test:device-approval     (TEST_BASE_URL overrides http://localhost:3000)
 *
 * Uses a throwaway barber and scratch devices; everything it creates is deleted at the end.
 */
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { prisma } from "../src/lib/prisma";
import { DEFAULT_PIN_LIMITS, createPinLimiter, devicePinLimiter, ownerPinLimiter } from "../src/lib/pin-attempts";

loadEnvConfig(process.cwd());

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const SERVICE_ID = "10000000-0000-0000-0000-000000000001"; // seeded Haircut
const RUN = randomUUID().slice(0, 8);
const BARBER = `test-approval-${RUN}`;
const CLIENT = `test-approval-${RUN}`;
const txIds: string[] = [];
const deviceKeys: string[] = [];
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

type Json = Record<string, unknown> | null;

async function call(path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "POST",
    headers: { "x-forwarded-for": CLIENT, ...(init.headers ?? { "Content-Type": "application/json" }) },
    body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as Json, cookie: res.headers.get("set-cookie") };
}

const newKey = () => {
  const key = randomUUID();
  deviceKeys.push(key);
  return key;
};

const approve = (deviceKey: string, pin: string, label?: string) =>
  call("/api/v1/devices/approve", { body: { deviceKey, pin, ...(label ? { label } : {}) } });

const auth = (deviceKey: string, secret: string) => ({
  "Content-Type": "application/json",
  "X-Ruzzco-Device": deviceKey,
  Authorization: `Bearer ${secret}`,
});

const sync = (headers: Record<string, string>, transactions: unknown[]) =>
  call("/api/v1/transactions/sync", { headers, body: { transactions } });

// The payload an older POS queued: no deviceKey, assignmentId, listPrice, amountPaid or sentAt.
function legacySale() {
  const id = randomUUID();
  txIds.push(id);
  return { id, barberId: BARBER, serviceId: SERVICE_ID, totalAmount: 250, paymentMethod: "CASH", transactionTime: new Date().toISOString() };
}

function sale(deviceKey: string, assignmentId?: string) {
  return { ...legacySale(), deviceKey, ...(assignmentId ? { assignmentId } : {}) };
}

const stored = (id: string) => prisma.transaction.findUnique({ where: { id }, select: { id: true, barberId: true, cashierId: true } });

function limiterChecks() {
  console.log("Approval limiter (no server)");
  check("the approval limiter is not the owner unlock limiter", devicePinLimiter !== ownerPinLimiter);
  let clock = 1_000_000;
  const owner = createPinLimiter(DEFAULT_PIN_LIMITS, () => clock);
  const approval = createPinLimiter(DEFAULT_PIN_LIMITS, () => clock);
  for (let i = 0; i < DEFAULT_PIN_LIMITS.perClient; i++) approval.recordFailure("phone");
  check("5 wrong approval PINs lock that client", approval.retryAfter("phone") > 0);
  check("...and leave the owner unlock counters alone", owner.retryAfter("phone") === 0);
  for (let i = 0; i < DEFAULT_PIN_LIMITS.shopWide; i++) approval.recordFailure(`guesser-${i}`);
  check("30 wrong approval PINs lock every client", approval.retryAfter("someone-else") > 0);
  clock += DEFAULT_PIN_LIMITS.lockMs;
  check("the lock ends after 15 minutes", approval.retryAfter("someone-else") === 0);
}

async function main() {
  limiterChecks();

  console.log(`\nApproved phones against ${BASE} (run ${RUN})`);
  const health = await fetch(`${BASE}/api/v1/health`).catch(() => null);
  if (!health?.ok) throw new Error(`Dev server not reachable at ${BASE}. Start it with \`npm run dev\`.`);
  const ownerPin = process.env.OWNER_PIN ?? "";
  const approvalPin = process.env.DEVICE_APPROVAL_PIN ?? "";
  if (!ownerPin) throw new Error("OWNER_PIN is not set in web/.env");
  if (!approvalPin || approvalPin === ownerPin) throw new Error("DEVICE_APPROVAL_PIN must be set in web/.env and differ from OWNER_PIN");
  await prisma.barber.create({ data: { id: BARBER, fullName: `Test Barber Approval ${RUN}`, commissionRate: 0.5 } });

  console.log("\nAn unapproved phone");
  const phone = newKey();
  const waiting = legacySale();
  const noHeaders = await sync({ "Content-Type": "application/json" }, [waiting]);
  check("sync without device headers answers 401 DEVICE_NOT_APPROVED", noHeaders.status === 401 && noHeaders.body?.code === "DEVICE_NOT_APPROVED", `got ${noHeaders.status}`);
  const madeUp = await sync(auth(phone, "a".repeat(64)), [{ ...waiting, deviceKey: phone }]);
  check("sync with a made-up secret answers 401 DEVICE_NOT_APPROVED", madeUp.status === 401 && madeUp.body?.code === "DEVICE_NOT_APPROVED", `got ${madeUp.status}`);
  check("nothing was inserted", (await stored(waiting.id)) === null);
  const bindUnapproved = await call("/api/v1/devices/bind", { headers: auth(phone, "a".repeat(64)), body: { deviceKey: phone, barberId: BARBER, assignmentId: randomUUID() } });
  check("bind from an unapproved phone answers 401 DEVICE_NOT_APPROVED", bindUnapproved.status === 401 && bindUnapproved.body?.code === "DEVICE_NOT_APPROVED", `got ${bindUnapproved.status}`);
  check("no assignment was created", (await prisma.deviceAssignment.count({ where: { deviceKey: phone } })) === 0);
  check("an unapproved phone leaves no devices row", (await prisma.device.findUnique({ where: { deviceKey: phone } })) === null);

  console.log("\nApproving");
  const wrong = await approve(phone, `${ownerPin}9`);
  check("a wrong PIN answers 401 and approves nothing", wrong.status === 401 && !wrong.body?.secret && (await prisma.device.findUnique({ where: { deviceKey: phone } })) === null, `got ${wrong.status}`);
  const textPlain = await call("/api/v1/devices/approve", { headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ deviceKey: phone, pin: ownerPin }) });
  check("approve refuses a non-JSON Content-Type (415)", textPlain.status === 415, `got ${textPlain.status}`);

  const byOwner = await approve(phone, ownerPin, "Test phone");
  const secret1 = String(byOwner.body?.secret ?? "");
  check("the owner PIN approves: 200 with a 64-hex secret", byOwner.status === 200 && /^[0-9a-f]{64}$/.test(secret1), `got ${byOwner.status}`);
  check("...recorded as OWNER", byOwner.body?.approvedWith === "OWNER");
  check("...and sets no owner cookie", !byOwner.cookie);
  const row = await prisma.device.findUnique({ where: { deviceKey: phone } });
  check("the server keeps a hash, never the secret", !!row && row.secretHash.length === 64 && row.secretHash !== secret1 && row.label === "Test phone");

  const helper = newKey();
  const byApprover = await approve(helper, approvalPin);
  check("the approval PIN approves, recorded as APPROVER", byApprover.status === 200 && byApprover.body?.approvedWith === "APPROVER", `got ${byApprover.status}`);
  check("...and sets no owner cookie", !byApprover.cookie);

  console.log("\nThe approval PIN opens nothing else");
  const unlockWithApproval = await call("/api/v1/owner/unlock", { body: { pin: approvalPin } });
  check("owner unlock refuses the approval PIN", unlockWithApproval.status === 401 && !unlockWithApproval.cookie, `got ${unlockWithApproval.status}`);
  for (const [method, path] of [["GET", "/api/v1/devices"], ["GET", "/api/v1/reports/reconciliation?date=2026-10-01"], ["GET", "/api/v1/reports/ledger-summary?period=day&date=2026-10-01"]] as const) {
    const res = await call(path, { method, headers: {} });
    check(`${method} ${path.split("?")[0]} is 401 without the owner cookie`, res.status === 401, `got ${res.status}`);
  }
  const revokeNoOwner = await call("/api/v1/devices/revoke", { body: { deviceKey: phone } });
  check("revoke is 401 without the owner cookie", revokeNoOwner.status === 401, `got ${revokeNoOwner.status}`);

  console.log("\nSending from an approved phone");
  const synced = await sync(auth(phone, secret1), [waiting]);
  check("the sale queued while unapproved (an older POS payload) syncs after approval", synced.status === 200 && (synced.body?.syncedIds as string[] | undefined)?.includes(waiting.id) === true, JSON.stringify(synced.body));
  const legacyRow = await stored(waiting.id);
  check("...keeping its stamped barber, no cashier (legacy rule)", legacyRow?.barberId === BARBER && legacyRow.cashierId === null);

  const assignmentId = randomUUID();
  const bound = await call("/api/v1/devices/bind", { headers: auth(phone, secret1), body: { deviceKey: phone, barberId: BARBER, assignmentId } });
  check("bind from the approved phone works", bound.status === 200, `got ${bound.status}`);
  const otherBind = await call("/api/v1/devices/bind", { headers: auth(phone, secret1), body: { deviceKey: helper, barberId: BARBER, assignmentId: randomUUID() } });
  check("bind for another device key answers 401", otherBind.status === 401 && otherBind.body?.code === "DEVICE_NOT_APPROVED", `got ${otherBind.status}`);

  const own = sale(phone, assignmentId);
  const foreign = sale(helper);
  const mixed = await sync(auth(phone, secret1), [own, foreign]);
  const rejected = (mixed.body?.rejected ?? []) as { id: string; reason: string }[];
  check("a sale carrying another device's key is DEVICE_MISMATCH", rejected.some((r) => r.id === foreign.id && r.reason === "DEVICE_MISMATCH"), JSON.stringify(mixed.body));
  check("...it is not inserted, the phone's own sale is", (await stored(foreign.id)) === null && (await stored(own.id))?.cashierId === BARBER);

  const listed = await call("/api/v1/devices", { method: "GET", headers: { Cookie: await ownerCookie() } });
  const list = (listed.body?.devices ?? []) as Record<string, unknown>[];
  const mine = list.find((d) => d.deviceKey === phone);
  check("the owner list shows the phone with label, approver and last seen", !!mine && mine.label === "Test phone" && mine.approvedWith === "OWNER" && !!mine.lastSeenAt);
  check("the list never carries a secret or its hash", !JSON.stringify(listed.body).includes(secret1) && list.every((d) => !("secretHash" in d)));

  console.log("\nRe-approval replaces the secret");
  const again = await approve(phone, approvalPin);
  const secret2 = String(again.body?.secret ?? "");
  check("approving again returns a new secret", again.status === 200 && secret2.length === 64 && secret2 !== secret1);
  const oldSecret = await sync(auth(phone, secret1), [sale(phone)]);
  check("the old secret stops working", oldSecret.status === 401, `got ${oldSecret.status}`);
  const newSecret = await sync(auth(phone, secret2), [sale(phone)]);
  check("the new secret works", newSecret.status === 200, `got ${newSecret.status}`);

  console.log("\nRevoke");
  const cookie = await ownerCookie();
  const revoked = await call("/api/v1/devices/revoke", { headers: { "Content-Type": "application/json", Cookie: cookie }, body: { deviceKey: phone } });
  check("the owner revokes a phone", revoked.status === 200, `got ${revoked.status}`);
  const afterRevoke = sale(phone, assignmentId);
  const syncRevoked = await sync(auth(phone, secret2), [afterRevoke]);
  check("sync from the revoked phone answers 401 at once", syncRevoked.status === 401 && syncRevoked.body?.code === "DEVICE_NOT_APPROVED", `got ${syncRevoked.status}`);
  check("...and inserts nothing", (await stored(afterRevoke.id)) === null);
  const bindRevoked = await call("/api/v1/devices/bind", { headers: auth(phone, secret2), body: { deviceKey: phone, barberId: BARBER, assignmentId: randomUUID() } });
  check("bind from the revoked phone answers 401", bindRevoked.status === 401, `got ${bindRevoked.status}`);
  const revokeAgain = await call("/api/v1/devices/revoke", { headers: { "Content-Type": "application/json", Cookie: cookie }, body: { deviceKey: phone } });
  check("revoking again is a no-op", revokeAgain.status === 200);
  const reapproved = await approve(phone, ownerPin);
  const secret3 = String(reapproved.body?.secret ?? "");
  const held = await sync(auth(phone, secret3), [afterRevoke]);
  check("approved again, the phone's held sale syncs", held.status === 200 && (held.body?.syncedIds as string[] | undefined)?.includes(afterRevoke.id) === true, `got ${held.status}`);
}

let cachedCookie = "";
async function ownerCookie() {
  if (cachedCookie) return cachedCookie;
  const res = await call("/api/v1/owner/unlock", { body: { pin: process.env.OWNER_PIN } });
  cachedCookie = (res.cookie ?? "").split(";")[0];
  if (!cachedCookie) throw new Error(`owner unlock failed: HTTP ${res.status}`);
  return cachedCookie;
}

async function cleanup() {
  await prisma.transaction.deleteMany({ where: { OR: [{ id: { in: txIds } }, { barberId: BARBER }] } });
  await prisma.deviceAssignment.deleteMany({ where: { OR: [{ deviceKey: { in: deviceKeys } }, { barberId: BARBER }] } });
  await prisma.device.deleteMany({ where: { deviceKey: { in: deviceKeys } } });
  await prisma.barber.deleteMany({ where: { id: BARBER } });
}

main()
  .catch((error) => {
    failures.push(`crashed: ${error instanceof Error ? error.message : String(error)}`);
    console.error(error);
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("Cleanup failed:", e));
    await prisma.$disconnect();
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
      for (const f of failures) console.log(`  FAIL ${f}`);
      process.exit(1);
    }
  });

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
import { createTestOwner, type TestOwner } from "./lib/test-owner";
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

  console.log("\nStaff page data (GET /api/v1/users)");
  const secretOfHelper = String(byApprover.body?.secret ?? "");
  const helperAssignment = randomUUID();
  const helperBound = await call("/api/v1/devices/bind", { headers: auth(helper, secretOfHelper), body: { deviceKey: helper, barberId: BARBER, assignmentId: helperAssignment } });
  check("a second phone is bound to the same barber", helperBound.status === 200, `got ${helperBound.status}`);
  const staffNoOwner = await call("/api/v1/users", { method: "GET", headers: {} });
  check("without owner access it is 401 with no data", staffNoOwner.status === 401 && !("barbers" in (staffNoOwner.body ?? {})) && !("users" in (staffNoOwner.body ?? {})), `got ${staffNoOwner.status}`);
  const staffApproved = await call("/api/v1/users", { method: "GET", headers: auth(phone, secret1) });
  check("an approved phone's headers don't open it either (401)", staffApproved.status === 401, `got ${staffApproved.status}`);
  const staff = await call("/api/v1/users", { method: "GET", headers: { Cookie: await ownerCookie() } });
  const staffText = JSON.stringify(staff.body);
  type StaffBarber = { id: string; accountId: string | null; phones: { approved: number; revoked: number } };
  const staffBarbers = (staff.body?.barbers ?? []) as StaffBarber[];
  const countsOf = (list: StaffBarber[]) => list.find((b) => b.id === BARBER)?.phones;
  check("the owner gets 200 with users and barbers", staff.status === 200 && Array.isArray(staff.body?.users) && staffBarbers.length > 0, `got ${staff.status}`);
  check("a barber with no account is listed with accountId null", staffBarbers.find((b) => b.id === BARBER)?.accountId === null);
  check("the staff page carries counts only, no phone list", !("assignedPhones" in (staff.body ?? {})) && !("devices" in (staff.body ?? {})));
  check("two approved phones are assigned to that barber, none revoked", countsOf(staffBarbers)?.approved === 2 && countsOf(staffBarbers)?.revoked === 0, JSON.stringify(countsOf(staffBarbers)));
  check(
    "no credential material: no device key, secret, hash or password field",
    !staffText.includes(phone) && !staffText.includes(helper) && !staffText.includes(secret1) && !staffText.includes(secretOfHelper) &&
      !/secretHash|secret_hash|passwordHash|"deviceKey"|"secret"/.test(staffText)
  );

  console.log("\nPhones page data (GET /api/v1/devices)");
  const devicesNoOwner = await call("/api/v1/devices?barber=" + BARBER, { method: "GET", headers: {} });
  check("the filtered list is 401 without owner access, with no data", devicesNoOwner.status === 401 && !("devices" in (devicesNoOwner.body ?? {})), `got ${devicesNoOwner.status}`);
  const phonesList = await call(`/api/v1/devices?barber=${BARBER}`, { method: "GET", headers: { Cookie: await ownerCookie() } });
  const filtered = (phonesList.body?.devices ?? []) as { deviceKey: string; state: string; barberId: string | null }[];
  check("filtering by barber returns exactly that barber's two assigned phones", filtered.length === 2 && filtered.every((d) => d.state === "assigned" && d.barberId === BARBER) && filtered.some((d) => d.deviceKey === phone) && filtered.some((d) => d.deviceKey === helper), JSON.stringify(filtered.map((d) => d.state)));
  const otherBarber = await call(`/api/v1/devices?barber=${randomUUID()}`, { method: "GET", headers: { Cookie: await ownerCookie() } });
  check("another barber's filter returns none of them", ((otherBarber.body?.devices ?? []) as unknown[]).length === 0 && otherBarber.status === 200);
  const everything = await call("/api/v1/devices", { method: "GET", headers: { Cookie: await ownerCookie() } });
  check("with no filter every phone is listed, and the barber list is there for the filter", ((everything.body?.devices ?? []) as unknown[]).length >= 2 && ((everything.body?.barbers ?? []) as { id: string }[]).some((b) => b.id === BARBER));
  check("the phone list carries no secret or hash", !JSON.stringify(everything.body).includes(secret1) && !/secretHash|secret_hash/.test(JSON.stringify(everything.body)));
  const noRecordKey = newKey(); // an assignment whose phone has no device record
  const noRecordAssignment = randomUUID();
  await prisma.deviceAssignment.create({ data: { id: noRecordAssignment, deviceKey: noRecordKey, barberId: BARBER } });
  const withOrphan = await call(`/api/v1/devices?barber=${BARBER}`, { method: "GET", headers: { Cookie: await ownerCookie() } });
  const orphanList = (withOrphan.body?.orphanAssignments ?? []) as { id: string }[];
  check("an assignment with no phone record is reported on its own, not as a phone", orphanList.some((o) => o.id === noRecordAssignment) && !JSON.stringify(withOrphan.body?.devices).includes(noRecordKey));
  const staffWithOrphan = await call("/api/v1/users", { method: "GET", headers: { Cookie: await ownerCookie() } });
  check("...and never counted as an approved phone", countsOf((staffWithOrphan.body?.barbers ?? []) as StaffBarber[])?.approved === 2);
  await prisma.deviceAssignment.deleteMany({ where: { id: noRecordAssignment } });

  console.log("\nRe-approval replaces the secret and ends the assignment");
  const queuedOffline = sale(phone, assignmentId); // made on the phone before it was approved again
  const activeBefore = await prisma.deviceAssignment.count({ where: { deviceKey: phone, revokedAt: null } });
  const totalBefore = await prisma.deviceAssignment.count({ where: { deviceKey: phone } });
  const hashBefore = (await prisma.device.findUnique({ where: { deviceKey: phone } }))?.secretHash;
  check("before: the phone has one active assignment", activeBefore === 1 && totalBefore >= 1);
  const again = await approve(phone, approvalPin);
  const secret2 = String(again.body?.secret ?? "");
  check("approving again returns a new secret", again.status === 200 && secret2.length === 64 && secret2 !== secret1);
  const hashAfter = (await prisma.device.findUnique({ where: { deviceKey: phone } }))?.secretHash;
  check("the stored hash was replaced", !!hashAfter && hashAfter !== hashBefore && hashAfter.length === 64);
  const oldSecret = await sync(auth(phone, secret1), [sale(phone)]);
  check("the old secret stops working", oldSecret.status === 401, `got ${oldSecret.status}`);
  const newSecret = await sync(auth(phone, secret2), [sale(phone)]);
  check("the new secret works", newSecret.status === 200, `got ${newSecret.status}`);
  check("the phone's old assignment is ended", (await prisma.deviceAssignment.count({ where: { deviceKey: phone, revokedAt: null } })) === 0);
  const oldRow = await prisma.deviceAssignment.findUnique({ where: { id: assignmentId } });
  check("...as history: the row is kept with its barber and an end time", !!oldRow && oldRow.barberId === BARBER && oldRow.revokedAt !== null && (await prisma.deviceAssignment.count({ where: { deviceKey: phone } })) === totalBefore);
  const bindingNow = await call(`/api/v1/devices/binding?deviceKey=${phone}`, { method: "GET", headers: auth(phone, secret2) });
  check("the re-approved phone has no active binding (it does not inherit the old one)", bindingNow.status === 200 && bindingNow.body?.bound === false, JSON.stringify(bindingNow.body));
  check("another phone's assignment was not touched", (await prisma.deviceAssignment.findUnique({ where: { id: helperAssignment } }))?.revokedAt === null);
  const staffAfter = await call("/api/v1/users", { method: "GET", headers: { Cookie: await ownerCookie() } });
  check("the staff page now counts one approved phone for that barber", countsOf((staffAfter.body?.barbers ?? []) as StaffBarber[])?.approved === 1, JSON.stringify(countsOf((staffAfter.body?.barbers ?? []) as StaffBarber[])));
  const afterReapprove = await call("/api/v1/devices", { method: "GET", headers: { Cookie: await ownerCookie() } });
  const reapproved1 = ((afterReapprove.body?.devices ?? []) as { deviceKey: string; state: string; barberId: string | null }[]).find((d) => d.deviceKey === phone);
  check("the Phones page shows the re-approved phone as approved but not assigned", reapproved1?.state === "unassigned" && reapproved1.barberId === null, JSON.stringify(reapproved1));

  console.log("\nQueued offline sale across re-approval");
  const queuedSync = await sync(auth(phone, secret2), [queuedOffline]);
  check("a sale made under the ended assignment still syncs", queuedSync.status === 200 && (queuedSync.body?.syncedIds as string[] | undefined)?.includes(queuedOffline.id) === true, JSON.stringify(queuedSync.body));
  check("...attributed to that assignment's barber, as before", (await stored(queuedOffline.id))?.cashierId === BARBER && (await stored(queuedOffline.id))?.barberId === BARBER);

  console.log("\nBinding again uses the normal workflow");
  const secondAssignment = randomUUID();
  const rebound = await call("/api/v1/devices/bind", { headers: auth(phone, secret2), body: { deviceKey: phone, barberId: BARBER, assignmentId: secondAssignment } });
  check("a bind with no active binding needs no PIN and works", rebound.status === 200, `got ${rebound.status}`);
  const bindingAfter = await call(`/api/v1/devices/binding?deviceKey=${phone}`, { method: "GET", headers: auth(phone, secret2) });
  check("the phone is bound again, under the new assignment", bindingAfter.body?.bound === true && (bindingAfter.body?.assignment as { id?: string } | undefined)?.id === secondAssignment, JSON.stringify(bindingAfter.body));
  const newAssignmentSale = sale(phone, secondAssignment);
  const rebindSync = await sync(auth(phone, secret2), [newAssignmentSale]);
  check("a sale under the new assignment syncs", rebindSync.status === 200 && (rebindSync.body?.syncedIds as string[] | undefined)?.includes(newAssignmentSale.id) === true);
  const firstApprovalKey = newKey();
  const firstTime = await approve(firstApprovalKey, ownerPin);
  check("a first approval still works and ends nothing", firstTime.status === 200 && (await prisma.deviceAssignment.count({ where: { deviceKey: phone, revokedAt: null } })) === 1 && (await prisma.deviceAssignment.count({ where: { deviceKey: firstApprovalKey } })) === 0);

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
  // Revoking does not end the assignment (queued sales keep their barber), but the phone is no longer usable.
  check("revoking leaves its assignment record in place (history)", (await prisma.deviceAssignment.count({ where: { deviceKey: phone, revokedAt: null } })) === 1);
  const afterRevokeList = await call("/api/v1/devices", { method: "GET", headers: { Cookie: cookie } });
  const revokedRow = ((afterRevokeList.body?.devices ?? []) as { deviceKey: string; state: string; barberId: string | null }[]).find((d) => d.deviceKey === phone);
  check("the Phones page lists it as revoked, with its last barber as history", revokedRow?.state === "revoked" && revokedRow.barberId === BARBER, JSON.stringify(revokedRow));
  const staffRevoked = await call("/api/v1/users", { method: "GET", headers: { Cookie: cookie } });
  const revokedCounts = countsOf((staffRevoked.body?.barbers ?? []) as StaffBarber[]);
  check("the staff page counts it as revoked, not as an approved phone", revokedCounts?.approved === 1 && revokedCounts.revoked === 1, JSON.stringify(revokedCounts));
  const reapproved = await approve(phone, ownerPin);
  const secret3 = String(reapproved.body?.secret ?? "");
  const held = await sync(auth(phone, secret3), [afterRevoke]);
  check("approved again, the phone's held sale syncs", held.status === 200 && (held.body?.syncedIds as string[] | undefined)?.includes(afterRevoke.id) === true, `got ${held.status}`);
}

// Slice 19: owner routes take an owner account session (scripts/lib/test-owner.ts). Made only
// after the unlock checks above, which need "no owner account" to answer 401, not 409.
let testOwner: TestOwner | null = null;
async function ownerCookie() {
  testOwner ??= await createTestOwner(BASE, prisma, "approval");
  return testOwner.cookie;
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
    await testOwner?.cleanup().catch((e) => console.error("Test owner cleanup failed:", e));
    await cleanup().catch((e) => console.error("Cleanup failed:", e));
    await prisma.$disconnect();
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
      for (const f of failures) console.log(`  FAIL ${f}`);
      process.exit(1);
    }
  });

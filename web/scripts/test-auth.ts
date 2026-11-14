/**
 * Staff login (slice 19) against a running dev server: POST /api/v1/auth/login, logout and
 * session, the staff account routes (/api/v1/users), owner routes with an account session, the
 * PIN unlock once an owner account exists, and `userId` on synced sales.
 *
 *   npm run dev            (in another terminal; OWNER_PIN and OWNER_SESSION_SECRET in web/.env)
 *   npm run test:auth      (TEST_BASE_URL overrides http://localhost:3000)
 *
 * Uses throwaway barbers, accounts and an approved scratch phone; all are deleted at the end.
 * Each run sends 8 wrong passwords: the sign-in limiter locks every username after 30 in 15
 * minutes (shop-wide), so run it at most 3 times in 15 minutes; restarting the server clears it.
 */
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { prisma } from "../src/lib/prisma";
import { manilaToday, parseBusinessDate } from "../src/lib/business-date";
import { createTestDevices } from "./lib/test-devices";
import { createTestOwner, type TestOwner } from "./lib/test-owner";

loadEnvConfig(process.cwd());

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const RUN = randomUUID().slice(0, 8);
const SERVICE_ID = "10000000-0000-0000-0000-000000000001"; // seeded Haircut
const devices = createTestDevices(BASE);
const BARBER = {
  A: { id: `test-auth-A-${RUN}`, name: `Auth A ${RUN}` },
  B: { id: `test-auth-B-${RUN}`, name: `Auth B ${RUN}` },
  C: { id: `test-auth-C-${RUN}`, name: `Auth C ${RUN}` }, // deactivated mid-test
};
const PASSWORD = `pw-${RUN}-secret`;
const txIds: string[] = [];
const userIds: string[] = [];
let owner: TestOwner | null = null;
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

async function call(method: string, path: string, opts: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}), ...(opts.cookie ? { Cookie: opts.cookie } : {}) },
    body: opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body),
  });
  const setCookie = res.headers.get("set-cookie") ?? "";
  return { status: res.status, body: (await res.json().catch(() => null)) as Json, setCookie, cookie: setCookie.split(";")[0] };
}

const login = (username: string, password: string, deviceKey?: string) =>
  call("POST", "/api/v1/auth/login", { body: { username, password, ...(deviceKey ? { deviceKey } : {}) }, headers: deviceKey ? devices.headers(deviceKey) : {} });

const session = (cookie: string, query = "", headers: Record<string, string> = {}) =>
  call("GET", `/api/v1/auth/session${query}`, { cookie, headers });

async function createAccount(body: Record<string, unknown>) {
  const res = await call("POST", "/api/v1/users", { body, cookie: owner!.cookie });
  const id = (res.body?.user as { id?: string } | undefined)?.id;
  if (id) userIds.push(id);
  return { ...res, id: id ?? "" };
}

const lastSignIn = async (id: string) => (await prisma.user.findUnique({ where: { id }, select: { lastSignInAt: true } }))?.lastSignInAt?.getTime() ?? null;

function sale(deviceKey: string, assignmentId: string, barberId: string, userId?: unknown) {
  const id = randomUUID();
  txIds.push(id);
  return { id, barberId, serviceId: SERVICE_ID, totalAmount: 250, transactionTime: new Date().toISOString(), deviceKey, assignmentId, ...(userId === undefined ? {} : { userId }) };
}

async function main() {
  console.log(`Staff login against ${BASE} (run ${RUN})`);
  const health = await fetch(`${BASE}/api/v1/health`).catch(() => null);
  if (!health?.ok) throw new Error(`Dev server not reachable at ${BASE}. Start it with \`npm run dev\`.`);

  await prisma.barber.createMany({ data: Object.values(BARBER).map((b) => ({ id: b.id, fullName: b.name, commissionRate: 0.5, isActive: true })) });
  owner = await createTestOwner(BASE, prisma, "auth");
  const phone = await devices.approve();
  const otherPhone = await devices.approve();

  // ── Staff accounts ────────────────────────────────────────────────────────
  console.log("\nStaff accounts (/api/v1/users)");
  check("GET without an owner session is 401", (await call("GET", "/api/v1/users")).status === 401);
  const accA = await createAccount({ role: "BARBER", barberId: BARBER.A.id, username: `T-A-${RUN}`, password: PASSWORD });
  check("create a barber account (201)", accA.status === 201 && !!accA.id, `got ${accA.status} ${JSON.stringify(accA.body)}`);
  check("...username stored lower-case, name from the barber", (accA.body?.user as { username?: string; name?: string })?.username === `t-a-${RUN}` && (accA.body?.user as { name?: string })?.name === BARBER.A.name);
  check("...the answer carries no password or hash", !JSON.stringify(accA.body).includes(PASSWORD) && !JSON.stringify(accA.body).includes("scrypt$"));
  const accB = await createAccount({ role: "BARBER", barberId: BARBER.B.id, username: `t-b-${RUN}`, password: PASSWORD });
  await createAccount({ role: "BARBER", barberId: BARBER.C.id, username: `t-c-${RUN}`, password: PASSWORD });
  check("a second account for the same barber is 409", (await createAccount({ role: "BARBER", barberId: BARBER.A.id, username: `t-a2-${RUN}`, password: PASSWORD })).status === 409);
  check("a taken username is 409", (await createAccount({ role: "OWNER", name: "Dup", username: `t-b-${RUN}`, password: PASSWORD })).status === 409);
  check("a 7-character password is 400", (await createAccount({ role: "OWNER", name: "Short", username: `t-s-${RUN}`, password: "1234567" })).status === 400);
  check("a username with a space is 400", (await createAccount({ role: "OWNER", name: "Bad", username: "has space", password: PASSWORD })).status === 400);
  check("an owner account with a barber is 400", (await createAccount({ role: "OWNER", name: "X", barberId: BARBER.A.id, username: `t-x-${RUN}`, password: PASSWORD })).status === 400);
  const plain = await fetch(`${BASE}/api/v1/users`, { method: "POST", headers: { "Content-Type": "text/plain", Cookie: owner.cookie }, body: "{}" });
  check("a non-JSON write is 415", plain.status === 415, `got ${plain.status}`);
  const listed = await call("GET", "/api/v1/users", { cookie: owner.cookie });
  check("the list shows the accounts, never a hash", listed.status === 200 && JSON.stringify(listed.body).includes(`t-a-${RUN}`) && !JSON.stringify(listed.body).includes("scrypt$") && !JSON.stringify(listed.body).includes("passwordHash"));

  // ── Sign-in ───────────────────────────────────────────────────────────────
  console.log("\nSign-in");
  const before = await lastSignIn(accA.id);
  const okA = await login(`T-A-${RUN}`, PASSWORD, phone);
  check("right password on an approved phone: 200 (username case ignored)", okA.status === 200 && (okA.body?.account as { barberId?: string })?.barberId === BARBER.A.id, `got ${okA.status} ${JSON.stringify(okA.body)}`);
  check("...sets ruzzco_session, HttpOnly, SameSite=Strict", okA.cookie.startsWith("ruzzco_session=") && /HttpOnly/i.test(okA.setCookie) && /SameSite=Strict/i.test(okA.setCookie), okA.setCookie);
  const endOfDay = parseBusinessDate(manilaToday())!.end.toISOString();
  check("...a barber session ends at midnight Manila", okA.body?.expiresAt === endOfDay, String(okA.body?.expiresAt));
  check("...and records the sign-in time", (await lastSignIn(accA.id)) !== null && (await lastSignIn(accA.id)) !== before);
  check("GET /api/v1/auth/session with it: the account", (await session(okA.cookie)).status === 200);

  const wrong = await login(`t-a-${RUN}`, "wrong-password", phone);
  const unknown = await login(`t-nobody-${RUN}`, "wrong-password", phone);
  check("wrong password: 401 WRONG_PASSWORD", wrong.status === 401 && wrong.body?.code === "WRONG_PASSWORD", `got ${wrong.status}`);
  check("unknown username: the same status, code and message", unknown.status === wrong.status && unknown.body?.code === wrong.body?.code && unknown.body?.error === wrong.body?.error);
  check("...and no cookie either way", !wrong.cookie && !unknown.cookie);

  const noHeaders = await call("POST", "/api/v1/auth/login", { body: { username: `t-a-${RUN}`, password: PASSWORD, deviceKey: phone } });
  check("barber without approved-phone headers: 401 DEVICE_NOT_APPROVED", noHeaders.status === 401 && noHeaders.body?.code === "DEVICE_NOT_APPROVED" && !noHeaders.cookie, `got ${noHeaders.status}`);

  const ownerOnPos = await login(owner.username, owner.password, phone);
  check("owner account on the POS sign-in: 403 OWNER_ON_POS", ownerOnPos.status === 403 && ownerOnPos.body?.code === "OWNER_ON_POS" && !ownerOnPos.cookie, `got ${ownerOnPos.status}`);
  const ownerOk = await login(owner.username, owner.password);
  const ownerExpiry = Date.parse(String(ownerOk.body?.expiresAt));
  check("owner account on the PC: 200, a 12-hour session", ownerOk.status === 200 && Math.abs(ownerExpiry - (Date.now() + 12 * 3600_000)) < 120_000, `got ${ownerOk.status}`);

  // ── Case 3: a phone assigned to another barber ────────────────────────────
  console.log("\nCase 3: phone assigned to another barber");
  const assignmentB = randomUUID();
  const bound = await call("POST", "/api/v1/devices/bind", { headers: devices.headers(otherPhone), body: { deviceKey: otherPhone, barberId: BARBER.B.id, assignmentId: assignmentB } });
  check("(setup) the second phone is bound to B", bound.status === 200, `got ${bound.status}`);
  const signInBefore = await lastSignIn(accA.id);
  const refused = await login(`t-a-${RUN}`, PASSWORD, otherPhone);
  check("A on B's phone: 403 PHONE_ASSIGNED naming B", refused.status === 403 && refused.body?.code === "PHONE_ASSIGNED" && refused.body?.error === `This phone is assigned to ${BARBER.B.name}.`, `got ${refused.status} ${JSON.stringify(refused.body)}`);
  const active = await prisma.deviceAssignment.findMany({ where: { deviceKey: otherPhone, revokedAt: null } });
  check("...nothing written: no cookie, no sign-in time, the binding unchanged", !refused.cookie && (await lastSignIn(accA.id)) === signInBefore && active.length === 1 && active[0].id === assignmentB);
  const okB = await login(`t-b-${RUN}`, PASSWORD, otherPhone);
  check("B on B's phone: 200", okB.status === 200, `got ${okB.status}`);

  // ── Owner routes ──────────────────────────────────────────────────────────
  console.log("\nOwner routes");
  check("an owner account session opens an owner route", (await call("GET", "/api/v1/devices", { cookie: owner.cookie })).status === 200);
  check("a barber session does not (401)", (await call("GET", "/api/v1/devices", { cookie: okA.cookie })).status === 401);
  check("nor does it open the staff accounts", (await call("GET", "/api/v1/users", { cookie: okB.cookie })).status === 401);
  const pin = process.env.OWNER_PIN ?? "";
  if (pin) {
    const unlock = await call("POST", "/api/v1/owner/unlock", { body: { pin }, headers: { "x-forwarded-for": `test-auth-${RUN}` } });
    check("PIN unlock once an owner account exists: 409 OWNER_ACCOUNT_EXISTS, no cookie", unlock.status === 409 && unlock.body?.code === "OWNER_ACCOUNT_EXISTS" && !unlock.cookie, `got ${unlock.status}`);
  }

  // ── Password reset and deactivation ───────────────────────────────────────
  console.log("\nPassword reset");
  const changedAt = (okA.body?.account as { passwordChangedAt?: string }).passwordChangedAt ?? "";
  const reset = await call("PATCH", `/api/v1/users/${accA.id}`, { body: { password: `${PASSWORD}-new` }, cookie: owner.cookie });
  check("the owner resets A's password", reset.status === 200, `got ${reset.status}`);
  const afterReset = await session(okA.cookie);
  check("A's session now answers 401 PASSWORD_CHANGED", afterReset.status === 401 && afterReset.body?.reason === "PASSWORD_CHANGED", `got ${afterReset.status} ${JSON.stringify(afterReset.body)}`);
  const offlineCheck = await session("", `?userId=${accA.id}&passwordChangedAt=${encodeURIComponent(changedAt)}`, devices.headers(phone));
  check("a phone signed in offline (no cookie) learns PASSWORD_CHANGED too", offlineCheck.status === 401 && offlineCheck.body?.reason === "PASSWORD_CHANGED", JSON.stringify(offlineCheck.body));
  const unapprovedCheck = await session("", `?userId=${accA.id}&passwordChangedAt=${encodeURIComponent(changedAt)}`);
  check("...but only from an approved phone (otherwise NONE)", unapprovedCheck.status === 401 && unapprovedCheck.body?.reason === "NONE");
  check("the old password is refused", (await login(`t-a-${RUN}`, PASSWORD, phone)).status === 401);
  const fresh = await login(`t-a-${RUN}`, `${PASSWORD}-new`, phone);
  check("the new one works", fresh.status === 200, `got ${fresh.status}`);
  const freshChangedAt = (fresh.body?.account as { passwordChangedAt?: string }).passwordChangedAt ?? "";
  const sameCheck = await session("", `?userId=${accA.id}&passwordChangedAt=${encodeURIComponent(freshChangedAt)}`, devices.headers(phone));
  check("...and the phone's account check then answers NONE (nothing changed)", sameCheck.body?.reason === "NONE");

  console.log("\nDeactivation");
  const okC = await login(`t-c-${RUN}`, PASSWORD, phone).catch(() => null);
  // A's phone is unbound, so C may sign in on it; only the session is needed here.
  await prisma.barber.update({ where: { id: BARBER.C.id }, data: { isActive: false } });
  check("a deactivated barber: sign-in 403 INACTIVE", (await login(`t-c-${RUN}`, PASSWORD, phone)).body?.code === "INACTIVE");
  if (okC?.cookie) check("...and the session already open answers 401 INACTIVE", (await session(okC.cookie)).body?.reason === "INACTIVE");
  const deactivated = await call("PATCH", `/api/v1/users/${accB.id}`, { body: { isActive: false }, cookie: owner.cookie });
  check("the owner deactivates B's account", deactivated.status === 200 && (deactivated.body?.user as { isActive?: boolean }).isActive === false);
  const inactive = await login(`t-b-${RUN}`, PASSWORD, otherPhone);
  check("a deactivated account: 403 INACTIVE, no cookie", inactive.status === 403 && inactive.body?.code === "INACTIVE" && !inactive.cookie, `got ${inactive.status}`);
  check("...and B's open session answers 401 INACTIVE", (await session(okB.cookie)).body?.reason === "INACTIVE");
  const reactivated = await call("PATCH", `/api/v1/users/${accB.id}`, { body: { isActive: true }, cookie: owner.cookie });
  check("reactivated, B signs in again", reactivated.status === 200 && (await login(`t-b-${RUN}`, PASSWORD, otherPhone)).status === 200);

  console.log("\nLast owner");
  const second = await createAccount({ role: "OWNER", name: `Second owner ${RUN}`, username: `t-o2-${RUN}`, password: PASSWORD });
  const offSecond = await call("PATCH", `/api/v1/users/${second.id}`, { body: { isActive: false }, cookie: owner.cookie });
  check("an owner account can be deactivated while another is active", offSecond.status === 200, `got ${offSecond.status}`);
  const otherOwners = await prisma.user.count({ where: { id: { not: owner.id }, role: "OWNER", isActive: true, username: { not: null }, passwordHash: { not: null } } });
  if (otherOwners === 0) {
    const last = await call("PATCH", `/api/v1/users/${owner.id}`, { body: { isActive: false }, cookie: owner.cookie });
    check("the last active owner account can't be deactivated: 409 LAST_OWNER", last.status === 409 && last.body?.code === "LAST_OWNER", `got ${last.status}`);
  } else {
    console.log("  - last-owner case skipped: this database has another active owner account");
  }

  // ── Lockout ───────────────────────────────────────────────────────────────
  console.log("\nWrong-password limit");
  const accL = await createAccount({ role: "OWNER", name: `Locked ${RUN}`, username: `t-l-${RUN}`, password: PASSWORD });
  const statuses: number[] = [];
  for (let i = 0; i < 5; i++) statuses.push((await login(`t-l-${RUN}`, "wrong-password")).status);
  check("5 wrong passwords for one username each answer 401", accL.status === 201 && statuses.every((s) => s === 401), statuses.join(","));
  const refusedRight = await login(`t-l-${RUN}`, PASSWORD);
  check("then even the right password is refused: 429 TOO_MANY", refusedRight.status === 429 && refusedRight.body?.code === "TOO_MANY" && !refusedRight.cookie, `got ${refusedRight.status}`);
  const otherUser = await login(owner.username, owner.password);
  check("another username is not locked", otherUser.status === 200, `got ${otherUser.status}`);

  // ── userId on sales ───────────────────────────────────────────────────────
  console.log("\nuserId on synced sales (information only)");
  const valid = sale(otherPhone, assignmentB, BARBER.B.id, accA.id); // A's account on B's phone
  const unknownUser = sale(otherPhone, assignmentB, BARBER.B.id, randomUUID());
  const malformed = sale(otherPhone, assignmentB, BARBER.B.id, "not-a-uuid");
  const none = sale(otherPhone, assignmentB, BARBER.B.id);
  const synced = await call("POST", "/api/v1/transactions/sync", { headers: devices.headers(otherPhone), body: { transactions: [valid, unknownUser, malformed, none] } });
  const syncedIds = (synced.body?.syncedIds ?? []) as string[];
  check("all four sales sync, none rejected", synced.status === 200 && [valid, unknownUser, malformed, none].every((t) => syncedIds.includes(t.id)) && ((synced.body?.rejected as unknown[]) ?? []).length === 0, JSON.stringify(synced.body));
  const rows = new Map((await prisma.transaction.findMany({ where: { id: { in: [valid.id, unknownUser.id, malformed.id, none.id] } }, select: { id: true, userId: true, barberId: true, cashierId: true } })).map((r) => [r.id, r]));
  check("a valid userId is stored as sent, even from another barber's account", rows.get(valid.id)?.userId === accA.id);
  check("an unknown userId is stored as null", rows.get(unknownUser.id)?.userId === null);
  check("a malformed userId is dropped (null), the sale kept", rows.get(malformed.id)?.userId === null);
  check("every sale keeps the assignment's barber and cashier", [...rows.values()].every((r) => r.barberId === BARBER.B.id && r.cashierId === BARBER.B.id));

  // ── Logout ────────────────────────────────────────────────────────────────
  const out = await call("POST", "/api/v1/auth/logout", { body: {}, cookie: fresh.cookie });
  check("logout clears the cookie", out.status === 200 && /^ruzzco_session=;/.test(out.setCookie) && /Max-Age=0/i.test(out.setCookie), out.setCookie);
}

async function cleanup() {
  await prisma.transaction.deleteMany({ where: { OR: [{ id: { in: txIds } }, { barberId: { in: Object.values(BARBER).map((b) => b.id) } }] } });
  await prisma.user.deleteMany({ where: { OR: [{ id: { in: userIds } }, { barberId: { in: Object.values(BARBER).map((b) => b.id) } }] } });
  await prisma.deviceAssignment.deleteMany({ where: { OR: [{ deviceKey: { in: devices.keys() } }, { barberId: { in: Object.values(BARBER).map((b) => b.id) } }] } });
  await devices.cleanup(prisma);
  await prisma.barber.deleteMany({ where: { id: { in: Object.values(BARBER).map((b) => b.id) } } });
}

main()
  .catch((error) => {
    failures.push(`crashed: ${error instanceof Error ? error.message : String(error)}`);
    console.error(error);
  })
  .finally(async () => {
    await owner?.cleanup().catch((e) => console.error("Test owner cleanup failed:", e));
    await cleanup().catch((e) => console.error("Cleanup failed:", e));
    await prisma.$disconnect();
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
      for (const f of failures) console.log(`  FAIL ${f}`);
      process.exit(1);
    }
  });

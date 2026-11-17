/**
 * Authorization audit (slice 19 §7.3, §7.8, §7.10) against a running dev server:
 *
 *   - the matrix in scripts/lib/authz-matrix.ts covers every route.ts and exported method in
 *     src/app/api, and names nothing that doesn't exist;
 *   - every owner, phone and phone-or-owner route refuses each credential it must refuse (none,
 *     a made-up device secret, a revoked phone, an approved phone, a barber session, an approved
 *     phone with a barber session, the owner session on device routes, a PIN cookie once an owner
 *     account exists) with 401 and a body that carries no data, and nothing is written;
 *   - allowed calls answer with their data (the owner gets owner data with no phone headers; the
 *     phone gets its own binding, the catalog and only its own barber's QRs);
 *   - an approved phone asking about another phone's key, sale or barber gets nothing;
 *   - role-based pages (slice 19b correction): a barber session is redirected to /pos from /,
 *     /about and every owner page before anything renders, even with a PIN cookie beside it, and
 *     still opens /pos and /shift-log; the owner opens / and every owner page without phone
 *     headers; barber sign-in clears a leftover PIN cookie; an owner can't sign in on the POS;
 *   - request restrictions: wrong content types on cookie-authenticated writes (415, nothing
 *     changes), no CORS grant to a foreign Origin, cookie attributes, and C1 on forecast/refresh.
 *
 *   npm run dev                  (in another terminal; OWNER_PIN and OWNER_SESSION_SECRET in web/.env)
 *   npm run test:authz           (TEST_BASE_URL overrides http://localhost:3000)
 *
 * Scratch barbers, phones, accounts and sales (business date 2000-02-11), removed at the end. The
 * suite can't run a browser's SameSite logic; that part rests on the threat model in §7.8.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { loadEnvConfig } from "@next/env";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/passwords";
import { ownerCookieValue } from "../src/lib/owner-access";
import { createTestOwner, type TestOwner } from "./lib/test-owner";
import { createTestDevices } from "./lib/test-devices";
import { AUTHZ_MATRIX, type MatrixRow, type Method } from "./lib/authz-matrix";

loadEnvConfig(process.cwd());

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const RUN = randomUUID().slice(0, 8);
const SERVICE_ID = "10000000-0000-0000-0000-000000000001"; // seeded Haircut
const DATE = "2000-02-11";
const AT = "2000-02-11T04:00:00.000Z"; // noon in Manila
const BARBER_A = { id: `test-authz-a-${RUN}`, fullName: `Test Barber AuthzA ${RUN}` };
const BARBER_B = { id: `test-authz-b-${RUN}`, fullName: `Test Barber AuthzB ${RUN}` };
const SAMPLE = new Uint8Array(readFileSync(join(process.cwd(), "scripts", "fixtures", "sample-qr.png")));
const PASSWORD = randomBytes(12).toString("hex");
const devices = createTestDevices(BASE);

let passed = 0;
const failures: string[] = [];
const txIds: string[] = [];
const userIds: string[] = [];
let testOwner: TestOwner | null = null;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

type Headers = Record<string, string>;
type Answer = { status: number; text: string; json: Record<string, unknown> | null; headers: globalThis.Headers };

async function call(method: string, path: string, opts: { headers?: Headers; body?: string | Uint8Array } = {}): Promise<Answer> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: opts.headers ?? {},
    ...(opts.body === undefined ? {} : { body: typeof opts.body === "string" ? opts.body : Buffer.from(opts.body) }),
    redirect: "manual",
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, text, json, headers: res.headers };
}

// ── Matrix coverage ─────────────────────────────────────────────────────────

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

function exportedMethods(source: string): string[] {
  const found = new Set<string>();
  for (const m of source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) found.add(m[1]);
  for (const m of source.matchAll(/export\s+(?:const|let|var)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) found.add(m[1]);
  for (const m of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const name of m[1].split(",").map((n) => n.trim().split(/\s+as\s+/).pop()!.trim())) {
      if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(name)) found.add(name);
    }
  }
  return [...found];
}

function checkMatrixCoverage() {
  console.log("M1 the matrix covers every route and method");
  const apiDir = join(process.cwd(), "src", "app", "api");
  const actual = new Set<string>();
  for (const file of routeFiles(apiDir)) {
    const route = relative(apiDir, file).split(sep).slice(0, -1).join("/");
    for (const method of exportedMethods(readFileSync(file, "utf8"))) actual.add(`${method} ${route}`);
  }
  const listed = new Set(AUTHZ_MATRIX.map((r) => `${r.method} ${r.route}`));
  const missing = [...actual].filter((k) => !listed.has(k)).sort();
  const extra = [...listed].filter((k) => !actual.has(k)).sort();
  check(`every exported handler has a row (${actual.size} handlers)`, missing.length === 0, `no row for: ${missing.join(", ")}`);
  check("every row names a handler that exists", extra.length === 0, `not found: ${extra.join(", ")}`);
  check("no duplicate rows", listed.size === AUTHZ_MATRIX.length);
}

// ── Scratch data ────────────────────────────────────────────────────────────

let phoneA = "";
let phoneB = "";
let phoneRevoked = "";
const assignA = randomUUID();
const assignB = randomUUID();
const assignR = randomUUID();
let saleA = "";
let saleB = "";
let barberUserId = "";
let ownerCookie = "";
let barberCookie = "";
let pinCookie = "";
let pinCookieReal = false;

function sale(deviceKey: string, assignmentId: string, barberId: string) {
  const id = randomUUID();
  txIds.push(id);
  return {
    id, barberId, serviceId: SERVICE_ID, totalAmount: 250, listPrice: 250, amountPaid: 250,
    paymentMethod: "CASH", transactionTime: AT, assignmentId, deviceKey,
  };
}

async function syncAs(deviceKey: string, sales: unknown[]) {
  return call("POST", "/api/v1/transactions/sync", { headers: devices.headers(deviceKey), body: JSON.stringify({ transactions: sales }) });
}

async function setup() {
  // The PIN cookie: a real one issued before any owner account exists, when this database has
  // none; otherwise a correctly signed one (the server can't tell them apart).
  const before = await call("GET", "/api/v1/auth/session");
  if (before.json?.ownerSignIn === "PIN" && process.env.OWNER_PIN) {
    const plain = await call("POST", "/api/v1/owner/unlock", {
      headers: { "Content-Type": "application/json", "x-forwarded-for": `authz-${RUN}` },
      body: JSON.stringify({ pin: process.env.OWNER_PIN }),
    });
    const secure = await call("POST", "/api/v1/owner/unlock", {
      headers: { "Content-Type": "application/json", "x-forwarded-for": `authz-${RUN}`, "x-forwarded-proto": "https" },
      body: JSON.stringify({ pin: process.env.OWNER_PIN }),
    });
    checkCookie("owner/unlock", plain.headers.get("set-cookie") ?? "", secure.headers.get("set-cookie") ?? "");
    pinCookie = (plain.headers.get("set-cookie") ?? "").split(";")[0];
    pinCookieReal = pinCookie.startsWith("ruzzco_owner_access=");
  }
  if (!pinCookieReal) {
    console.log("  - owner/unlock cookie attributes skipped: this database already has an active owner account (409)");
    pinCookie = `ruzzco_owner_access=${ownerCookieValue()}`;
  }

  testOwner = await createTestOwner(BASE, prisma, "authz");
  ownerCookie = testOwner.cookie;

  for (const barber of [BARBER_A, BARBER_B]) await prisma.barber.create({ data: { ...barber, commissionRate: 0.5 } });

  phoneA = await devices.approve();
  phoneB = await devices.approve();
  phoneRevoked = await devices.approve();
  const bind = (deviceKey: string, barberId: string, assignmentId: string) =>
    call("POST", "/api/v1/devices/bind", { headers: devices.headers(deviceKey), body: JSON.stringify({ deviceKey, barberId, assignmentId }) });
  for (const [key, barber, id] of [[phoneA, BARBER_A.id, assignA], [phoneB, BARBER_B.id, assignB], [phoneRevoked, BARBER_A.id, assignR]] as const) {
    const res = await bind(key, barber, id);
    if (res.status !== 200) throw new Error(`setup bind failed: HTTP ${res.status} ${res.text}`);
  }

  const a = sale(phoneA, assignA, BARBER_A.id);
  const b = sale(phoneB, assignB, BARBER_B.id);
  const syncedA = await syncAs(phoneA, [a]);
  const syncedB = await syncAs(phoneB, [b]);
  if (!(syncedA.json?.syncedIds as string[] | undefined)?.includes(a.id) || !(syncedB.json?.syncedIds as string[] | undefined)?.includes(b.id)) {
    throw new Error(`setup sync failed: ${syncedA.text} ${syncedB.text}`);
  }
  saleA = a.id;
  saleB = b.id;

  const revoked = await call("POST", "/api/v1/devices/revoke", { headers: { "Content-Type": "application/json", Cookie: ownerCookie }, body: JSON.stringify({ deviceKey: phoneRevoked }) });
  if (revoked.status !== 200) throw new Error(`setup revoke failed: HTTP ${revoked.status}`);

  for (const barber of [BARBER_A.id, BARBER_B.id]) {
    const up = await call("PUT", `/api/v1/payment-qrs/${encodeURIComponent(barber)}/GCASH`, { headers: { "Content-Type": "image/png", Cookie: ownerCookie }, body: SAMPLE });
    if (up.status !== 200) throw new Error(`setup QR upload failed: HTTP ${up.status}`);
  }

  const user = await prisma.user.create({
    data: {
      name: `Test barber (authz ${RUN})`, role: "BARBER", barberId: BARBER_A.id, username: `t-authz-${RUN}`,
      passwordHash: await hashPassword(PASSWORD), passwordChangedAt: new Date(),
    },
    select: { id: true },
  });
  barberUserId = user.id;
  userIds.push(user.id);
  const login = await call("POST", "/api/v1/auth/login", {
    headers: devices.headers(phoneA),
    body: JSON.stringify({ username: `t-authz-${RUN}`, password: PASSWORD, deviceKey: phoneA }),
  });
  barberCookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  if (login.status !== 200 || !barberCookie.startsWith("ruzzco_session=")) throw new Error(`setup barber sign-in failed: HTTP ${login.status} ${login.text}`);
}

// ── Credentials ─────────────────────────────────────────────────────────────

type Credential = { name: string; headers: () => Headers };

const json: Headers = { "Content-Type": "application/json" };
const CREDENTIALS: Record<string, Credential> = {
  none: { name: "no credentials", headers: () => ({ ...json }) },
  madeUp: {
    name: "a made-up device secret (localStorage edited)",
    headers: () => ({ ...json, "X-Ruzzco-Device": phoneA, Authorization: `Bearer ${randomBytes(32).toString("hex")}` }),
  },
  revoked: { name: "a revoked phone", headers: () => devices.headers(phoneRevoked) },
  phone: { name: "an approved phone", headers: () => devices.headers(phoneA) },
  barber: { name: "a barber session", headers: () => ({ ...json, Cookie: barberCookie }) },
  barberOnPhone: { name: "a barber session on an approved phone", headers: () => ({ ...devices.headers(phoneA), Cookie: barberCookie }) },
  owner: { name: "the owner account session alone", headers: () => ({ ...json, Cookie: ownerCookie }) },
  pin: { name: "a PIN cookie once an owner account exists", headers: () => ({ ...json, Cookie: pinCookie }) },
};

const REFUSED: Record<"owner" | "phone" | "phone-or-owner", (keyof typeof CREDENTIALS)[]> = {
  owner: ["none", "madeUp", "revoked", "phone", "barber", "barberOnPhone", "pin"],
  phone: ["none", "madeUp", "revoked", "barber", "owner", "pin"],
  "phone-or-owner": ["none", "madeUp", "revoked", "barber", "pin"],
};

// ── Requests per route ──────────────────────────────────────────────────────

type Probe = { path: string; body?: string | Uint8Array; contentType?: string; after?: () => Promise<string | null> };

/** A request that would change or reveal something if it were accepted. */
function refusedProbe(row: MatrixRow): Probe | null {
  const qr = (barber: string, method: string) => `/api/v1/payment-qrs/${encodeURIComponent(barber)}/${method}`;
  const key = `${row.method} ${row.route}`;
  switch (key) {
    case "POST v1/transactions/sync": {
      const s = sale(phoneA, assignA, BARBER_A.id);
      return {
        path: "/api/v1/transactions/sync",
        body: JSON.stringify({ transactions: [s] }),
        after: async () => ((await prisma.transaction.count({ where: { id: s.id } })) === 0 ? null : "the sale was inserted"),
      };
    }
    case "POST v1/devices/bind": {
      const id = randomUUID();
      return {
        path: "/api/v1/devices/bind",
        body: JSON.stringify({ deviceKey: phoneA, barberId: BARBER_A.id, assignmentId: id }),
        after: async () => ((await prisma.deviceAssignment.count({ where: { id } })) === 0 ? null : "an assignment was written"),
      };
    }
    case "GET v1/devices/binding": return { path: `/api/v1/devices/binding?deviceKey=${encodeURIComponent(phoneA)}` };
    case "GET v1/devices": return { path: "/api/v1/devices" };
    case "POST v1/devices/revoke": return { path: "/api/v1/devices/revoke", body: JSON.stringify({ deviceKey: phoneB }) };
    case "GET v1/users": return { path: "/api/v1/users" };
    case "POST v1/users":
      return { path: "/api/v1/users", body: JSON.stringify({ name: "Intruder", role: "OWNER", username: `t-intr-${RUN}`, password: PASSWORD }) };
    case "PATCH v1/users/[id]": return { path: `/api/v1/users/${barberUserId}`, body: JSON.stringify({ isActive: false }) };
    case "GET v1/reports/payouts": return { path: `/api/v1/reports/payouts?date=${DATE}&commissionBase=LIST_PRICE` };
    case "POST v1/reports/payouts":
      return { path: "/api/v1/reports/payouts", body: JSON.stringify({ id: randomUUID(), barberId: BARBER_A.id, date: DATE, amount: 10, method: "CASH" }) };
    case "GET v1/reports/reconciliation": return { path: `/api/v1/reports/reconciliation?date=${DATE}` };
    case "POST v1/reports/reconciliation":
      return { path: "/api/v1/reports/reconciliation", body: JSON.stringify({ date: DATE, countedCash: 1, pettyCash: 0, notes: "authz" }) };
    case "GET v1/reports/ledger-summary": return { path: `/api/v1/reports/ledger-summary?date=${DATE}&period=day&commissionBase=LIST_PRICE` };
    case "GET v1/reports/custom-amounts": return { path: `/api/v1/reports/custom-amounts?date=${DATE}` };
    case "GET v1/reports/payout-history": return { path: `/api/v1/reports/payout-history?from=${DATE}&to=${DATE}` };
    case "GET v1/reports/sales": return { path: `/api/v1/reports/sales?from=${DATE}&to=${DATE}` };
    case "POST v1/reports/time-review": return { path: "/api/v1/reports/time-review", body: JSON.stringify({ transactionId: saleA, choice: "RECEIVED" }) };
    case "GET v1/forecast": return { path: "/api/v1/forecast" };
    case "POST v1/forecast/refresh": return { path: "/api/v1/forecast/refresh", body: "{}" };
    case "GET v1/payment-qrs/[barberId]/[method]": return { path: qr(BARBER_A.id, "GCASH") };
    case "PUT v1/payment-qrs/[barberId]/[method]": return { path: qr(BARBER_A.id, "MAYA"), body: SAMPLE, contentType: "image/png" };
    case "DELETE v1/payment-qrs/[barberId]/[method]": return { path: qr(BARBER_A.id, "GCASH") };
    case "GET v1/payment-qrs": return { path: "/api/v1/payment-qrs" };
    case "GET v1/catalog": return { path: "/api/v1/catalog" };
    case "POST v1/payments/qrph":
      return {
        path: "/api/v1/payments/qrph",
        body: JSON.stringify({ transactionId: saleA }),
        after: async () => ((await prisma.gatewayPayment.count({ where: { transactionId: saleA } })) === 0 ? null : "a charge was stored"),
      };
    case "GET v1/payments/qrph/check": return { path: `/api/v1/payments/qrph/check?transactionId=${saleA}` };
    case "POST v1/payments/qrph/check": return { path: "/api/v1/payments/qrph/check", body: JSON.stringify({ transactionId: saleA }) };
    default: return null;
  }
}

// Anything that would identify the shop's people or money. A refusal carries only success/code/error.
function leaks(answer: Answer): string | null {
  if (!answer.json) return `not JSON: ${answer.text.slice(0, 80)}`;
  const extra = Object.keys(answer.json).filter((k) => !["success", "code", "error"].includes(k));
  if (extra.length) return `extra fields: ${extra.join(",")}`;
  const secrets = [BARBER_A.id, BARBER_B.id, BARBER_A.fullName, BARBER_B.fullName, assignA, assignB, saleA, saleB, phoneB, "commissionRate"];
  const found = secrets.filter((s) => s && answer.text.includes(s));
  return found.length ? `mentions ${found.join(",")}` : null;
}

async function stateDigest() {
  const counts = await Promise.all([
    prisma.transaction.count(), prisma.deviceAssignment.count(), prisma.device.count(), prisma.payoutEntry.count(),
    prisma.dailyPayoutLedger.count(), prisma.shiftReconciliation.count(), prisma.user.count(), prisma.barberPaymentQr.count(),
    prisma.gatewayPayment.count(), prisma.forecastRun.count(),
  ]);
  const barbers = [BARBER_A.id, BARBER_B.id];
  const touched = await Promise.all([
    prisma.device.findMany({ where: { deviceKey: { in: devices.keys() } }, select: { deviceKey: true, secretHash: true, revokedAt: true }, orderBy: { deviceKey: "asc" } }),
    prisma.deviceAssignment.findMany({ where: { barberId: { in: barbers } }, select: { id: true, deviceKey: true, barberId: true, revokedAt: true }, orderBy: { id: "asc" } }),
    prisma.user.findMany({ where: { id: { in: [...userIds, testOwner?.id ?? ""] } }, select: { id: true, username: true, passwordHash: true, isActive: true, passwordChangedAt: true }, orderBy: { id: "asc" } }),
    prisma.barberPaymentQr.findMany({ where: { barberId: { in: barbers } }, select: { barberId: true, method: true, sha256: true }, orderBy: [{ barberId: "asc" }, { method: "asc" }] }),
    prisma.transaction.findMany({ where: { barberId: { in: barbers } }, select: { id: true, barberId: true, amountPaid: true, paymentStatus: true, timeReviewedAt: true }, orderBy: { id: "asc" } }),
    prisma.dailyPayoutLedger.findMany({ where: { barberId: { in: barbers } }, select: { id: true, cashPaid: true, gcashPaid: true }, orderBy: { id: "asc" } }),
  ]);
  return JSON.stringify({ counts, touched }, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
}

async function refusals() {
  console.log("\nR1 each route refuses the credentials it must refuse, with no data and no writes");
  const before = await stateDigest();
  for (const row of AUTHZ_MATRIX) {
    if (row.access !== "owner" && row.access !== "phone" && row.access !== "phone-or-owner") continue;
    for (const credKey of REFUSED[row.access]) {
      const probe = refusedProbe(row);
      if (!probe) {
        check(`${row.method} ${row.route}: a probe is defined`, false);
        continue;
      }
      const cred = CREDENTIALS[credKey];
      const headers = { ...cred.headers(), ...(probe.contentType ? { "Content-Type": probe.contentType } : {}) };
      const answer = await call(row.method, probe.path, { headers, body: probe.body });
      const leak = leaks(answer);
      const after = probe.after ? await probe.after() : null;
      check(
        `${row.method} ${row.route} × ${cred.name} → 401, no data${probe.after ? ", nothing written" : ""}`,
        answer.status === 401 && leak === null && after === null,
        `HTTP ${answer.status}${leak ? `; ${leak}` : ""}${after ? `; ${after}` : ""}`,
      );
    }
  }
  check("state: row counts and touched rows unchanged after every refusal", (await stateDigest()) === before);
}

async function otherPhone() {
  console.log("\nR2 an approved phone asking about another phone's key, sale or barber gets nothing");
  const before = await stateDigest();
  const a = devices.headers(phoneA);
  const binding = await call("GET", `/api/v1/devices/binding?deviceKey=${encodeURIComponent(phoneB)}`, { headers: a });
  check("devices/binding for another phone's key → 401, no data", binding.status === 401 && leaks(binding) === null, `HTTP ${binding.status} ${binding.text.slice(0, 120)}`);
  const image = await call("GET", `/api/v1/payment-qrs/${encodeURIComponent(BARBER_B.id)}/GCASH`, { headers: a });
  check("another barber's QR image → 404, no bytes", image.status === 404 && leaks(image) === null, `HTTP ${image.status}`);
  const charge = await call("POST", "/api/v1/payments/qrph", { headers: a, body: JSON.stringify({ transactionId: saleB }) });
  check("QR Ph charge for another phone's sale → 404", charge.status === 404 && leaks(charge) === null, `HTTP ${charge.status} ${charge.text.slice(0, 120)}`);
  const status = await call("GET", `/api/v1/payments/qrph/check?transactionId=${saleB}`, { headers: a });
  check("QR Ph status of another phone's sale (GET) → 404", status.status === 404 && leaks(status) === null, `HTTP ${status.status}`);
  const recheck = await call("POST", "/api/v1/payments/qrph/check", { headers: a, body: JSON.stringify({ transactionId: saleB }) });
  check("QR Ph Check status of another phone's sale (POST) → 404", recheck.status === 404 && leaks(recheck) === null, `HTTP ${recheck.status}`);
  check("no charge stored for the other phone's sale; nothing else changed", (await stateDigest()) === before);
}

async function allowed() {
  console.log("\nR3 allowed calls answer with their data");
  const owner = { ...json, Cookie: ownerCookie };
  const phone = devices.headers(phoneA);

  // The owner, with no phone headers (case 3): every owner read returns its data.
  const reads: [string, (j: Record<string, unknown>) => boolean][] = [
    ["/api/v1/devices", (j) => Array.isArray(j.devices) && (j.devices as { deviceKey: string }[]).some((d) => d.deviceKey === phoneA)],
    ["/api/v1/users", (j) => Array.isArray(j.users) && (j.users as { id: string }[]).some((u) => u.id === barberUserId)],
    [`/api/v1/reports/payouts?date=${DATE}&commissionBase=LIST_PRICE`, (j) => JSON.stringify(j).includes(BARBER_A.id)],
    [`/api/v1/reports/reconciliation?date=${DATE}`, (j) => j.success === true],
    [`/api/v1/reports/ledger-summary?date=${DATE}&period=day&commissionBase=LIST_PRICE`, (j) => j.success === true],
    [`/api/v1/reports/custom-amounts?date=${DATE}`, (j) => j.success === true && Array.isArray(j.sales)],
    [`/api/v1/reports/payout-history?from=${DATE}&to=${DATE}`, (j) => j.success === true && Array.isArray(j.days)],
    [`/api/v1/reports/sales?from=${DATE}&to=${DATE}`, (j) => j.success === true && Array.isArray(j.sales)],
    ["/api/v1/forecast", (j) => j.success === true],
  ];
  for (const [path, ok] of reads) {
    const answer = await call("GET", path, { headers: owner });
    check(`owner, no phone headers: GET ${path.split("?")[0]} → 200 with its data`, answer.status === 200 && answer.json !== null && ok(answer.json), `HTTP ${answer.status} ${answer.text.slice(0, 120)}`);
  }
  // Owner writes get past the owner check (an empty body is refused for itself, not for access).
  const writes: [Method, string][] = [
    ["POST", "/api/v1/devices/revoke"], ["POST", "/api/v1/users"], ["PATCH", `/api/v1/users/${barberUserId}`],
    ["POST", "/api/v1/reports/payouts"], ["POST", "/api/v1/reports/reconciliation"], ["POST", "/api/v1/reports/time-review"],
  ];
  for (const [method, path] of writes) {
    const answer = await call(method, path, { headers: owner, body: "{}" });
    check(`owner: ${method} ${path.replace(barberUserId, "[id]")} passes the owner check`, answer.status !== 401 && answer.status < 500, `HTTP ${answer.status}`);
  }
  const removeMissing = await call("DELETE", `/api/v1/payment-qrs/${encodeURIComponent(BARBER_B.id)}/MAYA`, { headers: owner });
  check("owner: DELETE payment-qrs passes the owner check", removeMissing.status === 200, `HTTP ${removeMissing.status}`);

  // The phone: its own binding, the catalog, only its own barber's QRs, its own sale.
  const binding = await call("GET", `/api/v1/devices/binding?deviceKey=${encodeURIComponent(phoneA)}`, { headers: phone });
  check("phone: its own binding", binding.status === 200 && binding.json?.bound === true && (binding.json.assignment as { id: string }).id === assignA, binding.text.slice(0, 160));
  const ownerBinding = await call("GET", `/api/v1/devices/binding?deviceKey=${encodeURIComponent(phoneA)}`, { headers: owner });
  check("owner: any phone's binding", ownerBinding.status === 200 && (ownerBinding.json?.barber as { id: string } | undefined)?.id === BARBER_A.id);
  for (const [who, headers] of [["phone", phone], ["owner", owner]] as const) {
    const catalog = await call("GET", "/api/v1/catalog", { headers });
    check(`${who}: the catalog`, catalog.status === 200 && Array.isArray(catalog.json?.barbers) && (catalog.json.barbers as { id: string }[]).some((b) => b.id === BARBER_A.id));
  }
  const phoneList = await call("GET", "/api/v1/payment-qrs", { headers: phone });
  const phoneQrs = (phoneList.json?.qrs as { barberId: string }[] | undefined) ?? [];
  check(
    "phone: the QR list holds only its own barber's QRs",
    phoneList.status === 200 && phoneList.json?.scope === "phone" && phoneList.json.barberId === BARBER_A.id && phoneQrs.length > 0 && phoneQrs.every((q) => q.barberId === BARBER_A.id),
    phoneList.text.slice(0, 160),
  );
  const ownerList = await call("GET", "/api/v1/payment-qrs", { headers: owner });
  const ownerQrs = (ownerList.json?.qrs as { barberId: string }[] | undefined) ?? [];
  check("owner: the QR list holds every barber's", ownerQrs.some((q) => q.barberId === BARBER_A.id) && ownerQrs.some((q) => q.barberId === BARBER_B.id));
  for (const [who, headers] of [["phone", phone], ["owner", owner]] as const) {
    const image = await call("GET", `/api/v1/payment-qrs/${encodeURIComponent(BARBER_A.id)}/GCASH`, { headers });
    check(`${who}: barber A's QR image`, image.status === 200 && image.headers.get("content-type") === "image/png" && image.headers.get("cache-control") === "no-store");
  }
  const ownerImageB = await call("GET", `/api/v1/payment-qrs/${encodeURIComponent(BARBER_B.id)}/GCASH`, { headers: owner });
  check("owner: barber B's QR image too", ownerImageB.status === 200);
  const own = await call("POST", "/api/v1/payments/qrph/check", { headers: phone, body: JSON.stringify({ transactionId: saleA }) });
  check("phone: its own sale's QR Ph status passes the phone check (404 = gateway off or no charge)", own.status !== 401, `HTTP ${own.status}`);
  const s = sale(phoneA, assignA, BARBER_A.id);
  const synced = await syncAs(phoneA, [s]);
  check("phone: sync accepts its own sale", (synced.json?.syncedIds as string[] | undefined)?.includes(s.id) === true, synced.text.slice(0, 160));
  const rebind = await call("POST", "/api/v1/devices/bind", { headers: phone, body: JSON.stringify({ deviceKey: phoneA, barberId: BARBER_A.id, assignmentId: assignA }) });
  check("phone: bind (a retry of its accepted assignment) → 200", rebind.status === 200, `HTTP ${rebind.status}`);
}

// Markup only a rendered page has (the template's `rz-page-in`/`rz-page-out` transition names don't count).
function pageMarkup(html: string): string | null {
  const found = ["Expected drawer cash", "New account", "view and record barber payouts"].filter((t) => html.includes(t));
  for (const cls of [/rz-page(?!-)/, /rz-panel/, /rz-banner/, /rz-mirror/]) if (cls.test(html)) found.push(cls.source);
  return found.length ? found.join(", ") : null;
}

const OWNER_PAGE_PATHS = ["/ledger", "/devices", "/payment-qr", "/reconciliation", "/reports", "/forecast", "/staff"];

async function pages() {
  const as = (cookie: string) => ({ Cookie: cookie });
  const redirectsToPos = (a: Answer) => (a.status === 307 || a.status === 308 || a.status === 303) && /\/pos$/.test(new URL(a.headers.get("location") ?? "", BASE).pathname);

  console.log("\nP1 a barber session opens /pos and /shift-log only: every other page redirects to /pos (slice 19b correction)");
  for (const path of ["/", "/about", ...OWNER_PAGE_PATHS, "/ledger?date=2000-02-11"]) {
    const barber = await call("GET", path, { headers: as(barberCookie) });
    check(`${path} with a barber session → redirect to /pos`, redirectsToPos(barber), `HTTP ${barber.status} ${barber.headers.get("location") ?? ""}`);
    // The 307 carries only Next's redirect shell (the root layout and NEXT_REDIRECT), never the page.
    const content = pageMarkup(barber.text);
    check(`${path} with a barber session: only the redirect shell, no page markup`, barber.text.includes("NEXT_REDIRECT;replace;/pos;") && !content, content ?? "no NEXT_REDIRECT to /pos");
  }
  for (const path of ["/", "/ledger", "/staff"]) {
    const onPhone = await call("GET", path, { headers: { ...devices.headers(phoneA), Cookie: barberCookie } });
    check(`${path} with a barber session on an approved phone → redirect to /pos`, redirectsToPos(onPhone), `HTTP ${onPhone.status}`);
    const withPin = await call("GET", path, { headers: as(`${barberCookie}; ${pinCookie}`) });
    check(`${path} with a barber session and a PIN cookie → still redirected (the session decides)`, redirectsToPos(withPin), `HTTP ${withPin.status}`);
  }
  // RSC requests (in-app navigation) are redirected too, not answered with the page's payload.
  const rsc = await call("GET", "/ledger", { headers: { ...as(barberCookie), RSC: "1" } });
  check("/ledger as in-app navigation with a barber session: no ledger payload", !rsc.text.includes("view and record barber payouts") || redirectsToPos(rsc), `HTTP ${rsc.status}`);
  for (const path of ["/pos", "/shift-log"]) {
    const barber = await call("GET", path, { headers: as(barberCookie) });
    check(`${path} with a barber session → 200, no redirect`, barber.status === 200, `HTTP ${barber.status}`);
    const plain = await call("GET", path);
    check(`${path} with no credentials → 200, no redirect (opens offline; the phone decides what to show)`, plain.status === 200, `HTTP ${plain.status}`);
  }

  console.log("\nP2 the owner opens / and every owner page from an unapproved browser");
  const homeOwner = await call("GET", "/", { headers: as(ownerCookie) });
  check("/ with the owner session alone → 200 with the dashboard (slice 21a)", homeOwner.status === 200 && homeOwner.text.includes("Expected drawer cash") && homeOwner.text.includes("Owed to barbers"), `HTTP ${homeOwner.status}`);
  check("/ with the owner session: page markup present (the barber check above means something)", pageMarkup(homeOwner.text) !== null);
  const aboutOwner = await call("GET", "/about", { headers: as(ownerCookie) });
  check("/about with the owner session alone → 200", aboutOwner.status === 200, `HTTP ${aboutOwner.status}`);
  for (const path of OWNER_PAGE_PATHS) {
    const owner = await call("GET", path, { headers: as(ownerCookie) });
    check(`${path} with the owner session alone → 200, no redirect`, owner.status === 200, `HTTP ${owner.status} ${owner.headers.get("location") ?? ""}`);
  }
  const lockedViews: [string, string][] = [
    ["/reports", "Sales, revenue and how the shop did over a date range"],
    ["/forecast", "How the forecast is checked and how its revenue estimate is worked out"],
  ];
  for (const [path, signedOut] of lockedViews) {
    const owner = await call("GET", path, { headers: as(ownerCookie) });
    check(`${path} with the owner session: not the signed-out view`, owner.status === 200 && !owner.text.includes(signedOut));
  }
  // Slice 27: /insights is a redirect to /reports (next.config), whoever asks; /reports keeps its own checks.
  const oldInsights = await call("GET", "/insights?date=2026-01-01");
  check("/insights → 308 to /reports (no page of its own)", oldInsights.status === 308 && new URL(oldInsights.headers.get("location") ?? "", BASE).pathname === "/reports", `HTTP ${oldInsights.status} ${oldInsights.headers.get("location") ?? ""}`);
  const staffOwner = await call("GET", "/staff", { headers: as(ownerCookie) });
  check("/staff with the owner session: the form is there", staffOwner.status === 200 && staffOwner.text.includes("New account"));

  console.log("\nP3 owner access never passes /pos and /shift-log; signed-out browsers are not redirected");
  const ownerOnPos = await call("POST", "/api/v1/auth/login", {
    headers: devices.headers(phoneA),
    body: JSON.stringify({ username: testOwner!.username, password: testOwner!.password, deviceKey: phoneA }),
  });
  check("owner account signing in on the POS → 403 OWNER_ON_POS, no cookie", ownerOnPos.status === 403 && ownerOnPos.json?.code === "OWNER_ON_POS" && !(ownerOnPos.headers.get("set-cookie") ?? "").includes("ruzzco_session="), `HTTP ${ownerOnPos.status}`);
  for (const path of ["/pos", "/shift-log"]) {
    const owner = await call("GET", path, { headers: as(ownerCookie) });
    check(`${path} with the owner session → 200, the same shell (approval is decided on the phone, never by owner access)`, owner.status === 200, `HTTP ${owner.status}`);
  }
  for (const path of ["/", "/about", "/ledger", "/reports", "/forecast", "/staff"]) {
    const none = await call("GET", path);
    check(`${path} with no credentials → 200 (the approval or sign-in screen), not redirected`, none.status === 200, `HTTP ${none.status}`);
    check(`${path} with no credentials: no dashboard, peso figure or account form`, !none.text.includes("Expected drawer cash") && !none.text.includes("Owed to barbers") && !none.text.includes("₱") && !none.text.includes("New account"));
  }

  console.log("\nP4 barber sign-in clears a leftover PIN cookie");
  const again = await call("POST", "/api/v1/auth/login", {
    headers: { ...devices.headers(phoneA), Cookie: pinCookie },
    body: JSON.stringify({ username: `t-authz-${RUN}`, password: PASSWORD, deviceKey: phoneA }),
  });
  const setCookies = again.headers.getSetCookie();
  const cleared = setCookies.find((c) => c.startsWith("ruzzco_owner_access="));
  check("barber sign-in → 200 with a new session cookie", again.status === 200 && setCookies.some((c) => c.startsWith("ruzzco_session=")), `HTTP ${again.status}`);
  check("barber sign-in clears ruzzco_owner_access (empty, Max-Age=0)", Boolean(cleared && /^ruzzco_owner_access=;/.test(cleared) && /max-age=0/i.test(cleared)), cleared ?? "no Set-Cookie for it");
  const ownerAgain = await testOwner!.signIn();
  check("owner sign-in leaves the PIN cookie alone", ownerAgain.startsWith("ruzzco_session="));
}

// ── Request restrictions (§7.8) ─────────────────────────────────────────────

function checkCookie(route: string, plain: string, secure: string) {
  const attrs = (raw: string) => raw.split(";").map((p) => p.trim().toLowerCase());
  const p = attrs(plain);
  const s = attrs(secure);
  check(`${route}: Set-Cookie is HttpOnly, SameSite=Strict, Path=/`, p.includes("httponly") && p.includes("samesite=strict") && p.includes("path=/"), plain.replace(/=[^;]*/, "=…"));
  check(`${route}: no Secure over plain HTTP`, !p.includes("secure"));
  check(`${route}: Secure when the request came through HTTPS`, s.includes("secure") && s.includes("httponly") && s.includes("samesite=strict"));
}

async function restrictions() {
  console.log("\nC1 cookie-authenticated JSON writes refuse other content types (415), nothing changes");
  const owner = ownerCookie;
  const wrongTypes: [string, string][] = [
    ["text/plain", "text/plain"],
    ["form", "application/x-www-form-urlencoded"],
    ["multipart", "multipart/form-data; boundary=x"],
  ];
  const writes: [Method, string, string][] = [
    ["POST", "/api/v1/reports/payouts", JSON.stringify({ id: randomUUID(), barberId: BARBER_A.id, date: DATE, amount: 10, method: "CASH" })],
    ["POST", "/api/v1/reports/reconciliation", JSON.stringify({ date: DATE, countedCash: 1, pettyCash: 0 })],
    ["POST", "/api/v1/reports/time-review", JSON.stringify({ transactionId: saleA, choice: "RECEIVED" })],
    ["POST", "/api/v1/users", JSON.stringify({ name: "Form", role: "OWNER", username: `t-form-${RUN}`, password: PASSWORD })],
    ["POST", "/api/v1/devices/revoke", JSON.stringify({ deviceKey: phoneB })],
    ["PATCH", `/api/v1/users/${barberUserId}`, JSON.stringify({ isActive: false })],
    ["POST", "/api/v1/owner/lock", "{}"],
    ["POST", "/api/v1/auth/logout", "{}"],
    ["POST", "/api/v1/auth/login", JSON.stringify({ username: testOwner!.username, password: testOwner!.password })],
    ["POST", "/api/v1/forecast/refresh", "{}"],
  ];
  const before = await stateDigest();
  for (const [method, path, body] of writes) {
    for (const [label, type] of wrongTypes) {
      const answer = await call(method, path, { headers: { "Content-Type": type, Cookie: owner }, body });
      check(`${method} ${path.replace(barberUserId, "[id]")} as ${label} → 415, no cookie set`, answer.status === 415 && !answer.headers.get("set-cookie"), `HTTP ${answer.status}`);
    }
  }
  // Unlock checks OWNER_ACCOUNT_EXISTS before the body (slice 19): 409 here, never a cookie.
  for (const [label, type] of wrongTypes) {
    const answer = await call("POST", "/api/v1/owner/unlock", { headers: { "Content-Type": type, Cookie: owner }, body: JSON.stringify({ pin: process.env.OWNER_PIN ?? "" }) });
    check(`POST /api/v1/owner/unlock as ${label} → 409 or 415, no cookie set`, (answer.status === 409 || answer.status === 415) && !answer.headers.get("set-cookie"), `HTTP ${answer.status}`);
  }
  check("state unchanged after every wrong content type", (await stateDigest()) === before);
  const stillOwner = await call("GET", "/api/v1/devices", { headers: { Cookie: owner } });
  check("the owner session still works (lock/logout as text/plain cleared nothing)", stillOwner.status === 200);

  console.log("\nC2 no CORS grant to a foreign Origin");
  const evil = "https://evil.example";
  const paths = [...new Set(AUTHZ_MATRIX.map((r) => r.route))].map((route) =>
    `/api/${route.replace("[barberId]", encodeURIComponent(BARBER_A.id)).replace("[method]", "GCASH").replace("[id]", barberUserId)}`,
  );
  let granted: string[] = [];
  for (const path of paths) {
    const preflight = await call("OPTIONS", path, {
      headers: { Origin: evil, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,authorization,x-ruzzco-device", Cookie: owner },
    });
    const plain = await call("GET", path, { headers: { Origin: evil, Cookie: owner } });
    for (const [kind, answer] of [["OPTIONS", preflight], ["GET", plain]] as const) {
      if (answer.headers.get("access-control-allow-origin") || answer.headers.get("access-control-allow-credentials")) granted.push(`${kind} ${path}`);
    }
  }
  check(`no Access-Control-Allow-Origin or -Credentials on any route (${paths.length} routes, preflight and GET)`, granted.length === 0, granted.join(", "));
  granted = [];

  console.log("\nC3 session cookie attributes");
  const login = (extra: Headers) => call("POST", "/api/v1/auth/login", {
    headers: { ...json, ...extra },
    body: JSON.stringify({ username: testOwner!.username, password: testOwner!.password }),
  });
  checkCookie("auth/login", (await login({})).headers.get("set-cookie") ?? "", (await login({ "x-forwarded-proto": "https" })).headers.get("set-cookie") ?? "");
  if (!pinCookieReal) console.log("  - owner/unlock attributes: see the skip note above");

  console.log("\nC4 forecast/refresh (C1): JSON {} only, checked before the ml-service call");
  const runs = () => prisma.forecastRun.count();
  const runsBefore = await runs();
  const bad: [string, Headers, string | undefined, number][] = [
    ["no content type", { Cookie: owner }, undefined, 415],
    ["text/plain", { Cookie: owner, "Content-Type": "text/plain" }, "{}", 415],
    ["a form", { Cookie: owner, "Content-Type": "application/x-www-form-urlencoded" }, "a=1", 415],
    ["multipart", { Cookie: owner, "Content-Type": "multipart/form-data; boundary=x" }, "--x--", 415],
    ["malformed JSON", { Cookie: owner, ...json }, "{", 400],
    ["an array", { Cookie: owner, ...json }, "[]", 400],
    ["null", { Cookie: owner, ...json }, "null", 400],
    ["a string", { Cookie: owner, ...json }, "\"refresh\"", 400],
    ["an object with a key", { Cookie: owner, ...json }, "{\"days\":30}", 400],
  ];
  for (const [label, headers, body, want] of bad) {
    const answer = await call("POST", "/api/v1/forecast/refresh", { headers, body });
    check(`${label} → ${want}`, answer.status === want, `HTTP ${answer.status}`);
  }
  check("no forecast run saved by any of them", (await runs()) === runsBefore);
  const good = await call("POST", "/api/v1/forecast/refresh", { headers: { Cookie: owner, ...json }, body: "{}" });
  if (good.status === 502) {
    check("valid {} with the ml-service stopped → 502, nothing saved (the checks above ran before the call)", (await runs()) === runsBefore);
  } else {
    check("valid {} with the ml-service running → 200, exactly one run saved", good.status === 200 && (await runs()) === runsBefore + 1, `HTTP ${good.status}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function cleanup() {
  await devices.cleanup(prisma).catch((e) => console.error("Device cleanup failed:", e));
  const barbers = [BARBER_A.id, BARBER_B.id];
  await prisma.gatewayPayment.deleteMany({ where: { transactionId: { in: txIds } } });
  await prisma.dailyPayoutLedger.deleteMany({ where: { barberId: { in: barbers } } });
  await prisma.transaction.deleteMany({ where: { OR: [{ id: { in: txIds } }, { barberId: { in: barbers } }] } });
  await prisma.user.deleteMany({ where: { OR: [{ id: { in: userIds } }, { barberId: { in: barbers } }, { username: { in: [`t-intr-${RUN}`, `t-form-${RUN}`] } }] } });
  await prisma.deviceAssignment.deleteMany({ where: { barberId: { in: barbers } } });
  await prisma.barberPaymentQr.deleteMany({ where: { barberId: { in: barbers } } });
  await prisma.barber.deleteMany({ where: { id: { in: barbers } } });
}

async function main() {
  console.log(`Authorization audit against ${BASE} (run ${RUN})\n`);
  checkMatrixCoverage();
  const health = await fetch(`${BASE}/api/v1/health`).catch(() => null);
  if (!health?.ok) throw new Error(`Dev server not reachable at ${BASE}. Start it with \`npm run dev\`.`);
  console.log("\nSetup");
  await setup();
  await refusals();
  await otherPhone();
  await allowed();
  await pages();
  await restrictions();
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

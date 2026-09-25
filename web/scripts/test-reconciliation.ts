/**
 * Integration test for reconciliation correctness: Manila business-day windows, append-only
 * revisions, staleness, and the expected-drawer-cash formula.
 *
 * Calls the REAL routes (POST /api/v1/transactions/sync, GET/POST /api/v1/reports/reconciliation,
 * GET/POST /api/v1/reports/payouts) on a running dev server and checks stored rows with Prisma.
 *
 *   npm run dev                      (in another terminal)
 *   npm run test:reconciliation      (TEST_BASE_URL overrides http://localhost:3000)
 *
 * Needs OWNER_PIN in web/.env (read, never printed). Uses throwaway barbers and fixed past
 * business dates (2000-01-10..12, no real data); its sales, ledger rows and reconciliation
 * revisions on those dates, and its barbers, are deleted at the end.
 */
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { prisma } from "../src/lib/prisma";
import { manilaToday, parseBusinessDate } from "../src/lib/business-date";

loadEnvConfig(process.cwd());

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const SERVICE_ID = "10000000-0000-0000-0000-000000000001"; // seeded Haircut
const RUN = randomUUID().slice(0, 8);
const PREV = "2000-01-10";
const D = "2000-01-11";
const NEXT = "2000-01-12";
const DATES = [PREV, D, NEXT];
const dateValue = (date: string) => new Date(`${date}T00:00:00.000Z`);
// Manila wall-clock time with milliseconds, sent as a UTC ISO instant like the POS does.
const AT = (date: string, time: string) => new Date(`${date}T${time}+08:00`).toISOString();

const BARBERS = {
  A: { id: `test-rec-A-${RUN}`, rate: 0.5 }, // makes every sale
  B: { id: `test-rec-B-${RUN}`, rate: 0.5 }, // only has a payout row
};

const txIds: string[] = [];
let ownerCookie = "";
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

// ── HTTP helpers ─────────────────────────────────────────────────────────────

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(ownerCookie ? { Cookie: ownerCookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as T };
}

type SyncResponse = { syncedIds: string[]; rejected: { id: string | null; reason: string }[] };
type Expected = {
  cashTotal: string; cashTips: string; cashPayouts: string; pettyCash: string; expectedDrawerCash: string;
  gcashTotal: string; mayaTotal: string; digitalTotal: string; totalRevenue: string; transactionCount: number;
};
type Saved = {
  id: number; revision: number; expectedCash: string; countedCash: string; variance: string; pettyCashAmount: string;
  gcashTotal: string; mayaTotal: string; totalRevenue: string; reconciledAt: string;
};
type Staleness = { stale: boolean; staleReasons: string[]; lateSyncedCount: number; expectedCashDelta: string };
type Recon = { success: boolean; date: string; expected: Expected; saved: Saved | null; staleness: Staleness | null; error?: string };
type LedgerRow = { barberId: string; commissionTotal: string };

const sync = (items: unknown[]) => request<SyncResponse>("POST", "/api/v1/transactions/sync", { transactions: items });
const recon = (date: string) => request<Recon>("GET", `/api/v1/reports/reconciliation?date=${date}`);
const reconcile = (date: string, countedCash: number, pettyCashAmount = 0) =>
  request<Recon>("POST", "/api/v1/reports/reconciliation", { date, countedCash, pettyCashAmount });
const ledger = (date: string) =>
  request<{ success: boolean; rows: LedgerRow[] }>("GET", `/api/v1/reports/payouts?date=${date}&commissionBase=LIST_PRICE`);
const pay = (barberId: string, cashPaid: number, gcashPaid: number, paid: boolean) =>
  request<{ success: boolean }>("POST", "/api/v1/reports/payouts", {
    date: D, barberId, commissionBase: "LIST_PRICE", cashPaid, gcashPaid, paid,
  });

type SaleOpts = { date: string; time: string; amount: number; method?: "CASH" | "GCASH" | "MAYA"; tipAmount?: number };
function sale({ date, time, amount, method = "CASH", tipAmount = 0 }: SaleOpts) {
  const id = randomUUID();
  txIds.push(id);
  return {
    id,
    barberId: BARBERS.A.id,
    serviceId: SERVICE_ID,
    totalAmount: amount,
    listPrice: amount,
    amountPaid: amount,
    tipAmount,
    customAmount: true,
    paymentMethod: method,
    transactionTime: AT(date, time),
  };
}

async function syncAll(items: ReturnType<typeof sale>[], label: string) {
  const res = await sync(items);
  const ok = res.status === 200 && items.every((i) => res.body.syncedIds.includes(i.id)) && res.body.rejected.length === 0;
  check(`setup: ${label} synced`, ok, JSON.stringify(res.body));
}

const reconRows = (date: string) =>
  prisma.shiftReconciliation.findMany({ where: { reconciliationDate: dateValue(date) }, orderBy: { revision: "asc" } });

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Reconciliation integration test against ${BASE} (run ${RUN}, dates ${DATES.join(", ")})`);

  console.log("\nH business-date helper (pure)");
  for (const bad of ["2026-02-30", "2026-02-31", "2026-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "2026-9-5", "", "2026-09-25T00:00"]) {
    check(`"${bad}" is rejected`, parseBusinessDate(bad) === null);
  }
  check("2024-02-29 (leap day) is accepted", parseBusinessDate("2024-02-29") !== null);
  const w = parseBusinessDate("2026-09-25")!;
  check(
    "2026-09-25 window is [2026-09-24T16:00:00.000Z, 2026-09-25T16:00:00.000Z)",
    w.start.toISOString() === "2026-09-24T16:00:00.000Z" && w.end.toISOString() === "2026-09-25T16:00:00.000Z",
    `${w.start.toISOString()} .. ${w.end.toISOString()}`
  );
  check("dateValue is the calendar label at UTC midnight", w.dateValue.toISOString() === "2026-09-25T00:00:00.000Z");
  check("manilaToday at 2026-09-24T16:00:00.000Z is 2026-09-25", manilaToday(new Date("2026-09-24T16:00:00.000Z")) === "2026-09-25");
  check("manilaToday at 2026-09-24T15:59:59.999Z is 2026-09-24", manilaToday(new Date("2026-09-24T15:59:59.999Z")) === "2026-09-24");

  const health = await fetch(`${BASE}/api/v1/health`).catch(() => null);
  if (!health?.ok) throw new Error(`Dev server not reachable at ${BASE}. Start it with \`npm run dev\`.`);
  if (!process.env.OWNER_PIN) throw new Error("OWNER_PIN is not set in web/.env");

  const unlock = await fetch(`${BASE}/api/v1/owner/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: process.env.OWNER_PIN }),
  });
  ownerCookie = unlock.headers.get("set-cookie")?.split(";")[0] ?? "";
  if (!unlock.ok || !ownerCookie) throw new Error(`Owner unlock failed with ${unlock.status}`);

  const first = parseBusinessDate(PREV)!.start;
  const last = parseBusinessDate(NEXT)!.end;
  const existing = await prisma.transaction.count({ where: { transactionTime: { gte: first, lt: last } } });
  if (existing > 0) throw new Error(`${existing} sales already exist on ${PREV}..${NEXT}; refusing to run`);
  await cleanupDates();
  for (const [key, b] of Object.entries(BARBERS)) {
    await prisma.barber.create({ data: { id: b.id, fullName: `Test Recon ${key} ${RUN}`, commissionRate: b.rate } });
  }

  console.log("\nB1-B4 one sale, one business date, at the Manila midnight edges");
  const atNextMidnight = sale({ date: NEXT, time: "00:00:00.000", amount: 100 }); // B1
  const beforeMidnight = sale({ date: D, time: "23:59:59.999", amount: 200 }); // B2
  const afterMidnight = sale({ date: NEXT, time: "00:00:00.001", amount: 400 }); // B3
  const atMidnight = sale({ date: D, time: "00:00:00.000", amount: 800 }); // B4
  await syncAll([atNextMidnight, beforeMidnight, afterMidnight, atMidnight], "edge sales");
  check("B1: D+1 00:00:00.000 Manila is stored as D 16:00:00.000Z", atNextMidnight.transactionTime === `${D}T16:00:00.000Z`);

  const prev = await recon(PREV);
  let cur = await recon(D);
  const next = await recon(NEXT);
  check("B4: D 00:00:00.000 is not in D-1", prev.body.expected.transactionCount === 0 && prev.body.expected.cashTotal === "0.00", JSON.stringify(prev.body.expected));
  check("B1/B2/B4: D holds 23:59:59.999 and 00:00:00.000 of D only (200 + 800)", cur.body.expected.cashTotal === "1000.00" && cur.body.expected.transactionCount === 2, JSON.stringify(cur.body.expected));
  check("B1/B3: D+1 holds 00:00:00.000 and 00:00:00.001 of D+1 (100 + 400)", next.body.expected.cashTotal === "500.00" && next.body.expected.transactionCount === 2, JSON.stringify(next.body.expected));

  console.log("\nB5 reconciliation and payouts select the same sales");
  let rowsD = await ledger(D);
  const rowsNext = await ledger(NEXT);
  const commissionOf = (rows: LedgerRow[]) => rows.find((r) => r.barberId === BARBERS.A.id)?.commissionTotal;
  check("B5: payouts D commission is 500.00 (0.5 × 1000, same sales as reconciliation)", commissionOf(rowsD.body.rows) === "500.00", String(commissionOf(rowsD.body.rows)));
  check("B5: payouts D+1 commission is 250.00 (0.5 × 500)", commissionOf(rowsNext.body.rows) === "250.00", String(commissionOf(rowsNext.body.rows)));

  console.log("\nB6 invalid calendar dates are rejected, never rolled over");
  const rowsBefore = await prisma.shiftReconciliation.count();
  const badGet = await recon("2026-02-30");
  check("B6: reconciliation GET 2026-02-30 → 400", badGet.status === 400, String(badGet.status));
  const badPost = await reconcile("2026-02-31", 100);
  check("B6: reconciliation POST 2026-02-31 → 400", badPost.status === 400, String(badPost.status));
  const badLedger = await ledger("2026-02-30");
  check("B6: payouts GET 2026-02-30 → 400", badLedger.status === 400, String(badLedger.status));
  check("B6: no reconciliation row was written", (await prisma.shiftReconciliation.count()) === rowsBefore);
  const tomorrow = new Date(Date.now() + 36 * 60 * 60 * 1000);
  const future = await reconcile(manilaToday(tomorrow), 100);
  check("future Manila date → 422", future.status === 422, String(future.status));

  console.log("\nC1/C2 expected drawer cash formula");
  await syncAll([
    sale({ date: D, time: "10:00:00.000", amount: 150, tipAmount: 30 }),
    sale({ date: D, time: "11:00:00.000", amount: 1000, method: "GCASH", tipAmount: 50 }),
    sale({ date: D, time: "12:00:00.000", amount: 300, method: "MAYA" }),
  ], "cash + tip, GCash + tip, Maya");
  const legacyId = randomUUID();
  txIds.push(legacyId);
  await prisma.transaction.create({
    data: {
      id: legacyId, barberId: BARBERS.A.id, totalAmount: 5, amountPaid: null, barberCommissionAmount: 2.5,
      commissionRate: 0.5, paymentMethod: "CASH", transactionTime: new Date(AT(D, "14:00:00.000")),
    },
  });
  cur = await recon(D);
  let e = cur.body.expected;
  check("C1: cash sales 1155.00 (200 + 800 + 150 + legacy 5)", e.cashTotal === "1155.00", e.cashTotal);
  check("C2: legacy sale with null amountPaid counts its totalAmount", e.transactionCount === 6, String(e.transactionCount));
  check("C1: cash tips 30.00 (GCash tip excluded)", e.cashTips === "30.00", e.cashTips);
  check("C1: GCash 1000.00, Maya 300.00, revenue 2455.00 (tips excluded)", e.gcashTotal === "1000.00" && e.mayaTotal === "300.00" && e.totalRevenue === "2455.00", JSON.stringify(e));
  check("C1: expected drawer 1185.00 with no payouts or petty cash", e.expectedDrawerCash === "1185.00", e.expectedDrawerCash);
  check("no saved revision yet: saved and staleness are null", cur.body.saved === null && cur.body.staleness === null);

  console.log("\nS6 only paid payouts leave the drawer; gcashPaid never does");
  await ledger(D); // creates the rows for A and B
  check("setup: A paid ₱120 cash + ₱70 GCash", (await pay(BARBERS.A.id, 120, 70, true)).status === 200);
  check("setup: B ₱60 cash entered but not paid", (await pay(BARBERS.B.id, 60, 0, false)).status === 200);
  e = (await recon(D)).body.expected;
  check("S6: cash payouts 120.00 (unpaid 60 and GCash 70 excluded)", e.cashPayouts === "120.00", e.cashPayouts);
  check("C1: expected drawer 1065.00 = 1155 + 30 - 120", e.expectedDrawerCash === "1065.00", e.expectedDrawerCash);

  console.log("\nR1 first save is revision 1 and current");
  let save = await reconcile(D, 1040, 25);
  check("R1: saved as revision 1", save.status === 200 && save.body.saved?.revision === 1, JSON.stringify(save.body));
  check("R1: expected 1040.00 (1065 - 25 petty), variance 0.00", save.body.saved?.expectedCash === "1040.00" && save.body.saved.variance === "0.00", JSON.stringify(save.body.saved));
  check("R1: POST response is not stale", save.body.staleness?.stale === false, JSON.stringify(save.body.staleness));
  cur = await recon(D);
  check("S2: fresh GET is not stale, delta 0.00, no late syncs", cur.body.staleness?.stale === false && cur.body.staleness.expectedCashDelta === "0.00" && cur.body.staleness.lateSyncedCount === 0 && cur.body.staleness.staleReasons.length === 0, JSON.stringify(cur.body.staleness));
  check("S2: live expected uses the saved petty cash (1040.00)", cur.body.expected.expectedDrawerCash === "1040.00" && cur.body.expected.pettyCash === "25.00", JSON.stringify(cur.body.expected));
  const [rev1] = await reconRows(D);

  console.log("\nS1 a late GCash sale: stale with a zero cash delta");
  await syncAll([sale({ date: D, time: "15:00:00.000", amount: 500, method: "GCASH" })], "late GCash sale");
  cur = await recon(D);
  let s = cur.body.staleness;
  check("S1: stale, reason LATE_SYNCED_TRANSACTIONS only", s?.stale === true && s.staleReasons.join() === "LATE_SYNCED_TRANSACTIONS", JSON.stringify(s));
  check("S1: lateSyncedCount 1, expectedCashDelta 0.00", s?.lateSyncedCount === 1 && s.expectedCashDelta === "0.00", JSON.stringify(s));
  check("S1: saved revision unchanged (GCash 1000.00), live GCash 1500.00", cur.body.saved?.gcashTotal === "1000.00" && cur.body.expected.gcashTotal === "1500.00");

  console.log("\nS1 a late cash sale: stale with a cash delta");
  await syncAll([sale({ date: D, time: "16:00:00.000", amount: 50 })], "late cash sale");
  cur = await recon(D);
  s = cur.body.staleness;
  check("S1: both reasons, lateSyncedCount 2, delta +50.00", s?.stale === true && s.staleReasons.includes("EXPECTED_CASH_CHANGED") && s.staleReasons.includes("LATE_SYNCED_TRANSACTIONS") && s.lateSyncedCount === 2 && s.expectedCashDelta === "50.00", JSON.stringify(s));
  check("S1: saved expected and variance stay 1040.00 / 0.00", cur.body.saved?.expectedCash === "1040.00" && cur.body.saved.variance === "0.00", JSON.stringify(cur.body.saved));

  console.log("\nS4/R2 re-saving appends revision 2; revision 1 is untouched");
  save = await reconcile(D, 1090, 25);
  check("R2: saved as revision 2, expected 1090.00, variance 0.00", save.body.saved?.revision === 2 && save.body.saved.expectedCash === "1090.00" && save.body.saved.variance === "0.00", JSON.stringify(save.body.saved));
  check("S4: revision 2 is not stale", save.body.staleness?.stale === false, JSON.stringify(save.body.staleness));
  let rows = await reconRows(D);
  const rev1After = rows.find((r) => r.revision === 1);
  check("R2: two rows for D", rows.length === 2, String(rows.length));
  check(
    "R2: revision 1 identical to before (expected, counted, variance, GCash, revenue, reconciledAt)",
    !!rev1After && rev1After.id === rev1.id && rev1After.expectedCash.eq(rev1.expectedCash) && rev1After.countedCash.eq(rev1.countedCash)
      && rev1After.variance.eq(rev1.variance) && rev1After.gcashTotal.eq(rev1.gcashTotal) && rev1After.totalRevenue.eq(rev1.totalRevenue)
      && rev1After.reconciledAt.getTime() === rev1.reconciledAt.getTime()
  );
  cur = await recon(D);
  check("GET returns the latest revision (2) and it is not stale", cur.body.saved?.revision === 2 && cur.body.staleness?.stale === false, JSON.stringify(cur.body.staleness));

  console.log("\nS5 a late sale for the next day does not stale D");
  await syncAll([sale({ date: NEXT, time: "10:00:00.000", amount: 70 })], "late D+1 sale");
  cur = await recon(D);
  check("S5: D still not stale", cur.body.staleness?.stale === false, JSON.stringify(cur.body.staleness));

  console.log("\nS3 payout edits after the count");
  await pay(BARBERS.A.id, 120, 90, true);
  cur = await recon(D);
  check("S3: a GCash-only payout change does not stale D", cur.body.staleness?.stale === false, JSON.stringify(cur.body.staleness));
  await pay(BARBERS.B.id, 60, 0, true);
  cur = await recon(D);
  s = cur.body.staleness;
  check("S3: marking B's ₱60 paid stales D with delta -60.00", s?.stale === true && s.staleReasons.join() === "EXPECTED_CASH_CHANGED" && s.expectedCashDelta === "-60.00" && s.lateSyncedCount === 0, JSON.stringify(s));
  check("S3: live expected drawer 1030.00", cur.body.expected.expectedDrawerCash === "1030.00", cur.body.expected.expectedDrawerCash);

  console.log("\nR3 concurrent saves get distinct revisions");
  const [c1, c2] = await Promise.all([reconcile(D, 1030, 25), reconcile(D, 1030, 25)]);
  const revs = [c1.body.saved?.revision, c2.body.saved?.revision].sort();
  check("R3: both saved as revisions 3 and 4", c1.status === 200 && c2.status === 200 && revs.join() === "3,4", `${c1.status}/${c2.status} ${revs.join()}`);
  rows = await reconRows(D);
  check("R3: four revisions stored, numbered 1..4", rows.map((r) => r.revision).join() === "1,2,3,4", rows.map((r) => r.revision).join());
  rowsD = await ledger(D);
  // 0.5 × (200 + 800 + 150 + 1000 + 300 + 500 + 50) + legacy 2.50; the D+1 midnight 100 would add 50.
  check("B5: payouts D still exclude the D+1 midnight sale (commission 1502.50)", commissionOf(rowsD.body.rows) === "1502.50", String(commissionOf(rowsD.body.rows)));
}

async function cleanupDates() {
  // Every row on the test dates, including the zero ledger rows the GET creates for real barbers.
  await prisma.dailyPayoutLedger.deleteMany({ where: { businessDate: { in: DATES.map(dateValue) } } });
  await prisma.shiftReconciliation.deleteMany({ where: { reconciliationDate: { in: DATES.map(dateValue) } } });
}

async function cleanup() {
  const barberIds = Object.values(BARBERS).map((b) => b.id);
  await cleanupDates();
  await prisma.dailyPayoutLedger.deleteMany({ where: { barberId: { in: barberIds } } });
  await prisma.syncMismatchLog.deleteMany({ where: { transactionId: { in: txIds } } });
  // Items and commission logs cascade with the transaction.
  await prisma.transaction.deleteMany({ where: { OR: [{ id: { in: txIds } }, { barberId: { in: barberIds } }] } });
  await prisma.barber.deleteMany({ where: { id: { in: barberIds } } });
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

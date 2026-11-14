/**
 * Integration test for payout entries (slice 18): each payout to a barber is its own entry,
 * never edited; Remaining = owed − the sum of the entries; an amount above what is owed is
 * refused; a repeated id is one entry; a correction undoes part of one entry with a reason;
 * every cash entry leaves expected drawer cash at once; a late sale after full payment shows as
 * additional owed; the old request body still works; and every ledger row equals its entries.
 *
 *   npm run dev                    (in another terminal)
 *   npm run test:payout-entries    (TEST_BASE_URL overrides http://localhost:3000)
 *
 * Uses a throwaway barber, a scratch approved phone and fixed past business dates
 * (2000-04-10, 2000-04-11); everything it creates is deleted at the end.
 */
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { prisma } from "../src/lib/prisma";
import { createTestOwner, type TestOwner } from "./lib/test-owner";
import { manilaToday } from "../src/lib/business-date";
import { createTestDevices } from "./lib/test-devices";

loadEnvConfig(process.cwd());

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const SERVICE_ID = "10000000-0000-0000-0000-000000000001"; // seeded Haircut
const RUN = randomUUID().slice(0, 8);
const BARBER = `test-payout-${RUN}`;
const D = "2000-04-10";
const D_OLD = "2000-04-11"; // the old request body
const DATES = [D, D_OLD];
const dateValue = (date: string) => new Date(`${date}T00:00:00.000Z`);
const AT = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+08:00`).toISOString();
const devices = createTestDevices(BASE);
let deviceKey = "";
const txIds: string[] = [];
let ownerCookie = "";
let testOwner: TestOwner | null = null;
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

async function request<T>(method: "GET" | "POST", path: string, body?: unknown, owner = true, extraHeaders: Record<string, string> = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(owner && ownerCookie ? { Cookie: ownerCookie } : {}), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as T };
}

type Entry = { id: string; method: string; kind: string; amount: string; correctsId: string | null; note: string | null; recordedAt: string; correctableLeft: string };
type Row = { barberId: string; totalOwed: string; cashPaid: string; gcashPaid: string; paidTotal: string; remaining: string; paid: boolean; additionalOwed: boolean; entries: Entry[] };
type PostBody = { success: boolean; replay?: boolean; code?: string; error?: string; remaining?: string; left?: string; row: Row; entry: Entry | null };
type Recon = { expected: { cashPayouts: string; expectedDrawerCash: string }; staleness: { stale: boolean; staleReasons: string[]; expectedCashDelta: string } | null };

const ledger = async (date: string) => request<{ success: boolean; rows: Row[] }>("GET", `/api/v1/reports/payouts?date=${date}`);
const myRow = async (date: string) => (await ledger(date)).body.rows?.find((r) => r.barberId === BARBER);
const post = (body: Record<string, unknown>, owner = true) => request<PostBody>("POST", "/api/v1/reports/payouts", { date: D, barberId: BARBER, ...body }, owner);
const pay = (id: string, amount: number, method = "CASH") => post({ id, method, amount });
const correct = (id: string, correctsId: string, amount: number, note: string | undefined, method = "CASH") =>
  post({ id, kind: "CORRECTION", correctsId, method, amount, ...(note === undefined ? {} : { note }) });
const recon = async (date: string) => (await request<Recon>("GET", `/api/v1/reports/reconciliation?date=${date}`)).body;
const entryCount = () => prisma.payoutEntry.count({ where: { barberId: BARBER } });

async function syncSale(date: string, hhmm: string, amount: number) {
  const id = randomUUID();
  txIds.push(id);
  const res = await request<{ syncedIds: string[]; rejected: unknown[] }>("POST", "/api/v1/transactions/sync", {
    transactions: [{ id, barberId: BARBER, serviceId: SERVICE_ID, totalAmount: amount, listPrice: amount, amountPaid: amount, tipAmount: 0, customAmount: true, paymentMethod: "CASH", transactionTime: AT(date, hhmm) }],
  }, false, devices.headers(deviceKey));
  check(`setup: ₱${amount} cash sale on ${date} synced`, res.status === 200 && res.body.syncedIds.includes(id), JSON.stringify(res.body));
}

async function main() {
  console.log(`Payout entries test against ${BASE} (run ${RUN}, dates ${DATES.join(", ")})`);
  const health = await fetch(`${BASE}/api/v1/health`).catch(() => null);
  if (!health?.ok) throw new Error(`Dev server not reachable at ${BASE}. Start it with \`npm run dev\`.`);
  // Slice 19: owner routes take an owner account session (scripts/lib/test-owner.ts).
  testOwner = await createTestOwner(BASE, prisma, "payout-ent");
  ownerCookie = testOwner.cookie;

  const existing = await prisma.transaction.count({ where: { transactionTime: { gte: new Date(AT(D, "00:00")), lt: new Date(AT("2000-04-12", "00:00")) } } });
  if (existing > 0) throw new Error(`${existing} sales already exist on ${DATES.join(", ")}; refusing to run`);
  await cleanupDates();
  await prisma.barber.create({ data: { id: BARBER, fullName: `Test Payout ${RUN}`, commissionRate: 0.5 } });
  deviceKey = await devices.approve();
  await syncSale(D, "10:00", 2000); // owed 1,000.00

  console.log("\nOwner-only and input checks");
  check("POST without the owner cookie → 401", (await post({ id: randomUUID(), method: "CASH", amount: 10 }, false)).status === 401);
  check("an amount of 0 → 400", (await pay(randomUUID(), 0)).status === 400);
  check("an id that is not a UUID → 400", (await pay("not-a-uuid", 10)).status === 400);
  check("a payout that names an entry to correct → 400", (await post({ id: randomUUID(), method: "CASH", amount: 10, correctsId: randomUUID() })).status === 400);
  check("an unknown barber → 404", (await post({ id: randomUUID(), method: "CASH", amount: 10, barberId: `nobody-${RUN}` })).status === 404);
  check("nothing was saved by the refused requests", (await entryCount()) === 0);

  console.log("\nCase 1: ₱500 at midday, ₱500 at night");
  const id1 = randomUUID();
  let res = await pay(id1, 500);
  check("first ₱500 saved: paid 500.00, Remaining 500.00, one entry", res.status === 200 && res.body.row.paidTotal === "500.00" && res.body.row.remaining === "500.00" && res.body.row.entries.length === 1, JSON.stringify(res.body));
  check("a part payment is not \"additional owed\"", res.body.row?.additionalOwed === false && res.body.row.paid === true);
  check("the entry keeps barber, method, amount and time", res.body.entry?.method === "CASH" && res.body.entry.amount === "500.00" && res.body.entry.kind === "PAYOUT" && !!res.body.entry.recordedAt);

  console.log("\nCase 2: Save tapped twice");
  const id2 = randomUUID();
  const [a, b] = await Promise.all([pay(id2, 500), pay(id2, 500)]);
  check("both taps answer 200, exactly one is a replay", a.status === 200 && b.status === 200 && [a.body.replay, b.body.replay].filter(Boolean).length === 1, JSON.stringify([a.body.replay, b.body.replay]));
  check("two entries stored, not three", (await entryCount()) === 2);
  let row = await myRow(D);
  check("Remaining goes to 0.00 after the second ₱500", row?.remaining === "0.00" && row.paidTotal === "1000.00" && row.entries.length === 2, JSON.stringify(row));
  res = await pay(id2, 400);
  check("the same id with a different amount → 409 ID_CONFLICT", res.status === 409 && res.body.code === "ID_CONFLICT", JSON.stringify(res.body));

  console.log("\nCase 3: an amount above what is still owed");
  res = await pay(randomUUID(), 1);
  check("₱1 more → 409 OVERPAYMENT with remaining 0.00", res.status === 409 && res.body.code === "OVERPAYMENT" && res.body.remaining === "0.00" && /₱0\.00/.test(res.body.error ?? ""), JSON.stringify(res.body));
  check("nothing was saved", (await entryCount()) === 2);

  console.log("\nCase 4: a wrong amount is corrected by a new entry");
  check("a correction without a reason → 400", (await correct(randomUUID(), id2, 100, undefined)).status === 400);
  check("a correction with the other method → 400", (await correct(randomUUID(), id2, 100, "wrong method", "GCASH")).status === 400);
  check("a correction of an unknown entry → 400", (await correct(randomUUID(), randomUUID(), 100, "no such entry")).status === 400);
  const fix = randomUUID();
  res = await correct(fix, id2, 200, "typed 500, paid 300");
  check("a ₱200 correction of the second payout saves", res.status === 200 && res.body.entry?.amount === "-200.00" && res.body.entry.kind === "CORRECTION" && res.body.entry.correctsId === id2, JSON.stringify(res.body));
  row = res.body.row;
  check("both stay visible: three entries, Remaining 200.00", row?.entries.length === 3 && row.remaining === "200.00" && row.paidTotal === "800.00", JSON.stringify(row));
  check("the corrected payout has ₱300.00 left to correct; the correction has none", row?.entries.find((e) => e.id === id2)?.correctableLeft === "300.00" && row.entries.find((e) => e.id === fix)?.correctableLeft === "0.00");
  res = await correct(randomUUID(), id2, 300.01, "too much");
  check("correcting more than is left → 409 CORRECTION_TOO_LARGE, left 300.00", res.status === 409 && res.body.code === "CORRECTION_TOO_LARGE" && res.body.left === "300.00", JSON.stringify(res.body));
  check("a correction of a correction → 400", (await correct(randomUUID(), fix, 10, "again")).status === 400);
  check("the cash correction returns to the drawer: cash payouts 800.00", (await recon(D)).expected.cashPayouts === "800.00");

  console.log("\nCase 6: a payout after the cash count was saved");
  const saved = await request<{ success: boolean }>("POST", "/api/v1/reports/reconciliation", { date: D, countedCash: 1200, pettyCashAmount: 0 });
  check("setup: count saved (expected 2000 − 800 = 1200)", saved.status === 200);
  check("a GCash payout of ₱100 saves", (await pay(randomUUID(), 100, "GCASH")).status === 200);
  let rec = await recon(D);
  check("…and does not mark the count out of date", rec.staleness?.stale === false, JSON.stringify(rec.staleness));
  check("a cash payout of ₱100 saves", (await pay(randomUUID(), 100)).status === 200);
  rec = await recon(D);
  check("…and marks it out of date (EXPECTED_CASH_CHANGED, −100.00) at once", rec.staleness?.stale === true && rec.staleness.staleReasons.join() === "EXPECTED_CASH_CHANGED" && rec.staleness.expectedCashDelta === "-100.00", JSON.stringify(rec.staleness));

  console.log("\nCase 5: a late sale after the barber was paid in full");
  row = await myRow(D);
  check("setup: fully paid (Remaining 0.00, five entries)", row?.remaining === "0.00" && row.entries.length === 5 && row.additionalOwed === false, JSON.stringify(row));
  const before = JSON.stringify(row?.entries);
  await syncSale(D, "18:00", 400); // owed 1,200.00
  row = await myRow(D);
  check("Remaining is 200.00 again and shows as additional owed", row?.remaining === "200.00" && row.additionalOwed === true, JSON.stringify(row));
  check("the earlier entries are unchanged", JSON.stringify(row?.entries) === before);
  check("paying the ₱200 clears additional owed", (await pay(randomUUID(), 200)).status === 200 && (await myRow(D))?.additionalOwed === false);

  console.log("\nFuture dates");
  const tomorrow = manilaToday(new Date(Date.now() + 36 * 3600 * 1000));
  const rowsBefore = await prisma.dailyPayoutLedger.count({ where: { businessDate: dateValue(tomorrow) } });
  check("GET a future date → 422", (await ledger(tomorrow)).status === 422);
  check("POST on a future date → 422", (await post({ id: randomUUID(), method: "CASH", amount: 10, date: tomorrow })).status === 422);
  check("no ledger row was written for it", (await prisma.dailyPayoutLedger.count({ where: { businessDate: dateValue(tomorrow) } })) === rowsBefore);

  console.log("\nThe old request body (totals)");
  await syncSale(D_OLD, "10:00", 600); // owed 300.00
  const old = (cashPaid: number, gcashPaid: number) => request<PostBody>("POST", "/api/v1/reports/payouts", { date: D_OLD, barberId: BARBER, commissionBase: "LIST_PRICE", cashPaid, gcashPaid, paid: false });
  res = await old(100, 0);
  check("cashPaid 100 (paid false) saves one ₱100 entry and counts as paid", res.status === 200 && res.body.row.entries.length === 1 && res.body.row.cashPaid === "100.00" && res.body.row.paid === true, JSON.stringify(res.body));
  check("the same totals again add nothing", (await old(100, 0)).status === 200 && (await myRow(D_OLD))?.entries.length === 1);
  res = await old(50, 0);
  check("a lower total → 409 TOTAL_DECREASE", res.status === 409 && res.body.code === "TOTAL_DECREASE", JSON.stringify(res.body));
  res = await old(100, 250);
  check("totals above what is owed → 409 OVERPAYMENT, remaining 200.00", res.status === 409 && res.body.code === "OVERPAYMENT" && res.body.remaining === "200.00", JSON.stringify(res.body));
  check("the ₱100 counts against that day's drawer although paid was false", (await recon(D_OLD)).expected.cashPayouts === "100.00");

  console.log("\nCase 7: every ledger row equals its entries (whole database)");
  const [mismatch] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    "SELECT COUNT(*) n FROM daily_payout_ledgers l WHERE l.cash_paid <> COALESCE((SELECT SUM(amount) FROM payout_entries p WHERE p.ledger_id = l.id AND p.method = 'CASH'), 0) OR l.gcash_paid <> COALESCE((SELECT SUM(amount) FROM payout_entries p WHERE p.ledger_id = l.id AND p.method = 'GCASH'), 0) OR ((l.cash_paid <> 0 OR l.gcash_paid <> 0) AND l.paid_at IS NULL)"
  );
  check("no row differs from the sums of its entries, and every row with an amount has paid_at", Number(mismatch.n) === 0, `${mismatch.n} rows differ`);
  const [orphans] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    "SELECT COUNT(*) n FROM payout_entries p WHERE p.barber_id <> (SELECT barber_id FROM daily_payout_ledgers l WHERE l.id = p.ledger_id) OR p.business_date <> (SELECT business_date FROM daily_payout_ledgers l WHERE l.id = p.ledger_id)"
  );
  check("every entry's barber and date match its ledger row", Number(orphans.n) === 0, `${orphans.n} entries differ`);
}

async function cleanupDates() {
  // Ledger rows on the test dates (entries cascade), including zero rows for real barbers.
  await prisma.dailyPayoutLedger.deleteMany({ where: { businessDate: { in: DATES.map(dateValue) } } });
  await prisma.shiftReconciliation.deleteMany({ where: { reconciliationDate: { in: DATES.map(dateValue) } } });
}

async function cleanup() {
  try {
    await cleanupDates();
    await prisma.dailyPayoutLedger.deleteMany({ where: { barberId: BARBER } });
    await prisma.transaction.deleteMany({ where: { OR: [{ id: { in: txIds } }, { barberId: BARBER }] } });
    await prisma.barber.deleteMany({ where: { id: BARBER } });
  } finally {
    await devices.cleanup(prisma);
  }
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

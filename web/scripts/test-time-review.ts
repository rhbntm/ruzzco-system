/**
 * Integration test for the owner's date review of flagged sales (L5): flagged sales stay out
 * of every day's figures until reviewed, then count once on the confirmed day; the review is
 * owner-only, idempotent and never changes the commission snapshot; a sale reviewed onto a
 * day whose payout was already marked paid shows as additional owed without touching the
 * paid amount.
 *
 *   npm run dev                 (in another terminal; OWNER_PIN in web/.env)
 *   npm run test:time-review    (TEST_BASE_URL overrides http://localhost:3000)
 *
 * Uses a throwaway barber and two fixed past business dates (2000-03-15, 2000-03-16). One
 * sale is reviewed onto today for a moment; everything it creates is deleted at the end.
 */
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { prisma } from "../src/lib/prisma";
import { manilaToday } from "../src/lib/business-date";

loadEnvConfig(process.cwd());

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const SERVICE_ID = "10000000-0000-0000-0000-000000000001"; // seeded Haircut
const RUN = randomUUID().slice(0, 8);
const BARBER = `test-review-${RUN}`;
const D_REC = "2000-03-15";
const D_PAY = "2000-03-16";
// Manila wall time as a UTC ISO string: the sync schema accepts only `Z` timestamps.
const AT = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+08:00`).toISOString();
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

async function request<T>(method: "GET" | "POST", path: string, body?: unknown, owner = true): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(owner && ownerCookie ? { Cookie: ownerCookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as T };
}

type Expected = { cashTotal: string; cashPayouts: string; expectedDrawerCash: string; totalRevenue: string; transactionCount: number };
type Recon = {
  expected: Expected;
  saved: { revision: number } | null;
  staleness: { stale: boolean; staleReasons: string[]; lateReviewedCount: number } | null;
  needsDateReview: { id: string; statedDate: string; receivedDate: string; flag: string }[];
};
type LedgerRow = { barberId: string; commissionTotal: string; totalOwed: string; cashPaid: string; paid: boolean; additionalOwed: boolean };
type Ledger = { rows: LedgerRow[]; heldForReview: number };
type Review = { success: boolean; status?: string; businessDate?: string; error?: string };

const recon = async (date: string) => (await request<Recon>("GET", `/api/v1/reports/reconciliation?date=${date}`)).body;
const ledger = async (date: string) => (await request<Ledger>("GET", `/api/v1/reports/payouts?date=${date}`)).body;
const myRow = (l: Ledger) => l.rows.find((r) => r.barberId === BARBER);
const review = (transactionId: string, choice: string, owner = true) => request<Review>("POST", "/api/v1/reports/time-review", { transactionId, choice }, owner);

function sale(transactionTime: string, amount: number) {
  const id = randomUUID();
  txIds.push(id);
  return { id, barberId: BARBER, serviceId: SERVICE_ID, totalAmount: amount, paymentMethod: "CASH", transactionTime };
}

// sentAt is the phone's clock at sending. Sending a 2000-dated sale with a 2000 clock makes
// the server flag it DEVICE_CLOCK_SKEW (the server's clock says today).
async function syncSale(item: ReturnType<typeof sale>, sentAt?: string) {
  const res = await request<{ syncedIds: string[] }>("POST", "/api/v1/transactions/sync", { transactions: [item], ...(sentAt ? { sentAt } : {}) }, false);
  return res.body.syncedIds.includes(item.id);
}

async function main() {
  console.log(`Date review test against ${BASE} (run ${RUN})`);
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
  await prisma.barber.create({ data: { id: BARBER, fullName: `Test Barber Review ${RUN}`, commissionRate: 0.5 } });
  const today = manilaToday();
  const todayCash0 = Number((await recon(today)).expected.cashTotal);

  console.log("\nFlagged sales count nowhere until reviewed");
  const normal = sale(AT(D_REC, "10:00"), 200);
  check("an ordinary old offline sale syncs", await syncSale(normal));
  const flagged = sale(AT(D_REC, "11:00"), 150);
  check("a sale from a phone whose clock says 2000 syncs too", await syncSale(flagged, AT(D_REC, "11:05")));
  check("it is stored flagged DEVICE_CLOCK_SKEW", (await prisma.transaction.findUnique({ where: { id: flagged.id } }))?.timeFlag === "DEVICE_CLOCK_SKEW");
  let rec = await recon(D_REC);
  check("its stated day counts only the ordinary sale (₱200, 1 sale)", rec.expected.cashTotal === "200.00" && rec.expected.transactionCount === 1, JSON.stringify(rec.expected));
  check("it is listed for review on its stated day", rec.needsDateReview.some((s) => s.id === flagged.id && s.statedDate === D_REC && s.receivedDate === today));
  let todayRec = await recon(today);
  check("and on the day it was received", todayRec.needsDateReview.some((s) => s.id === flagged.id));
  check("but it is not in today's figures either", Number(todayRec.expected.cashTotal) === todayCash0);

  const saved = await request<Recon>("POST", "/api/v1/reports/reconciliation", { date: D_REC, countedCash: 200 });
  check("the stated day is reconciled at ₱200, not stale", saved.status === 200 && saved.body.staleness?.stale === false);

  console.log("\nThe review");
  check("without the owner PIN → 401", (await review(flagged.id, "STATED_DATE", false)).status === 401);
  const snapshotBefore = await prisma.transaction.findUniqueOrThrow({ where: { id: flagged.id } });
  let r = await review(flagged.id, "STATED_DATE");
  check("keep the stated date → reviewed onto 2000-03-15", r.status === 200 && r.body.status === "reviewed" && r.body.businessDate === D_REC, JSON.stringify(r.body));
  rec = await recon(D_REC);
  check("now its stated day counts it: ₱350, 2 sales", rec.expected.cashTotal === "350.00" && rec.expected.transactionCount === 2, JSON.stringify(rec.expected));
  check("the saved reconciliation is stale with TIME_REVIEWED", rec.staleness?.stale === true && rec.staleness.staleReasons.includes("TIME_REVIEWED") && rec.staleness.lateReviewedCount === 1, JSON.stringify(rec.staleness));
  check("it is no longer listed for review there", !rec.needsDateReview.some((s) => s.id === flagged.id));
  todayRec = await recon(today);
  check("nor on the received day, and today's figures are unchanged (no double count)", !todayRec.needsDateReview.some((s) => s.id === flagged.id) && Number(todayRec.expected.cashTotal) === todayCash0);
  const snapshotAfter = await prisma.transaction.findUniqueOrThrow({ where: { id: flagged.id } });
  check(
    "the sale's timestamp and commission snapshot did not change",
    snapshotAfter.transactionTime.getTime() === snapshotBefore.transactionTime.getTime() &&
      snapshotAfter.barberCommissionAmount.equals(snapshotBefore.barberCommissionAmount) &&
      snapshotAfter.commissionRate.equals(snapshotBefore.commissionRate) &&
      snapshotAfter.totalAmount.equals(snapshotBefore.totalAmount)
  );

  r = await review(flagged.id, "STATED_DATE");
  const again = await prisma.transaction.findUniqueOrThrow({ where: { id: flagged.id } });
  check("the same review again is a no-op (200 unchanged)", r.status === 200 && r.body.status === "unchanged" && again.timeReviewedAt?.getTime() === snapshotAfter.timeReviewedAt?.getTime());
  check("a different choice afterwards → 409", (await review(flagged.id, "RECEIVED_DATE")).status === 409);
  check("an ordinary sale has nothing to review → 409", (await review(normal.id, "STATED_DATE")).status === 409);
  check("an unknown sale → 404", (await review(randomUUID(), "STATED_DATE")).status === 404);
  check("a bad choice → 400", (await review(flagged.id, "TOMORROW")).status === 400);

  console.log("\nA future stated date");
  const future = sale(new Date(Date.now() + 26 * 3600 * 1000).toISOString(), 120);
  await syncSale(future);
  check("a sale stamped tomorrow is flagged FUTURE_TIMESTAMP", (await prisma.transaction.findUnique({ where: { id: future.id } }))?.timeFlag === "FUTURE_TIMESTAMP");
  check("keeping a date that has not happened → 422", (await review(future.id, "STATED_DATE")).status === 422);
  r = await review(future.id, "RECEIVED_DATE");
  check("using the received date puts it on today", r.status === 200 && r.body.businessDate === today);
  check("today's cash grows by exactly its ₱120", Number((await recon(today)).expected.cashTotal) === todayCash0 + 120);

  console.log("\nReviewed onto a day whose payout is already paid");
  const paidSale = sale(AT(D_PAY, "10:00"), 200);
  await syncSale(paidSale);
  let l = await ledger(D_PAY);
  check("the day's ledger shows ₱100 commission", myRow(l)?.commissionTotal === "100.00", JSON.stringify(myRow(l)));
  const pay = await request<{ success: boolean }>("POST", "/api/v1/reports/payouts", { date: D_PAY, barberId: BARBER, commissionBase: "LIST_PRICE", cashPaid: 100, gcashPaid: 0, paid: true });
  check("the payout is marked paid with ₱100 cash", pay.status === 200);
  const late = sale(AT(D_PAY, "15:00"), 300);
  await syncSale(late, AT(D_PAY, "15:02"));
  l = await ledger(D_PAY);
  check("a flagged ₱300 sale stated that day is held: still ₱100, 1 held", myRow(l)?.commissionTotal === "100.00" && l.heldForReview === 1, JSON.stringify({ row: myRow(l), held: l.heldForReview }));
  r = await review(late.id, "STATED_DATE");
  l = await ledger(D_PAY);
  const row = myRow(l);
  check("after review the commission is ₱250", row?.commissionTotal === "250.00" && row.totalOwed === "250.00", JSON.stringify(row));
  check("the amount already paid is unchanged (₱100) and still marked paid", row?.cashPaid === "100.00" && row.paid === true);
  check("the extra ₱150 shows as additional owed", row?.additionalOwed === true);
  check("nothing is held any more", l.heldForReview === 0);
  const payRec = await recon(D_PAY);
  check("the drawer counts the ₱100 payout once: expected ₱200 + ₱300 - ₱100 = ₱400", payRec.expected.cashPayouts === "100.00" && payRec.expected.expectedDrawerCash === "400.00", JSON.stringify(payRec.expected));
  await review(late.id, "STATED_DATE");
  check("reviewing it again does not add the commission twice", myRow(await ledger(D_PAY))?.commissionTotal === "250.00");
  const lateRow = await prisma.transaction.findUniqueOrThrow({ where: { id: late.id } });
  check("its commission snapshot is unchanged (₱150 at 0.5)", Number(lateRow.barberCommissionAmount) === 150 && Number(lateRow.commissionRate) === 0.5);
}

async function cleanup() {
  const dates = [D_REC, D_PAY].map((d) => new Date(`${d}T00:00:00.000Z`));
  await prisma.shiftReconciliation.deleteMany({ where: { reconciliationDate: { in: dates } } });
  await prisma.dailyPayoutLedger.deleteMany({ where: { OR: [{ businessDate: { in: dates } }, { barberId: BARBER }] } });
  await prisma.transaction.deleteMany({ where: { OR: [{ id: { in: txIds } }, { barberId: BARBER }] } });
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

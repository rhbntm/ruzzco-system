/**
 * Integration test for commission snapshots and the payout ledger.
 *
 * Calls the REAL routes (POST /api/v1/transactions/sync, GET/POST /api/v1/reports/payouts)
 * on a running dev server and checks the stored rows with Prisma.
 *
 *   npm run dev                  (in another terminal)
 *   npm run test:commission      (TEST_BASE_URL overrides http://localhost:3000)
 *
 * Needs OWNER_PIN in web/.env (read, never printed). Uses throwaway barbers and a fixed
 * past business date; its sales, ledger rows (for every barber on that date), assignments
 * and barbers are deleted at the end.
 */
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { commissionFor } from "../src/lib/commission";

loadEnvConfig(process.cwd());

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const SERVICE_ID = "10000000-0000-0000-0000-000000000001"; // seeded Haircut
const RUN = randomUUID().slice(0, 8);
const DATE = "2000-01-03"; // no real sales; every ledger row on it is test data
const AT = (hhmm: string) => new Date(`${DATE}T${hhmm}:00+08:00`).toISOString();

const BARBERS = {
  A: { id: `test-com-A-${RUN}`, rate: 0.4, active: true }, // rate changes mid-test
  B: { id: `test-com-B-${RUN}`, rate: 0.5, active: true }, // rounding
  I: { id: `test-com-I-${RUN}`, rate: 0.3, active: true }, // deactivated after its sale syncs
  J: { id: `test-com-J-${RUN}`, rate: 0.35, active: true }, // deactivated before its sale syncs
  N: { id: `test-com-N-${RUN}`, rate: 0.25, active: false }, // inactive, no sales
};

const txIds: string[] = [];
const deviceKeys: string[] = [];
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

type SyncResponse = { syncedIds: string[]; rejected: { id: string | null; reason: string }[]; duplicatesSkipped: number };
type LedgerRow = {
  barberId: string; commissionTotal: string; tipTotal: string; totalOwed: string;
  cashPaid: string; gcashPaid: string; paid: boolean; additionalOwed: boolean;
};

const sync = (items: unknown[]) => request<SyncResponse>("POST", "/api/v1/transactions/sync", { transactions: items });
const ledger = async (base: "LIST_PRICE" | "AMOUNT_PAID" = "LIST_PRICE") => {
  const res = await request<{ success: boolean; rows: LedgerRow[] }>("GET", `/api/v1/reports/payouts?date=${DATE}&commissionBase=${base}`);
  if (res.status !== 200 || !res.body.success) throw new Error(`ledger GET failed with ${res.status}`);
  return res.body.rows;
};
const pay = (barberId: string, cashPaid: number) =>
  request<{ success: boolean; row: LedgerRow }>("POST", "/api/v1/reports/payouts", {
    date: DATE, barberId, commissionBase: "LIST_PRICE", cashPaid, gcashPaid: 0, paid: true,
  });
const rowFor = (rows: LedgerRow[], barberId: string) => rows.find((r) => r.barberId === barberId);

type SaleOpts = { barberId: string; time: string; list?: number; paid?: number } & Record<string, unknown>;
function sale({ barberId, time, list = 150, paid = list, ...extra }: SaleOpts) {
  const id = randomUUID();
  txIds.push(id);
  return {
    id,
    barberId,
    serviceId: SERVICE_ID,
    totalAmount: paid,
    listPrice: list,
    amountPaid: paid,
    paymentMethod: "CASH",
    transactionTime: AT(time),
    ...extra,
  };
}

async function stored(id: string) {
  return prisma.transaction.findUnique({ where: { id }, include: { commissionLogs: true } });
}

const setRate = (id: string, rate: number) => prisma.barber.update({ where: { id }, data: { commissionRate: rate } });
const deactivate = (id: string) => prisma.barber.update({ where: { id }, data: { isActive: false } });
const eq = (value: unknown, expected: string) => value != null && new Prisma.Decimal(String(value)).eq(expected);

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Commission and payout integration test against ${BASE} (run ${RUN}, date ${DATE})`);
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

  await prisma.dailyPayoutLedger.deleteMany({ where: { businessDate: new Date(`${DATE}T00:00:00.000Z`) } });
  for (const [key, b] of Object.entries(BARBERS)) {
    await prisma.barber.create({ data: { id: b.id, fullName: `Test Barber ${key} ${RUN}`, commissionRate: b.rate, isActive: b.active } });
  }

  console.log("\nC14 half-up rounding in the shared helper");
  for (const [base, rate, want] of [
    [2.01, 0.5, "1.01"], // float Math.round gives 1.00
    [0.01, 0.5, "0.01"], // 0.005 up, not to even
    [0.05, 0.5, "0.03"], // 0.025 up, not to even (0.02)
    [99.99, 0.35, "35.00"], // 34.9965
    [150, 0.4, "60.00"],
  ] as const) {
    const got = commissionFor(base, rate);
    check(`${base} × ${rate} = ${want}`, got.toFixed(2) === want, `got ${got.toFixed(2)}`);
  }

  console.log("\nC1/C2/C4 discounted sale is snapshotted on list price at the server-side rate");
  const s1 = sale({ barberId: BARBERS.A.id, time: "09:00", list: 150, paid: 120, discountType: "PERCENT", discountAmount: 30 });
  let res = await sync([s1]);
  check("C1: sale accepted", res.status === 200 && res.body.syncedIds.includes(s1.id), JSON.stringify(res.body));
  let tx = await stored(s1.id);
  check("C1: commissionRate stored as 0.40", eq(tx?.commissionRate, "0.40"), `got ${tx?.commissionRate}`);
  check("C2/C4: barberCommissionAmount is 60.00 (150 list × 0.40, not 120 paid)", eq(tx?.barberCommissionAmount, "60.00") && tx?.commissionBase === "LIST_PRICE", `got ${tx?.barberCommissionAmount}`);
  check("C4: amountPaid stays 120.00", eq(tx?.amountPaid, "120.00"));

  console.log("\nC14 sync uses the same half-up helper");
  const sRound = sale({ barberId: BARBERS.B.id, time: "09:10", list: 2.01, customAmount: true });
  await sync([sRound]);
  tx = await stored(sRound.id);
  check("custom 2.01 at 0.50 stored as 1.01", eq(tx?.barberCommissionAmount, "1.01"), `got ${tx?.barberCommissionAmount}`);

  console.log("\nC3 a rate change does not rewrite the past");
  await setRate(BARBERS.A.id, 0.6);
  let rows = await ledger();
  check("C3: ledger commission for A still 60.00 after the rate went to 0.60", rowFor(rows, BARBERS.A.id)?.commissionTotal === "60.00", JSON.stringify(rowFor(rows, BARBERS.A.id)));
  tx = await stored(s1.id);
  check("C3: stored snapshot unchanged (0.40, 60.00)", eq(tx?.commissionRate, "0.40") && eq(tx?.barberCommissionAmount, "60.00"));

  console.log("\nC5/C6 a later sale uses the new rate; mixed rates add up");
  const s2 = sale({ barberId: BARBERS.A.id, time: "11:00", list: 150 });
  await sync([s2]);
  tx = await stored(s2.id);
  check("C5: new sale stored at 0.60 = 90.00", eq(tx?.commissionRate, "0.60") && eq(tx?.barberCommissionAmount, "90.00"), `got ${tx?.commissionRate} / ${tx?.barberCommissionAmount}`);
  rows = await ledger();
  check("C6: ledger commission for A is 150.00 (60 + 90)", rowFor(rows, BARBERS.A.id)?.commissionTotal === "150.00", JSON.stringify(rowFor(rows, BARBERS.A.id)));

  console.log("\nAMOUNT_PAID view is display-only and uses the snapshotted rates");
  rows = await ledger("AMOUNT_PAID");
  check("view shows 138.00 (120 × 0.40 + 150 × 0.60)", rowFor(rows, BARBERS.A.id)?.commissionTotal === "138.00", JSON.stringify(rowFor(rows, BARBERS.A.id)));
  const dbRow = await prisma.dailyPayoutLedger.findFirst({ where: { barberId: BARBERS.A.id } });
  check("stored ledger commissionTotal still the LIST_PRICE 150.00", eq(dbRow?.commissionTotal, "150.00") && eq(dbRow?.totalOwed, "150.00"), `got ${dbRow?.commissionTotal}`);

  console.log("\nC7 a paid day does not show additional owed after a rate change");
  const paidA = await pay(BARBERS.A.id, 150);
  check("C7: payout saved for A", paidA.status === 200 && paidA.body.row.paid && !paidA.body.row.additionalOwed, JSON.stringify(paidA.body));
  await setRate(BARBERS.A.id, 0.8);
  rows = await ledger();
  const a = rowFor(rows, BARBERS.A.id);
  check("C7: after the rate went to 0.80, A is still 150.00 owed, paid, no additional owed", a?.totalOwed === "150.00" && a.paid && !a.additionalOwed, JSON.stringify(a));

  console.log("\nC11 a duplicate re-sync after a rate change keeps the original snapshot");
  res = await sync([s1, { ...s1, listPrice: 500, totalAmount: 500, amountPaid: 500, barberId: BARBERS.B.id }]);
  check("C11: both copies acknowledged as duplicates", res.body.syncedIds.filter((id) => id === s1.id).length === 2 && res.body.duplicatesSkipped === 2, JSON.stringify(res.body));
  tx = await stored(s1.id);
  check("C11: still A, 0.40, 60.00, list 150", tx?.barberId === BARBERS.A.id && eq(tx.commissionRate, "0.40") && eq(tx.barberCommissionAmount, "60.00") && eq(tx.listPrice, "150.00"));

  console.log("\nC8 an inactive barber with sales stays visible and payable");
  const sI = sale({ barberId: BARBERS.I.id, time: "12:00", list: 150, tipAmount: 20 });
  await sync([sI]);
  await deactivate(BARBERS.I.id);
  rows = await ledger();
  const i = rowFor(rows, BARBERS.I.id);
  check("C8: I appears with 45.00 commission, 20.00 tip, 65.00 owed", i?.commissionTotal === "45.00" && i.tipTotal === "20.00" && i.totalOwed === "65.00", JSON.stringify(i));
  const paidI = await pay(BARBERS.I.id, 65);
  check("C8: payout for inactive I saves", paidI.status === 200 && paidI.body.row?.paid === true && paidI.body.row.cashPaid === "65.00", JSON.stringify(paidI.body));

  console.log("\nC9 an inactive barber with no sales and no row is not included");
  check("C9: N not in the ledger", !rowFor(rows, BARBERS.N.id));
  check("C9: no ledger row stored for N", (await prisma.dailyPayoutLedger.count({ where: { barberId: BARBERS.N.id } })) === 0);

  console.log("\nC10 a barber deactivated before sync: the sale is accepted and payable");
  const devJ = randomUUID();
  deviceKeys.push(devJ);
  const asgJ = randomUUID();
  const bindJ = await request<{ success: boolean }>("POST", "/api/v1/devices/bind", { deviceKey: devJ, barberId: BARBERS.J.id, assignmentId: asgJ });
  check("C10: setup: device bound to J while active", bindJ.status === 200);
  const sJ = sale({ barberId: BARBERS.J.id, time: "13:00", list: 150, deviceKey: devJ, assignmentId: asgJ });
  await deactivate(BARBERS.J.id);
  res = await sync([sJ]);
  check("C10: sale accepted after J was deactivated", res.body.syncedIds.includes(sJ.id) && res.body.rejected.length === 0, JSON.stringify(res.body));
  tx = await stored(sJ.id);
  check("C10: stored for J at 0.35 = 52.50", tx?.barberId === BARBERS.J.id && eq(tx.commissionRate, "0.35") && eq(tx.barberCommissionAmount, "52.50"));
  rows = await ledger();
  check("C10: J appears with 52.50", rowFor(rows, BARBERS.J.id)?.commissionTotal === "52.50", JSON.stringify(rowFor(rows, BARBERS.J.id)));
  const paidJ = await pay(BARBERS.J.id, 52.5);
  check("C10: payout for J saves", paidJ.status === 200 && paidJ.body.row?.paid === true);

  console.log("\nC12/C13 one commission log per sale; the ledger does not count them again");
  const all = await prisma.transaction.findMany({ where: { id: { in: txIds } }, include: { commissionLogs: true } });
  check(`C12: every stored sale (${all.length}) has exactly one matching commission log`, all.length === 5 && all.every((t) =>
    t.commissionLogs.length === 1 && t.commissionLogs[0].barberId === t.barberId && t.commissionLogs[0].amount.eq(t.barberCommissionAmount)));
  rows = await ledger();
  for (const b of Object.values(BARBERS)) {
    const sum = all.filter((t) => t.barberId === b.id).reduce((acc, t) => acc.add(t.barberCommissionAmount), new Prisma.Decimal(0));
    const row = rowFor(rows, b.id);
    if (!row) continue;
    check(`C13: ${b.id.split("-")[2]} ledger ${row.commissionTotal} = sum of sale snapshots ${sum.toFixed(2)}`, row.commissionTotal === sum.toFixed(2));
  }

  console.log("\nC16 schema: commission_rate is required and never null");
  const [col] = await prisma.$queryRaw<{ nullable: string }[]>`
    SELECT IS_NULLABLE AS nullable FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactions' AND COLUMN_NAME = 'commission_rate'`;
  check("C16: transactions.commission_rate is NOT NULL", col?.nullable === "NO", JSON.stringify(col));
  const [nulls] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM transactions WHERE commission_rate IS NULL`;
  check("C16: no transaction has a null commission_rate", Number(nulls.n) === 0);
}

async function cleanup() {
  const barberIds = Object.values(BARBERS).map((b) => b.id);
  // Every row on the test date, including the zero rows the GET creates for real barbers.
  await prisma.dailyPayoutLedger.deleteMany({ where: { OR: [{ businessDate: new Date(`${DATE}T00:00:00.000Z`) }, { barberId: { in: barberIds } }] } });
  await prisma.syncMismatchLog.deleteMany({ where: { transactionId: { in: txIds } } });
  // Items and commission logs cascade with the transaction.
  await prisma.transaction.deleteMany({ where: { OR: [{ id: { in: txIds } }, { barberId: { in: barberIds } }] } });
  await prisma.deviceAssignment.deleteMany({ where: { OR: [{ deviceKey: { in: deviceKeys } }, { barberId: { in: barberIds } }] } });
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

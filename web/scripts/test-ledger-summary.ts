/**
 * Slice 10: the ledger summary. Part 1 is pure (periods and arithmetic, invented numbers).
 * Part 2 calls the REAL route on a running dev server.
 *
 *   npm run dev                     (in another terminal)
 *   npm run test:ledger-summary     (TEST_BASE_URL overrides http://localhost:3000)
 *
 * Needs OWNER_PIN in web/.env (read, never printed). Uses a throwaway barber and fixed past dates
 * in February 2000 (no real data); its sales, ledger rows, reconciliations and barber are deleted
 * at the end.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { loadEnvConfig } from "@next/env";
import { prisma } from "../src/lib/prisma";
import { latestRevisionPerDate, leftForShop, periodDates, remainingToPay, serviceGap } from "../src/lib/ledger-summary";

loadEnvConfig(process.cwd());

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const SERVICE_ID = "10000000-0000-0000-0000-000000000001"; // seeded Haircut
const RUN = randomUUID().slice(0, 8);
const BARBER = `test-sum-${RUN}`;
const MONTH = periodDates("2000-02-15", "month"); // all of February 2000
const TUE = "2000-02-08"; // week = Mon 2000-02-07 .. Sun 2000-02-13
const WED = "2000-02-09";
const THU = "2000-02-10";
const dateValue = (date: string) => new Date(`${date}T00:00:00.000Z`);
const AT = (date: string, time: string) => new Date(`${date}T${time}+08:00`).toISOString();
const D = (value: string | number) => new Prisma.Decimal(value);

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

type Summary = {
  success: boolean; error?: string; from: string; to: string; period: string;
  sales: { cash: string; gcash: string; maya: string; qrph: string; total: string; count: number };
  shared: { commissions: string; tips: string; pettyCash: string; pettyCashRecorded: boolean };
  leftForShop: string;
  payouts: { owed: string; paid: string; remaining: string };
  services: { name: string; count: number; listSales: string }[];
  serviceGap: string;
  days: { date: string; revenue: string; commissions: string }[];
  pettyCashMissingDays: number;
};

async function call<T>(method: "GET" | "POST", path: string, body?: unknown, cookie = ownerCookie): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as T };
}

const summary = (date: string, period = "day", base = "LIST_PRICE", cookie = ownerCookie) =>
  call<Summary>("GET", `/api/v1/reports/ledger-summary?date=${date}&period=${period}&commissionBase=${base}`, undefined, cookie);

function sale(date: string, time: string, amount: number, method: "CASH" | "GCASH" | "MAYA" = "CASH", tipAmount = 0) {
  const id = randomUUID();
  txIds.push(id);
  return {
    id, barberId: BARBER, serviceId: SERVICE_ID, totalAmount: amount, listPrice: amount, amountPaid: amount,
    tipAmount, customAmount: true, paymentMethod: method, transactionTime: AT(date, time),
  };
}

function pure() {
  console.log("Periods");
  check("day is just the date", periodDates("2026-10-14", "day").join() === "2026-10-14");
  const wed = periodDates("2026-10-14", "week"); // a Wednesday
  check("week runs Monday to Sunday", wed.length === 7 && wed[0] === "2026-10-12" && wed[6] === "2026-10-18", wed.join());
  check("a Monday starts its own week", periodDates("2026-10-12", "week")[0] === "2026-10-12");
  check("a Sunday ends its own week", periodDates("2026-10-18", "week")[6] === "2026-10-18" && periodDates("2026-10-18", "week")[0] === "2026-10-12");
  const crossing = periodDates("2026-09-30", "week");
  check("a week can cross a month end", crossing[0] === "2026-09-28" && crossing[6] === "2026-10-04", crossing.join());
  check("February 2000 has 29 days", MONTH.length === 29 && MONTH[0] === "2000-02-01" && MONTH[28] === "2000-02-29");
  check("February 2026 has 28 days", periodDates("2026-02-10", "month").length === 28);
  check("December has 31 days and ends on the 31st", periodDates("2026-12-05", "month").at(-1) === "2026-12-31" && periodDates("2026-12-05", "month").length === 31);

  console.log("\nArithmetic");
  check("left for the shop = revenue - commissions - petty cash", leftForShop(D(300), D(150), D(50)).equals(100));
  check("tips are never subtracted (they are not in revenue)", leftForShop(D(300), D(150), D(0)).equals(150));
  check("a zero day is zero", leftForShop(D(0), D(0), D(0)).isZero());
  check("remaining is owed - paid", remainingToPay(D(170), D(100)).equals(70));
  check("remaining never goes below zero", remainingToPay(D(50), D(80)).isZero());
  check("a discount makes the service gap negative", serviceGap(D(180), D(200)).equals(-20));
  check("a custom amount above list makes it positive", serviceGap(D(250), D(200)).equals(50));
  const latest = latestRevisionPerDate([
    { date: "2000-02-08", revision: 1, amount: 10 }, { date: "2000-02-08", revision: 2, amount: 20 }, { date: "2000-02-09", revision: 1, amount: 5 },
  ]);
  check("the latest revision wins per date", latest.get("2000-02-08")?.amount === 20 && latest.get("2000-02-09")?.amount === 5);
}

async function integration() {
  const health = await fetch(`${BASE}/api/v1/health`).catch(() => null);
  if (!health?.ok) throw new Error(`Dev server not reachable at ${BASE}. Start it with \`npm run dev\`.`);
  if (!process.env.OWNER_PIN) throw new Error("OWNER_PIN is not set in web/.env");
  const unlock = await fetch(`${BASE}/api/v1/owner/unlock`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: process.env.OWNER_PIN }),
  });
  ownerCookie = unlock.headers.get("set-cookie")?.split(";")[0] ?? "";
  if (!unlock.ok || !ownerCookie) throw new Error(`Owner unlock failed with ${unlock.status}`);

  const first = new Date("2000-02-01T00:00:00.000+08:00");
  const last = new Date("2000-03-01T00:00:00.000+08:00");
  const existing = await prisma.transaction.count({ where: { transactionTime: { gte: first, lt: last } } });
  if (existing > 0) throw new Error(`${existing} sales already exist in February 2000; refusing to run`);
  await cleanupDates();
  await prisma.barber.create({ data: { id: BARBER, fullName: `Test Summary ${RUN}`, commissionRate: 0.5 } });

  console.log("\nAccess and input");
  check("no owner cookie → 401", (await summary(TUE, "day", "LIST_PRICE", "")).status === 401);
  check("a bad date → 400", (await summary("2000-02-30")).status === 400);
  check("a bad period → 400", (await call("GET", `/api/v1/reports/ledger-summary?date=${TUE}&period=year`)).status === 400);

  const batch = [
    sale(TUE, "10:00:00.000", 200, "CASH", 20),
    sale(TUE, "11:00:00.000", 100, "GCASH"),
    sale(THU, "10:00:00.000", 400, "CASH"),
  ];
  const synced = await call<{ syncedIds: string[]; rejected: unknown[] }>("POST", "/api/v1/transactions/sync", { transactions: batch });
  check("setup: sales synced", synced.status === 200 && batch.every((b) => synced.body.syncedIds.includes(b.id)) && synced.body.rejected.length === 0, JSON.stringify(synced.body));
  const rec = await call<{ success: boolean }>("POST", "/api/v1/reports/reconciliation", { date: TUE, countedCash: 220, pettyCashAmount: 50 });
  check("setup: petty cash saved for the day", rec.status === 200 || rec.status === 201, String(rec.status));

  console.log("\nOne day");
  const day = (await summary(TUE)).body;
  check("sales are split by payment method", day.sales.cash === "200.00" && day.sales.gcash === "100.00" && day.sales.maya === "0.00" && day.sales.total === "300.00" && day.sales.count === 2, JSON.stringify(day.sales));
  check("commissions are the snapshotted 50% (150.00), tips 20.00 stay out of revenue", day.shared.commissions === "150.00" && day.shared.tips === "20.00", JSON.stringify(day.shared));
  check("petty cash comes from the saved End-of-Day Cash", day.shared.pettyCash === "50.00" && day.shared.pettyCashRecorded === true);
  check("left for the shop = 300 - 150 - 50", day.leftForShop === "100.00", day.leftForShop);
  check("payouts owed = commission + tips", day.payouts.owed === "170.00" && day.payouts.paid === "0.00" && day.payouts.remaining === "170.00", JSON.stringify(day.payouts));
  check("the service block lists the Haircut with its count", day.services.some((s) => s.name.length > 0 && s.count === 2), JSON.stringify(day.services));
  check("service sales + gap = revenue", day.services.reduce((n, s) => n.add(s.listSales), D(0)).add(day.serviceGap).equals(day.sales.total), `${JSON.stringify(day.services)} ${day.serviceGap}`);
  check("a day has no per-day list", day.days.length === 0);

  const empty = (await summary(WED)).body;
  check("a day without sales is all zero", empty.sales.total === "0.00" && empty.shared.commissions === "0.00" && empty.leftForShop === "0.00" && empty.services.length === 0);
  check("a day without End-of-Day Cash says petty cash was not recorded", empty.shared.pettyCashRecorded === false && empty.pettyCashMissingDays === 1);

  console.log("\nWeek and month");
  const week = (await summary(WED, "week")).body;
  check("the week names its range", week.from === "2000-02-07" && week.to === "2000-02-13" && week.days.length === 7);
  check("week revenue is the sum of its sales (700)", week.sales.total === "700.00" && week.sales.count === 3, JSON.stringify(week.sales));
  check("week commissions are 350.00 and tips 20.00", week.shared.commissions === "350.00" && week.shared.tips === "20.00");
  check("week total equals the sum of its days", week.days.reduce((n, d) => n.add(d.revenue), D(0)).equals(week.sales.total) && week.days.reduce((n, d) => n.add(d.commissions), D(0)).equals(week.shared.commissions));
  check("six of seven days have no End-of-Day Cash", week.pettyCashMissingDays === 6 && week.shared.pettyCashRecorded === false);
  const month = (await summary(WED, "month")).body;
  check("the month covers February 2000 (29 days) and holds the same sales", month.from === "2000-02-01" && month.to === "2000-02-29" && month.days.length === 29 && month.sales.total === "700.00");

  console.log("\nCommission base");
  const amountPaid = (await summary(TUE, "day", "AMOUNT_PAID")).body;
  check("AMOUNT_PAID changes only the commission side; sales are unchanged", amountPaid.sales.total === day.sales.total && amountPaid.shared.tips === day.shared.tips);

  console.log("\nRead-only");
  const payout = await call<{ success: boolean }>("POST", "/api/v1/reports/payouts", { date: TUE, barberId: BARBER, commissionBase: "LIST_PRICE", cashPaid: 100, gcashPaid: 0, paid: true });
  check("setup: a payout of 100 recorded", payout.status === 200 && payout.body.success);
  const afterPayout = (await summary(TUE)).body;
  check("recorded as paid 100.00, still to pay 70.00; revenue and commissions did not move", afterPayout.payouts.paid === "100.00" && afterPayout.payouts.remaining === "70.00" && afterPayout.sales.total === "300.00" && afterPayout.shared.commissions === "150.00", JSON.stringify(afterPayout.payouts));
  const countRows = () => prisma.dailyPayoutLedger.count({ where: { businessDate: { in: MONTH.map(dateValue) } } });
  const before = await countRows();
  await summary(TUE, "month");
  await summary(THU, "week");
  check("calling the summary creates no ledger rows", (await countRows()) === before);
}

async function cleanupDates() {
  await prisma.dailyPayoutLedger.deleteMany({ where: { businessDate: { in: MONTH.map(dateValue) } } });
  await prisma.shiftReconciliation.deleteMany({ where: { reconciliationDate: { in: MONTH.map(dateValue) } } });
}

async function cleanup() {
  await cleanupDates();
  await prisma.dailyPayoutLedger.deleteMany({ where: { barberId: BARBER } });
  await prisma.syncMismatchLog.deleteMany({ where: { transactionId: { in: txIds } } });
  await prisma.transaction.deleteMany({ where: { OR: [{ id: { in: txIds } }, { barberId: BARBER }] } });
  await prisma.barber.deleteMany({ where: { id: BARBER } });
}

async function main() {
  console.log(`Ledger summary test against ${BASE} (run ${RUN})\n`);
  pure();
  await integration();
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

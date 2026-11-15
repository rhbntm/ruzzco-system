/**
 * Slice 10: the ledger summary. Part 1 is pure (periods and arithmetic, invented numbers).
 * Part 2 calls the REAL route on a running dev server. Part 3 (slice 16) checks the read-only
 * custom-amounts route (GET /api/v1/reports/custom-amounts) on the same fixtures' barber.
 *
 *   npm run dev                     (in another terminal)
 *   npm run test:ledger-summary     (TEST_BASE_URL overrides http://localhost:3000)
 *
 * Needs OWNER_PIN in web/.env (read, never printed). Uses a throwaway barber, an approved scratch
 * phone (sync needs one, slice 15) and fixed past dates in February 2000 (no real data); its
 * sales, ledger rows, reconciliations, phone and barber are deleted at the end.
 *
 * Part 4 (slice 20) checks `from`/`to`: rangeFigures against computeExpected + totalsForDate +
 * the legacy item query day by day (both bases), whole answers against the legacy date/period
 * answer (one day, a completed past week and month), Manila midnights, held sales, clamped
 * daily remaining, 400/401/422 and a 366-date range's time. Its fixtures are in January 2000.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { loadEnvConfig } from "@next/env";
import { prisma } from "../src/lib/prisma";
import { createTestOwner, type TestOwner } from "./lib/test-owner";
import { createTestDevices } from "./lib/test-devices";
import { latestRevisionPerDate, leftForShop, listPriceOf, periodDates, remainingToPay, serviceGap } from "../src/lib/ledger-summary";
import { createTestBarberSession } from "./lib/test-barber-session";
import { manilaToday, parseBusinessDate } from "../src/lib/business-date";
import { datesBetween } from "../src/lib/date-range";
import { rangeFigures } from "../src/lib/range-figures";
import { computeExpected } from "../src/lib/reconciliation";
import { totalsForDate, type Base } from "../src/lib/payout-totals";
import { countsOnDay } from "../src/lib/time-review";
import { DASHBOARD_PERIODS, dashboardRange, loadPeriodBarbers, loadPeriodSummary, loadTodayDrawer, parseDashboardPeriod } from "../src/lib/dashboard";
import { presetRange } from "../src/lib/date-range";
import { peso } from "../src/lib/peso";

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

const devices = createTestDevices(BASE);
let deviceKey = ""; // the scratch phone every sale is synced from (its sales carry no deviceKey)
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

async function call<T>(method: "GET" | "POST", path: string, body?: unknown, cookie = ownerCookie, extraHeaders: Record<string, string> = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as T };
}

const summary = (date: string, period = "day", base = "LIST_PRICE", cookie = ownerCookie) =>
  call<Summary>("GET", `/api/v1/reports/ledger-summary?date=${date}&period=${period}&commissionBase=${base}`, undefined, cookie);
// Sync needs an approved phone (slice 15): the scratch device's key and secret ride along.
const sync = (transactions: unknown[]) =>
  call<{ syncedIds: string[]; rejected: unknown[] }>("POST", "/api/v1/transactions/sync", { transactions }, ownerCookie, devices.headers(deviceKey));

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
  check("a service row uses the sale's list price (slice 13)", listPriceOf({ listPrice: D(250), amountPaid: D(125), totalAmount: D(125) }).equals(250));
  check("no list price: falls back to the amount paid", listPriceOf({ listPrice: null, amountPaid: D(180), totalAmount: D(180) }).equals(180));
  check("no list price and no amount paid (before slice 4): falls back to the total", listPriceOf({ listPrice: null, amountPaid: null, totalAmount: D(200) }).equals(200));
  const latest = latestRevisionPerDate([
    { date: "2000-02-08", revision: 1, amount: 10 }, { date: "2000-02-08", revision: 2, amount: 20 }, { date: "2000-02-09", revision: 1, amount: 5 },
  ]);
  check("the latest revision wins per date", latest.get("2000-02-08")?.amount === 20 && latest.get("2000-02-09")?.amount === 5);
}

async function integration() {
  const health = await fetch(`${BASE}/api/v1/health`).catch(() => null);
  if (!health?.ok) throw new Error(`Dev server not reachable at ${BASE}. Start it with \`npm run dev\`.`);
  // Slice 19: owner routes take an owner account session (scripts/lib/test-owner.ts).
  testOwner = await createTestOwner(BASE, prisma, "ledger-sum");
  ownerCookie = testOwner.cookie;

  const first = new Date("2000-02-01T00:00:00.000+08:00");
  const last = new Date("2000-03-01T00:00:00.000+08:00");
  const existing = await prisma.transaction.count({ where: { transactionTime: { gte: first, lt: last } } });
  if (existing > 0) throw new Error(`${existing} sales already exist in February 2000; refusing to run`);
  await cleanupDates();
  await prisma.barber.create({ data: { id: BARBER, fullName: `Test Summary ${RUN}`, commissionRate: 0.5 } });
  deviceKey = await devices.approve();

  console.log("\nAccess and input");
  check("no owner cookie → 401", (await summary(TUE, "day", "LIST_PRICE", "")).status === 401);
  check("a bad date → 400", (await summary("2000-02-30")).status === 400);
  check("a bad period → 400", (await call("GET", `/api/v1/reports/ledger-summary?date=${TUE}&period=year`)).status === 400);

  const batch = [
    sale(TUE, "10:00:00.000", 200, "CASH", 20),
    sale(TUE, "11:00:00.000", 100, "GCASH"),
    sale(THU, "10:00:00.000", 400, "CASH"),
  ];
  const synced = await sync(batch);
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

  console.log("\nDiscounts line (slice 13): list price minus amount paid");
  const LOYALTY_DAY = "2000-02-24";
  const loyaltySale = { ...sale(LOYALTY_DAY, "10:00:00.000", 125), listPrice: 250, discountType: "PERCENT", discountAmount: 125, customAmount: false };
  const customSale = sale(LOYALTY_DAY, "11:00:00.000", 300); // a custom amount is its own list price
  const added = await sync([loyaltySale, customSale]);
  check("setup: loyalty and custom-amount sales synced", added.status === 200 && added.body.rejected.length === 0, JSON.stringify(added.body));
  const loyaltyDay = (await summary(LOYALTY_DAY)).body;
  check("revenue counts what was paid (125 + 300)", loyaltyDay.sales.total === "425.00", loyaltyDay.sales.total);
  check("the service row counts the list price (250 + 300)", loyaltyDay.services.length === 1 && loyaltyDay.services[0].listSales === "550.00" && loyaltyDay.services[0].count === 2, JSON.stringify(loyaltyDay.services));
  check("the Discounts line shows the ₱125 loyalty discount, the custom amount adds nothing", loyaltyDay.serviceGap === "-125.00", loyaltyDay.serviceGap);
  check("service sales + Discounts = revenue", loyaltyDay.services.reduce((n, s) => n.add(s.listSales), D(0)).add(loyaltyDay.serviceGap).equals(loyaltyDay.sales.total));

  // A sale from before slice 4 has no list price and no amount paid; the server never stores
  // one like that now, so it is written directly, as an old database has it.
  const legacyId = randomUUID();
  txIds.push(legacyId);
  await prisma.transaction.create({
    data: {
      id: legacyId, barberId: BARBER, totalAmount: 200, barberCommissionAmount: 100, commissionRate: 0.5,
      transactionTime: new Date(AT(LOYALTY_DAY, "12:00:00.000")),
      items: { create: { serviceId: SERVICE_ID, priceAtSale: 200 } },
      commissionLogs: { create: { barberId: BARBER, amount: 100 } },
    },
  });
  const withLegacy = (await summary(LOYALTY_DAY)).body;
  check("an old sale without a list price counts what was paid in its service row (550 + 200)", withLegacy.services[0]?.listSales === "750.00", JSON.stringify(withLegacy.services));
  check("…and adds nothing to Discounts", withLegacy.serviceGap === "-125.00", withLegacy.serviceGap);
  check("revenue is the amounts paid (125 + 300 + 200), as before slice 13", withLegacy.sales.total === "625.00", withLegacy.sales.total);
  check("service sales + Discounts = revenue with the old sale too", withLegacy.services.reduce((n, s) => n.add(s.listSales), D(0)).add(withLegacy.serviceGap).equals(withLegacy.sales.total));
  const loyaltyWeek = (await summary(LOYALTY_DAY, "week")).body;
  check("over the week too: service sales + Discounts = revenue", loyaltyWeek.services.reduce((n, s) => n.add(s.listSales), D(0)).add(loyaltyWeek.serviceGap).equals(loyaltyWeek.sales.total), `${JSON.stringify(loyaltyWeek.services)} ${loyaltyWeek.serviceGap} ${loyaltyWeek.sales.total}`);

  await customAmounts();
  await ranges();
  await dashboard();
}

type CustomList = {
  success: boolean; date: string;
  sales: { id: string; time: string; barberName: string; serviceName: string | null; amountPaid: string; note: string | null; paymentMethod: string; paymentStatus: string; commission: string; menuPriceNow: string | null }[];
};

// Slice 16, Decision 4: the read-only custom-amounts list for one business date.
async function customAmounts() {
  console.log("\nCustom amounts (slice 16)");
  const DAY = "2000-02-16"; // a Wednesday with no other fixtures
  const BEFORE = "2000-02-15";
  const AFTER = "2000-02-17";
  const list = (date: string, cookie = ownerCookie) => call<CustomList>("GET", `/api/v1/reports/custom-amounts?date=${date}`, undefined, cookie);
  const ids = async (date: string) => (await list(date)).body.sales?.map((s) => s.id) ?? [];

  // Authorization
  const signedOut = await list(DAY, "");
  check("custom amounts: 401 without owner access", signedOut.status === 401, String(signedOut.status));
  const ownerAnswer = await list(DAY);
  check("custom amounts: 200 with owner access", ownerAnswer.status === 200 && ownerAnswer.body.success && Array.isArray(ownerAnswer.body.sales), JSON.stringify(ownerAnswer.body));

  // Fixtures: synced sales (PAID) and, for the other statuses and the date review, Prisma inserts.
  const onDay = { ...sale(DAY, "15:00:00.000", 400), customAmountNote: "test note" };
  const onBefore = sale(BEFORE, "15:00:00.000", 410);
  const onAfter = sale(AFTER, "15:00:00.000", 420);
  const menuSale = { ...sale(DAY, "16:00:00.000", 250), customAmount: false }; // a ₱250 haircut, not custom
  const synced = await sync([onDay, onBefore, onAfter, menuSale]);
  check("setup: custom and menu-price sales synced", synced.status === 200 && synced.body.rejected.length === 0, JSON.stringify(synced.body));

  const insert = async (status: "PENDING" | "EXPIRED" | "FAILED" | "PAID", at: string, extra: Partial<Prisma.TransactionUncheckedCreateInput> = {}) => {
    const id = randomUUID();
    txIds.push(id);
    await prisma.transaction.create({
      data: {
        id, barberId: BARBER, totalAmount: 300, listPrice: 300, amountPaid: 300, customAmount: true, customAmountNote: `status ${status}`,
        barberCommissionAmount: 150, commissionRate: 0.5, paymentMethod: status === "PAID" ? "CASH" : "QRPH", paymentStatus: status,
        transactionTime: new Date(at), ...extra,
        items: { create: { serviceId: SERVICE_ID, priceAtSale: 300 } },
        commissionLogs: { create: { barberId: BARBER, amount: 150 } },
      },
    });
    return id;
  };
  const pending = await insert("PENDING", AT(DAY, "17:00:00.000"));
  const expired = await insert("EXPIRED", AT(DAY, "17:10:00.000"));
  const failed = await insert("FAILED", AT(DAY, "17:20:00.000"));
  // Stamped on the day before by a phone whose clock was off, received on DAY: held for review.
  const flagged = await insert("PAID", AT(BEFORE, "18:00:00.000"), { timeFlag: "DEVICE_CLOCK_SKEW", clockSkewSeconds: -86400, syncedAt: new Date(AT(DAY, "18:00:00.000")) });

  // Date filtering
  const dayIds = await ids(DAY);
  check("date: a custom sale on the date is listed", dayIds.includes(onDay.id), JSON.stringify(dayIds));
  check("date: custom sales on the day before and after are not", !dayIds.includes(onBefore.id) && !dayIds.includes(onAfter.id));
  check("date: the day before lists its own sale only", (await ids(BEFORE)).includes(onBefore.id) && !(await ids(BEFORE)).includes(onDay.id));
  check("date: a flagged sale waiting for review is listed on no day", !dayIds.includes(flagged) && !(await ids(BEFORE)).includes(flagged));
  const reviewed = await call<{ success: boolean }>("POST", "/api/v1/reports/time-review", { transactionId: flagged, choice: "RECEIVED_DATE" });
  check("setup: the flagged sale's received date confirmed", reviewed.status === 200 && reviewed.body.success, JSON.stringify(reviewed.body));
  check("date: after review it is listed on its confirmed date only", (await ids(DAY)).includes(flagged) && !(await ids(BEFORE)).includes(flagged));

  // Status filtering
  check("status: custom PAID and PENDING are listed", dayIds.includes(onDay.id) && dayIds.includes(pending));
  check("status: EXPIRED and FAILED are not", !dayIds.includes(expired) && !dayIds.includes(failed));
  check("status: a non-custom sale on the date is not", !dayIds.includes(menuSale.id));
  const times = (await list(DAY)).body.sales.map((s) => s.time);
  check("order: newest first", times.length >= 3 && times.every((v, i) => i === 0 || times[i - 1] >= v), JSON.stringify(times));

  // Values
  await prisma.barber.update({ where: { id: BARBER }, data: { commissionRate: 0.3 } });
  const rows = (await list(DAY)).body.sales;
  const row = rows.find((s) => s.id === onDay.id);
  check("values: the commission is the stored snapshot (200.00 at 50%) after the rate changed to 30%", row?.commission === "200.00", JSON.stringify(row));
  const menuNow = (await prisma.service.findUniqueOrThrow({ where: { id: SERVICE_ID }, select: { standardPrice: true } })).standardPrice.toFixed(2);
  check(`values: "Menu price now" is the service's current price (${menuNow})`, row?.menuPriceNow === menuNow);
  check("values: amount paid, note, payment method and status as stored", row?.amountPaid === "400.00" && row.note === "test note" && row.paymentMethod === "CASH" && row.paymentStatus === "PAID" && row.barberName === `Test Summary ${RUN}`, JSON.stringify(row));
  check("values: a PENDING sale says so", rows.find((s) => s.id === pending)?.paymentStatus === "PENDING");

  // Read-only
  const counts = () => Promise.all([prisma.transaction.count(), prisma.dailyPayoutLedger.count(), prisma.payoutEntry.count()]);
  const before = await counts();
  await list(DAY);
  await list(BEFORE);
  await list("2000-02-20");
  check("read-only: a GET writes nothing (transactions, payout ledger rows, payout entries unchanged)", JSON.stringify(await counts()) === JSON.stringify(before));
  check("read-only: an impossible date answers 400", (await list("2000-02-30")).status === 400);
  check("read-only: a missing date answers 400", (await call("GET", "/api/v1/reports/custom-amounts")).status === 400);
}

// ── Part 4, slice 20: from/to ────────────────────────────────────────────────

const JAN = periodDates("2000-01-15", "month"); // all of January 2000
const W_MON = "2000-01-10"; // a completed past week: Mon 2000-01-10 .. Sun 2000-01-16
const W_SUN = "2000-01-16";
let barberSessionCleanup: (() => Promise<void>) | null = null;
let barberPageCookie = "";

type RangeSummary = Summary & { date: string; heldForReview: number; commissionBase: string };
const rangeSummary = (from: string, to: string, base = "LIST_PRICE", cookie = ownerCookie) =>
  call<RangeSummary>("GET", `/api/v1/reports/ledger-summary?from=${from}&to=${to}&commissionBase=${base}`, undefined, cookie);
const legacy = (date: string, period: string, base = "LIST_PRICE") =>
  call<RangeSummary>("GET", `/api/v1/reports/ledger-summary?date=${date}&period=${period}&commissionBase=${base}`);
// Every field but the two that name the request (`date`, `period`).
function sameAnswer(a: RangeSummary, b: RangeSummary) {
  const strip = (s: RangeSummary) => JSON.stringify({ ...s, date: undefined, period: undefined });
  return strip(a) === strip(b);
}

type Fixture = {
  at: string; amount: number; method?: "CASH" | "GCASH" | "MAYA" | "QRPH"; status?: "PAID" | "PENDING" | "EXPIRED" | "FAILED";
  tip?: number; listPrice?: number; flag?: boolean; reviewedOn?: string;
};
// Written directly, as the sync would store them: QR Ph sales and their statuses can't be synced
// while the gateway is off, and a flagged sale needs a phone clock that is wrong.
async function insertSale(f: Fixture) {
  const id = randomUUID();
  txIds.push(id);
  const list = f.listPrice ?? f.amount;
  await prisma.transaction.create({
    data: {
      id, barberId: BARBER, totalAmount: f.amount, listPrice: list, amountPaid: f.amount, tipAmount: f.tip ?? 0,
      discountType: list > f.amount ? "PERCENT" : "NONE", discountAmount: list - f.amount,
      barberCommissionAmount: list / 2, commissionRate: 0.5, paymentMethod: f.method ?? "CASH", paymentStatus: f.status ?? "PAID",
      transactionTime: new Date(f.at),
      ...(f.flag ? { timeFlag: "DEVICE_CLOCK_SKEW" as const, clockSkewSeconds: 3600 } : {}),
      ...(f.reviewedOn ? { timeReviewedAt: new Date(), timeReviewChoice: "RECEIVED_DATE" as const, timeReviewedBusinessDate: dateValue(f.reviewedOn) } : {}),
      items: { create: { serviceId: SERVICE_ID, priceAtSale: list } },
      commissionLogs: { create: { barberId: BARBER, amount: list / 2 } },
    },
  });
  return id;
}

// The legacy summary's per-day sources, called as its date/period path calls them.
async function legacyDay(date: string, base: Base) {
  const day = parseBusinessDate(date)!;
  const [expected, byBarber, items] = await Promise.all([
    computeExpected(day, 0),
    totalsForDate(date, base),
    prisma.transactionItem.findMany({
      where: { transaction: { ...countsOnDay(day), paymentStatus: "PAID" } },
      select: { service: { select: { name: true } }, transaction: { select: { listPrice: true, amountPaid: true, totalAmount: true } } },
    }),
  ]);
  const services = new Map<string, { count: number; listSales: Prisma.Decimal }>();
  for (const item of items) {
    const entry = services.get(item.service.name) ?? { count: 0, listSales: D(0) };
    services.set(item.service.name, { count: entry.count + 1, listSales: entry.listSales.add(listPriceOf(item.transaction)) });
  }
  return { expected, byBarber, services };
}

const mapJson = <V>(m: Map<string, V>, f: (v: V) => unknown) =>
  JSON.stringify([...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, f(v)]));
const sumOf = (values: Iterable<{ commission: Prisma.Decimal; viewCommission: Prisma.Decimal; tips: Prisma.Decimal }>, key: "commission" | "viewCommission" | "tips") =>
  [...values].reduce((n, t) => n.add(t[key]), D(0));

async function equivalence(label: string) {
  const first = parseBusinessDate(JAN[0])!;
  const last = parseBusinessDate(JAN[JAN.length - 1])!;
  for (const base of ["LIST_PRICE", "AMOUNT_PAID"] as const) {
    const { perDate, total } = await rangeFigures(first, last, base);
    const mismatches: string[] = [];
    let sumRevenue = D(0);
    for (const date of JAN) {
      const got = perDate.get(date)!;
      const want = await legacyDay(date, base);
      const fields: [string, string, string][] = [
        ["cash", got.cash.toFixed(2), want.expected.cashSales.toFixed(2)],
        ["gcash", got.gcash.toFixed(2), want.expected.gcashTotal.toFixed(2)],
        ["maya", got.maya.toFixed(2), want.expected.mayaTotal.toFixed(2)],
        ["qrph", got.qrph.toFixed(2), want.expected.qrphTotal.toFixed(2)],
        ["revenue", got.revenue.toFixed(2), want.expected.totalRevenue.toFixed(2)],
        ["count", String(got.count), String(want.expected.transactionCount)],
        ["commissions", got.commissions.toFixed(2), sumOf(want.byBarber.values(), "viewCommission").toFixed(2)],
        ["canonical commission", got.canonicalCommission.toFixed(2), sumOf(want.byBarber.values(), "commission").toFixed(2)],
        ["tips", got.tips.toFixed(2), sumOf(want.byBarber.values(), "tips").toFixed(2)],
      ];
      for (const [name, a, b] of fields) if (a !== b) mismatches.push(`${date} ${name} ${a} ≠ ${b}`);
      const svc = (v: { count: number; listSales: Prisma.Decimal }) => [v.count, v.listSales.toFixed(2)];
      if (mapJson(got.services, svc) !== mapJson(want.services, svc)) mismatches.push(`${date} services`);
      const barber = (v: { commission: Prisma.Decimal; viewCommission: Prisma.Decimal; tips: Prisma.Decimal }) =>
        [v.commission.toFixed(2), v.viewCommission.toFixed(2), v.tips.toFixed(2)];
      if (mapJson(got.byBarber, barber) !== mapJson(want.byBarber, barber)) mismatches.push(`${date} per barber`);
      sumRevenue = sumRevenue.add(got.revenue);
    }
    check(`${label}: rangeFigures = computeExpected + totalsForDate + item query on each of January's 31 days (${base})`, mismatches.length === 0, mismatches.slice(0, 5).join("; "));
    check(`${label}: the range total is the sum of its days (${base})`, total.revenue.equals(sumRevenue), `${total.revenue} vs ${sumRevenue}`);
  }
}

async function ranges() {
  console.log("\nDate ranges (slice 20)");
  const existing = await prisma.transaction.count({ where: { transactionTime: { gte: new Date("2000-01-01T00:00:00.000+08:00"), lt: new Date("2000-02-01T00:00:00.000+08:00") } } });
  if (existing > 0) throw new Error(`${existing} sales already exist in January 2000; refusing to run`);

  // Every payment method and status, tips, a loyalty discount (so the two bases differ), flagged sales.
  await insertSale({ at: AT(W_MON, "10:00:00.000"), amount: 250, tip: 20 });
  await insertSale({ at: AT(W_MON, "11:00:00.000"), amount: 300, method: "GCASH" });
  await insertSale({ at: AT("2000-01-11", "10:00:00.000"), amount: 250, method: "MAYA", tip: 10 });
  await insertSale({ at: AT("2000-01-11", "12:00:00.000"), amount: 250, method: "QRPH" });
  await insertSale({ at: AT("2000-01-11", "13:00:00.000"), amount: 250, method: "QRPH", status: "PENDING" });
  await insertSale({ at: AT("2000-01-12", "13:00:00.000"), amount: 250, method: "QRPH", status: "EXPIRED" });
  await insertSale({ at: AT("2000-01-12", "14:00:00.000"), amount: 250, method: "QRPH", status: "FAILED" });
  await insertSale({ at: AT("2000-01-12", "15:00:00.000"), amount: 125, listPrice: 250 });
  // Flagged: stamped after the week and confirmed onto its Thursday; stamped inside and confirmed after it; one held.
  await insertSale({ at: AT("2000-01-20", "10:00:00.000"), amount: 500, flag: true, reviewedOn: "2000-01-13" });
  await insertSale({ at: AT("2000-01-14", "10:00:00.000"), amount: 300, flag: true, reviewedOn: "2000-01-25" });
  const held = await insertSale({ at: AT("2000-01-15", "10:00:00.000"), amount: 400, flag: true });
  // Edge case 1: the four Manila midnights around the week.
  await insertSale({ at: AT("2000-01-09", "23:59:59.999"), amount: 111 });
  await insertSale({ at: AT(W_MON, "00:00:00.000"), amount: 222 });
  await insertSale({ at: AT(W_SUN, "23:59:59.999"), amount: 333, method: "GCASH" });
  await insertSale({ at: AT("2000-01-17", "00:00:00.000"), amount: 444 });

  // Petty cash on Tuesday; a part payout on Wednesday through the route; Monday overpaid by 100
  // (a stored payment above what its sales now say, written directly: the route refuses one).
  const rec = await call("POST", "/api/v1/reports/reconciliation", { date: "2000-01-11", countedCash: 0, pettyCashAmount: 50 });
  check("ranges setup: petty cash saved on Tuesday", rec.status === 200 || rec.status === 201, String(rec.status));
  const partial = await call<{ success: boolean }>("POST", "/api/v1/reports/payouts", { id: randomUUID(), date: "2000-01-12", barberId: BARBER, commissionBase: "LIST_PRICE", method: "CASH", amount: 50 });
  check("ranges setup: a ₱50 payout on Wednesday", partial.status === 200 && partial.body.success, JSON.stringify(partial.body));
  const mondayOwed = D(125 + 150 + 111).add(20); // the 250, 300 and 00:00 ₱222 sales at 50%, plus the tip
  const ledger = await prisma.dailyPayoutLedger.create({
    data: { barberId: BARBER, businessDate: dateValue(W_MON), commissionTotal: mondayOwed.sub(20), tipTotal: 20, totalOwed: mondayOwed, cashPaid: mondayOwed.add(100), paidAt: new Date() },
  });
  await prisma.payoutEntry.create({
    data: { id: randomUUID(), ledgerId: ledger.id, barberId: BARBER, businessDate: dateValue(W_MON), method: "CASH", amount: mondayOwed.add(100), owedAtEntry: mondayOwed.add(100) },
  });

  console.log("\nEquivalence with the existing calculations");
  await equivalence("before review");
  for (const base of ["LIST_PRICE", "AMOUNT_PAID"]) {
    const [rDay, lDay] = await Promise.all([rangeSummary("2000-01-12", "2000-01-12", base), legacy("2000-01-12", "day", base)]);
    check(`a one-day range = the legacy period=day answer, field for field (${base})`, rDay.status === 200 && sameAnswer(rDay.body, lDay.body), `\n${JSON.stringify(rDay.body)}\n${JSON.stringify(lDay.body)}`);
    const [rWeek, lWeek] = await Promise.all([rangeSummary(W_MON, W_SUN, base), legacy("2000-01-13", "week", base)]);
    check(`a completed past week Mon..Sun = the legacy period=week answer, field for field (${base})`, rWeek.status === 200 && sameAnswer(rWeek.body, lWeek.body), `\n${JSON.stringify(rWeek.body)}\n${JSON.stringify(lWeek.body)}`);
    const [rMonth, lMonth] = await Promise.all([rangeSummary(JAN[0], JAN[30], base), legacy("2000-01-20", "month", base)]);
    check(`a completed past month = the legacy period=month answer, field for field (${base})`, rMonth.status === 200 && sameAnswer(rMonth.body, lMonth.body), `\n${JSON.stringify(rMonth.body)}\n${JSON.stringify(lMonth.body)}`);
  }
  const weekRange = (await rangeSummary(W_MON, W_SUN)).body;
  check("the answer echoes from and to and lists each of the 7 days", weekRange.from === W_MON && weekRange.to === W_SUN && weekRange.days.length === 7 && weekRange.days[0].date === W_MON && weekRange.days[6].date === W_SUN);
  check("a one-day range has no per-day list, as the legacy day", (await rangeSummary(W_MON, W_MON)).body.days.length === 0);

  console.log("\nManila midnights (edge case 1)");
  const dayRevenue = (s: RangeSummary, date: string) => s.days.find((d) => d.date === date)?.revenue;
  check("00:00:00.000 on from is in (Monday 250 + 300 + 222 = 772.00)", dayRevenue(weekRange, W_MON) === "772.00", dayRevenue(weekRange, W_MON));
  check("23:59:59.999 on to is in (Sunday 333.00)", dayRevenue(weekRange, W_SUN) === "333.00", dayRevenue(weekRange, W_SUN));
  check("23:59:59.999 the day before from is out: it counts on that day", (await rangeSummary("2000-01-09", "2000-01-09")).body.sales.total === "111.00");
  check("00:00:00.000 the day after to is out: it counts on that day", (await rangeSummary("2000-01-17", "2000-01-17")).body.sales.total === "444.00");
  // Mon 772, Tue 250 Maya + 250 QR Ph, Wed 125, Thu 500 (reviewed onto it), Sun 333.
  check("the week holds exactly its own sales (2230.00, 8 paid)", weekRange.sales.total === "2230.00" && weekRange.sales.count === 8, JSON.stringify(weekRange.sales));
  check("PENDING, EXPIRED and FAILED QR Ph sales count nowhere; the PAID one counts", weekRange.sales.qrph === "250.00", weekRange.sales.qrph);

  console.log("\nHeld for review (edge case 2)");
  check("an unreviewed flagged sale stamped in the range is held, not counted (Saturday 0.00)", weekRange.heldForReview === 1 && dayRevenue(weekRange, "2000-01-15") === "0.00", `${weekRange.heldForReview} ${dayRevenue(weekRange, "2000-01-15")}`);
  check("a flagged sale stamped in the range but confirmed after it is not in it (Friday 0.00)", dayRevenue(weekRange, "2000-01-14") === "0.00");
  check("a flagged sale stamped after the range but confirmed inside it counts on that day (Thursday 500.00)", dayRevenue(weekRange, "2000-01-13") === "500.00");
  const reviewed = await call<{ success: boolean }>("POST", "/api/v1/reports/time-review", { transactionId: held, choice: "STATED_DATE" });
  check("ranges setup: the held sale's stated date confirmed", reviewed.status === 200 && reviewed.body.success, JSON.stringify(reviewed.body));
  const afterReview = (await rangeSummary(W_MON, W_SUN)).body;
  check("after review it counts on its confirmed date (Saturday 400.00, week 2630.00, none held)", dayRevenue(afterReview, "2000-01-15") === "400.00" && afterReview.sales.total === "2630.00" && afterReview.heldForReview === 0, JSON.stringify(afterReview.sales));
  check("…and on no other day of the range", afterReview.days.filter((d) => d.date !== "2000-01-15").every((d) => d.revenue === dayRevenue(weekRange, d.date)));
  await equivalence("after review");

  console.log("\nDaily versus range-level remaining (edge case 5)");
  const owed = D(afterReview.payouts.owed), paid = D(afterReview.payouts.paid), remaining = D(afterReview.payouts.remaining);
  const days = await Promise.all(datesBetween(W_MON, W_SUN).map(async (d) => (await rangeSummary(d, d)).body.payouts));
  const clampedSum = days.reduce((n, p) => n.add(p.remaining), D(0));
  check("Monday is overpaid by 100: its remaining is 0.00", days[0].remaining === "0.00" && D(days[0].paid).sub(days[0].owed).equals(100), JSON.stringify(days[0]));
  check("the range remaining is the sum of the clamped daily balances", remaining.equals(clampedSum), `${remaining} vs ${clampedSum}`);
  check("…not owed − paid (which is 100 lower: the overpaid day hides another day's balance)", remaining.equals(owed.sub(paid).add(100)), `${owed} ${paid} ${remaining}`);

  console.log("\nRefused");
  const to = JAN[30];
  const year = datesBetween("1999-01-31", to); // 366 dates
  check("from after to → 400", (await rangeSummary(W_SUN, W_MON)).status === 400);
  check("367 dates → 400", (await rangeSummary("1999-01-30", to)).status === 400);
  check("date together with from → 400", (await call("GET", `/api/v1/reports/ledger-summary?date=${W_MON}&from=${W_MON}&to=${W_SUN}`)).status === 400);
  check("period together with from/to → 400", (await call("GET", `/api/v1/reports/ledger-summary?period=week&from=${W_MON}&to=${W_SUN}`)).status === 400);
  check("from without to → 400", (await call("GET", `/api/v1/reports/ledger-summary?from=${W_MON}`)).status === 400);
  check("an impossible date → 400", (await rangeSummary("2000-02-30", "2000-03-01")).status === 400);
  const today = manilaToday();
  const tomorrow = new Date(Date.parse(`${today}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
  const future = await rangeSummary(today, tomorrow);
  check("to after today (Manila) → 422 \"That date has not happened yet\"", future.status === 422 && future.body.error === "That date has not happened yet", `${future.status} ${future.body.error}`);
  check("to = today (Manila) is accepted", (await rangeSummary(today, today)).status === 200);
  check("no owner access → 401", (await rangeSummary(W_MON, W_SUN, "LIST_PRICE", "")).status === 401);
  const barber = await createTestBarberSession(BASE, prisma, BARBER, devices.headers(deviceKey), deviceKey, "sum");
  barberSessionCleanup = barber.cleanup;
  barberPageCookie = barber.cookie;
  check("a barber session → 401", (await rangeSummary(W_MON, W_SUN, "LIST_PRICE", barber.cookie)).status === 401);
  const onPhone = await call("GET", `/api/v1/reports/ledger-summary?from=${W_MON}&to=${W_SUN}`, undefined, barber.cookie, devices.headers(deviceKey));
  check("a barber session on an approved phone → 401", onPhone.status === 401);

  console.log("\nRead-only and time");
  const counts = () => Promise.all([prisma.transaction.count(), prisma.dailyPayoutLedger.count(), prisma.payoutEntry.count(), prisma.shiftReconciliation.count()]);
  const before = await counts();
  const started = performance.now();
  const long = await rangeSummary(year[0], to);
  const ms = Math.round(performance.now() - started);
  console.log(`    366-date range ${year[0]}..${to}: ${ms} ms`);
  check(`a 366-date range answers in under 10 seconds (${ms} ms)`, long.status === 200 && long.body.days.length === 366 && ms < 10_000, `HTTP ${long.status}`);
  check("…and holds January's sales", long.body.sales.total === (await rangeSummary(JAN[0], to)).body.sales.total);
  check("range requests write nothing (transactions, ledger rows, entries, reconciliations)", JSON.stringify(await counts()) === JSON.stringify(before));
}

// ── Part 5, slice 21a: the owner dashboard on `/` ────────────────────────────

// The dashboard reads the ledger summary's own function (rangeSummary), so for the same dates its
// figures are the route's answer. Read-only, on today's real dates: nothing is written here.
async function dashboard() {
  console.log("\nOwner dashboard (slice 21a)");
  const today = manilaToday();
  check("the period defaults to Today", parseDashboardPeriod(undefined) === "today" && parseDashboardPeriod("year") === "today" && parseDashboardPeriod(["week"]) === "today");
  check("week and month are read as given", parseDashboardPeriod("week") === "week" && parseDashboardPeriod("month") === "month");
  const week = dashboardRange("week", today);
  const month = dashboardRange("month", today);
  check("Today is today to today", JSON.stringify(dashboardRange("today", today)) === JSON.stringify({ from: today, to: today }));
  check("This week is Monday to today (presetRange)", JSON.stringify(week) === JSON.stringify(presetRange("thisWeek", today)) && new Date(`${week.from}T00:00:00Z`).getUTCDay() === 1 && week.to === today, JSON.stringify(week));
  check("This month is the 1st to today (presetRange)", month.from === `${today.slice(0, 7)}-01` && month.to === today, JSON.stringify(month));

  const counts = () => Promise.all([prisma.transaction.count(), prisma.dailyPayoutLedger.count(), prisma.payoutEntry.count(), prisma.shiftReconciliation.count()]);
  const before = await counts();
  for (const period of DASHBOARD_PERIODS) {
    const { from, to } = dashboardRange(period, today);
    const [mine, route, barbers] = await Promise.all([loadPeriodSummary(period, today), rangeSummary(from, to), loadPeriodBarbers(period, today)]);
    check(`${period}: the dashboard's summary = GET ledger-summary?from=${from}&to=${to}, field for field`, route.status === 200 && JSON.stringify(mine) === JSON.stringify(route.body), `\n${JSON.stringify(mine)}\n${JSON.stringify(route.body)}`);
    const sum = (field: "revenue" | "commission" | "tips") => barbers.reduce((n, b) => n.add(b[field]), D(0));
    check(
      `${period}: the barber rows add up to the summary (sales, amount paid, commissions, tips)`,
      barbers.reduce((n, b) => n + b.sales, 0) === mine.sales.count && sum("revenue").equals(mine.sales.total) && sum("commission").equals(mine.shared.commissions) && sum("tips").equals(mine.shared.tips),
      `${sum("revenue")} ${mine.sales.total} ${sum("commission")} ${mine.shared.commissions}`
    );
  }
  const weekDays = await Promise.all(datesBetween(week.from, week.to).map(async (d) => (await rangeSummary(d, d)).body.sales.total));
  check("This week's sales are the sum of its days", weekDays.reduce((n, t) => n.add(t), D(0)).equals((await loadPeriodSummary("week", today)).sales.total));

  const drawer = await loadTodayDrawer(today);
  const eod = await call<{ success: boolean; expected: unknown; saved: unknown; staleness: unknown }>("GET", `/api/v1/reports/reconciliation?date=${today}`);
  const plain = (value: unknown) => JSON.stringify(JSON.parse(JSON.stringify(value)));
  check(
    "the drawer card = End-of-Day Cash for today (expected, saved, staleness)",
    eod.status === 200 && plain(drawer.expected) === plain(eod.body.expected) && plain(drawer.saved) === plain(eod.body.saved) && plain(drawer.staleness) === plain(eod.body.staleness),
    `\n${plain(drawer.expected)}\n${plain(eod.body.expected)}`
  );
  check("the dashboard's loaders write nothing", JSON.stringify(await counts()) === JSON.stringify(before));

  // The page itself. Without owner access: no roster, no price, no figure in the HTML.
  const page = async (path: string, cookie: string) => {
    const res = await fetch(`${BASE}${path}`, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });
    return { status: res.status, html: await res.text() };
  };
  const [roster, services] = await Promise.all([
    prisma.barber.findMany({ select: { fullName: true } }),
    prisma.service.findMany({ select: { name: true } }),
  ]);
  const signedOut = await page("/", "");
  const leaked = [...roster.map((b) => b.fullName), ...services.map((s) => s.name)].filter((name) => name.length >= 4 && signedOut.html.includes(name));
  check("/ without owner access: 200, and no barber or service name in the HTML", signedOut.status === 200 && leaked.length === 0, leaked.join(", "));
  check("/ without owner access: no peso amount and no dashboard in the HTML", !signedOut.html.includes("₱") && !/Expected drawer cash|Owed to barbers|Payment mix/.test(signedOut.html));
  const owner = await page("/", ownerCookie);
  const todaySummary = await loadPeriodSummary("today", today);
  const CARDS = ["Sales per day", "Payment mix", "Services sold", "Owed to barbers", "Expected drawer cash", "Sales held for date review", "Phones", "Customer forecast"];
  const missing = CARDS.filter((title) => !owner.html.includes(title));
  check("/ with owner access: the dashboard and every card", owner.status === 200 && missing.length === 0, `${owner.status} ${missing.join(", ")}`);
  check("/ with owner access: today's sales figure is the summary's", owner.html.includes(peso(Number(todaySummary.sales.total))), peso(Number(todaySummary.sales.total)));
  check("/ with owner access: the drawer figure is End-of-Day Cash's", owner.html.includes(peso(Number(drawer.expected.expectedDrawerCash))));
  const ownerWeek = await page("/?period=week", ownerCookie);
  check("/?period=week: the week's sales figure is the summary's", ownerWeek.status === 200 && ownerWeek.html.includes(peso(Number((await loadPeriodSummary("week", today)).sales.total))));
  check("the owner menu is on the page, with no link to /pos or /shift-log", owner.html.includes('href="/ledger"') && owner.html.includes('href="/staff"') && !/href="\/(pos|shift-log)"/.test(owner.html));
  if (barberPageCookie) {
    // The barber session made in ranges() is still signed in.
    const asBarber = await page("/", barberPageCookie);
    check("/ with a barber session: redirected to /pos, no figure rendered", asBarber.status >= 300 && asBarber.status < 400 && !asBarber.html.includes("₱"), String(asBarber.status));
  }
}

async function cleanupDates() {
  await prisma.dailyPayoutLedger.deleteMany({ where: { businessDate: { in: MONTH.map(dateValue) } } });
  await prisma.shiftReconciliation.deleteMany({ where: { reconciliationDate: { in: MONTH.map(dateValue) } } });
  await prisma.dailyPayoutLedger.deleteMany({ where: { businessDate: { in: JAN.map(dateValue) } } });
  await prisma.shiftReconciliation.deleteMany({ where: { reconciliationDate: { in: JAN.map(dateValue) } } });
}

async function cleanup() {
  try {
    await cleanupDates();
    await prisma.dailyPayoutLedger.deleteMany({ where: { barberId: BARBER } });
    await prisma.syncMismatchLog.deleteMany({ where: { transactionId: { in: txIds } } });
    await prisma.transaction.deleteMany({ where: { OR: [{ id: { in: txIds } }, { barberId: BARBER }] } });
    await prisma.barber.deleteMany({ where: { id: BARBER } });
  } finally {
    await devices.cleanup(prisma); // even when a delete above fails
  }
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
    await testOwner?.cleanup().catch((e) => console.error("Test owner cleanup failed:", e));
    await barberSessionCleanup?.().catch((e) => console.error("Test barber cleanup failed:", e));
    await cleanup().catch((e) => console.error("Cleanup failed:", e));
    await prisma.$disconnect();
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
      for (const f of failures) console.log(`  FAIL ${f}`);
      process.exit(1);
    }
  });

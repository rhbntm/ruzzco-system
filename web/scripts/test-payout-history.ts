/**
 * Slice 20: the read-only payout history, GET /api/v1/reports/payout-history?from&to.
 *
 *   npm run dev                       (in another terminal)
 *   npm run test:payout-history       (TEST_BASE_URL overrides http://localhost:3000)
 *
 * Needs OWNER_PIN in web/.env (read, never printed). Uses two throwaway barbers, an approved
 * scratch phone, a scratch owner and barber account, and fixed past dates in March 2000 (no real
 * data); everything it creates is deleted at the end.
 *
 * Week Mon 2000-03-06 .. Sun 2000-03-12 (barber A active, barber B made inactive):
 *   Sun 03-05 23:59:59.999  A ₱100            out of the range (edge case 1)
 *   Mon 03-06 00:00:00.000  A ₱200            owed 100, paid 200 (overpaid by 100, edge case 5)
 *   Tue 03-07               A ₱200            owed 100, unpaid; a PENDING QR Ph sale owes nothing
 *   Wed 03-08               A ₱300, then ₱100 synced after the day was opened on /ledger
 *   Thu 03-09               A ₱250 paid in full, then ₱300 + ₱10 tip: additional owed
 *   Fri 03-10               A ₱500, payout 200 and a correction of 50 (recorded today: edge case 6)
 *   Sat 03-11               B ₱400 (inactive, edge case 8); A has only a held flagged sale
 *   Sun 03-12 23:59:59.999  B ₱222            in
 *   Mon 03-13 00:00:00.000  A ₱444            out
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { loadEnvConfig } from "@next/env";
import { prisma } from "../src/lib/prisma";
import { manilaToday } from "../src/lib/business-date";
import { datesBetween } from "../src/lib/date-range";
import { createTestOwner, type TestOwner } from "./lib/test-owner";
import { createTestDevices } from "./lib/test-devices";
import { createTestBarberSession } from "./lib/test-barber-session";

loadEnvConfig(process.cwd());

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const SERVICE_ID = "10000000-0000-0000-0000-000000000001"; // seeded Haircut
const RUN = randomUUID().slice(0, 8);
const A = { id: `test-hist-a-${RUN}`, fullName: `Test History A ${RUN}` };
const B = { id: `test-hist-b-${RUN}`, fullName: `Test History B ${RUN}` };
const FROM = "2000-03-06";
const TO = "2000-03-12";
const [MON, TUE, WED, THU, FRI, SAT, SUN] = datesBetween(FROM, TO);
const MARCH = datesBetween("2000-03-01", "2000-03-31");
const dateValue = (date: string) => new Date(`${date}T00:00:00.000Z`);
const AT = (date: string, time: string) => new Date(`${date}T${time}+08:00`);
const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

const devices = createTestDevices(BASE);
let deviceKey = "";
const txIds: string[] = [];
let ownerCookie = "";
let testOwner: TestOwner | null = null;
let barberCleanup: (() => Promise<void>) | null = null;
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

type Entry = { id: string; method: string; kind: string; amount: string; correctsId: string | null; note: string | null; recordedAt: string; correctableLeft: string };
type HistoryBarber = {
  barberId: string; barberName: string; active: boolean; commission: string; tips: string;
  owed: string; paid: string; remaining: string; additionalOwed: boolean; entries: Entry[];
};
type History = {
  success: boolean; error?: string; from: string; to: string; heldForReview: number;
  totals: { owed: string; paid: string; remaining: string; additionalOwedDays: number };
  days: { date: string; barbers: HistoryBarber[] }[];
};
type CardRow = { barberId: string; totalOwed: string; paidTotal: string; remaining: string; additionalOwed: boolean };

async function call<T>(path: string, init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}) {
  const cookie = init.cookie ?? ownerCookie;
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...init.headers },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as T };
}
const history = (from = FROM, to = TO, cookie?: string, headers?: Record<string, string>) =>
  call<History>(`/api/v1/reports/payout-history?from=${from}&to=${to}`, { cookie, headers });
const cards = (date: string) => call<{ rows: CardRow[] }>(`/api/v1/reports/payouts?date=${date}&commissionBase=LIST_PRICE`);
const pay = (date: string, barberId: string, amount: number, extra: Record<string, unknown> = {}) =>
  call<{ success: boolean; entry: Entry }>("/api/v1/reports/payouts", { method: "POST", body: { id: randomUUID(), date, barberId, commissionBase: "LIST_PRICE", method: "CASH", amount, ...extra } });

async function insertSale(barberId: string, at: Date, amount: number, extra: Partial<Prisma.TransactionUncheckedCreateInput> = {}) {
  const id = randomUUID();
  txIds.push(id);
  await prisma.transaction.create({
    data: {
      id, barberId, totalAmount: amount, listPrice: amount, amountPaid: amount, customAmount: true, tipAmount: 0,
      barberCommissionAmount: amount / 2, commissionRate: 0.5, paymentMethod: "CASH", paymentStatus: "PAID", transactionTime: at, ...extra,
      items: { create: { serviceId: SERVICE_ID, priceAtSale: amount } },
      commissionLogs: { create: { barberId, amount: amount / 2 } },
    },
  });
  return id;
}

async function syncSale(barberId: string, at: Date, amount: number, tipAmount = 0) {
  const id = randomUUID();
  txIds.push(id);
  const res = await call<{ syncedIds: string[]; rejected: unknown[] }>("/api/v1/transactions/sync", {
    method: "POST",
    cookie: "",
    headers: devices.headers(deviceKey),
    body: { transactions: [{ id, barberId, serviceId: SERVICE_ID, totalAmount: amount, listPrice: amount, amountPaid: amount, tipAmount, customAmount: true, paymentMethod: "CASH", transactionTime: at.toISOString() }] },
  });
  check(`setup: ₱${amount} sale synced on ${manilaToday(at)}`, res.status === 200 && res.body.syncedIds.includes(id), JSON.stringify(res.body));
}

const row = (h: History, date: string, barberId: string) => h.days.find((d) => d.date === date)?.barbers.find((b) => b.barberId === barberId);

async function main() {
  console.log(`Payout history test against ${BASE} (run ${RUN})\n`);
  const health = await fetch(`${BASE}/api/v1/health`).catch(() => null);
  if (!health?.ok) throw new Error(`Dev server not reachable at ${BASE}. Start it with \`npm run dev\`.`);
  const existing = await prisma.transaction.count({ where: { transactionTime: { gte: AT("2000-03-01", "00:00:00.000"), lt: AT("2000-04-01", "00:00:00.000") } } });
  if (existing > 0) throw new Error(`${existing} sales already exist in March 2000; refusing to run`);
  await cleanupDates();

  testOwner = await createTestOwner(BASE, prisma, "pay-hist");
  ownerCookie = testOwner.cookie;
  for (const barber of [A, B]) await prisma.barber.create({ data: { ...barber, commissionRate: 0.5 } });
  deviceKey = await devices.approve();

  console.log("Authorization");
  check("signed out → 401", (await history(FROM, TO, "")).status === 401);
  const barber = await createTestBarberSession(BASE, prisma, A.id, devices.headers(deviceKey), deviceKey, "hist");
  barberCleanup = barber.cleanup;
  check("an authenticated BARBER session → 401", (await history(FROM, TO, barber.cookie)).status === 401);
  check("a BARBER session with approved-phone headers → 401", (await history(FROM, TO, barber.cookie, devices.headers(deviceKey))).status === 401);
  check("approved-phone headers alone → 401", (await history(FROM, TO, "", devices.headers(deviceKey))).status === 401);
  const empty = await history();
  check("the owner → 200", empty.status === 200 && empty.body.success === true && Array.isArray(empty.body.days), JSON.stringify(empty.body));
  check("a range with nothing in it lists no day and totals zero", empty.body.days.length === 0 && empty.body.totals.owed === "0.00" && empty.body.totals.remaining === "0.00");

  // ── Fixtures ──
  await insertSale(A.id, AT("2000-03-05", "23:59:59.999"), 100);
  await insertSale(A.id, AT(MON, "00:00:00.000"), 200);
  const monLedger = await prisma.dailyPayoutLedger.create({
    data: { barberId: A.id, businessDate: dateValue(MON), commissionTotal: 100, tipTotal: 0, totalOwed: 100, cashPaid: 200, paidAt: new Date() },
  });
  // Paid 100 too much (a stored payment above what the sales say; the route refuses one, so written directly).
  await prisma.payoutEntry.create({ data: { id: randomUUID(), ledgerId: monLedger.id, barberId: A.id, businessDate: dateValue(MON), method: "CASH", amount: 200, owedAtEntry: 200 } });
  await insertSale(A.id, AT(TUE, "10:00:00.000"), 200);
  await insertSale(A.id, AT(TUE, "11:00:00.000"), 250, { paymentMethod: "QRPH", paymentStatus: "PENDING" });
  await insertSale(A.id, AT(WED, "10:00:00.000"), 300);
  await insertSale(A.id, AT(THU, "10:00:00.000"), 250);
  await insertSale(A.id, AT(FRI, "10:00:00.000"), 500);
  await insertSale(B.id, AT(SAT, "10:00:00.000"), 400);
  await insertSale(A.id, AT(SAT, "11:00:00.000"), 600, { timeFlag: "DEVICE_CLOCK_SKEW", clockSkewSeconds: 3600 }); // held for review
  await insertSale(B.id, AT(SUN, "23:59:59.999"), 222);
  await insertSale(A.id, AT("2000-03-13", "00:00:00.000"), 444);

  // Wednesday is opened on /ledger (its stored row says 150), then a sale syncs late.
  const opened = await cards(WED);
  check("setup: Wednesday opened on the ledger (stored owed 150.00)", opened.body.rows?.find((r) => r.barberId === A.id)?.totalOwed === "150.00", JSON.stringify(opened.body));
  await syncSale(A.id, AT(WED, "15:00:00.000"), 100);
  // Thursday paid in full, then a later sale with a tip.
  const thuPaid = await pay(THU, A.id, 125);
  check("setup: Thursday paid in full (125)", thuPaid.status === 200 && thuPaid.body.success, JSON.stringify(thuPaid.body));
  await syncSale(A.id, AT(THU, "16:00:00.000"), 300, 10);
  // Friday: a payout of 200 and a correction of 50 of it.
  const friPay = await pay(FRI, A.id, 200);
  check("setup: Friday payout 200", friPay.status === 200 && friPay.body.success, JSON.stringify(friPay.body));
  const friFix = await pay(FRI, A.id, 50, { kind: "CORRECTION", correctsId: friPay.body.entry?.id, note: "counted twice" });
  check("setup: Friday correction of 50", friFix.status === 200 && friFix.body.success, JSON.stringify(friFix.body));
  await prisma.barber.update({ where: { id: B.id }, data: { isActive: false } });

  const counts = () => Promise.all([prisma.transaction.count(), prisma.dailyPayoutLedger.count(), prisma.payoutEntry.count(), prisma.dailyPayoutLedger.findMany({ where: { barberId: { in: [A.id, B.id] } }, select: { totalOwed: true, cashPaid: true, updatedAt: true }, orderBy: { id: "asc" } })]);
  const before = JSON.stringify(await counts());
  const h = (await history()).body;

  console.log("\nOwed from sales");
  const wed = row(h, WED, A.id);
  const storedWed = await prisma.dailyPayoutLedger.findUnique({ where: { barberId_businessDate: { barberId: A.id, businessDate: dateValue(WED) } } });
  check("the stored Wednesday row is stale (still 150.00)", storedWed?.totalOwed.toFixed(2) === "150.00", storedWed?.totalOwed.toFixed(2));
  check("history owed includes the late sale (200.00)", wed?.owed === "200.00" && wed.commission === "200.00" && wed.remaining === "200.00", JSON.stringify(wed));
  const tue = row(h, TUE, A.id);
  check("a PENDING QR Ph sale owes nothing (Tuesday 100.00)", tue?.owed === "100.00", JSON.stringify(tue));

  console.log("\nAdditional owed");
  const thu = row(h, THU, A.id);
  check("fully paid, then a later sale: additionalOwed", thu?.additionalOwed === true, JSON.stringify(thu));
  check("remaining = the new sale's commission + tip (150 + 10 = 160.00), paid unchanged (125.00)", thu?.remaining === "160.00" && thu.paid === "125.00" && thu.owed === "285.00" && thu.tips === "10.00", JSON.stringify(thu));
  check("counted once in additionalOwedDays", h.totals.additionalOwedDays === 1, String(h.totals.additionalOwedDays));
  check("no other barber-day is flagged", h.days.flatMap((d) => d.barbers).filter((b) => b.additionalOwed).length === 1);

  console.log("\nCorrections");
  const fri = row(h, FRI, A.id);
  check("paid is the signed sum (200 − 50 = 150.00)", fri?.paid === "150.00", JSON.stringify(fri));
  check("both entries listed as stored: the payout +200.00, the correction −50.00", fri?.entries.length === 2 && fri.entries[0].amount === "200.00" && fri.entries[0].kind === "PAYOUT" && fri.entries[1].amount === "-50.00" && fri.entries[1].kind === "CORRECTION" && fri.entries[1].correctsId === fri.entries[0].id, JSON.stringify(fri?.entries));
  check("remaining follows (250 − 150 = 100.00)", fri?.remaining === "100.00");

  console.log("\nDaily versus range-level remaining (edge case 5)");
  const mon = row(h, MON, A.id);
  check("Monday overpaid by 100: remaining 0.00", mon?.owed === "100.00" && mon.paid === "200.00" && mon.remaining === "0.00", JSON.stringify(mon));
  check("Tuesday owed 100: remaining 100.00", tue?.remaining === "100.00" && tue.paid === "0.00");
  const all = h.days.flatMap((d) => d.barbers);
  const sum = (key: "owed" | "paid" | "remaining") => all.reduce((n, b) => n.add(b[key]), D(0));
  check("totals.owed = Σ owed (1246.00)", h.totals.owed === sum("owed").toFixed(2) && h.totals.owed === "1246.00", h.totals.owed);
  check("totals.paid = Σ signed paid (475.00)", h.totals.paid === sum("paid").toFixed(2) && h.totals.paid === "475.00", h.totals.paid);
  check("totals.remaining = Σ clamped daily remaining (871.00)", h.totals.remaining === sum("remaining").toFixed(2) && h.totals.remaining === "871.00", h.totals.remaining);
  check("…not owed − paid (771.00)", D(h.totals.owed).sub(h.totals.paid).toFixed(2) === "771.00" && h.totals.remaining !== "771.00");
  const monTue = (await history(MON, TUE)).body;
  check("Monday + Tuesday alone: remaining 100.00, not owed − paid (0.00)", monTue.totals.remaining === "100.00" && monTue.totals.owed === "200.00" && monTue.totals.paid === "200.00", JSON.stringify(monTue.totals));

  console.log("\nWhere entries and barbers are listed");
  const today = manilaToday();
  check("an entry recorded today is listed under the date it pays for (Friday), not under today (edge case 6)", fri?.entries.every((e) => manilaToday(new Date(e.recordedAt)) === today) === true && !h.days.some((d) => d.date === today));
  const sat = h.days.find((d) => d.date === SAT);
  check("an inactive barber's sales are listed (edge case 8)", sat?.barbers.length === 1 && sat.barbers[0].barberId === B.id && sat.barbers[0].active === false && sat.barbers[0].owed === "200.00", JSON.stringify(sat));
  check("a barber with only a held flagged sale is not listed that day", !sat?.barbers.some((b) => b.barberId === A.id));
  check("held for review: 1", h.heldForReview === 1, String(h.heldForReview));
  check("only barber-days with something: A on Mon–Fri, B on Sat and Sun", JSON.stringify(h.days.map((d) => [d.date, d.barbers.map((b) => b.barberId === A.id ? "A" : "B").join()])) === JSON.stringify([[SUN, "B"], [SAT, "B"], [FRI, "A"], [THU, "A"], [WED, "A"], [TUE, "A"], [MON, "A"]]), JSON.stringify(h.days.map((d) => d.date)));
  check("days newest first", h.days.every((d, i) => i === 0 || h.days[i - 1].date > d.date));
  await insertSale(B.id, AT(FRI, "18:00:00.000"), 100);
  const both = (await history(FRI, FRI)).body.days[0]?.barbers.map((b) => b.barberName) ?? [];
  check("barbers by name within a day", both.length === 2 && both[0] === A.fullName && both[1] === B.fullName, JSON.stringify(both));

  console.log("\nManila midnights (edge case 1)");
  check("00:00:00.000 on from is in (Monday)", mon?.commission === "100.00");
  check("23:59:59.999 on to is in (Sunday, 111.00)", row(h, SUN, B.id)?.owed === "111.00");
  check("23:59:59.999 the day before from and 00:00:00.000 the day after to are out", !h.days.some((d) => d.date === "2000-03-05" || d.date === "2000-03-13"));
  const outside = (await history("2000-03-05", "2000-03-05")).body;
  check("…and each counts on its own day", row(outside, "2000-03-05", A.id)?.owed === "50.00" && row((await history("2000-03-13", "2000-03-13")).body, "2000-03-13", A.id)?.owed === "222.00");

  console.log("\nRead-only");
  await history("2000-03-01", "2000-03-31");
  await history(MON, MON);
  // The Friday B sale above is the only write since `before`.
  const afterCounts = await counts();
  const expected = JSON.parse(before);
  expected[0] += 1;
  check("GETs write nothing (transactions, ledger rows and their values, entries unchanged)", JSON.stringify(afterCounts) === JSON.stringify(expected));
  check("from after to → 400", (await history(TO, FROM)).status === 400);
  check("367 dates → 400", (await history("1999-03-01", "2000-03-01")).status === 400);
  check("366 dates → 200", (await history("1999-03-02", "2000-03-01")).status === 200);
  check("an impossible date → 400", (await history("2000-02-30", TO)).status === 400);
  check("a missing to → 400", (await call("/api/v1/reports/payout-history?from=2000-03-01")).status === 400);
  const tomorrow = new Date(Date.parse(`${today}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
  const future = await history(today, tomorrow);
  check("to after today → 422 \"That date has not happened yet\"", future.status === 422 && future.body.error === "That date has not happened yet", `${future.status} ${future.body?.error}`);

  console.log("\nAgreement with the payout cards (the payouts GET, list price)");
  const final = (await history()).body;
  for (const date of [MON, TUE, WED, THU, FRI, SAT, SUN]) {
    const rows = (await cards(date)).body.rows ?? [];
    for (const b of final.days.find((d) => d.date === date)?.barbers ?? []) {
      const card = rows.find((r) => r.barberId === b.barberId);
      check(`${date} ${b.barberId === A.id ? "A" : "B"}: owed, paid, remaining and additionalOwed equal the card`,
        !!card && card.totalOwed === b.owed && card.paidTotal === b.paid && card.remaining === b.remaining && card.additionalOwed === b.additionalOwed,
        `${JSON.stringify(card)} vs ${JSON.stringify(b)}`);
    }
  }
}

async function cleanupDates() {
  await prisma.dailyPayoutLedger.deleteMany({ where: { businessDate: { in: MARCH.map(dateValue) } } });
}

async function cleanup() {
  try {
    await cleanupDates();
    await prisma.dailyPayoutLedger.deleteMany({ where: { barberId: { in: [A.id, B.id] } } });
    await prisma.syncMismatchLog.deleteMany({ where: { transactionId: { in: txIds } } });
    await prisma.transaction.deleteMany({ where: { OR: [{ id: { in: txIds } }, { barberId: { in: [A.id, B.id] } }] } });
    await barberCleanup?.();
    await prisma.barber.deleteMany({ where: { id: { in: [A.id, B.id] } } });
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

/**
 * Slice 22a: the owner's Sales route (GET /api/v1/reports/sales) on a running dev server.
 *
 *   npm run dev                  (in another terminal)
 *   npm run test:sales-list      (TEST_BASE_URL overrides http://localhost:3000)
 *
 * Needs MySQL. Creates a throwaway owner, two throwaway barbers (one inactive) and its own sales on
 * fixed past dates in March 2000 (no real data), and removes them all at the end.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { loadEnvConfig } from "@next/env";
import { prisma } from "../src/lib/prisma";
import { createTestOwner, type TestOwner } from "./lib/test-owner";
import { manilaToday } from "../src/lib/business-date";
import { parseRange } from "../src/lib/date-range";
import { parseSalesQuery, clampPage } from "../src/lib/sales-list";

loadEnvConfig(process.cwd());

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const RUN = randomUUID().slice(0, 8);
const BARBER_A = `test-sales-a-${RUN}`;
const BARBER_B = `test-sales-b-${RUN}`; // inactive
const AT = (date: string, time: string) => new Date(`${date}T${time}+08:00`);
const D = (value: string | number) => new Prisma.Decimal(value);
const txIds: string[] = [];
let owner: TestOwner | null = null;
let cookie = "";
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

type SaleRow = { id: string; listedOn: string; countsOn: string | null; counted: boolean; timeReview: string | null; paymentStatus: string; barberName: string };
type Answer = {
  success: boolean; error?: string; from: string; to: string; page: number; pageCount: number; pageSize: number;
  totals: { count: number; paidCount: number; amountPaid: string; tips: string; commission: string; notCounted: number };
  sales: SaleRow[];
};
async function sales(query: string, withCookie = cookie) {
  const res = await fetch(`${BASE}/api/v1/reports/sales?${query}`, { headers: withCookie ? { Cookie: withCookie } : {} });
  return { status: res.status, body: (await res.json()) as Answer };
}

type NewSale = {
  barberId: string; at: Date; amount?: number; tip?: number; method?: "CASH" | "GCASH" | "MAYA" | "QRPH";
  status?: "PAID" | "PENDING" | "EXPIRED" | "FAILED"; custom?: boolean; discount?: number; serviceId: string;
  flag?: boolean; syncedAt?: Date;
};
async function addSale(s: NewSale) {
  const id = randomUUID();
  const amount = s.amount ?? 250;
  await prisma.transaction.create({
    data: {
      id, barberId: s.barberId, totalAmount: D(amount), amountPaid: D(amount), listPrice: D(amount + (s.discount ?? 0)),
      discountAmount: D(s.discount ?? 0), discountType: s.discount ? "PERCENT" : "NONE", tipAmount: D(s.tip ?? 0),
      customAmount: s.custom ?? false, customAmountNote: s.custom ? "test" : null,
      barberCommissionAmount: D((amount + (s.discount ?? 0)) / 2), commissionRate: D(0.5),
      paymentMethod: s.method ?? "CASH", paymentStatus: s.status ?? "PAID", transactionTime: s.at,
      ...(s.syncedAt ? { syncedAt: s.syncedAt } : {}),
      ...(s.flag ? { timeFlag: "DEVICE_CLOCK_SKEW" as const } : {}),
      items: { create: [{ serviceId: s.serviceId, priceAtSale: D(amount) }] },
    },
  });
  txIds.push(id);
  return id;
}

async function main() {
  owner = await createTestOwner(BASE, prisma, "sales");
  cookie = owner.cookie;
  const [svc1, svc2] = await prisma.service.findMany({ take: 2, orderBy: { name: "asc" }, select: { id: true } });
  await prisma.barber.create({ data: { id: BARBER_A, fullName: `Test Sales A ${RUN}`, commissionRate: 0.5 } });
  await prisma.barber.create({ data: { id: BARBER_B, fullName: `Test Sales B ${RUN}`, commissionRate: 0.5, isActive: false } });

  const DAY1 = "2000-03-10", DAY2 = "2000-03-11", DAY3 = "2000-03-12";
  // 21 paid cash sales on DAY1 for barber A, a tip on each.
  for (let i = 0; i < 21; i++) await addSale({ barberId: BARBER_A, at: AT(DAY1, `10:${String(i).padStart(2, "0")}:00`), tip: 10, serviceId: svc1.id });
  await addSale({ barberId: BARBER_A, at: AT(DAY1, "15:00:00"), method: "QRPH", status: "PENDING", serviceId: svc1.id });
  await addSale({ barberId: BARBER_A, at: AT(DAY1, "15:30:00"), method: "QRPH", status: "EXPIRED", serviceId: svc1.id });
  await addSale({ barberId: BARBER_B, at: AT(DAY2, "11:00:00"), method: "GCASH", serviceId: svc2?.id ?? svc1.id });
  await addSale({ barberId: BARBER_A, at: AT(DAY3, "11:00:00"), amount: 999, custom: true, serviceId: svc1.id });
  await addSale({ barberId: BARBER_A, at: AT(DAY3, "12:00:00"), amount: 125, discount: 125, serviceId: svc1.id });
  // Flagged, not reviewed: stated Mar 3, received Mar 12.
  const flaggedId = await addSale({ barberId: BARBER_A, at: AT("2000-03-03", "10:00:00"), syncedAt: AT(DAY3, "09:00:00"), flag: true, serviceId: svc1.id });

  console.log("Access and input");
  const range = `from=${DAY1}&to=${DAY3}`;
  check("signed out → 401", (await sales(range, "")).status === 401);
  check("signed out with a bad range is still 401 (before any query)", (await sales("from=bad&to=bad", "")).status === 401);
  check("no from/to → 400", (await sales("")).status === 400);
  const today = manilaToday();
  for (const [name, from, to, status] of [
    ["from after to", DAY3, DAY1, 400], ["not a date", "2000-02-30", DAY1, 400], ["more than 366 dates", "1999-01-01", DAY3, 400], ["a future date", today, new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10), 422],
  ] as const) {
    const r = await sales(`from=${from}&to=${to}`);
    const expected = parseRange(from, to, today);
    check(`${name} → ${status} with parseRange's wording`, r.status === status && !expected.ok && r.body.error === expected.error, `${r.status} ${r.body.error}`);
  }
  for (const bad of ["method=CHECK", "status=LOST", "kind=big", "page=abc", "pageSize=0", "pageSize=7", "pageSize=101", "pageSize=2.5"]) {
    check(`${bad} → 400`, (await sales(`${range}&${bad}`)).status === 400);
  }
  check("an id that matches nothing finds no sales (not an error)", (await sales(`${range}&barberId=nobody`)).body.totals.count === 0);
  check("no pageSize means 25", (await sales(range)).body.pageSize === 25);
  const parsed = parseSalesQuery(new URLSearchParams("pageSize=10&page=2"));
  check("parseSalesQuery reads page and size", !("error" in parsed) && parsed.page === 2 && parsed.pageSize === 10);
  check("clampPage clamps past the last page", clampPage(9, 21, 10).page === 3 && clampPage(0, 0, 10).page === 1);

  console.log("\nTotals");
  const all = await sales(range);
  const summary = await (await fetch(`${BASE}/api/v1/reports/ledger-summary?${range}`, { headers: { Cookie: cookie } })).json();
  check("with no filters, amount paid equals the ledger summary's total", all.body.totals.amountPaid === summary.sales.total, `${all.body.totals.amountPaid} vs ${summary.sales.total}`);
  check("commission equals the summary's", all.body.totals.commission === summary.shared.commissions, `${all.body.totals.commission} vs ${summary.shared.commissions}`);
  check("tips equal the summary's", all.body.totals.tips === summary.shared.tips);
  // 21*250 + 125 (GCash) wait: B's sale is 250 -> 21*250 + 250 + 999 + 125 = 6624
  check("amount paid is PAID sales only: 21×250 + 250 + 999 + 125", all.body.totals.amountPaid === "6624.00", all.body.totals.amountPaid);
  check("listed: 21 + pending + expired + 1 + custom + loyalty + the flagged one", all.body.totals.count === 27, String(all.body.totals.count));
  check("not counted: pending, expired and the flagged sale", all.body.totals.notCounted === 3, String(all.body.totals.notCounted));
  check("PENDING and EXPIRED sales are listed", all.body.sales.length === 25 && (await sales(`${range}&status=PENDING`)).body.totals.count === 1 && (await sales(`${range}&status=EXPIRED`)).body.totals.count === 1);

  console.log("\nFilters");
  const f = async (q: string) => (await sales(`${range}&${q}`)).body.totals;
  check("barber A", (await f(`barberId=${BARBER_A}`)).count === 26);
  check("the inactive barber's sales are listed", (await f(`barberId=${BARBER_B}`)).count === 1);
  check("method GCASH", (await f("method=GCASH")).count === 1);
  check("method QRPH", (await f("method=QRPH")).count === 2);
  check("status PAID", (await f("status=PAID")).count === 25, String((await f("status=PAID")).count));
  check("service filter narrows", (svc2 ? (await f(`serviceId=${svc2.id}`)).count === 1 : true));
  check("kind custom", (await f("kind=custom")).count === 1 && (await f("kind=custom")).amountPaid === "999.00");
  check("kind loyalty", (await f("kind=loyalty")).count === 1 && (await f("kind=loyalty")).amountPaid === "125.00");

  // Slice 23: a sale of two services, alone on its own day.
  if (svc2) {
    const DAY4 = "2000-03-13";
    const multiId = randomUUID();
    await prisma.transaction.create({
      data: {
        id: multiId, barberId: BARBER_A, totalAmount: D(500), amountPaid: D(500), listPrice: D(500), discountAmount: D(0), discountType: "NONE", tipAmount: D(0),
        barberCommissionAmount: D(250), commissionRate: D(0.5), paymentMethod: "CASH", paymentStatus: "PAID", transactionTime: AT(DAY4, "11:00:00"),
        items: { create: [{ serviceId: svc1.id, priceAtSale: D(250) }, { serviceId: svc2.id, priceAtSale: D(250) }] },
      },
    });
    txIds.push(multiId);
    const day4 = `from=${DAY4}&to=${DAY4}`;
    for (const svc of [svc1, svc2]) {
      const r = await sales(`${day4}&serviceId=${svc.id}`);
      check(`slice 23: filtering by either of its services lists the two-service sale once (${svc === svc1 ? "first" : "second"})`, r.body.totals.count === 1 && r.body.sales.length === 1 && r.body.totals.amountPaid === "500.00", JSON.stringify(r.body.totals));
    }
    const plain = await sales(day4);
    const row = plain.body.sales[0] as SaleRow & { serviceName?: string; serviceNames?: string[] };
    check("slice 23: one row, both services named, amount paid once (₱500)", plain.body.sales.length === 1 && row.serviceNames?.length === 2 && (row.serviceName ?? "").includes(" + ") && plain.body.totals.amountPaid === "500.00" && plain.body.totals.paidCount === 1, JSON.stringify(row));
  }
  check("filters combine (barber A, cash, paid, one day)", (await sales(`from=${DAY1}&to=${DAY1}&barberId=${BARBER_A}&method=CASH&status=PAID`)).body.totals.count === 21);

  console.log("\nFlagged sales");
  const flaggedIn = (r: Answer) => r.sales.find((s) => s.id === flaggedId);
  const onReceived = await sales(`from=${DAY3}&to=${DAY3}`);
  const flagged = flaggedIn(onReceived.body);
  check("an unreviewed flagged sale is listed on its received date, marked, and not counted", !!flagged && flagged.listedOn === DAY3 && flagged.countsOn === null && !flagged.counted && flagged.timeReview === "UNDER_REVIEW");
  check("a range of its stated dates doesn't list it", !flaggedIn((await sales("from=2000-03-01&to=2000-03-05")).body));
  await prisma.transaction.update({ where: { id: flaggedId }, data: { timeReviewedAt: new Date(), timeReviewChoice: "STATED_DATE", timeReviewedBusinessDate: new Date("2000-03-03T00:00:00.000Z") } });
  const afterStated = flaggedIn((await sales("from=2000-03-01&to=2000-03-05")).body);
  check("after review it is listed and counted on the confirmed date", !!afterStated && afterStated.countsOn === "2000-03-03" && afterStated.counted);
  check("and no longer on its received date", !flaggedIn((await sales(`from=${DAY3}&to=${DAY3}`)).body));

  console.log("\nPages");
  const base = `from=${DAY1}&to=${DAY1}&barberId=${BARBER_A}&method=CASH&status=PAID`; // 21 sales
  const p1 = await sales(`${base}&pageSize=10`);
  const p3 = await sales(`${base}&pageSize=10&page=3`);
  const p9 = await sales(`${base}&pageSize=10&page=9`);
  check("21 sales at 10 a page make 3 pages", p1.body.pageCount === 3 && p1.body.sales.length === 10);
  check("page 3 holds 1", p3.body.sales.length === 1 && p3.body.page === 3);
  check("page 9 answers page 3", p9.body.page === 3 && p9.body.sales.length === 1);
  check("no pageSize: one page of 21", (await sales(base)).body.pageCount === 1);
  check("newest first", p1.body.sales[0].id !== p3.body.sales[0].id);
  const same = [p1, p3, p9, await sales(`${base}&pageSize=50`), await sales(`${base}&pageSize=100`)].map((r) => JSON.stringify(r.body.totals));
  check("totals are the same on every page and every size", new Set(same).size === 1);
  const ids = new Set([...p1.body.sales, ...(await sales(`${base}&pageSize=10&page=2`)).body.sales, ...p3.body.sales].map((s) => s.id));
  check("every sale appears once across the pages", ids.size === 21);
}

async function cleanup() {
  await prisma.transaction.deleteMany({ where: { id: { in: txIds } } });
  await prisma.barber.deleteMany({ where: { id: { in: [BARBER_A, BARBER_B] } } });
}

main()
  .catch((error) => {
    failures.push(`crashed: ${error instanceof Error ? error.message : String(error)}`);
    console.error(error);
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("Cleanup failed:", e));
    await owner?.cleanup().catch((e) => console.error("Test owner cleanup failed:", e));
    await prisma.$disconnect();
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
      for (const f of failures) console.log(`  FAIL ${f}`);
      process.exit(1);
    }
    process.exit(0);
  });

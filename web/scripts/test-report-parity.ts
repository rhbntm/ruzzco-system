/**
 * Slice 27: Reports agrees with the Dashboard and Payouts (rangeSummary), End-of-Day Cash
 * (computeExpected, day by day) and Sales (listSales) wherever their figures overlap. Needs MySQL
 * only (no dev server). Synthetic sales on June 1998 dates under a throwaway barber (refuses to
 * run if any sale exists on them); every row is deleted at the end.
 *
 *   npm run test:report-parity
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { parseBusinessDate } from "../src/lib/business-date";
import { parseRange, datesBetween } from "../src/lib/date-range";
import { loadReport, previousRange } from "../src/lib/report";
import { chartBuckets } from "../src/lib/report-chart";
import { rangeFigures } from "../src/lib/range-figures";
import { rangeSummary } from "../src/lib/range-summary";
import { computeExpected } from "../src/lib/reconciliation";
import { listSales } from "../src/lib/sales-list";

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

const D = (v: number) => new Prisma.Decimal(v);
const HAIRCUT = "10000000-0000-0000-0000-000000000001";
const SHAVE = "10000000-0000-0000-0000-000000000002";
const BARBER = randomUUID();
const FROM = "1998-06-08"; // Monday
const TO = "1998-06-14"; // Sunday
const TODAY = "1998-06-30";
const ids: string[] = [];
// A Manila time: "1998-06-10 23:59" Manila is 15:59 UTC the same day.
const at = (date: string, manila: string) => new Date(new Date(`${date}T${manila}:00+08:00`).getTime());

async function sale(o: { date: string; time: string; paid: number; list?: number; tip?: number; method?: "CASH" | "GCASH" | "MAYA" | "QRPH"; status?: "PAID" | "PENDING"; items?: [string, number][]; flag?: boolean; reviewedOn?: string }) {
  const id = randomUUID();
  ids.push(id);
  const list = o.list ?? o.paid;
  await prisma.transaction.create({
    data: {
      id, barberId: BARBER, totalAmount: D(o.paid), amountPaid: D(o.paid), listPrice: D(list), discountAmount: D(list - o.paid), discountType: list > o.paid ? "PERCENT" : "NONE",
      tipAmount: D(o.tip ?? 0), barberCommissionAmount: D(list / 2), commissionRate: D(0.5), paymentMethod: o.method ?? "CASH", paymentStatus: o.status ?? "PAID",
      transactionTime: at(o.date, o.time),
      ...(o.flag ? { timeFlag: "DEVICE_CLOCK_SKEW" as const, clockSkewSeconds: 3600 } : {}),
      ...(o.reviewedOn ? { timeReviewedAt: new Date(), timeReviewChoice: "RECEIVED_DATE" as const, timeReviewedBusinessDate: parseBusinessDate(o.reviewedOn)!.dateValue } : {}),
      items: { create: (o.items ?? [[HAIRCUT, list]]).map(([serviceId, price]) => ({ serviceId, priceAtSale: D(price) })) },
    },
  });
}

async function main() {
  const first = parseBusinessDate("1998-05-01")!.dateValue;
  const last = parseBusinessDate("1998-07-01")!.dateValue;
  const existing = await prisma.transaction.count({ where: { transactionTime: { gte: first, lt: last } } });
  if (existing > 0) throw new Error(`${existing} sales already exist in May–June 1998; refusing to run`);
  await prisma.barber.create({ data: { id: BARBER, fullName: `Test Reports ${BARBER.slice(0, 6)}`, commissionRate: 0.5 } });

  await sale({ date: "1998-06-08", time: "10:15", paid: 250, tip: 20 });
  await sale({ date: "1998-06-08", time: "14:30", paid: 300, method: "GCASH" });
  // Two services with the loyalty card: list ₱500, paid ₱375, items at menu price (slice 23).
  await sale({ date: "1998-06-09", time: "11:00", paid: 375, list: 500, items: [[HAIRCUT, 250], [SHAVE, 250]] });
  // An old-style loyalty haircut: priceAtSale held the amount paid.
  await sale({ date: "1998-06-10", time: "12:00", paid: 125, list: 250, items: [[HAIRCUT, 125]] });
  await sale({ date: "1998-06-10", time: "23:59", paid: 250, method: "MAYA" }); // still Jun 10 in Manila
  await sale({ date: "1998-06-11", time: "00:00", paid: 250 }); // Jun 11 in Manila
  await sale({ date: "1998-06-12", time: "13:00", paid: 250, method: "QRPH", status: "PENDING" }); // never counted
  await sale({ date: "1998-06-13", time: "15:00", paid: 400, flag: true }); // held: counts nowhere
  await sale({ date: "1998-06-20", time: "10:00", paid: 600, flag: true, reviewedOn: "1998-06-14" }); // reviewed onto Jun 14
  await sale({ date: "1998-06-03", time: "10:00", paid: 250 }); // the week before (previous period)

  const today = TODAY;
  const range = parseRange(FROM, TO, today);
  if (!range.ok) throw new Error(range.error);
  const report = await loadReport(range);
  const summary = await rangeSummary(range, "LIST_PRICE");
  const sales = await listSales(range, { filters: { kind: "all" }, page: 1, pageSize: 25 });

  console.log("Reports = Dashboard and Payouts (rangeSummary)");
  check("revenue", report.totals.revenue.toFixed(2) === summary.sales.total, `${report.totals.revenue} vs ${summary.sales.total}`);
  check("paid sales", report.totals.sales === summary.sales.count);
  check("tips", report.totals.tips.toFixed(2) === summary.shared.tips);
  check("payment methods", ["CASH", "GCASH", "MAYA", "QRPH"].every((m) => report.byMethod.find((x) => x.method === m)!.revenue.toFixed(2) === summary.sales[m.toLowerCase() as "cash"]));
  const rows = (list: { name: string; count?: number; items?: number; listSales?: string; listed?: Prisma.Decimal }[]) =>
    list.map((s) => `${s.name}:${s.count ?? s.items}:${s.listSales ?? s.listed!.toFixed(2)}`).sort().join("|");
  check("services: items and menu value", rows(report.byService) === rows(summary.services), `${rows(report.byService)} vs ${rows(summary.services)}`);

  console.log("\nReports = End-of-Day Cash, day by day (computeExpected)");
  const mismatches: string[] = [];
  for (const date of datesBetween(FROM, TO)) {
    const expected = await computeExpected(parseBusinessDate(date)!, 0);
    const day = report.daily.find((d) => d.date === date)!;
    if (!day.revenue.equals(expected.totalRevenue) || day.sales !== expected.transactionCount) mismatches.push(`${date}: ${day.revenue}/${day.sales} vs ${expected.totalRevenue}/${expected.transactionCount}`);
  }
  check("every day's revenue and paid sales", mismatches.length === 0, mismatches.join("; "));

  console.log("\nReports = Sales (listSales, no filters)");
  check("amount paid = revenue", sales.totals.amountPaid === report.totals.revenue.toFixed(2), `${sales.totals.amountPaid} vs ${report.totals.revenue}`);
  check("paid count = paid sales", sales.totals.paidCount === report.totals.sales);
  check("tips", sales.totals.tips === report.totals.tips.toFixed(2));

  console.log("\nDefinitions");
  check("revenue counts each sale once: 250 + 300 + 375 + 125 + 250 + 250 + 600 = 2150", report.totals.revenue.toFixed(2) === "2150.00", report.totals.revenue.toFixed(2));
  check("paid sales: 7 (pending QR Ph and the held sale left out; the reviewed one in)", report.totals.sales === 7, String(report.totals.sales));
  const haircut = report.byService.find((s) => s.items > 1);
  const shave = report.byService.find((s) => s.items === 1);
  check("service items: the two-service sale adds one haircut and one shave", report.byService.reduce((n, s) => n + s.items, 0) === 8 && !!shave, JSON.stringify(report.byService.map((s) => [s.name, s.items, s.listed.toFixed(2)])));
  check("menu value: shave ₱250 (its item), not the sale's ₱500", shave?.listed.toFixed(2) === "250.00");
  check("menu value: the old loyalty haircut counts at its ₱250 list price", haircut !== undefined && haircut.listed.toFixed(2) === (250 + 300 + 250 + 250 + 250 + 250 + 600).toFixed(2), `${haircut?.listed.toFixed(2)} (2025.00 would mean the old row was read at its ₱125 priceAtSale)`);
  check("Manila day boundary: 23:59 counts on Jun 10, 00:00 on Jun 11", report.daily.find((d) => d.date === "1998-06-10")!.sales === 2 && report.daily.find((d) => d.date === "1998-06-11")!.sales === 1);
  check("the reviewed sale counts on its confirmed date (Jun 14)", report.daily.find((d) => d.date === "1998-06-14")!.revenue.toFixed(2) === "600.00");
  check("held for review: 1", report.heldForReview === 1);
  check("busy hours leave out flagged sales (the reviewed one too)", report.hours.reduce((n, h) => n + h.sales, 0) === 6 && report.hourExcluded === 1);

  console.log("\nPrevious period and the chart");
  const prev = previousRange(FROM, 7);
  const before = await rangeFigures(parseBusinessDate(prev.first)!, parseBusinessDate(prev.last)!, "LIST_PRICE");
  check("the previous period is the 7 days before (Jun 1–7)", prev.first === "1998-06-01" && prev.last === "1998-06-07");
  check("previous figures equal rangeFigures over those days", report.previous.revenue.equals(before.total.revenue) && report.previous.sales === before.total.count && report.previous.sales === 1);
  const daysTotal = report.daily.reduce((s, d) => s.add(d.revenue), D(0));
  check("the days add up to the range's revenue", daysTotal.equals(report.totals.revenue));
  const chartTotal = chartBuckets(report.daily.map((d) => ({ date: d.date, revenue: d.revenue.toNumber(), sales: d.sales }))).buckets.reduce((s, b) => s + b.revenue, 0);
  check("the chart's columns add up to the same revenue", Math.round(chartTotal * 100) === Math.round(report.totals.revenue.toNumber() * 100));
  const oneDay = parseRange("1998-06-10", "1998-06-10", today);
  if (oneDay.ok) {
    const [r, s] = await Promise.all([loadReport(oneDay), rangeSummary(oneDay, "LIST_PRICE")]);
    check("a one-day range: Reports = rangeSummary (the Dashboard's Today card path)", r.totals.revenue.toFixed(2) === s.sales.total && r.totals.sales === s.sales.count && r.totals.revenue.toFixed(2) === "375.00");
  }
}

main()
  .catch((error) => {
    failures.push(`crashed: ${error instanceof Error ? error.message : String(error)}`);
    console.error(error);
  })
  .finally(async () => {
    await prisma.transaction.deleteMany({ where: { id: { in: ids } } }).catch((e) => console.error("Cleanup failed:", e));
    await prisma.barber.deleteMany({ where: { id: BARBER } }).catch((e) => console.error("Cleanup failed:", e));
    await prisma.$disconnect();
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
      for (const f of failures) console.log(`  FAIL ${f}`);
      process.exit(1);
    }
  });

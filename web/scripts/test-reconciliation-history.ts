/**
 * Slice 26: saved-count history on End-of-Day Cash. Needs the dev server and MySQL.
 *
 *   npm run test:reconciliation-history     (TEST_BASE_URL overrides http://localhost:3000)
 *
 * Uses synthetic dates in February and March 1999 (refuses to run if any count exists there) and
 * a throwaway owner account; every row it creates is deleted at the end. No sale is created.
 */
import { loadEnvConfig } from "@next/env";
import { prisma } from "../src/lib/prisma";
import { parseBusinessDate } from "../src/lib/business-date";
import { datesBetween } from "../src/lib/date-range";
import { listRevisions, recentCounts } from "../src/lib/reconciliation";
import { createTestOwner, type TestOwner } from "./lib/test-owner";

loadEnvConfig(process.cwd());
const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

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

const FIRST = "1999-02-28";
const LAST = "1999-03-30"; // 31 dates
const DATES = datesBetween(FIRST, LAST);
const POST_DAY = "1999-03-31"; // saved through the real POST route
const day = (d: string) => parseBusinessDate(d)!;
let owner: TestOwner | null = null;

type Saved = { revision: number; expectedCash: string; countedCash: string; variance: string; note: string | null; reconciledAt: string };
async function call<T>(path: string, init: RequestInit = {}, cookie = owner?.cookie ?? "") {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) } });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
}

async function main() {
  const existing = await prisma.shiftReconciliation.count({ where: { reconciliationDate: { gte: day("1999-01-01").dateValue, lte: day(POST_DAY).dateValue } } });
  if (existing > 0) throw new Error(`${existing} counts already exist in early 1999; refusing to run`);
  owner = await createTestOwner(BASE, prisma, "rechist");

  // One count per date; the middle date gets three revisions; the last date's count is saved at
  // 20:00 UTC, which is the next morning in Manila: it still belongs to its business date.
  for (const d of DATES) {
    await prisma.shiftReconciliation.create({
      data: { reconciliationDate: day(d).dateValue, revision: 1, expectedCash: 1000, countedCash: 1000, variance: 0, gcashTotal: 0, totalRevenue: 1000,
        reconciledAt: d === LAST ? new Date(`${d}T20:00:00Z`) : new Date(`${d}T12:00:00Z`) },
    });
  }
  const MID = "1999-03-15";
  for (const [revision, counted] of [[2, 950], [3, 1010]] as const) {
    await prisma.shiftReconciliation.create({
      data: { reconciliationDate: day(MID).dateValue, revision, expectedCash: 1000, countedCash: counted, variance: counted - 1000, gcashTotal: 0, totalRevenue: 1000,
        note: `revision ${revision}`, reconciledAt: new Date(`${MID}T1${revision}:00:00Z`) },
    });
  }

  console.log("Selected-date history");
  const mid = await listRevisions(day(MID));
  check("three revisions, newest first", mid.map((r) => r.revision).join() === "3,2,1", mid.map((r) => r.revision).join());
  check("each keeps its own values", mid[0].countedCash.toFixed(2) === "1010.00" && mid[1].countedCash.toFixed(2) === "950.00" && mid[2].countedCash.toFixed(2) === "1000.00" && mid[1].note === "revision 2");
  check("a date with no count has an empty history", (await listRevisions(day("1999-01-15"))).length === 0);
  const got = await call<{ success: boolean; saved: Saved | null; revisions: Saved[] }>(`/api/v1/reports/reconciliation?date=${MID}`);
  check("GET ?date answers revisions newest first, saved = the first", got.status === 200 && got.body.revisions?.map((r) => r.revision).join() === "3,2,1" && got.body.saved?.revision === 3 && JSON.stringify(got.body.saved) === JSON.stringify(got.body.revisions[0]), JSON.stringify(got.body.revisions?.map((r) => r.revision)));
  check("revision 2 as stored: counted ₱950.00, variance -50.00, its note", got.body.revisions?.[1]?.countedCash === "950.00" && got.body.revisions[1].variance === "-50.00" && got.body.revisions[1].note === "revision 2");
  const empty = await call<{ revisions: Saved[]; saved: Saved | null }>(`/api/v1/reports/reconciliation?date=1999-01-15`);
  check("GET ?date on an uncounted date: no revisions, no saved count", empty.status === 200 && empty.body.revisions?.length === 0 && empty.body.saved === null);

  console.log("\nRecent dates");
  const recent = await recentCounts(day(LAST), 30);
  check("30 dates of the 31 with a count, newest first", recent.length === 30 && recent[0].date === LAST && recent[29].date === "1999-03-01", `${recent.length} ${recent[0]?.date} … ${recent[29]?.date}`);
  check("the 31st (oldest) date is left out", !recent.some((r) => r.date === FIRST));
  check("each date once, with its latest revision (3 on the middle date)", new Set(recent.map((r) => r.date)).size === 30 && recent.find((r) => r.date === MID)?.latest.revision === 3);
  check("Manila date: a count saved at 20:00 UTC stays on its business date", recent[0].date === LAST && recent[0].latest.reconciledAt.toISOString() === `${LAST}T20:00:00.000Z`);
  check("a limit of 5 gives the 5 newest", (await recentCounts(day(LAST), 5)).map((r) => r.date).join() === "1999-03-30,1999-03-29,1999-03-28,1999-03-27,1999-03-26");
  check("up to a date before any count: empty", (await recentCounts(day("1999-02-27"), 30)).length === 0);

  console.log("\nRoute and access");
  const live = await call<{ success: boolean; recent: { date: string; latest: Saved }[] }>("/api/v1/reports/reconciliation?recent=30");
  const liveDates = live.body.recent?.map((r) => r.date) ?? [];
  check("GET ?recent=30: at most 30 dates, newest first, none after today", live.status === 200 && liveDates.length <= 30 && liveDates.every((d, i) => i === 0 || liveDates[i - 1] > d), `${live.status} ${liveDates.length}`);
  for (const bad of ["recent=0", "recent=61", "recent=abc", "recent=2.5", `recent=5&date=${MID}`]) {
    check(`${bad} → 400`, (await call(`/api/v1/reports/reconciliation?${bad}`)).status === 400);
  }
  check("signed out: ?recent is 401", (await call("/api/v1/reports/reconciliation?recent=30", {}, "")).status === 401);
  check("signed out: ?date is 401", (await call(`/api/v1/reports/reconciliation?date=${MID}`, {}, "")).status === 401);

  console.log("\nWrites unchanged (append-only)");
  const post = (counted: number) => call<{ success: boolean; saved: Saved; revisions: Saved[] }>("/api/v1/reports/reconciliation", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: POST_DAY, countedCash: counted, note: `count ${counted}` }),
  });
  const first = await post(0);
  const second = await post(5);
  check("two saves give revisions 1 then 2", first.body.saved?.revision === 1 && second.body.saved?.revision === 2, JSON.stringify([first.body.saved?.revision, second.body.saved?.revision]));
  check("the POST answer carries the history, newest first", second.body.revisions?.map((r) => r.revision).join() === "2,1");
  const stored = await listRevisions(day(POST_DAY));
  check("revision 1 is unchanged after revision 2 (counted ₱0.00, its note)", stored[1]?.revision === 1 && stored[1].countedCash.toFixed(2) === "0.00" && stored[1].note === "count 0");
  check("expected cash is the same in both saves (no sales on the date)", first.body.saved?.expectedCash === second.body.saved?.expectedCash);
}

main()
  .catch((error) => {
    failures.push(`crashed: ${error instanceof Error ? error.message : String(error)}`);
    console.error(error);
  })
  .finally(async () => {
    await prisma.shiftReconciliation
      .deleteMany({ where: { reconciliationDate: { gte: day(FIRST).dateValue, lte: day(POST_DAY).dateValue } } })
      .catch((e) => console.error("Cleanup failed:", e));
    await owner?.cleanup().catch((e) => console.error("Test owner cleanup failed:", e));
    await prisma.$disconnect();
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
      for (const f of failures) console.log(`  FAIL ${f}`);
      process.exit(1);
    }
  });

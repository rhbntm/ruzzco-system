/**
 * Integration test for the owner forecast routes (slice 7): owner-only access, refresh saves
 * one run and 30 days (slice 14: the home panel's longest view), a second refresh the same day
 * overwrites those dates, GET still reads back 7.
 *
 * Needs, in other terminals:
 *   docker compose up -d ml-service   (trained: python train.py has written the artifacts)
 *   npm run dev                       (OWNER_PIN in web/.env)
 *   npm run test:forecast             (TEST_BASE_URL overrides http://localhost:3000)
 *
 * Refresh writes the real forecast for today and the next 29 days, exactly as the dashboard's
 * button does, and those rows are kept.
 */
import { loadEnvConfig } from "@next/env";
import { prisma } from "../src/lib/prisma";
import { manilaToday, parseBusinessDate } from "../src/lib/business-date";
import { addDays, type SerializedForecast } from "../src/lib/forecast";
import { MAX_FORECAST_DAYS } from "../src/lib/forecast-chart";

loadEnvConfig(process.cwd());

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
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

type Body = ({ success: true } & SerializedForecast) | { success: false; error: string };

async function call(method: "GET" | "POST", path: string, owner = true) {
  const res = await fetch(`${BASE}${path}`, { method, headers: owner ? { Cookie: ownerCookie } : {} });
  return { status: res.status, body: (await res.json().catch(() => null)) as Body | null };
}

const MONEY = /^\d+\.\d{2}$/;

async function main() {
  console.log(`Forecast integration test against ${BASE}`);
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

  const today = manilaToday();
  const range = { gte: parseBusinessDate(today)!.dateValue, lt: parseBusinessDate(addDays(today, MAX_FORECAST_DAYS))!.dateValue };
  const rowsInRange = () => prisma.dailyRevenueForecast.findMany({ where: { forecastDate: range } });

  console.log("\nOwner only");
  check("GET without the owner cookie is 401", (await call("GET", "/api/v1/forecast", false)).status === 401);
  const runsBefore = await prisma.forecastRun.count();
  check("refresh without the owner cookie is 401", (await call("POST", "/api/v1/forecast/refresh", false)).status === 401);
  check("a refused refresh saves nothing", (await prisma.forecastRun.count()) === runsBefore);

  console.log("\nFirst refresh");
  const first = await call("POST", "/api/v1/forecast/refresh");
  if (first.status === 502) throw new Error("Refresh returned 502: is ml-service up and trained? (docker compose up -d ml-service)");
  check("refresh answers 200", first.status === 200, `got ${first.status}`);
  const firstRun = first.body?.success ? first.body.run : null;
  check("saved exactly one new run", (await prisma.forecastRun.count()) === runsBefore + 1);
  check("returns 30 days from today", first.body?.success === true && first.body.days.length === 30 && first.body.days[0].date === today && first.body.days[29].date === addDays(today, 29));
  const afterFirst = await rowsInRange();
  check("30 stored days point at the run", afterFirst.length === 30 && afterFirst.every((r) => r.runId === firstRun?.id));
  check("confidence bounds stay null", afterFirst.every((r) => r.confidenceLowerBound === null && r.confidenceUpperBound === null));
  check("headcount is the customers rounded", afterFirst.every((r) => r.predictedCustomers !== null && r.predictedHeadcount === Math.round(Number(r.predictedCustomers))));
  check(
    "revenue = customers (one decimal) × average ticket",
    afterFirst.every((r) => Math.abs(Number(r.predictedCustomers) * Number(firstRun?.avgTicket) - Number(r.predictedRevenue)) <= 0.01)
  );

  // Slice 9: the method comparison is saved with the run (needs a model trained with slice 9 code).
  const savedComparison = firstRun?.comparison ?? null;
  const stored = firstRun ? await prisma.forecastRun.findUnique({ where: { id: firstRun.id } }) : null;
  check("the run's comparison was saved and is returned", savedComparison !== null && stored?.comparison !== null, "retrain the ml-service with the slice 9 code first (python train.py, then restart)");
  check("the comparison names the served method and has a mean for it", savedComparison !== null && savedComparison.served in savedComparison.mean);

  console.log("\nSecond refresh the same day");
  const second = await call("POST", "/api/v1/forecast/refresh");
  const secondRun = second.body?.success ? second.body.run : null;
  check("second refresh answers 200", second.status === 200, `got ${second.status}`);
  const afterSecond = await rowsInRange();
  check("still 30 rows for those dates, not 60", afterSecond.length === 30, `got ${afterSecond.length}`);
  check("rows now point at the second run", Boolean(secondRun) && secondRun?.id !== firstRun?.id && afterSecond.every((r) => r.runId === secondRun?.id));

  console.log("\nGET");
  const got = await call("GET", "/api/v1/forecast");
  check("GET answers 200", got.status === 200, `got ${got.status}`);
  if (got.body?.success) {
    const days = got.body.days;
    check("GET returns the latest run", got.body.run?.id === secondRun?.id);
    check("GET returns 7 days from today", days.length === 7 && days[0].date === today && days[6].date === addDays(today, 6));
    check("run was created today in Manila", got.body.run?.createdOn === today);
    check("money is sent as 2-decimal strings", MONEY.test(got.body.run?.avgTicket ?? "") && days.every((d) => MONEY.test(d.revenue)));
  } else {
    check("GET body", false, JSON.stringify(got.body));
  }
}

main()
  .catch((error) => {
    failures.push(`crashed: ${error instanceof Error ? error.message : String(error)}`);
    console.error(error);
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
      for (const f of failures) console.log(`  FAIL ${f}`);
      process.exit(1);
    }
  });

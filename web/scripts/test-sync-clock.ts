/**
 * Tests suspicious-timestamp detection (L5): src/lib/time-anomaly.ts on its own, then the real
 * sync route storing and flagging sales on a running dev server.
 *
 *   npm run dev               (in another terminal)
 *   npm run test:sync-clock   (TEST_BASE_URL overrides http://localhost:3000)
 *
 * Flagged sales are recorded, never rejected, and keep their timestamps. Uses a throwaway
 * barber; everything it creates is deleted at the end.
 */
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { prisma } from "../src/lib/prisma";
import { CLOCK_TOLERANCE_MS, detectTimeAnomaly } from "../src/lib/time-anomaly";

loadEnvConfig(process.cwd());

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const SERVICE_ID = "10000000-0000-0000-0000-000000000001"; // seeded Haircut
const RUN = randomUUID().slice(0, 8);
const BARBER = `test-clock-${RUN}`;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const YEARS_2 = 2 * 365 * DAY;
const txIds: string[] = [];
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

type SyncResponse = { syncedIds: string[]; rejected: { id: string | null; reason: string }[]; duplicatesSkipped: number };

async function sync(items: unknown[], sentAt?: unknown) {
  const res = await fetch(`${BASE}/api/v1/transactions/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactions: items, ...(sentAt === undefined ? {} : { sentAt }) }),
  });
  return { status: res.status, body: (await res.json()) as SyncResponse };
}

function sale(at: Date, amount = 200) {
  const id = randomUUID();
  txIds.push(id);
  return { id, barberId: BARBER, serviceId: SERVICE_ID, totalAmount: amount, paymentMethod: "CASH", transactionTime: at.toISOString() };
}

const stored = (id: string) => prisma.transaction.findUnique({ where: { id } });

function pureChecks() {
  console.log("Detection rule (no server)");
  const now = new Date("2026-10-10T06:00:00.000Z");
  const at = (ms: number) => new Date(now.getTime() + ms);
  check("tolerance is five minutes", CLOCK_TOLERANCE_MS === 5 * MIN);
  check("exactly five minutes ahead is not flagged", detectTimeAnomaly({ transactionTime: at(5 * MIN), serverNow: now }) === null);
  check("five minutes and one second ahead is FUTURE", detectTimeAnomaly({ transactionTime: at(5 * MIN + 1000), serverNow: now })?.flag === "FUTURE_TIMESTAMP");
  check("a 30-day-old sale from a correct clock is not flagged", detectTimeAnomaly({ transactionTime: at(-30 * DAY), sentAt: now, serverNow: now }) === null);
  check("a phone clock 6 minutes behind is DEVICE_CLOCK_SKEW", detectTimeAnomaly({ transactionTime: at(-1 * HOUR), sentAt: at(-6 * MIN), serverNow: now })?.flag === "DEVICE_CLOCK_SKEW");
  const both = detectTimeAnomaly({ transactionTime: at(2 * DAY - HOUR), sentAt: at(2 * DAY), serverNow: now });
  check("both conditions: DEVICE_CLOCK_SKEW wins, skew = phone minus server", both?.flag === "DEVICE_CLOCK_SKEW" && both.skewSeconds === 2 * 24 * 3600, JSON.stringify(both));
  const future = detectTimeAnomaly({ transactionTime: at(HOUR), sentAt: now, serverNow: now });
  check("FUTURE skew = how far ahead the sale is", future?.flag === "FUTURE_TIMESTAMP" && future.skewSeconds === 3600);
}

async function main() {
  pureChecks();

  console.log(`\nSync route (run ${RUN})`);
  const health = await fetch(`${BASE}/api/v1/health`).catch(() => null);
  if (!health?.ok) throw new Error(`Dev server not reachable at ${BASE}. Start it with \`npm run dev\`.`);
  await prisma.barber.create({ data: { id: BARBER, fullName: `Test Barber Clock ${RUN}`, commissionRate: 0.5 } });
  const now = () => new Date();

  const ahead = sale(new Date(Date.now() + HOUR));
  let res = await sync([ahead]);
  let row = await stored(ahead.id);
  check("a sale one hour ahead is synced, not rejected", res.body.syncedIds.includes(ahead.id) && res.body.rejected.length === 0);
  check("it is flagged FUTURE_TIMESTAMP with about +3600 s", row?.timeFlag === "FUTURE_TIMESTAMP" && Math.abs((row.clockSkewSeconds ?? 0) - 3600) < 120, `${row?.timeFlag} ${row?.clockSkewSeconds}`);
  check("its timestamp is stored exactly as sent", row?.transactionTime.toISOString() === ahead.transactionTime);
  check("its commission snapshot is recorded as usual", Number(row?.barberCommissionAmount) === 100 && Number(row?.commissionRate) === 0.5);

  const slightly = sale(new Date(Date.now() + 3 * MIN));
  await sync([slightly], now().toISOString());
  check("three minutes ahead is within tolerance: not flagged", (await stored(slightly.id))?.timeFlag === null);

  const oldOk = sale(new Date(Date.now() - 30 * DAY));
  await sync([oldOk], now().toISOString());
  check("a 30-day-old offline sale with a correct sentAt is not flagged", (await stored(oldOk.id))?.timeFlag === null);

  const oldLegacy = sale(new Date(Date.now() - 30 * DAY));
  await sync([oldLegacy]);
  check("an old sale from a phone that sends no sentAt is not flagged", (await stored(oldLegacy.id))?.timeFlag === null);

  const behindA = sale(new Date(Date.now() - YEARS_2 - HOUR));
  const behindB = sale(new Date(Date.now() - YEARS_2 - 2 * HOUR), 150);
  res = await sync([behindA, behindB], new Date(Date.now() - YEARS_2).toISOString());
  const [rowA, rowB] = [await stored(behindA.id), await stored(behindB.id)];
  check("a phone clock two years behind: both sales synced", res.body.syncedIds.includes(behindA.id) && res.body.syncedIds.includes(behindB.id));
  check(
    "both flagged DEVICE_CLOCK_SKEW with about -2 years of skew",
    rowA?.timeFlag === "DEVICE_CLOCK_SKEW" && rowB?.timeFlag === "DEVICE_CLOCK_SKEW" && Math.abs((rowA.clockSkewSeconds ?? 0) + YEARS_2 / 1000) < 120,
    `${rowA?.timeFlag} ${rowA?.clockSkewSeconds}`
  );

  const both = sale(new Date(Date.now() + 2 * DAY - HOUR));
  await sync([both], new Date(Date.now() + 2 * DAY).toISOString());
  row = await stored(both.id);
  check(
    "future timestamp and a fast clock together: DEVICE_CLOCK_SKEW, about +2 days",
    row?.timeFlag === "DEVICE_CLOCK_SKEW" && Math.abs((row.clockSkewSeconds ?? 0) - 2 * 24 * 3600) < 120,
    `${row?.timeFlag} ${row?.clockSkewSeconds}`
  );

  res = await sync([ahead], new Date(Date.now() - YEARS_2).toISOString());
  row = await stored(ahead.id);
  check("a resent flagged sale is a duplicate: synced, flag unchanged", res.body.syncedIds.includes(ahead.id) && res.body.duplicatesSkipped === 1 && row?.timeFlag === "FUTURE_TIMESTAMP");

  const garbled = sale(new Date(Date.now() + HOUR));
  res = await sync([garbled], "not a date");
  check("an unreadable sentAt does not block the batch", res.status === 200 && res.body.syncedIds.includes(garbled.id));
  check("without a usable sentAt only the FUTURE check applies", (await stored(garbled.id))?.timeFlag === "FUTURE_TIMESTAMP");

  console.log("\nKnown limitation (documented in src/lib/time-anomaly.ts)");
  // The phone was a day behind when the sale was made, and its clock was fixed before it
  // synced. Its sentAt is correct, so nothing distinguishes this from a day-old offline sale.
  const corrected = sale(new Date(Date.now() - DAY));
  await sync([corrected], now().toISOString());
  check("a bad past timestamp synced after the clock was corrected is NOT flagged", (await stored(corrected.id))?.timeFlag === null);
}

async function cleanup() {
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

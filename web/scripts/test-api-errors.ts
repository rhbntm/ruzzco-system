/**
 * Integration test for request-shape errors: a body that is not JSON gets 400 (not 500) on
 * every POST route that reads one, and a sync batch over SYNC_BATCH_MAX gets 400 with nothing
 * stored. Only refused requests are sent, so nothing is written.
 *
 *   npm run dev               (in another terminal; OWNER_PIN in web/.env)
 *   npm run test:api-errors   (TEST_BASE_URL overrides http://localhost:3000)
 */
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { prisma } from "../src/lib/prisma";
import { SYNC_BATCH_MAX } from "../src/lib/schemas";

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

async function post(path: string, body: string, owner = false) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(owner ? { Cookie: ownerCookie } : {}) },
    body,
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null };
}

async function main() {
  console.log(`API error-shape test against ${BASE}`);
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

  console.log("\nBody that is not JSON");
  const routes: [string, boolean][] = [
    ["/api/v1/transactions/sync", false],
    ["/api/v1/devices/bind", false],
    ["/api/v1/reports/reconciliation", true],
    ["/api/v1/reports/payouts", true],
  ];
  for (const [path, owner] of routes) {
    const res = await post(path, "{not json", owner);
    check(`${path} answers 400`, res.status === 400 && res.body?.success === false, `got ${res.status}`);
  }

  console.log("\nSync batch cap");
  const before = await prisma.transaction.count();
  const ids = Array.from({ length: SYNC_BATCH_MAX + 1 }, () => randomUUID());
  const tooMany = await post(
    "/api/v1/transactions/sync",
    JSON.stringify({
      transactions: ids.map((id) => ({
        id,
        barberId: "00000000-0000-0000-0000-000000000002",
        serviceId: "10000000-0000-0000-0000-000000000001",
        totalAmount: 200,
        transactionTime: new Date().toISOString(),
      })),
    })
  );
  check(`${SYNC_BATCH_MAX + 1} sales in one request answers 400`, tooMany.status === 400, `got ${tooMany.status}`);
  check("nothing from the oversized batch is stored", (await prisma.transaction.count()) === before);

  console.log("\nHealth");
  const healthBody = (await (await fetch(`${BASE}/api/v1/health`)).json()) as { status?: string; error?: string };
  check("health reports healthy with no error text", healthBody.status === "healthy" && healthBody.error === undefined);
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

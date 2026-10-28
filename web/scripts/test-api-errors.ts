/**
 * Integration test for request-shape errors: a body that is not JSON gets 400 (not 500) on
 * every POST route that reads one, a Content-Type other than application/json gets 415
 * (slice 15; a charset parameter is fine), and a sync batch over SYNC_BATCH_MAX gets 400 with
 * nothing stored. Only refused requests are sent, so nothing is written except one approved
 * test device (bind and sync need one, slice 15), which is deleted at the end.
 *
 *   npm run dev               (in another terminal; OWNER_PIN in web/.env)
 *   npm run test:api-errors   (TEST_BASE_URL overrides http://localhost:3000)
 */
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { prisma } from "../src/lib/prisma";
import { SYNC_BATCH_MAX } from "../src/lib/schemas";
import { createTestDevices } from "./lib/test-devices";

loadEnvConfig(process.cwd());

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const devices = createTestDevices(BASE);
let device = ""; // approved in main(), so bind and sync reach their body checks
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

type Auth = "owner" | "device" | "none";

async function post(path: string, body: string, auth: Auth = "none", contentType = "application/json") {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      ...(auth === "device" ? devices.headers(device) : {}),
      ...(auth === "owner" ? { Cookie: ownerCookie } : {}),
      "Content-Type": contentType,
    },
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
  device = await devices.approve();

  console.log("\nBody that is not JSON");
  // Sync and bind check the device before the body (slice 15), so they are sent from an approved one.
  const routes: [string, Auth][] = [
    ["/api/v1/transactions/sync", "device"],
    ["/api/v1/devices/bind", "device"],
    ["/api/v1/reports/reconciliation", "owner"],
    ["/api/v1/reports/payouts", "owner"],
  ];
  for (const [path, auth] of routes) {
    const res = await post(path, "{not json", auth);
    check(`${path} answers 400`, res.status === 400 && res.body?.success === false, `got ${res.status}`);
  }

  console.log("\nContent-Type must be application/json (slice 15)");
  const jsonBodies: [string, Auth, unknown][] = [
    ["/api/v1/transactions/sync", "device", { transactions: [] }],
    ["/api/v1/devices/bind", "device", { deviceKey: device }],
    ["/api/v1/reports/reconciliation", "owner", { date: "2000-01-01" }],
  ];
  // Bind and reconciliation bodies are incomplete on purpose: if the type check ever stopped
  // refusing them they would fail validation, so this section never writes anything.
  for (const [path, auth, body] of jsonBodies) {
    const res = await post(path, JSON.stringify(body), auth, "text/plain");
    check(`${path} with text/plain (JSON body) answers 415`, res.status === 415 && res.body?.success === false, `got ${res.status}`);
  }
  // A charset parameter is still JSON: the broken body gets past the type check to the 400.
  const charset = await post("/api/v1/transactions/sync", "{not json", "device", "application/json; charset=utf-8");
  check("application/json; charset=utf-8 is accepted (400 for the body, not 415)", charset.status === 400, `got ${charset.status}`);

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
    }),
    "device"
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
    await devices.cleanup(prisma).catch((e) => console.error("Device cleanup failed:", e));
    await prisma.$disconnect();
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
      for (const f of failures) console.log(`  FAIL ${f}`);
      process.exit(1);
    }
  });

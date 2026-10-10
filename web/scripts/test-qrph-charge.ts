/**
 * Tests ensureQrphCharge (src/lib/gateway.ts): exactly one QR Ph charge per sale, even when
 * the POS, the shift log and a double tap ask at the same time. Uses the real database
 * (MySQL in Docker) and a fake PayMongo client that counts the charges it is asked to make.
 * No dev server and no PayMongo call.
 *
 *   npm run test:qrph-charge
 *
 * Uses a throwaway barber and sales; everything it creates is deleted at the end.
 */
import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { ensureQrphCharge, type QrphClient } from "../src/lib/gateway";

loadEnvConfig(process.cwd());

const RUN = randomUUID().slice(0, 8);
const BARBER = `test-qrc-${RUN}`;
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

// Fake PayMongo: each charge takes a moment (like the real three calls) and gets a new id.
function fakeClient(delayMs = 150) {
  const calls: { amount: string; transactionId: string }[] = [];
  const client: QrphClient = {
    createCharge: async (amount, transactionId) => {
      calls.push({ amount: amount.toFixed(2), transactionId });
      await new Promise((r) => setTimeout(r, delayMs));
      return { intentId: `pi_fake_${randomUUID()}`, qr: { imageUrl: "data:image/png;base64,AAAA", expiresAt: null, testUrl: null } };
    },
  };
  return { client, calls };
}

async function sale(method: "QRPH" | "CASH", amount = 250) {
  const id = randomUUID();
  txIds.push(id);
  await prisma.transaction.create({
    data: {
      id,
      barberId: BARBER,
      totalAmount: amount,
      amountPaid: amount,
      listPrice: amount,
      barberCommissionAmount: amount / 2,
      commissionRate: 0.5,
      paymentMethod: method,
      paymentStatus: method === "QRPH" ? "PENDING" : "PAID",
      transactionTime: new Date(),
      syncedAt: new Date(),
    },
  });
  return id;
}

async function main() {
  console.log(`QR Ph charge test (run ${RUN})`);
  await prisma.barber.create({ data: { id: BARBER, fullName: `Test Barber QRC ${RUN}`, commissionRate: 0.5 } });

  console.log("\nOne charge per sale");
  const qr = await sale("QRPH", 250);
  const fake = fakeClient();
  const results = await Promise.all([1, 2, 3].map(() => ensureQrphCharge(qr, fake.client)));
  check("three concurrent requests make one PayMongo charge", fake.calls.length === 1, `${fake.calls.length} charges`);
  check("charged for the sale's amount (tip excluded)", fake.calls[0]?.amount === "250.00" && fake.calls[0]?.transactionId === qr);
  const created = results.filter((r) => r.kind === "created");
  const existing = results.filter((r) => r.kind === "existing");
  check("one request created it, the others got the existing charge", created.length === 1 && existing.length === 2, results.map((r) => r.kind).join(","));
  const intentIds = new Set(results.map((r) => (r.kind === "created" ? r.intentId : r.kind === "existing" ? r.payment.intentId : "")));
  check("all three see the same intent", intentIds.size === 1);
  check("one stored charge row", (await prisma.gatewayPayment.count({ where: { transactionId: qr } })) === 1);

  const again = await ensureQrphCharge(qr, fake.client);
  check("a later retry returns the stored charge without charging again", again.kind === "existing" && fake.calls.length === 1);
  check("the stored charge is still PENDING", again.kind === "existing" && again.payment.status === "PENDING");

  console.log("\nRequests that must not charge");
  const none = fakeClient();
  check("a sale not on the server yet", (await ensureQrphCharge(randomUUID(), none.client)).kind === "not_synced");
  const cash = await sale("CASH", 200);
  check("a cash sale", (await ensureQrphCharge(cash, none.client)).kind === "not_qrph");
  check("neither reached PayMongo", none.calls.length === 0);

  console.log("\nA failed charge leaves nothing behind");
  const failing = await sale("QRPH", 300);
  const broken: QrphClient = {
    createCharge: async () => {
      throw new Error("PayMongo payment_intents failed: HTTP 500");
    },
  };
  let threw = false;
  try {
    await ensureQrphCharge(failing, broken);
  } catch {
    threw = true;
  }
  check("the error reaches the caller (the route answers 502)", threw);
  check("no charge row is stored", (await prisma.gatewayPayment.count({ where: { transactionId: failing } })) === 0);
  const retry = fakeClient(10);
  const recovered = await ensureQrphCharge(failing, retry.client);
  check("a retry afterwards creates the charge once", recovered.kind === "created" && retry.calls.length === 1);
  check("the sale itself was never changed", (await prisma.transaction.findUniqueOrThrow({ where: { id: failing } })).totalAmount.equals(new Prisma.Decimal(300)));
}

async function cleanup() {
  await prisma.gatewayPayment.deleteMany({ where: { transactionId: { in: txIds } } });
  await prisma.transaction.deleteMany({ where: { id: { in: txIds } } });
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

/**
 * Integration test for the QR Ph (PayMongo test mode) gateway: webhook signature, event
 * idempotency, PENDING→PAID, server-decided payment status, and PAID-only totals.
 *
 * Calls the REAL routes (sync, /api/v1/webhooks/paymongo, reconciliation, payouts) on a
 * running dev server. It never calls PayMongo: it stores its own GatewayPayment rows and
 * signs its own events with PAYMONGO_WEBHOOK_SECRET.
 *
 *   PAYMENT_GATEWAY=paymongo_test, PAYMONGO_SECRET_KEY=sk_test_..., PAYMONGO_WEBHOOK_SECRET in web/.env
 *   npm run dev                  (in another terminal)
 *   npm run test:gateway         (TEST_BASE_URL overrides http://localhost:3000)
 *
 * Secrets are read, never printed. Uses a throwaway barber and a fixed past business date
 * (2000-01-20); everything it creates is deleted at the end.
 */
import { createHmac, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { prisma } from "../src/lib/prisma";

loadEnvConfig(process.cwd());

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const SERVICE_ID = "10000000-0000-0000-0000-000000000001"; // seeded Haircut
const RUN = randomUUID().slice(0, 8);
const DATE = "2000-01-20";
const NEXT_DAY_NOON = Math.floor(new Date("2000-01-21T12:00:00+08:00").getTime() / 1000);
const AT = (hhmm: string) => new Date(`${DATE}T${hhmm}:00+08:00`).toISOString();
const BARBER = `test-gw-${RUN}`;
const SECRET = process.env.PAYMONGO_WEBHOOK_SECRET ?? "";

const txIds: string[] = [];
const eventIds: string[] = [];
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

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(ownerCookie ? { Cookie: ownerCookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as T };
}

type SyncResponse = { syncedIds: string[]; rejected: { id: string | null; reason: string }[] };
type Expected = {
  cashTotal: string; qrphTotal: string; totalRevenue: string; expectedDrawerCash: string; transactionCount: number;
  gatewaySales: { id: string; status: string; amount: string; late: boolean }[];
};
type LedgerRow = { barberId: string; commissionTotal: string };

const sync = (items: unknown[]) => request<SyncResponse>("POST", "/api/v1/transactions/sync", { transactions: items });
const reconciliation = async () => (await request<{ expected: Expected }>("GET", `/api/v1/reports/reconciliation?date=${DATE}`)).body.expected;
const commission = async () =>
  (await request<{ rows: LedgerRow[] }>("GET", `/api/v1/reports/payouts?date=${DATE}`)).body.rows.find((r) => r.barberId === BARBER)?.commissionTotal;

function sale(time: string, paymentMethod: string, amount = 200, extra: Record<string, unknown> = {}) {
  const id = randomUUID();
  txIds.push(id);
  return { id, barberId: BARBER, serviceId: SERVICE_ID, totalAmount: amount, listPrice: amount, amountPaid: amount, paymentMethod, transactionTime: AT(time), ...extra };
}

// Builds a PayMongo-shaped event and signs it like PayMongo: te = HMAC-SHA256(secret, `${t}.${body}`).
function event(type: string, intentId: string, opts: { paidAt?: number; livemode?: boolean; id?: string } = {}) {
  const id = opts.id ?? `evt_test_${RUN}_${eventIds.length}`;
  if (!eventIds.includes(id)) eventIds.push(id);
  return {
    id,
    body: JSON.stringify({
      data: {
        id,
        type: "event",
        attributes: {
          type,
          livemode: opts.livemode ?? false,
          data: { id: `pay_test_${RUN}`, type: "payment", attributes: { payment_intent_id: intentId, status: "paid", paid_at: opts.paidAt } },
        },
      },
    }),
  };
}

function sign(body: string, secret = SECRET) {
  const t = Math.floor(Date.now() / 1000);
  const te = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},te=${te},li=`;
}

async function deliver(body: string, signature: string | null) {
  const res = await fetch(`${BASE}/api/v1/webhooks/paymongo`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(signature ? { "Paymongo-Signature": signature } : {}) },
    body,
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as { result?: string; ignored?: boolean } | null };
}

const charge = (transactionId: string, intentId: string) =>
  prisma.gatewayPayment.create({ data: { transactionId, intentId, amount: 200, provider: "PAYMONGO_TEST" } });
const stored = (id: string) => prisma.transaction.findUnique({ where: { id }, include: { gatewayPayment: true } });

async function main() {
  console.log(`Gateway integration test against ${BASE} (run ${RUN}, date ${DATE})`);
  const health = await fetch(`${BASE}/api/v1/health`).catch(() => null);
  if (!health?.ok) throw new Error(`Dev server not reachable at ${BASE}. Start it with \`npm run dev\`.`);
  const gw = await fetch(`${BASE}/api/v1/payments/qrph`);
  if (gw.status !== 200) throw new Error("Gateway is off on the dev server. Set PAYMENT_GATEWAY=paymongo_test and a sk_test_ key in web/.env, then restart it.");
  if (!SECRET) throw new Error("PAYMONGO_WEBHOOK_SECRET is not set in web/.env");
  if (!process.env.OWNER_PIN) throw new Error("OWNER_PIN is not set in web/.env");

  const unlock = await fetch(`${BASE}/api/v1/owner/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: process.env.OWNER_PIN }),
  });
  ownerCookie = unlock.headers.get("set-cookie")?.split(";")[0] ?? "";
  if (!unlock.ok || !ownerCookie) throw new Error(`Owner unlock failed with ${unlock.status}`);

  await prisma.barber.create({ data: { id: BARBER, fullName: `Test Barber GW ${RUN}`, commissionRate: 0.5 } });

  console.log("\nG1 the client cannot sync a QRPH sale as PAID");
  const cash = sale("10:00", "CASH", 150);
  const qr = sale("10:30", "QRPH", 200, { paymentStatus: "PAID" });
  const res = await sync([cash, qr]);
  check("both sales accepted", res.status === 200 && res.body.syncedIds.length === 2 && res.body.rejected.length === 0, JSON.stringify(res.body));
  check("QRPH sale stored PENDING despite paymentStatus PAID in the payload", (await stored(qr.id))?.paymentStatus === "PENDING");
  check("CASH sale stored PAID", (await stored(cash.id))?.paymentStatus === "PAID");
  const qrRow = await stored(qr.id);
  check("QRPH commission is still snapshotted at sync (50% = 100.00)", qrRow?.barberCommissionAmount.toFixed(2) === "100.00" && qrRow.commissionRate.toFixed(2) === "0.50");

  console.log("\nG2 a PENDING sale counts nowhere");
  let exp = await reconciliation();
  check("reconciliation: QR Ph collected 0.00, revenue = cash only 150.00", exp.qrphTotal === "0.00" && exp.totalRevenue === "150.00", JSON.stringify(exp));
  check("reconciliation: drawer 150.00, 1 paid sale", exp.expectedDrawerCash === "150.00" && exp.transactionCount === 1);
  check("reconciliation: the pending sale is listed separately", exp.gatewaySales.some((g) => g.id === qr.id && g.status === "PENDING"));
  check("payout commission excludes the pending sale (75.00)", (await commission()) === "75.00");

  const intent = `pi_test_${RUN}_a`;
  await charge(qr.id, intent);

  console.log("\nG3 webhook signature");
  const paid = event("payment.paid", intent, { paidAt: Math.floor(new Date(AT("10:35")).getTime() / 1000) });
  check("no signature → 401", (await deliver(paid.body, null)).status === 401);
  check("wrong secret → 401", (await deliver(paid.body, sign(paid.body, "not-the-secret"))).status === 401);
  check("tampered body → 401", (await deliver(paid.body.replace("payment.paid", "payment.paid "), sign(paid.body))).status === 401);
  check("sale still PENDING after rejected deliveries", (await stored(qr.id))?.paymentStatus === "PENDING");

  console.log("\nG4 the paid event flips PENDING→PAID once");
  let wh = await deliver(paid.body, sign(paid.body));
  check("signed payment.paid → 200 applied", wh.status === 200 && wh.body?.result === "applied", JSON.stringify(wh.body));
  let row = await stored(qr.id);
  check("Transaction PAID and GatewayPayment PAID with paidAt and lastEventId", row?.paymentStatus === "PAID" && row.gatewayPayment?.status === "PAID" && !!row.gatewayPayment.paidAt && row.gatewayPayment.lastEventId === paid.id);
  const firstPaidAt = row?.gatewayPayment?.paidAt?.getTime();

  wh = await deliver(paid.body, sign(paid.body));
  check("same event again → 200 duplicate (no-op)", wh.status === 200 && wh.body?.result === "duplicate", JSON.stringify(wh.body));
  const paidAgain = event("payment.paid", intent, { paidAt: NEXT_DAY_NOON });
  wh = await deliver(paidAgain.body, sign(paidAgain.body));
  check("a second paid event → unchanged", wh.body?.result === "unchanged", JSON.stringify(wh.body));
  const failedLater = event("payment.failed", intent);
  wh = await deliver(failedLater.body, sign(failedLater.body));
  check("a failed event after PAID → unchanged (PAID is final)", wh.body?.result === "unchanged", JSON.stringify(wh.body));
  row = await stored(qr.id);
  check("still PAID, paidAt unchanged", row?.paymentStatus === "PAID" && row.gatewayPayment?.paidAt?.getTime() === firstPaidAt);
  check("payment method and amount never rewritten", row?.paymentMethod === "QRPH" && row.totalAmount.toFixed(2) === "200.00");

  console.log("\nG5 once PAID it counts, outside the drawer");
  exp = await reconciliation();
  check("QR Ph collected 200.00, revenue 350.00, drawer still 150.00", exp.qrphTotal === "200.00" && exp.totalRevenue === "350.00" && exp.expectedDrawerCash === "150.00", JSON.stringify(exp));
  check("payout commission now 175.00", (await commission()) === "175.00");

  console.log("\nG6 late confirmation and failure");
  const late = sale("21:30", "QRPH");
  const failing = sale("21:40", "QRPH");
  await sync([late, failing]);
  await charge(late.id, `pi_test_${RUN}_b`);
  await charge(failing.id, `pi_test_${RUN}_c`);
  const latePaid = event("payment.paid", `pi_test_${RUN}_b`, { paidAt: NEXT_DAY_NOON });
  await deliver(latePaid.body, sign(latePaid.body));
  const failed = event("payment.failed", `pi_test_${RUN}_c`);
  wh = await deliver(failed.body, sign(failed.body));
  check("payment.failed → FAILED", wh.body?.result === "applied" && (await stored(failing.id))?.paymentStatus === "FAILED");
  exp = await reconciliation();
  check("late sale counts on its sale date and is flagged late", exp.qrphTotal === "400.00" && exp.gatewaySales.some((g) => g.id === late.id && g.status === "PAID" && g.late), JSON.stringify(exp.gatewaySales));
  check("failed sale listed, not counted", exp.gatewaySales.some((g) => g.id === failing.id && g.status === "FAILED") && exp.totalRevenue === "550.00");

  console.log("\nG7 events that must not change anything");
  const unknown = event("payment.paid", `pi_test_${RUN}_unknown`);
  wh = await deliver(unknown.body, sign(unknown.body));
  check("unknown intent → 200 unknown_intent, event not recorded", wh.status === 200 && wh.body?.result === "unknown_intent" && !(await prisma.gatewayWebhookEvent.findUnique({ where: { eventId: unknown.id } })));
  const pendingSale = sale("11:00", "QRPH");
  await sync([pendingSale]);
  await charge(pendingSale.id, `pi_test_${RUN}_d`);
  const live = event("payment.paid", `pi_test_${RUN}_d`, { livemode: true });
  wh = await deliver(live.body, sign(live.body));
  check("livemode event ignored", wh.body?.ignored === true && (await stored(pendingSale.id))?.paymentStatus === "PENDING");
  const other = event("refund.succeeded", `pi_test_${RUN}_d`);
  wh = await deliver(other.body, sign(other.body));
  check("unhandled event type → 200 ignored", wh.status === 200 && wh.body?.ignored === true);
}

async function cleanup() {
  await prisma.gatewayWebhookEvent.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.gatewayPayment.deleteMany({ where: { transactionId: { in: txIds } } });
  await prisma.dailyPayoutLedger.deleteMany({ where: { OR: [{ businessDate: new Date(`${DATE}T00:00:00.000Z`) }, { barberId: BARBER }] } });
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

/**
 * Integration test for per-barber GCash/Maya QR images (slice 6): owner-only writes, method,
 * barber and upload validation, round trip, replace, remove, inactive barbers, and that a
 * sale synced while a QR exists is stored exactly as before.
 *
 * Calls the REAL routes on a running dev server:
 *   npm run dev                  (in another terminal; OWNER_PIN in web/.env)
 *   npm run test:payment-qr      (TEST_BASE_URL overrides http://localhost:3000)
 *
 * Uses only scripts/fixtures/sample-qr.png, which encodes the plain text
 * "DEMO ONLY - NOT A PAYMENT QR" (not a payment payload). Never use a real account QR here.
 * Throwaway barbers; everything it creates is deleted at the end.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { prisma } from "../src/lib/prisma";

loadEnvConfig(process.cwd());

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const SERVICE_ID = "10000000-0000-0000-0000-000000000001"; // seeded Haircut
const RUN = randomUUID().slice(0, 8);
const BARBER = `test-qr-${RUN}`;
const INACTIVE = `test-qr-off-${RUN}`;
const MAX = 1024 * 1024;
const SAMPLE = new Uint8Array(readFileSync(join(process.cwd(), "scripts", "fixtures", "sample-qr.png")));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

const txIds: string[] = [];
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

const path = (barberId: string, method: string) => `/api/v1/payment-qrs/${encodeURIComponent(barberId)}/${method}`;

async function put(barberId: string, method: string, body: Uint8Array, opts: { owner?: boolean; type?: string } = {}) {
  const res = await fetch(`${BASE}${path(barberId, method)}`, {
    method: "PUT",
    headers: { "Content-Type": opts.type ?? "image/png", ...(opts.owner === false ? {} : { Cookie: ownerCookie }) },
    body: Buffer.from(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as { qr?: { sha256: string; contentType: string } } | null };
}

async function del(barberId: string, method: string, owner = true) {
  const res = await fetch(`${BASE}${path(barberId, method)}`, { method: "DELETE", headers: owner ? { Cookie: ownerCookie } : {} });
  return { status: res.status, body: (await res.json().catch(() => null)) as { removed?: boolean } | null };
}

async function getImage(barberId: string, method: string) {
  const res = await fetch(`${BASE}${path(barberId, method)}`);
  return { status: res.status, type: res.headers.get("content-type"), nosniff: res.headers.get("x-content-type-options"), bytes: new Uint8Array(await res.arrayBuffer()) };
}

async function listed(barberId: string) {
  const res = await fetch(`${BASE}/api/v1/payment-qrs`);
  const body = (await res.json()) as { qrs: { barberId: string; method: string; sha256: string; contentType: string }[] };
  return body.qrs.filter((q) => q.barberId === barberId);
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const rowCount = (barberId: string) => prisma.barberPaymentQr.count({ where: { barberId } });

async function main() {
  console.log(`Payment QR integration test against ${BASE} (run ${RUN})`);
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

  await prisma.barber.create({ data: { id: BARBER, fullName: `Test Barber QR ${RUN}`, commissionRate: 0.5 } });
  await prisma.barber.create({ data: { id: INACTIVE, fullName: `Test Barber QR off ${RUN}`, commissionRate: 0.5, isActive: false } });

  console.log("\nQ1 writes are owner-only");
  check("PUT without the owner cookie → 401", (await put(BARBER, "GCASH", SAMPLE, { owner: false })).status === 401);
  check("DELETE without the owner cookie → 401", (await del(BARBER, "GCASH", false)).status === 401);
  check("nothing stored", (await rowCount(BARBER)) === 0);

  console.log("\nQ2 only GCASH and MAYA");
  check("PUT CASH → 400", (await put(BARBER, "CASH", SAMPLE)).status === 400);
  check("PUT QRPH → 400", (await put(BARBER, "QRPH", SAMPLE)).status === 400);
  check("GET lowercase gcash → 400", (await getImage(BARBER, "gcash")).status === 400);

  console.log("\nQ3 the barber must exist and be active");
  check("PUT for an unknown barber → 404", (await put(`no-such-${RUN}`, "GCASH", SAMPLE)).status === 404);
  check("PUT for an inactive barber → 404", (await put(INACTIVE, "GCASH", SAMPLE)).status === 404);
  check("nothing stored for the inactive barber", (await rowCount(INACTIVE)) === 0);

  console.log("\nQ4 the file must be a PNG, JPEG or WebP image of 1 MB or less");
  const text = new TextEncoder().encode("this is not an image");
  check("text sent as image/png → 415 (type is read from the bytes)", (await put(BARBER, "GCASH", text)).status === 415);
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  check("SVG → 415", (await put(BARBER, "GCASH", svg, { type: "image/svg+xml" })).status === 415);
  check("empty body → 400", (await put(BARBER, "GCASH", new Uint8Array(0))).status === 400);
  const huge = new Uint8Array(MAX + 1);
  huge.set(SAMPLE.subarray(0, 8)); // a PNG signature, so only the size can reject it
  check("1 MB + 1 byte → 413", (await put(BARBER, "GCASH", huge)).status === 413);
  check("nothing stored after the rejections", (await rowCount(BARBER)) === 0);

  console.log("\nQ5 upload, list and download round trip");
  const up = await put(BARBER, "GCASH", SAMPLE);
  check("PUT the sample QR → 200", up.status === 200, JSON.stringify(up.body));
  check("response has the sha256 of the bytes and image/png", up.body?.qr?.sha256 === sha(SAMPLE) && up.body?.qr?.contentType === "image/png");
  const list = await listed(BARBER);
  check("list has exactly that QR, no image bytes", list.length === 1 && list[0].method === "GCASH" && list[0].sha256 === sha(SAMPLE) && !("image" in list[0]));
  const img = await getImage(BARBER, "GCASH");
  check("GET returns identical bytes as image/png with nosniff", img.status === 200 && img.type === "image/png" && img.nosniff === "nosniff" && sameBytes(img.bytes, SAMPLE));
  check("no Maya QR yet → 404", (await getImage(BARBER, "MAYA")).status === 404);

  console.log("\nQ6 replace keeps one row per barber and method");
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(`sample-${RUN}`)]);
  const re = await put(BARBER, "GCASH", jpeg, { type: "image/jpeg" });
  check("replace → 200 with the new sha and image/jpeg", re.status === 200 && re.body?.qr?.sha256 === sha(jpeg) && re.body?.qr?.contentType === "image/jpeg");
  check("still one GCash row", (await prisma.barberPaymentQr.count({ where: { barberId: BARBER, method: "GCASH" } })) === 1);
  check("GET returns the replacement", sameBytes((await getImage(BARBER, "GCASH")).bytes, jpeg));

  console.log("\nQ7 a sale synced while a QR exists is stored as before");
  const id = randomUUID();
  txIds.push(id);
  const syncRes = await fetch(`${BASE}/api/v1/transactions/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactions: [{
      id, barberId: BARBER, serviceId: SERVICE_ID, totalAmount: 200, listPrice: 200, amountPaid: 200, tipAmount: 20,
      paymentMethod: "GCASH", paymentReference: `REF-${RUN}`, transactionTime: "2000-01-22T03:00:00.000Z",
    }] }),
  });
  const syncBody = (await syncRes.json()) as { syncedIds: string[]; rejected: unknown[] };
  check("GCash sale synced", syncRes.status === 200 && syncBody.syncedIds.includes(id) && syncBody.rejected.length === 0, JSON.stringify(syncBody));
  const stored = await prisma.transaction.findUnique({ where: { id } });
  check(
    "stored GCASH, PAID, amount, tip, reference and 50% commission as sent",
    stored?.paymentMethod === "GCASH" && stored.paymentStatus === "PAID" && stored.amountPaid?.toFixed(2) === "200.00" &&
      stored.tipAmount.toFixed(2) === "20.00" && stored.paymentReference === `REF-${RUN}` && stored.barberCommissionAmount.toFixed(2) === "100.00",
  );

  console.log("\nQ8 an inactive barber's QR is neither listed nor served");
  await prisma.barber.update({ where: { id: BARBER }, data: { isActive: false } });
  check("not listed", (await listed(BARBER)).length === 0);
  check("GET → 404", (await getImage(BARBER, "GCASH")).status === 404);
  check("the row is kept (reactivation shows it again)", (await rowCount(BARBER)) === 1);
  await prisma.barber.update({ where: { id: BARBER }, data: { isActive: true } });
  check("listed again after reactivation", (await listed(BARBER)).length === 1);

  console.log("\nQ9 remove");
  const rm = await del(BARBER, "GCASH");
  check("DELETE → 200 removed", rm.status === 200 && rm.body?.removed === true);
  check("GET → 404 and not listed", (await getImage(BARBER, "GCASH")).status === 404 && (await listed(BARBER)).length === 0);
  const again = await del(BARBER, "GCASH");
  check("DELETE again → 200, nothing removed", again.status === 200 && again.body?.removed === false);
}

async function cleanup() {
  const barberIds = [BARBER, INACTIVE];
  await prisma.barberPaymentQr.deleteMany({ where: { barberId: { in: barberIds } } });
  await prisma.dailyPayoutLedger.deleteMany({ where: { barberId: { in: barberIds } } });
  await prisma.transaction.deleteMany({ where: { OR: [{ id: { in: txIds } }, { barberId: { in: barberIds } }] } });
  await prisma.barber.deleteMany({ where: { id: { in: barberIds } } });
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

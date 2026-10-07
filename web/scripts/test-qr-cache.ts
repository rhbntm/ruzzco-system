/**
 * Unit test for the payment QR cache plan (slice 6): which QRs a phone downloads and which
 * it deletes, given the server's list and what it already has. No server or browser needed:
 *   npm run test:qr-cache
 */
import { planQrRefresh, qrCacheId, type CachedQrRef, type ServerQr } from "../src/lib/payment-qr-plan";

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

const A = "barber-a";
const B = "barber-b";
const srv = (barberId: string, method: "GCASH" | "MAYA", sha256: string): ServerQr => ({ barberId, method, sha256, contentType: "image/png" });
const local = (barberId: string, method: "GCASH" | "MAYA", sha256: string): CachedQrRef => ({ id: qrCacheId(barberId, method), sha256 });
const ids = (qrs: ServerQr[]) => qrs.map((q) => qrCacheId(q.barberId, q.method)).sort();
const same = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

console.log("C1 nothing cached");
{
  const plan = planQrRefresh([srv(A, "GCASH", "1"), srv(A, "MAYA", "2"), srv(B, "GCASH", "3")], []);
  check("downloads every listed QR", same(ids(plan.download), [`${A}:GCASH`, `${A}:MAYA`, `${B}:GCASH`]));
  check("removes nothing", plan.remove.length === 0);
}

console.log("\nC2 already up to date");
{
  const plan = planQrRefresh([srv(A, "GCASH", "1"), srv(B, "MAYA", "2")], [local(A, "GCASH", "1"), local(B, "MAYA", "2")]);
  check("downloads nothing when every sha matches", plan.download.length === 0);
  check("removes nothing", plan.remove.length === 0);
}

console.log("\nC3 replaced on the server");
{
  const plan = planQrRefresh([srv(A, "GCASH", "new"), srv(A, "MAYA", "2")], [local(A, "GCASH", "old"), local(A, "MAYA", "2")]);
  check("downloads only the changed QR", same(ids(plan.download), [`${A}:GCASH`]));
  check("the changed QR is replaced, not removed", plan.remove.length === 0);
  check("the download carries the new sha", plan.download[0]?.sha256 === "new");
}

console.log("\nC4 removed by the owner");
{
  const plan = planQrRefresh([srv(A, "GCASH", "1")], [local(A, "GCASH", "1"), local(A, "MAYA", "2")]);
  check("deletes the QR the server no longer lists", same(plan.remove, [`${A}:MAYA`]));
  check("keeps the other method of the same barber", plan.download.length === 0);
}

console.log("\nC5 barber deactivated (the server lists active barbers only)");
{
  const plan = planQrRefresh([srv(A, "GCASH", "1")], [local(A, "GCASH", "1"), local(B, "GCASH", "3"), local(B, "MAYA", "4")]);
  check("deletes both of that barber's QRs", same(plan.remove, [`${B}:GCASH`, `${B}:MAYA`]));
  check("leaves the active barber's QR alone", !plan.remove.includes(`${A}:GCASH`) && plan.download.length === 0);
}

console.log("\nC6 GCash and Maya are separate entries");
{
  const plan = planQrRefresh([srv(A, "MAYA", "1")], [local(A, "GCASH", "1")]);
  check("a Maya QR with the same sha as a cached GCash QR is still downloaded", same(ids(plan.download), [`${A}:MAYA`]));
  check("and the GCash one is removed", same(plan.remove, [`${A}:GCASH`]));
}

console.log("\nC7 the server lists nothing");
{
  const plan = planQrRefresh([], [local(A, "GCASH", "1"), local(B, "MAYA", "2")]);
  check("an empty list from the server clears the cache", same(plan.remove, [`${A}:GCASH`, `${B}:MAYA`]) && plan.download.length === 0);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}

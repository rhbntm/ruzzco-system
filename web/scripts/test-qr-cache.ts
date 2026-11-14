/**
 * Unit test for the payment QR cache plan (slice 6): which QRs a phone downloads and which
 * it deletes, given the server's list and what it already has, and (slice 19 §7, S4) what the
 * GCash/Maya modal shows for the bound barber. No server or browser needed:
 *   npm run test:qr-cache
 */
import {
  parseQrListRecord,
  planQrRefresh,
  qrCacheId,
  qrIdsToClearOnMove,
  qrModalState,
  readQrListAnswer,
  type CachedQrRef,
  type ServerQr,
} from "../src/lib/payment-qr-plan";

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

// ── Slice 19 §7 (S4): the barber-bound cache ─────────────────────────────────

const qr = (barberId: string, method: "GCASH" | "MAYA") => ({ barberId, method, dataUrl: `data:image/png;base64,${barberId}${method}` });

console.log("\nC8 the modal shows a QR only for the binding's barber");
{
  const listA = { barberId: A, methods: ["GCASH" as const] };
  check("A's cached QR on A's phone → the QR", qrModalState({ barberId: A, method: "GCASH", cached: qr(A, "GCASH"), list: listA }).kind === "qr");
  check("B's cached QR while bound to A → never shown (unavailable)", qrModalState({ barberId: A, method: "GCASH", cached: qr(B, "GCASH"), list: listA }).kind === "unavailable");
  check("a cached QR of the other method → not shown", qrModalState({ barberId: A, method: "MAYA", cached: qr(A, "GCASH"), list: null }).kind === "unavailable");
  check("no binding → unavailable, even with a cached QR", qrModalState({ barberId: null, method: "GCASH", cached: qr(A, "GCASH"), list: listA }).kind === "unavailable");
}

console.log("\nC9 \"not set up\" only after a successful list for that barber without the method");
{
  check("A's list without Maya → not set up", qrModalState({ barberId: A, method: "MAYA", cached: null, list: { barberId: A, methods: ["GCASH"] } }).kind === "not_set_up");
  check("A's list with GCash but no cached copy (download failed) → unavailable", qrModalState({ barberId: A, method: "GCASH", cached: null, list: { barberId: A, methods: ["GCASH"] } }).kind === "unavailable");
  check("no list yet → unavailable", qrModalState({ barberId: A, method: "GCASH", cached: null, list: null }).kind === "unavailable");
  check("the last list was for another barber → unavailable", qrModalState({ barberId: B, method: "GCASH", cached: null, list: { barberId: A, methods: [] } }).kind === "unavailable");
  check("the last list was for no barber (no active assignment) → unavailable", qrModalState({ barberId: A, method: "GCASH", cached: null, list: { barberId: null, methods: [] } }).kind === "unavailable");
}

console.log("\nC10 a move clears the old barber's entries");
{
  const cachedIds = [qrCacheId(A, "GCASH"), qrCacheId(A, "MAYA"), qrCacheId(B, "GCASH")];
  check("moving away from A clears both of A's QRs", same(qrIdsToClearOnMove(cachedIds, A), [`${A}:GCASH`, `${A}:MAYA`]));
  check("B's entry is left to the refresh", !qrIdsToClearOnMove(cachedIds, A).includes(`${B}:GCASH`));
  check("no previous barber → nothing cleared", qrIdsToClearOnMove(cachedIds, null).length === 0);
  check("an id prefix that isn't a whole barber id is not matched", qrIdsToClearOnMove([qrCacheId(`${A}x`, "GCASH")], A).length === 0);
}

console.log("\nC11 the refresh keeps only the list's barber");
{
  const answer = readQrListAnswer({ success: true, scope: "phone", barberId: A, qrs: [srv(A, "GCASH", "1"), srv(B, "MAYA", "2")] });
  check("a phone answer is read, recording its barber and methods", answer?.record.barberId === A && same(answer.record.methods, ["GCASH"]));
  check("another barber's entry in the answer is ignored", answer !== null && ids(answer.qrs).join() === `${A}:GCASH`);
  const plan = planQrRefresh(answer?.qrs ?? [], [local(A, "GCASH", "1"), local(B, "GCASH", "3"), local(B, "MAYA", "4")]);
  check("the plan deletes every cached entry outside the list", same(plan.remove, [`${B}:GCASH`, `${B}:MAYA`]) && plan.download.length === 0);
  check("an owner answer (every barber) is never cached from", readQrListAnswer({ success: true, scope: "owner", qrs: [srv(A, "GCASH", "1")] }) === null);
  check("a refusal is never cached from", readQrListAnswer({ success: false, code: "DEVICE_NOT_APPROVED" }) === null);
  const none = readQrListAnswer({ success: true, scope: "phone", barberId: null, qrs: [] });
  check("no active assignment: an empty list for no barber", none?.record.barberId === null && none.qrs.length === 0);
  check("the stored record reads back", JSON.stringify(parseQrListRecord(JSON.stringify({ barberId: A, methods: ["MAYA", "CASH"] }))) === JSON.stringify({ barberId: A, methods: ["MAYA"] }));
  check("an unreadable record is no record", parseQrListRecord("{not json") === null && parseQrListRecord(null) === null);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}

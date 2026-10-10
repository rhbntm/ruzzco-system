/**
 * Tests the sync queue in src/lib/sync.ts: chunked requests, one run at a time, and request
 * timeouts (src/lib/fetch-timeout.ts). Runs the real sync code on fake-indexeddb with a fake
 * server (a stubbed fetch). No dev server or database needed.
 *
 *   npm run test:sync-queue
 */
import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import type { LocalTransaction } from "../src/lib/db";

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

// ── Browser globals sync.ts expects ──────────────────────────────────────────
const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  },
});
Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, get: () => true });

// ── Fake server ──────────────────────────────────────────────────────────────
type Behaviour = { fail?: (requestNo: number) => boolean; reject?: Set<string>; reason?: string; delayMs?: number; onRequest?: () => Promise<void> | void };
let behaviour: Behaviour = {};
let requests: string[][] = [];
let sentAts: (string | undefined)[] = [];
let inFlight = 0;
let maxInFlight = 0;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.endsWith("/api/v1/transactions/sync")) throw new Error(`unexpected request ${url}`);
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  try {
    const body = JSON.parse(String(init?.body)) as { sentAt?: string; transactions: { id: string }[] };
    const ids = body.transactions.map((t) => t.id);
    requests.push(ids);
    sentAts.push(body.sentAt);
    await behaviour.onRequest?.();
    if (behaviour.delayMs) await new Promise((r) => setTimeout(r, behaviour.delayMs));
    if (behaviour.fail?.(requests.length)) return new Response("{}", { status: 500 });
    const rejected = ids.filter((id) => behaviour.reject?.has(id)).map((id) => ({ id, reason: behaviour.reason ?? "INVALID" }));
    const syncedIds = ids.filter((id) => !behaviour.reject?.has(id));
    return Response.json({ success: true, processedCount: syncedIds.length, duplicatesSkipped: 0, syncedIds, rejected });
  } finally {
    inFlight--;
  }
}) as typeof fetch;

async function main() {
  const { db } = await import("../src/lib/db");
  const { syncNow, retryRejected, SYNC_CHUNK_SIZE } = await import("../src/lib/sync");
  const { fetchWithTimeout } = await import("../src/lib/fetch-timeout");
  const { SYNC_BATCH_MAX } = await import("../src/lib/schemas");

  const sale = (): LocalTransaction => ({
    id: randomUUID(),
    barberId: "barber-1",
    barberName: "Barber 1",
    serviceId: "service-1",
    serviceName: "Haircut",
    price: 200,
    totalAmount: 200,
    listPrice: 200,
    amountPaid: 200,
    paymentMethod: "CASH",
    transactionTime: new Date().toISOString(),
    synced: 0,
    assignmentId: randomUUID(),
    deviceKey: randomUUID(),
  });
  const addSales = async (n: number) => {
    const rows = Array.from({ length: n }, sale);
    await db.transactions.bulkAdd(rows);
    return rows.map((r) => r.id);
  };
  const reset = async () => {
    await db.transactions.clear();
    behaviour = {};
    requests = [];
    sentAts = [];
    maxInFlight = 0;
  };
  const unsyncedCount = () => db.transactions.where("synced").equals(0).count();

  console.log("Chunks");
  check(`chunk size ${SYNC_CHUNK_SIZE} fits under the server cap ${SYNC_BATCH_MAX}`, SYNC_CHUNK_SIZE <= SYNC_BATCH_MAX);
  await reset();
  await addSales(120);
  let outcome = await syncNow();
  check("120 queued sales go in 3 requests (50, 50, 20)", requests.map((r) => r.length).join(",") === "50,50,20", requests.map((r) => r.length).join(","));
  check("every sale is sent once", new Set(requests.flat()).size === 120 && requests.flat().length === 120);
  check("all 120 marked synced", (await unsyncedCount()) === 0);
  check("outcome adds up across chunks", outcome.status === "synced" && outcome.processed === 120, JSON.stringify(outcome));
  check(
    "every chunk carries the phone's clock (sentAt) at send time",
    sentAts.length === 3 && sentAts.every((s) => typeof s === "string" && Math.abs(Date.parse(s) - Date.now()) < 60_000),
    JSON.stringify(sentAts)
  );

  await reset();
  const ids = await addSales(60);
  behaviour.reject = new Set([ids[5], ids[55]]);
  outcome = await syncNow();
  check("rejections from both chunks are recorded", outcome.rejected === 2 && outcome.attention === 2, JSON.stringify(outcome));
  const rejectedRows = await db.transactions.where("synced").equals(0).toArray();
  check("rejected sales stay unsynced with a reason", rejectedRows.length === 2 && rejectedRows.every((t) => t.syncError === "INVALID"));

  console.log("\nA chunk fails");
  await reset();
  await addSales(120);
  behaviour.fail = (n) => n === 2;
  outcome = await syncNow();
  check("the run stops at the failed chunk", requests.length === 2 && outcome.status === "failed", `requests ${requests.length}, ${outcome.status}`);
  check("the first chunk stays synced, the rest stay queued", (await unsyncedCount()) === 70, `unsynced ${await unsyncedCount()}`);
  behaviour.fail = undefined;
  requests = [];
  outcome = await syncNow();
  check("the next run sends only what is left (50, 20)", requests.map((r) => r.length).join(",") === "50,20" && (await unsyncedCount()) === 0);

  console.log("\nOne run at a time");
  await reset();
  await addSales(3);
  behaviour.delayMs = 30;
  const [a, b, c] = await Promise.all([syncNow(), syncNow(), syncNow()]);
  check("overlapping calls never send two requests at once", maxInFlight === 1, `max in flight ${maxInFlight}`);
  check("three overlapping calls make at most two runs", requests.length <= 2, `requests ${requests.length}`);
  check("the first run synced the sales", a.status === "synced" && a.processed === 3);
  check("the calls that waited share one rerun", b === c || (b.status === "empty" && c.status === "empty"));

  await reset();
  await addSales(2);
  let lateId = "";
  behaviour.onRequest = async () => {
    // A sale saved while the first run is on the wire.
    if (!lateId) lateId = (await addSales(1))[0];
  };
  const first = syncNow();
  const second = syncNow();
  await Promise.all([first, second]);
  const late = await db.transactions.get(lateId);
  check("a sale saved mid-run is picked up by the rerun", late?.synced === 1 && requests.length === 2, `requests ${requests.length}`);

  console.log("\nRetry of a QRPH sale refused while QR Ph was off");
  await reset();
  const qr = { ...sale(), paymentMethod: "QRPH" as const, totalAmount: 250, amountPaid: 250, listPrice: 250 };
  const cash = sale();
  await db.transactions.bulkAdd([qr, cash]);
  behaviour.reject = new Set([qr.id]);
  behaviour.reason = "GATEWAY_DISABLED";
  await syncNow();
  const refused = await db.transactions.get(qr.id);
  check("the QRPH sale is kept, unsynced, with GATEWAY_DISABLED", refused?.synced === 0 && refused.syncError === "GATEWAY_DISABLED");
  check("the cash sale in the same batch still synced", (await db.transactions.get(cash.id))?.synced === 1);
  check("the refused sale is not retried automatically", (await syncNow()).status === "empty");

  let retried = await retryRejected(qr.id);
  check("retry while still off: refused again, no QR payment offered", !retried.qrCharge && (await db.transactions.get(qr.id))?.syncError === "GATEWAY_DISABLED");

  behaviour.reject = new Set(); // QR Ph switched back on
  retried = await retryRejected(qr.id);
  check("retry after re-enabling: the sale syncs", (await db.transactions.get(qr.id))?.synced === 1);
  check("and the QR payment is offered for that sale and amount", retried.qrCharge?.id === qr.id && retried.qrCharge?.amount === 250, JSON.stringify(retried.qrCharge));
  const stored = await db.transactions.get(qr.id);
  check("nothing about the sale was rewritten", stored?.totalAmount === 250 && stored.paymentMethod === "QRPH" && stored.assignmentId === qr.assignmentId);

  await reset();
  const cashRejected = { ...sale(), syncError: "INVALID" };
  await db.transactions.add(cashRejected);
  retried = await retryRejected(cashRejected.id);
  check("retrying a non-QRPH sale never offers a QR payment", !retried.qrCharge && (await db.transactions.get(cashRejected.id))?.synced === 1);

  console.log("\nTimeouts");
  const hanging = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, rejectFetch) => {
      init?.signal?.addEventListener("abort", () => rejectFetch(new DOMException("aborted", "AbortError")));
    })) as typeof fetch;
  const realFetch = globalThis.fetch;
  globalThis.fetch = hanging;
  const started = Date.now();
  let timedOut = false;
  try {
    await fetchWithTimeout("/never", {}, 50);
  } catch {
    timedOut = true;
  }
  globalThis.fetch = realFetch;
  check("a request that never answers is abandoned after the timeout", timedOut && Date.now() - started < 1000, `${Date.now() - started} ms`);
}

main()
  .catch((error) => {
    failures.push(`crashed: ${error instanceof Error ? error.message : String(error)}`);
    console.error(error);
  })
  .finally(() => {
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
      for (const f of failures) console.log(`  FAIL ${f}`);
      process.exit(1);
    }
  });

/**
 * Integration test for per-item sync results and rejected-sale handling.
 *
 * Server side: calls the REAL route (POST /api/v1/transactions/sync) on a running dev
 * server and checks the stored rows with Prisma.
 * Client side: runs the REAL src/lib/sync.ts against an in-memory IndexedDB
 * (fake-indexeddb) with the real Dexie schema from src/lib/db.ts, talking to the same
 * server. Nothing from the sync algorithm is reimplemented here.
 *
 *   npm run dev                       (in another terminal)
 *   npm run test:sync-rejections      (TEST_BASE_URL overrides http://localhost:3000)
 *
 * Uses throwaway barbers, device keys and assignments; everything is deleted at the end.
 */
import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import type { LocalTransaction } from "../src/lib/db";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const SERVICE_ID = "10000000-0000-0000-0000-000000000001"; // seeded Haircut
const RUN = randomUUID().slice(0, 8);

const BARBERS = {
  A: { id: `test-rej-A-${RUN}`, rate: 0.5 },
  B: { id: `test-rej-B-${RUN}`, rate: 0.4 },
  Z: { id: `test-rej-Z-${RUN}`, rate: 0.3 }, // created mid-test (T9)
};
const UNKNOWN_BARBER = `test-rej-nobody-${RUN}`;

const txIds: string[] = [];
const deviceKeys: string[] = [];
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

// ── HTTP helpers ─────────────────────────────────────────────────────────────

type Rejection = { id: string | null; reason: string };
type SyncResponse = {
  success: boolean;
  processedCount: number;
  duplicatesSkipped: number;
  syncedIds: string[];
  rejected: Rejection[];
};

async function post<T>(path: string, body: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

const sync = (items: unknown[]) => post<SyncResponse>("/api/v1/transactions/sync", { transactions: items });
const bind = (deviceKey: string, barberId: string, assignmentId: string) =>
  post<{ success: boolean }>("/api/v1/devices/bind", { deviceKey, barberId, assignmentId });

function newDevice() {
  const key = randomUUID();
  deviceKeys.push(key);
  return key;
}

function track(id: string) {
  if (!txIds.includes(id)) txIds.push(id);
  return id;
}

type SaleOpts = { barberId: string; assignmentId?: string; deviceKey?: string; id?: string } & Record<string, unknown>;
function sale({ barberId, assignmentId, deviceKey, id, ...extra }: SaleOpts) {
  return {
    id: track(id ?? randomUUID()),
    barberId,
    serviceId: SERVICE_ID,
    totalAmount: 150,
    listPrice: 150,
    amountPaid: 150,
    paymentMethod: "CASH",
    transactionTime: new Date().toISOString(),
    ...(deviceKey ? { deviceKey } : {}),
    ...(assignmentId ? { assignmentId } : {}),
    ...extra,
  };
}

async function rowCounts(id: string) {
  const [transactions, items, commissionLogs, mismatchLogs] = await Promise.all([
    prisma.transaction.count({ where: { id } }),
    prisma.transactionItem.count({ where: { transactionId: id } }),
    prisma.commissionLog.count({ where: { transactionId: id } }),
    prisma.syncMismatchLog.count({ where: { transactionId: id } }),
  ]);
  return { transactions, items, commissionLogs, mismatchLogs };
}

async function expectNoRows(label: string, id: string) {
  const c = await rowCounts(id);
  check(`${label}: nothing inserted (transaction, item, commission log, mismatch log)`, c.transactions + c.items + c.commissionLogs + c.mismatchLogs === 0, JSON.stringify(c));
}

const reasonOf = (res: SyncResponse, id: string) => res.rejected.find((r) => r.id === id)?.reason;

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Sync rejection integration test against ${BASE} (run ${RUN})`);
  const health = await fetch(`${BASE}/api/v1/health`).catch(() => null);
  if (!health?.ok) throw new Error(`Dev server not reachable at ${BASE}. Start it with \`npm run dev\`.`);

  for (const key of ["A", "B"] as const) {
    await prisma.barber.create({ data: { id: BARBERS[key].id, fullName: `Test Barber ${key} ${RUN}`, commissionRate: BARBERS[key].rate } });
  }

  const dev1 = newDevice();
  const dev2 = newDevice();
  const idA = randomUUID();
  const idB = randomUUID();
  check("setup: device 1 bound to A", (await bind(dev1, BARBERS.A.id, idA)).status === 200);
  check("setup: device 2 bound to B", (await bind(dev2, BARBERS.B.id, idB)).status === 200);

  const valid = () => sale({ barberId: BARBERS.A.id, assignmentId: idA, deviceKey: dev1 });

  // ── Server ───────────────────────────────────────────────────────────────
  console.log("\nT1 valid + invalid + valid in one batch");
  const t1v1 = valid();
  const t1bad = sale({ barberId: BARBERS.A.id, assignmentId: idA, deviceKey: dev1, totalAmount: -5 });
  const t1v2 = valid();
  const t1 = await sync([t1v1, t1bad, t1v2]);
  check("T1: 200 with per-item results", t1.status === 200 && t1.body.success, JSON.stringify(t1.body));
  check("T1: both valid sales synced", t1.body.syncedIds.includes(t1v1.id) && t1.body.syncedIds.includes(t1v2.id) && t1.body.processedCount === 2);
  check("T1: invalid item rejected as INVALID", reasonOf(t1.body, t1bad.id) === "INVALID" && !t1.body.syncedIds.includes(t1bad.id), JSON.stringify(t1.body.rejected));
  check("T1: valid sales are stored", (await rowCounts(t1v1.id)).transactions === 1 && (await rowCounts(t1v2.id)).transactions === 1);
  await expectNoRows("T5/T1 invalid item", t1bad.id);

  console.log("\nT2 valid + unknown barber + valid in one batch");
  const t2v1 = valid();
  const t2bad = sale({ barberId: UNKNOWN_BARBER });
  const t2badWithAssignment = sale({ barberId: UNKNOWN_BARBER, assignmentId: randomUUID(), deviceKey: newDevice() });
  const t2v2 = valid();
  const t2 = await sync([t2v1, t2bad, t2badWithAssignment, t2v2]);
  check("T2: 200", t2.status === 200, JSON.stringify(t2.body));
  check("T2: both valid sales synced", t2.body.syncedIds.includes(t2v1.id) && t2.body.syncedIds.includes(t2v2.id) && t2.body.processedCount === 2);
  check("T2: unknown barber rejected as UNKNOWN_BARBER", reasonOf(t2.body, t2bad.id) === "UNKNOWN_BARBER", JSON.stringify(t2.body.rejected));
  check("T2: unknown barber with an assignment also UNKNOWN_BARBER", reasonOf(t2.body, t2badWithAssignment.id) === "UNKNOWN_BARBER");
  check("T2: no assignment was registered for the unknown barber", (await prisma.deviceAssignment.count({ where: { id: t2badWithAssignment.assignmentId } })) === 0);
  await expectNoRows("T5/T2 unknown barber", t2bad.id);
  await expectNoRows("T5/T2 unknown barber + assignment", t2badWithAssignment.id);

  console.log("\nT3 valid + DEVICE_MISMATCH + valid in one batch");
  const t3v1 = valid();
  const t3bad = sale({ barberId: BARBERS.A.id, assignmentId: idA, deviceKey: dev2 }); // idA belongs to dev1
  const t3v2 = valid();
  const t3 = await sync([t3v1, t3bad, t3v2]);
  check("T3: 200", t3.status === 200, JSON.stringify(t3.body));
  check("T3: both valid sales synced", t3.body.syncedIds.includes(t3v1.id) && t3.body.syncedIds.includes(t3v2.id) && t3.body.processedCount === 2);
  check("T3: rejected as DEVICE_MISMATCH", reasonOf(t3.body, t3bad.id) === "DEVICE_MISMATCH", JSON.stringify(t3.body.rejected));
  await expectNoRows("T5/T3 device mismatch", t3bad.id);

  console.log("\nT4 malformed items do not stop later valid items");
  const t4v1 = valid();
  const t4badMethod = sale({ barberId: BARBERS.A.id, assignmentId: idA, deviceKey: dev1, paymentMethod: "BTC" });
  const t4idOnly = track(randomUUID());
  const t4hugeAmount = sale({ barberId: BARBERS.A.id, assignmentId: idA, deviceKey: dev1, totalAmount: 1e12 });
  const t4longRef = sale({ barberId: BARBERS.A.id, assignmentId: idA, deviceKey: dev1, paymentReference: "x".repeat(300) });
  const t4noDevice = sale({ barberId: BARBERS.A.id, assignmentId: idA }); // assignmentId requires deviceKey
  const t4unknownService = sale({ barberId: BARBERS.A.id, assignmentId: idA, deviceKey: dev1, serviceId: "no-such-service" });
  const t4v2 = valid();
  const { id: _omit, ...noId } = sale({ barberId: BARBERS.A.id });
  void _omit;
  const t4 = await sync([t4v1, null, "junk", 42, { id: t4idOnly }, noId, t4badMethod, t4hugeAmount, t4longRef, t4noDevice, t4unknownService, t4v2]);
  check("T4: 200, not a 400 for the whole batch", t4.status === 200 && t4.body.success, JSON.stringify(t4.body));
  check("T4: both valid sales synced", t4.body.syncedIds.includes(t4v1.id) && t4.body.syncedIds.includes(t4v2.id) && t4.body.processedCount === 2);
  check("T4: every bad item INVALID", t4.body.rejected.length === 10 && t4.body.rejected.every((r) => r.reason === "INVALID"), JSON.stringify(t4.body.rejected));
  check("T4: items without a usable id are reported with id null", t4.body.rejected.filter((r) => r.id === null).length === 4);
  check("T4: item with only an id is reported by that id", reasonOf(t4.body, t4idOnly) === "INVALID");
  for (const [label, bad] of [
    ["bad payment method", t4badMethod],
    ["amount over Decimal(10,2)", t4hugeAmount],
    ["payment reference too long", t4longRef],
    ["assignmentId without deviceKey", t4noDevice],
    ["unknown service (database rejects it)", t4unknownService],
  ] as const) {
    check(`T4: ${label} rejected INVALID`, reasonOf(t4.body, bad.id) === "INVALID");
    await expectNoRows(`T5/T4 ${label}`, bad.id);
  }
  check("T4: an empty transactions array is still a 400 (outer shape)", (await post("/api/v1/transactions/sync", { transactions: [] })).status === 400);
  check("T4: a missing transactions field is still a 400", (await post("/api/v1/transactions/sync", {})).status === 400);
  const onlyBad = await sync([null, { id: randomUUID() }]);
  check("T4: a batch of only malformed items is 200 with nothing synced", onlyBad.status === 200 && onlyBad.body.syncedIds.length === 0 && onlyBad.body.rejected.length === 2);

  console.log("\nT10 idempotency is unchanged");
  const t10 = await sync([t1v1, t1bad, t1v2]);
  check("T10: already-stored sales are duplicates, nothing reprocessed", t10.body.duplicatesSkipped === 2 && t10.body.processedCount === 0 && t10.body.syncedIds.includes(t1v1.id) && t10.body.syncedIds.includes(t1v2.id), JSON.stringify(t10.body));
  check("T10: the rejected item is rejected again, not inserted", reasonOf(t10.body, t1bad.id) === "INVALID");
  check("T10: still exactly one row per stored sale", (await rowCounts(t1v1.id)).transactions === 1 && (await rowCounts(t1v1.id)).commissionLogs === 1);
  const t10b = await sync([{ id: t1v1.id, garbage: true }]);
  check("T10: an id already on the server counts as synced even if this copy is malformed", t10b.body.syncedIds.includes(t1v1.id) && t10b.body.rejected.length === 0, JSON.stringify(t10b.body));
  const t10c = await sync([t1v1, t1v1]);
  check("T10: the same id twice in one batch stays a single row", t10c.body.duplicatesSkipped === 2 && (await rowCounts(t1v1.id)).transactions === 1);

  console.log("\nT11 / T12 mismatch log only for sales that were actually inserted");
  const t11ok = sale({ barberId: BARBERS.B.id, assignmentId: idA, deviceKey: dev1 }); // claims B, assignment says A
  const t11wrongDevice = sale({ barberId: BARBERS.B.id, assignmentId: idA, deviceKey: dev2 }); // claim differs AND wrong device
  const t11unknownService = sale({ barberId: BARBERS.B.id, assignmentId: idA, deviceKey: dev1, serviceId: "no-such-service" }); // claim differs; insert fails
  const t11 = await sync([t11ok, t11wrongDevice, t11unknownService]);
  check("T11: the inserted mismatched sale is attributed to the assignment's barber", (await prisma.transaction.findUnique({ where: { id: t11ok.id } }))?.barberId === BARBERS.A.id);
  const okLogs = await prisma.syncMismatchLog.findMany({ where: { transactionId: t11ok.id } });
  check("T11: exactly one mismatch log for it (claimed B, resolved A)", okLogs.length === 1 && okLogs[0].claimedBarberId === BARBERS.B.id && okLogs[0].resolvedBarberId === BARBERS.A.id);
  check("T12: rejected DEVICE_MISMATCH item left no mismatch log", reasonOf(t11.body, t11wrongDevice.id) === "DEVICE_MISMATCH" && (await rowCounts(t11wrongDevice.id)).mismatchLogs === 0);
  check("T12: insert failure rolled its mismatch log back", reasonOf(t11.body, t11unknownService.id) === "INVALID" && (await rowCounts(t11unknownService.id)).mismatchLogs === 0);
  await expectNoRows("T12 failed insert", t11unknownService.id);
  const orphaned = await prisma.syncMismatchLog.findMany({ where: { transactionId: { in: txIds } } });
  const orphanIds: string[] = [];
  for (const log of orphaned) if ((await prisma.transaction.count({ where: { id: log.transactionId } })) === 0) orphanIds.push(log.transactionId);
  check("T12: no mismatch log in this run points at a missing transaction", orphanIds.length === 0, orphanIds.join(","));

  // ── Client (real lib/sync.ts + real Dexie schema on fake-indexeddb) ───────
  console.log("\nClient: real syncNow() against the real route");
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
  const syncRequests: string[][] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" && input.startsWith("/") ? `${BASE}${input}` : input;
    if (typeof url === "string" && url.endsWith("/api/v1/transactions/sync") && typeof init?.body === "string") {
      syncRequests.push((JSON.parse(init.body) as { transactions: { id: string }[] }).transactions.map((t) => t.id));
    }
    return realFetch(url, init);
  }) as typeof fetch;

  const { db } = await import("../src/lib/db");
  const sync_ = await import("../src/lib/sync");

  const local = (over: Partial<LocalTransaction> & { barberId: string }): LocalTransaction => ({
    id: track(randomUUID()),
    barberName: `Barber ${over.barberId}`,
    serviceId: SERVICE_ID,
    serviceName: "Haircut",
    price: 150,
    totalAmount: 150,
    listPrice: 150,
    amountPaid: 150,
    tipAmount: 20,
    paymentMethod: "GCASH",
    paymentReference: "REF-123",
    transactionTime: new Date().toISOString(),
    synced: 0,
    syncedAt: null,
    ...over,
  });
  const fromDb = async (id: string) => (await db.transactions.get(id)) as LocalTransaction;
  const withoutSyncFields = (t: LocalTransaction) => {
    const { synced, syncedAt, syncError, ...rest } = t;
    void synced; void syncedAt; void syncError;
    return rest;
  };

  const L1 = local({ barberId: BARBERS.A.id, assignmentId: idA, deviceKey: dev1 });
  const Lbad = local({ barberId: BARBERS.A.id, assignmentId: idA, deviceKey: dev2, tipAmount: 50, paymentMethod: "MAYA" }); // idA is dev1's
  const L2 = local({ barberId: BARBERS.A.id, assignmentId: idA, deviceKey: dev1 });
  await db.transactions.bulkAdd([L1, Lbad, L2]);
  const badSnapshot = structuredClone(withoutSyncFields(await fromDb(Lbad.id)));
  check("client: 3 sales pending, none rejected", (await sync_.countPending()) === 3 && (await sync_.listRejected()).length === 0);

  console.log("\nT6 rejected sale stays unsynced locally");
  const c1 = await sync_.syncNow();
  check("T6: valid sales around the bad one are synced locally", (await fromDb(L1.id)).synced === 1 && (await fromDb(L2.id)).synced === 1 && c1.processed === 2, JSON.stringify(c1));
  const badAfter = await fromDb(Lbad.id);
  check("T6: rejected sale is still in Dexie, unsynced, with its reason", badAfter.synced === 0 && badAfter.syncError === "DEVICE_MISMATCH");
  check("T6: it is classified as rejected, not pending", sync_.isRejected(badAfter) && (await sync_.countPending()) === 0);
  check("T6: nothing about the sale was rewritten (id, time, barber, assignment, device key, amounts, payment)", JSON.stringify(withoutSyncFields(badAfter)) === JSON.stringify(badSnapshot));
  check("T6: listRejected returns it with the reason label", (await sync_.listRejected()).map((t) => t.id).join() === Lbad.id && sync_.rejectLabel(badAfter.syncError) === "Device/assignment mismatch" && sync_.needsReview(badAfter.syncError));
  check("T6: the server has the two valid sales and not the rejected one", (await rowCounts(L1.id)).transactions === 1 && (await rowCounts(L2.id)).transactions === 1);
  await expectNoRows("T6 rejected sale", Lbad.id);
  check("T6: outcome counts the rejection", c1.rejected === 1 && c1.attention === 1);

  console.log("\nT7 rejected sale is excluded from automatic sync");
  syncRequests.length = 0;
  const c2 = await sync_.syncNow();
  check("T7: with only a rejected sale left, no sync request is sent", syncRequests.length === 0 && c2.status === "empty" && c2.attention === 1, JSON.stringify(c2));
  const L3 = local({ barberId: BARBERS.A.id, assignmentId: idA, deviceKey: dev1 });
  await db.transactions.add(L3);
  syncRequests.length = 0;
  const c3 = await sync_.syncNow();
  check("T7: a new pending sale is sent alone, without the rejected one", syncRequests.length === 1 && syncRequests[0].join() === L3.id, JSON.stringify(syncRequests));
  check("T7: the rejected sale is untouched and still needs attention", c3.attention === 1 && (await fromDb(Lbad.id)).syncError === "DEVICE_MISMATCH");

  console.log("\nT8 explicit retry clears the rejection and tries again");
  check("T8: clearRejection reports the change", await sync_.clearRejection(Lbad.id));
  const cleared = await fromDb(Lbad.id);
  check("T8: rejection cleared, still unsynced, back in the pending queue", cleared.synced === 0 && cleared.syncError === undefined && (await sync_.countPending()) === 1 && !sync_.isRejected(cleared));
  check("T8: clearing changed nothing else about the sale", JSON.stringify(withoutSyncFields(cleared)) === JSON.stringify(badSnapshot));
  syncRequests.length = 0;
  const c4 = await sync_.syncNow();
  check("T8: the retry sends it again", syncRequests.length === 1 && syncRequests[0].join() === Lbad.id, JSON.stringify(syncRequests));
  const again = await fromDb(Lbad.id);
  check("T8: the mismatch is genuinely unresolved, so it is rejected again and stays visible", c4.rejected === 1 && again.syncError === "DEVICE_MISMATCH" && again.synced === 0);
  check("T8: retrying an already-synced sale changes nothing", !(await sync_.clearRejection(L1.id)) || (await fromDb(L1.id)).synced === 1);

  console.log("\nT9 a rejected sale succeeds on retry once the server condition is fixed");
  const Lz = local({ barberId: BARBERS.Z.id }); // legacy sale for a barber the server does not know yet
  await db.transactions.add(Lz);
  const zSnapshot = structuredClone(withoutSyncFields(await fromDb(Lz.id)));
  const c5 = await sync_.syncNow();
  check("T9: unknown barber -> rejected UNKNOWN_BARBER locally", (await fromDb(Lz.id)).syncError === "UNKNOWN_BARBER" && sync_.rejectLabel("UNKNOWN_BARBER") === "Unknown barber" && c5.rejected === 1, JSON.stringify(c5));
  await expectNoRows("T9 before the fix", Lz.id);
  await prisma.barber.create({ data: { id: BARBERS.Z.id, fullName: `Test Barber Z ${RUN}`, commissionRate: BARBERS.Z.rate } });
  syncRequests.length = 0;
  await sync_.syncNow();
  check("T9: still not retried automatically after the server condition is fixed", syncRequests.every((ids) => !ids.includes(Lz.id)) && (await fromDb(Lz.id)).syncError === "UNKNOWN_BARBER");
  await sync_.clearRejection(Lz.id);
  const c6 = await sync_.syncNow();
  const zAfter = await fromDb(Lz.id);
  check("T9: after an explicit retry it syncs and the rejection is gone", zAfter.synced === 1 && zAfter.syncError === undefined && c6.processed === 1, JSON.stringify(c6));
  const zServer = await prisma.transaction.findUnique({ where: { id: Lz.id } });
  check("T9: the server has it under the same barber and id, legacy attribution (cashierId null)", zServer?.barberId === BARBERS.Z.id && zServer?.cashierId === null && Number(zServer?.barberCommissionAmount) === 45);
  check("T9: the sale's own fields never changed", JSON.stringify(withoutSyncFields(zAfter)) === JSON.stringify(zSnapshot));

  console.log("\nNothing was deleted locally");
  const all = await db.transactions.toArray();
  check(`every sale is still in Dexie (${all.length} of 5)`, all.length === 5 && [L1, Lbad, L2, L3, Lz].every((t) => all.some((a) => a.id === t.id)));
  db.close();
}

async function cleanup() {
  const barberIds = Object.values(BARBERS).map((b) => b.id);
  await prisma.syncMismatchLog.deleteMany({ where: { transactionId: { in: txIds } } });
  // Items and commission logs cascade with the transaction.
  await prisma.transaction.deleteMany({ where: { OR: [{ id: { in: txIds } }, { barberId: { in: barberIds } }] } });
  await prisma.deviceAssignment.deleteMany({ where: { OR: [{ deviceKey: { in: deviceKeys } }, { barberId: { in: barberIds } }] } });
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

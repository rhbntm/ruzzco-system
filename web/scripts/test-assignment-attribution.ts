/**
 * Integration test for device-assignment attribution.
 *
 * Calls the REAL routes (POST /api/v1/devices/bind, POST /api/v1/transactions/sync)
 * on a running dev server and checks the stored rows with Prisma. Uses throwaway
 * barbers, device keys and assignments; everything it creates is deleted at the end.
 *
 *   npm run dev                      (in another terminal)
 *   npm run test:attribution         (TEST_BASE_URL overrides http://localhost:3000)
 *
 * T17 (fresh-database migration check) also needs TEST_ADMIN_DATABASE_URL: a MySQL
 * user allowed to create and drop a scratch database, e.g. the local Docker root user.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const SERVICE_ID = "10000000-0000-0000-0000-000000000001"; // seeded Haircut
const RUN = randomUUID().slice(0, 8);

// Distinct rates so a wrong barber shows up as a wrong commission too.
const BARBERS = {
  A: { id: `test-attr-A-${RUN}`, rate: 0.5, active: true }, // commission on 150 = 75
  B: { id: `test-attr-B-${RUN}`, rate: 0.4, active: true }, // 60
  C: { id: `test-attr-C-${RUN}`, rate: 0.3, active: true }, // 45
  D: { id: `test-attr-D-${RUN}`, rate: 0.6, active: false }, // 90, inactive
};
const COMMISSION = { A: 75, B: 60, C: 45, D: 90 } as const;
type Key = keyof typeof BARBERS;

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

function newDevice() {
  const key = randomUUID();
  deviceKeys.push(key);
  return key;
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const bind = (deviceKey: string, barber: Key, assignmentId?: string) =>
  post("/api/v1/devices/bind", { deviceKey, barberId: BARBERS[barber].id, ...(assignmentId ? { assignmentId } : {}) });

type SaleOpts = { barber: Key; assignmentId?: string; deviceKey?: string; id?: string };
function sale({ barber, assignmentId, deviceKey, id }: SaleOpts) {
  const txId = id ?? randomUUID();
  if (!txIds.includes(txId)) txIds.push(txId);
  return {
    id: txId,
    barberId: BARBERS[barber].id,
    serviceId: SERVICE_ID,
    totalAmount: 150,
    listPrice: 150,
    amountPaid: 150,
    paymentMethod: "CASH",
    transactionTime: new Date().toISOString(),
    ...(deviceKey ? { deviceKey } : {}),
    ...(assignmentId ? { assignmentId } : {}),
  };
}

const sync = (items: unknown[]) => post("/api/v1/transactions/sync", { transactions: items });

async function stored(id: string) {
  return prisma.transaction.findUnique({ where: { id }, include: { commissionLogs: true } });
}

async function expectAttributed(label: string, id: string, barber: Key, assignmentId: string | null) {
  const tx = await stored(id);
  const want = BARBERS[barber].id;
  check(`${label}: attributed to ${barber}`, tx?.barberId === want, `got ${tx?.barberId}`);
  check(`${label}: assignmentId ${assignmentId ? "kept" : "null"}`, (tx?.assignmentId ?? null) === assignmentId, `got ${tx?.assignmentId}`);
  check(
    `${label}: commission ${COMMISSION[barber]} logged to ${barber}`,
    Number(tx?.barberCommissionAmount) === COMMISSION[barber] &&
      tx?.commissionLogs.length === 1 &&
      tx.commissionLogs[0].barberId === want &&
      Number(tx.commissionLogs[0].amount) === COMMISSION[barber],
    `got ${tx?.barberCommissionAmount}`
  );
}

const mismatchLogs = (id: string) => prisma.syncMismatchLog.count({ where: { transactionId: id } });
const assignment = (id: string) => prisma.deviceAssignment.findUnique({ where: { id } });
const activeFor = (deviceKey: string) => prisma.deviceAssignment.findMany({ where: { deviceKey, revokedAt: null } });

async function main() {
  console.log(`Attribution integration test against ${BASE} (run ${RUN})`);
  const health = await fetch(`${BASE}/api/v1/health`).catch(() => null);
  if (!health?.ok) throw new Error(`Dev server not reachable at ${BASE}. Start it with \`npm run dev\`.`);

  for (const [key, b] of Object.entries(BARBERS)) {
    await prisma.barber.create({ data: { id: b.id, fullName: `Test Barber ${key} ${RUN}`, commissionRate: b.rate, isActive: b.active } });
  }

  const dev1 = newDevice();
  const idA = randomUUID();
  const idB = randomUUID();
  const idC = randomUUID();

  console.log("\nT1 bind with phone-generated assignmentId");
  const t1 = await bind(dev1, "A", idA);
  const rowA = await assignment(idA);
  check("T1: 200", t1.status === 200, JSON.stringify(t1.body));
  check("T1: row id is the phone's id, active, barber A", rowA?.revokedAt === null && rowA?.barberId === BARBERS.A.id && rowA?.deviceKey === dev1);

  console.log("\nT2 same bind retried");
  const t2 = await bind(dev1, "A", idA);
  check("T2: 200", t2.status === 200, JSON.stringify(t2.body));
  check("T2: still one row, still active", (await prisma.deviceAssignment.count({ where: { deviceKey: dev1 } })) === 1 && (await assignment(idA))?.revokedAt === null);

  console.log("\nT3 same assignmentId with a different barber / device");
  const t3 = await bind(dev1, "B", idA);
  check("T3: different barber → 409 ASSIGNMENT_CONFLICT", t3.status === 409 && t3.body.code === "ASSIGNMENT_CONFLICT", JSON.stringify(t3.body));
  const t3b = await bind(newDevice(), "A", idA);
  check("T3: different device → 409 ASSIGNMENT_CONFLICT", t3b.status === 409 && t3b.body.code === "ASSIGNMENT_CONFLICT", JSON.stringify(t3b.body));
  check("T3: A unchanged and active", (await assignment(idA))?.revokedAt === null);

  console.log("\nT4 rebind A → B");
  const t4 = await bind(dev1, "B", idB);
  check("T4: 200", t4.status === 200, JSON.stringify(t4.body));
  check("T4: A revoked", (await assignment(idA))?.revokedAt !== null);
  const active4 = await activeFor(dev1);
  check("T4: exactly one active, and it is B", active4.length === 1 && active4[0].id === idB);

  console.log("\nT5 sale stamped A syncs after B is active");
  const s1 = sale({ barber: "A", assignmentId: idA, deviceKey: dev1 });
  const t5 = await sync([s1]);
  check("T5: 200, synced", t5.status === 200 && t5.body.syncedIds.includes(s1.id), JSON.stringify(t5.body));
  await expectAttributed("T5", s1.id, "A", idA);
  check("T5: no mismatch log", (await mismatchLogs(s1.id)) === 0);

  console.log("\nT6 one batch with A, B, A sales");
  const b1 = sale({ barber: "A", assignmentId: idA, deviceKey: dev1 });
  const b2 = sale({ barber: "B", assignmentId: idB, deviceKey: dev1 });
  const b3 = sale({ barber: "A", assignmentId: idA, deviceKey: dev1 });
  const t6 = await sync([b1, b2, b3]);
  check("T6: all three synced", t6.status === 200 && t6.body.processedCount === 3, JSON.stringify(t6.body));
  await expectAttributed("T6 #1", b1.id, "A", idA);
  await expectAttributed("T6 #2", b2.id, "B", idB);
  await expectAttributed("T6 #3", b3.id, "A", idA);

  console.log("\nT7 resend an already-synced sale after another rebind");
  check("T7: rebind to C 200", (await bind(dev1, "C", idC)).status === 200);
  const t7 = await sync([s1]);
  check("T7: counted as duplicate, not reprocessed", t7.body.duplicatesSkipped === 1 && t7.body.processedCount === 0 && t7.body.syncedIds.includes(s1.id), JSON.stringify(t7.body));
  await expectAttributed("T7", s1.id, "A", idA);

  console.log("\nT8 A → B → C offline, sales under each");
  const dev2 = newDevice();
  const idX = randomUUID();
  check("T8: device starts bound online to C (X)", (await bind(dev2, "C", idX)).status === 200);
  const idP = randomUUID(); // offline: A
  const idQ = randomUUID(); // offline: B
  const idR = randomUUID(); // offline: C, current and still pending
  const p1 = sale({ barber: "A", assignmentId: idP, deviceKey: dev2 });
  const p2 = sale({ barber: "A", assignmentId: idP, deviceKey: dev2 });
  const q1 = sale({ barber: "B", assignmentId: idQ, deviceKey: dev2 });
  const r1 = sale({ barber: "C", assignmentId: idR, deviceKey: dev2 });
  // Reconnect, in the order lib/sync.ts uses when the current bind is not yet accepted:
  // older assignments' sales go first; the pending current assignment's sales are held.
  const t8a = await sync([p1, p2, q1]);
  check("T8: older-assignment sales synced", t8a.status === 200 && t8a.body.processedCount === 3, JSON.stringify(t8a.body));
  const rowP = await assignment(idP);
  const rowQ = await assignment(idQ);
  check("T8: P and Q registered as historical (revoked)", rowP?.revokedAt !== null && rowQ?.revokedAt !== null && rowP?.barberId === BARBERS.A.id && rowQ?.barberId === BARBERS.B.id);
  const active8a = await activeFor(dev2);
  check("T8: sync did not touch the active binding (X)", active8a.length === 1 && active8a[0].id === idX);
  check("T8: bind current assignment R → 200", (await bind(dev2, "C", idR)).status === 200);
  const t8b = await sync([r1]);
  check("T8: R sale synced", t8b.body.processedCount === 1, JSON.stringify(t8b.body));
  const active8b = await activeFor(dev2);
  check("T8: exactly one active, R", active8b.length === 1 && active8b[0].id === idR);
  await expectAttributed("T8 P#1", p1.id, "A", idP);
  await expectAttributed("T8 P#2", p2.id, "A", idP);
  await expectAttributed("T8 Q", q1.id, "B", idQ);
  await expectAttributed("T8 R", r1.id, "C", idR);
  // If the current assignment's sale had synced before its bind (lost localStorage),
  // it would be registered revoked, still attributed correctly, and /bind refuses it:
  const dev2b = newDevice();
  const idS = randomUUID();
  const s8 = sale({ barber: "B", assignmentId: idS, deviceKey: dev2b });
  await sync([s8]);
  await expectAttributed("T8 lost-pending sale", s8.id, "B", idS);
  const t8c = await bind(dev2b, "B", idS);
  check("T8: late /bind of a sync-registered assignment → 409 ASSIGNMENT_REVOKED", t8c.status === 409 && t8c.body.code === "ASSIGNMENT_REVOKED", JSON.stringify(t8c.body));
  check("T8: and it did not become active", (await activeFor(dev2b)).length === 0);

  console.log("\nT9 payload claims the wrong barber for a valid assignment");
  const w1 = sale({ barber: "A", assignmentId: idB, deviceKey: dev1 });
  await sync([w1]);
  await expectAttributed("T9", w1.id, "B", idB);
  const log9 = await prisma.syncMismatchLog.findMany({ where: { transactionId: w1.id } });
  check("T9: one mismatch log (claimed A, resolved B)", log9.length === 1 && log9[0].claimedBarberId === BARBERS.A.id && log9[0].resolvedBarberId === BARBERS.B.id);

  console.log("\nT10 assignmentId sent with the wrong deviceKey");
  const m1 = sale({ barber: "A", assignmentId: idA, deviceKey: dev2 });
  const t10 = await sync([m1]);
  check(
    "T10: rejected DEVICE_MISMATCH, not synced",
    t10.status === 200 && !t10.body.syncedIds.includes(m1.id) && t10.body.rejected?.some((r: { id: string; reason: string }) => r.id === m1.id && r.reason === "DEVICE_MISMATCH"),
    JSON.stringify(t10.body)
  );
  check("T10: not inserted", (await stored(m1.id)) === null);
  const t10b = await post("/api/v1/transactions/sync", { transactions: [{ ...sale({ barber: "A", assignmentId: idA }), deviceKey: undefined }] });
  check("T10: assignmentId without deviceKey → 400", t10b.status === 400);

  console.log("\nT11 revoked assignment still accepts historical sales");
  check("T11: A is revoked", (await assignment(idA))?.revokedAt !== null);
  const h1 = sale({ barber: "A", assignmentId: idA, deviceKey: dev1 });
  await sync([h1]);
  await expectAttributed("T11", h1.id, "A", idA);
  const t11 = await bind(dev1, "A", idA);
  check("T11: re-binding revoked A → 409 ASSIGNMENT_REVOKED", t11.status === 409 && t11.body.code === "ASSIGNMENT_REVOKED", JSON.stringify(t11.body));
  const active11 = await activeFor(dev1);
  check("T11: not reactivated; C still the active binding", active11.length === 1 && active11[0].id === idC);

  console.log("\nT12 inactive barber");
  const dev3 = newDevice();
  const idE = randomUUID();
  await bind(dev3, "A", idE);
  const idD1 = randomUUID();
  const t12 = await bind(dev3, "D", idD1);
  check("T12: bind new assignment for inactive barber → 409 BARBER_INACTIVE", t12.status === 409 && t12.body.code === "BARBER_INACTIVE", JSON.stringify(t12.body));
  check("T12: assignment recorded already revoked", (await assignment(idD1))?.revokedAt !== null);
  const active12 = await activeFor(dev3);
  check("T12: device's active binding unchanged (E)", active12.length === 1 && active12[0].id === idE);
  const d1 = sale({ barber: "D", assignmentId: idD1, deviceKey: dev3 });
  await sync([d1]);
  await expectAttributed("T12 bound-then-inactive sale", d1.id, "D", idD1);
  const idD2 = randomUUID();
  const d2 = sale({ barber: "D", assignmentId: idD2, deviceKey: dev3 });
  await sync([d2]);
  await expectAttributed("T12 sync-registered inactive-barber sale", d2.id, "D", idD2);
  check("T12: legacy bind (no id) for inactive barber → 404", (await bind(dev3, "D")).status === 404);

  console.log("\nT13 legacy sale (no assignmentId) synced after a rebind");
  const dev4 = newDevice();
  await bind(dev4, "A", randomUUID());
  await bind(dev4, "B", randomUUID());
  const l1 = sale({ barber: "A", deviceKey: dev4 });
  await sync([l1]);
  await expectAttributed("T13", l1.id, "A", null);
  check("T13: cashierId null", (await stored(l1.id))?.cashierId === null);
  check("T13: no mismatch log", (await mismatchLogs(l1.id)) === 0);

  console.log("\nT14 legacy sale with no assignmentId and no deviceKey");
  const l2 = sale({ barber: "B" });
  // Exactly the shape older clients sent (no listPrice/amountPaid either).
  const t14 = await sync([{ id: l2.id, barberId: l2.barberId, serviceId: SERVICE_ID, totalAmount: 150, paymentMethod: "CASH", transactionTime: l2.transactionTime }]);
  check("T14: old payload shape validates", t14.status === 200, JSON.stringify(t14.body));
  await expectAttributed("T14", l2.id, "B", null);
  check("T14: cashierId null", (await stored(l2.id))?.cashierId === null);

  console.log("\nT15 deleting an assignment referenced by a transaction");
  let fkBlocked = false;
  try {
    await prisma.deviceAssignment.delete({ where: { id: idA } });
  } catch (error) {
    fkBlocked = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
  }
  check("T15: blocked by the foreign key (P2003)", fkBlocked);
  check("T15: assignment still present", (await assignment(idA)) !== null);

  console.log("\nT16 overlapping registration / sync for the same assignment");
  for (let round = 1; round <= 5; round++) {
    const dev5 = newDevice();
    const idH = randomUUID();
    await bind(dev5, "A", idH);
    const idU = randomUUID();
    const shared = sale({ barber: "B", assignmentId: idU, deviceKey: dev5 });
    const u1 = sale({ barber: "B", assignmentId: idU, deviceKey: dev5 });
    const u2 = sale({ barber: "B", assignmentId: idU, deviceKey: dev5 });
    const results = await Promise.all([sync([shared, u1]), sync([shared, u2]), sync([u1, u2])]);
    check(`T16.${round}: all overlapping syncs 200`, results.every((r) => r.status === 200), results.map((r) => r.status).join(","));
    check(`T16.${round}: exactly one assignment row, revoked`, (await prisma.deviceAssignment.count({ where: { id: idU } })) === 1 && (await assignment(idU))?.revokedAt !== null);
    const active16 = await activeFor(dev5);
    check(`T16.${round}: active binding untouched`, active16.length === 1 && active16[0].id === idH);
    const rows = await prisma.transaction.findMany({ where: { id: { in: [shared.id, u1.id, u2.id] } } });
    check(`T16.${round}: each sale stored once, attributed to B`, rows.length === 3 && rows.every((r) => r.barberId === BARBERS.B.id && r.assignmentId === idU));
  }
  for (let round = 1; round <= 5; round++) {
    const dev6 = newDevice();
    const idV = randomUUID();
    const binds = await Promise.all([bind(dev6, "A", idV), bind(dev6, "A", idV), bind(dev6, "A", idV)]);
    check(`T16.bind.${round}: concurrent identical binds all 200`, binds.every((r) => r.status === 200), binds.map((r) => r.status).join(","));
    const rows = await prisma.deviceAssignment.findMany({ where: { deviceKey: dev6 } });
    check(`T16.bind.${round}: one row, active`, rows.length === 1 && rows[0].id === idV && rows[0].revokedAt === null);

    const dev7 = newDevice();
    const [idJ, idK] = [randomUUID(), randomUUID()];
    const racing = await Promise.all([bind(dev7, "A", idJ), bind(dev7, "B", idK)]);
    check(`T16.bind.${round}: two different concurrent binds both 200`, racing.every((r) => r.status === 200), racing.map((r) => r.status).join(","));
    check(`T16.bind.${round}: exactly one active assignment afterwards`, (await activeFor(dev7)).length === 1);
  }

  console.log("\nInvariant: cashierId for every transaction this run inserted");
  const all = await prisma.transaction.findMany({ where: { id: { in: txIds } } });
  const bad = all.filter((t) => (t.assignmentId ? t.cashierId !== t.barberId : t.cashierId !== null));
  check(`assignment-backed → cashierId = barberId; legacy → null (${all.length} rows)`, bad.length === 0, bad.map((t) => t.id).join(","));

  console.log("\nT17 fresh database: migrations reproduce schema.prisma");
  t17FreshMigration();
}

/**
 * Applies prisma/migrations to a scratch database and diffs it against schema.prisma.
 * Creating a database needs more than the app user's privileges, so this uses
 * TEST_ADMIN_DATABASE_URL (any database path; only host and credentials are used).
 */
function t17FreshMigration() {
  const base = process.env.TEST_ADMIN_DATABASE_URL;
  if (!base) {
    check("T17: SKIPPED — set TEST_ADMIN_DATABASE_URL to a user that can CREATE DATABASE", false);
    return;
  }
  const scratchName = `ruzzco_migtest_${RUN}`;
  const scratch = new URL(base);
  scratch.pathname = `/${scratchName}`;
  const scratchUrl = scratch.toString();
  // Run the Prisma CLI through node (no shell), so the URL is never parsed by cmd.exe.
  const prismaCli = "node_modules/prisma/build/index.js";
  const run = (args: string[], env: NodeJS.ProcessEnv = process.env, input?: string) =>
    execFileSync(process.execPath, [prismaCli, ...args], { env, input, stdio: "pipe", encoding: "utf8" });
  try {
    run(["migrate", "deploy"], { ...process.env, DATABASE_URL: scratchUrl });
    check("T17: migrate deploy on an empty database succeeded", true);
    let diffEmpty = false;
    try {
      run(["migrate", "diff", "--from-url", scratchUrl, "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"]);
      diffEmpty = true;
    } catch {
      diffEmpty = false;
    }
    check("T17: no difference between migrated database and schema.prisma", diffEmpty);
  } catch (error) {
    // Message only; never print the command line (it contains the database URL).
    const stderr = String((error as { stderr?: string }).stderr ?? "").split("\n").find((l) => /error/i.test(l)) ?? "";
    check("T17: migrate deploy on an empty database succeeded", false, stderr.replaceAll(base, "<url>").replaceAll(scratchUrl, "<url>"));
  } finally {
    try {
      run(["db", "execute", "--stdin", "--url", scratchUrl], process.env, `DROP DATABASE IF EXISTS \`${scratchName}\`;`);
    } catch {
      console.log(`  ! could not drop scratch database ${scratchName}; drop it manually`);
    }
  }
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

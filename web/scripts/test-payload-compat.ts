/**
 * Tests that every sale shape a phone may still have queued passes the sync schema
 * (src/lib/schemas.ts). No server or database needed.
 *
 *   npm run test:payload-compat
 *
 * A sale written by an older POS can sit unsynced in Dexie through an upgrade. If a new
 * required field rejects it, it comes back INVALID on every Retry. New fields must stay
 * optional or defaulted; add a fixture here whenever the payload gains one.
 */
import { syncBatchSchema, syncTransactionItemSchema } from "../src/lib/schemas";

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

function expectParses(name: string, payload: Record<string, unknown>, expected: Record<string, unknown> = {}) {
  const result = syncTransactionItemSchema.safeParse(payload);
  if (!result.success) {
    check(name, false, result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    return;
  }
  const data = result.data as Record<string, unknown>;
  const mismatches = Object.entries(expected)
    .filter(([key, value]) => data[key] !== value)
    .map(([key, value]) => `${key}: expected ${String(value)}, got ${String(data[key])}`);
  check(name, mismatches.length === 0, mismatches.join("; "));
}

function expectRejected(name: string, payload: Record<string, unknown>) {
  check(name, !syncTransactionItemSchema.safeParse(payload).success, "parsed but should not");
}

const ids = {
  sale: "11111111-1111-4111-8111-111111111111",
  device: "22222222-2222-4222-8222-222222222222",
  assignment: "33333333-3333-4333-8333-333333333333",
};
const time = "2026-10-01T04:15:00.000Z";

// Defaults a sale gets when it predates the discount/tip/custom-amount fields.
const legacyDefaults = { discountType: "NONE", discountAmount: 0, tipAmount: 0, customAmount: false };

console.log("Historic shapes still parse");

expectParses(
  "Original cash sale (no paymentMethod field)",
  { id: ids.sale, barberId: "barber-1", serviceId: "svc-haircut", totalAmount: 200, transactionTime: time },
  { paymentMethod: "CASH", ...legacyDefaults, listPrice: undefined, amountPaid: undefined }
);

expectParses(
  "Cash sale with paymentMethod",
  { id: ids.sale, barberId: "barber-1", serviceId: "svc-haircut", totalAmount: 200, paymentMethod: "CASH", transactionTime: time },
  { paymentMethod: "CASH", ...legacyDefaults }
);

expectParses(
  "GCash sale with a reference",
  { id: ids.sale, barberId: "barber-1", serviceId: "svc-haircut", totalAmount: 200, paymentMethod: "GCASH", paymentReference: "1234567890", transactionTime: time },
  { paymentMethod: "GCASH", paymentReference: "1234567890", ...legacyDefaults }
);

expectParses(
  "Maya sale with a null reference",
  { id: ids.sale, barberId: "barber-1", serviceId: "svc-haircut", totalAmount: 150, paymentMethod: "MAYA", paymentReference: null, transactionTime: time },
  { paymentMethod: "MAYA", paymentReference: null }
);

expectParses(
  "Device-bound sale before assignments (deviceKey, no assignmentId)",
  { id: ids.sale, barberId: "barber-1", serviceId: "svc-haircut", totalAmount: 200, paymentMethod: "CASH", transactionTime: time, deviceKey: ids.device },
  { deviceKey: ids.device, assignmentId: undefined, ...legacyDefaults }
);

expectParses(
  "Senior/PWD −20% sale from the removed button (PERCENT)",
  {
    id: ids.sale, barberId: "barber-1", serviceId: "svc-haircut", totalAmount: 160,
    listPrice: 200, discountType: "PERCENT", discountAmount: 40, amountPaid: 160, tipAmount: 0,
    customAmount: false, customAmountNote: null, paymentMethod: "CASH", paymentReference: null,
    transactionTime: time, deviceKey: ids.device, assignmentId: ids.assignment,
  },
  { discountType: "PERCENT", discountAmount: 40, listPrice: 200, amountPaid: 160, totalAmount: 160 }
);

expectParses(
  "FIXED discount sale",
  { id: ids.sale, barberId: "barber-1", serviceId: "svc-haircut", totalAmount: 180, listPrice: 200, discountType: "FIXED", discountAmount: 20, amountPaid: 180, transactionTime: time },
  { discountType: "FIXED", discountAmount: 20 }
);

console.log("\nCurrent shape (as lib/sync.ts sends it)");

expectParses(
  "Haircut + tip, assignment-backed",
  {
    id: ids.sale, barberId: "barber-1", serviceId: "svc-haircut", totalAmount: 200,
    listPrice: 200, discountType: "NONE", discountAmount: 0, amountPaid: 200, tipAmount: 20,
    customAmount: false, customAmountNote: null, paymentMethod: "CASH", paymentReference: null,
    transactionTime: time, deviceKey: ids.device, assignmentId: ids.assignment,
  },
  { tipAmount: 20, assignmentId: ids.assignment, deviceKey: ids.device }
);

expectParses(
  "Custom amount with note",
  {
    id: ids.sale, barberId: "barber-1", serviceId: "svc-haircut", totalAmount: 123.46,
    listPrice: 123.46, discountType: "NONE", discountAmount: 0, amountPaid: 123.46, tipAmount: 0,
    customAmount: true, customAmountNote: "POS custom amount", paymentMethod: "CASH", paymentReference: null,
    transactionTime: time, deviceKey: ids.device, assignmentId: ids.assignment,
  },
  { customAmount: true, customAmountNote: "POS custom amount", listPrice: 123.46 }
);

console.log("\nFields the server must not take from the client");

{
  const result = syncTransactionItemSchema.safeParse({
    id: ids.sale, barberId: "barber-1", serviceId: "svc-haircut", totalAmount: 200,
    paymentMethod: "QRPH", paymentStatus: "PAID", transactionTime: time,
  });
  check("QRPH sale parses", result.success);
  check("a client-sent paymentStatus is stripped", result.success && !("paymentStatus" in result.data));
}

{
  const result = syncTransactionItemSchema.safeParse({
    id: ids.sale, barberId: "barber-1", serviceId: "svc-haircut", totalAmount: 200, transactionTime: time,
    commissionRate: 1, cashierId: "someone-else", visitId: "future-field",
  });
  check("unknown fields from a newer client are stripped, not rejected",
    result.success && !("commissionRate" in result.data) && !("cashierId" in result.data) && !("visitId" in result.data));
}

console.log("\nStill rejected (the schema is not just permissive)");

expectRejected("assignmentId without deviceKey", { id: ids.sale, barberId: "barber-1", serviceId: "svc-haircut", totalAmount: 200, transactionTime: time, assignmentId: ids.assignment });
expectRejected("missing totalAmount", { id: ids.sale, barberId: "barber-1", serviceId: "svc-haircut", transactionTime: time });
expectRejected("zero totalAmount", { id: ids.sale, barberId: "barber-1", serviceId: "svc-haircut", totalAmount: 0, transactionTime: time });
expectRejected("non-UUID id", { id: "sale-1", barberId: "barber-1", serviceId: "svc-haircut", totalAmount: 200, transactionTime: time });
expectRejected("unknown payment method", { id: ids.sale, barberId: "barber-1", serviceId: "svc-haircut", totalAmount: 200, paymentMethod: "PAYPAL", transactionTime: time });

console.log("\nBatch envelope: optional sentAt (L5)");
{
  const one = [{ id: ids.sale, barberId: "barber-1", serviceId: "svc-haircut", totalAmount: 200, transactionTime: time }];
  const old = syncBatchSchema.safeParse({ transactions: one });
  check("a batch without sentAt (older phones, queued payloads) still parses", old.success && old.data.sentAt === undefined);
  const now = syncBatchSchema.safeParse({ transactions: one, sentAt: new Date().toISOString() });
  check("a batch with sentAt parses and keeps it", now.success && typeof now.data.sentAt === "string");
  const junk = syncBatchSchema.safeParse({ transactions: one, sentAt: "yesterday-ish" });
  check("an unreadable sentAt is ignored, never a reason to refuse the sales", junk.success && junk.data.sentAt === undefined);
  const wrongType = syncBatchSchema.safeParse({ transactions: one, sentAt: 12345 });
  check("a non-string sentAt is ignored too", wrongType.success && wrongType.data.sentAt === undefined);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}

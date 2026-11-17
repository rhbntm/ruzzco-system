/**
 * Slice 16: the server's price check on a synced sale (src/lib/price-check.ts). Pure: no server,
 * no database. Prices are the shop's price list (src/lib/catalog.ts); amounts are invented.
 *
 *   npm run test:price-check
 */
import { Prisma } from "@prisma/client";
import { checkSalePrice, decimalCentavos, toCentavos, type PriceCheckSale } from "../src/lib/price-check";
import { loyaltyDiscount, priceSale } from "../src/lib/pricing";
import { HAIRCUT_ID, SERVICE_CATALOG } from "../src/lib/catalog";

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

const SHAVE_ID = "10000000-0000-0000-0000-000000000002";
const COLORING_ID = "10000000-0000-0000-0000-000000000004";
const priceOf = (id: string) => {
  const service = SERVICE_CATALOG.find((s) => s.id === id);
  return service ? toCentavos(service.standardPrice) : null;
};

/** A sale as the sync schema hands it to the route (defaults applied), haircut unless overridden. */
function sale(over: Partial<PriceCheckSale> = {}): PriceCheckSale {
  return { serviceId: HAIRCUT_ID, customAmount: false, discountType: "NONE", discountAmount: 0, totalAmount: 250, listPrice: 250, amountPaid: 250, ...over };
}

const run = (s: PriceCheckSale, servicePrice = priceOf(s.serviceId)) => checkSalePrice(s, servicePrice);
const expectOk = (name: string, s: PriceCheckSale, servicePrice?: number | null) => {
  const r = servicePrice === undefined ? run(s) : run(s, servicePrice);
  check(name, r.ok, JSON.stringify(r));
  return r;
};
const expectReason = (name: string, s: PriceCheckSale, reason: "PRICE_MISMATCH" | "INVALID", servicePrice?: number | null) => {
  const r = servicePrice === undefined ? run(s) : run(s, servicePrice);
  check(name, !r.ok && r.reason === reason, JSON.stringify(r));
};
/** An object without the keys whose value is undefined, as JSON would arrive. */
function omit(s: PriceCheckSale, ...keys: ("listPrice" | "amountPaid")[]): PriceCheckSale {
  const copy = { ...s };
  for (const key of keys) delete copy[key];
  return copy;
}

console.log("Edge cases (§2)");
expectReason("1: a men's haircut sent at list ₱500 is PRICE_MISMATCH", sale({ listPrice: 500, totalAmount: 500, amountPaid: 500 }), "PRICE_MISMATCH");
const loyalty = expectOk("2: loyalty sale, list ₱250, ₱125 off, paid ₱125, is recorded", sale({ discountType: "PERCENT", discountAmount: 125, amountPaid: 125, totalAmount: 125 }));
check("2: …stored with list price ₱250 (commission base)", loyalty.ok && loyalty.amounts.listPrice === 250 && loyalty.amounts.amountPaid === 125);
expectReason("3: loyalty discount on Hair coloring is PRICE_MISMATCH", sale({ serviceId: COLORING_ID, listPrice: 500, discountType: "PERCENT", discountAmount: 250, amountPaid: 250, totalAmount: 250 }), "PRICE_MISMATCH");
expectReason("3: a ₱100 discount on a ₱250 haircut is PRICE_MISMATCH", sale({ discountType: "PERCENT", discountAmount: 100, amountPaid: 150, totalAmount: 150 }), "PRICE_MISMATCH");
const custom500 = expectOk("4: a ₱250 haircut sent as a custom ₱500 is recorded", sale({ customAmount: true, listPrice: 500, amountPaid: 500, totalAmount: 500 }));
check("4: …with list price ₱500, the amount typed", custom500.ok && custom500.amounts.listPrice === 500);
const oldest = { serviceId: HAIRCUT_ID, customAmount: false, discountType: "NONE" as const, discountAmount: 0 };
expectReason("6: oldest payload shape (no listPrice, no amountPaid) at the old ₱200 haircut is PRICE_MISMATCH", { ...oldest, totalAmount: 200 }, "PRICE_MISMATCH");
const oldest250 = expectOk("6: the oldest shape at today's ₱250 passes, checked on totalAmount", { ...oldest, totalAmount: 250 });
check("6: …stored list price is totalAmount (₱250)", oldest250.ok && oldest250.amounts.listPrice === 250 && oldest250.amounts.amountPaid === 250);
expectReason("6: a slice-4+ payload queued at ₱200 (listPrice 200) is PRICE_MISMATCH", sale({ listPrice: 200, amountPaid: 200, totalAmount: 200 }), "PRICE_MISMATCH");

console.log("\nDecision 2: amounts must add up, checked on the stored values (no check against itself)");
// Not custom, listPrice and amountPaid sent.
expectReason("not custom, both sent: list ₱250 - ₱0 ≠ paid ₱200", sale({ amountPaid: 200, totalAmount: 200 }), "PRICE_MISMATCH");
expectReason("not custom, both sent: totalAmount ₱300 ≠ paid ₱250", sale({ totalAmount: 300 }), "PRICE_MISMATCH");
expectReason("not custom, both sent: loyalty ₱125 off but paid ₱250", sale({ discountType: "PERCENT", discountAmount: 125, amountPaid: 250, totalAmount: 250 }), "PRICE_MISMATCH");
// Not custom, no amountPaid.
expectReason("not custom, no amountPaid: list ₱250 - ₱0 ≠ totalAmount ₱200", omit(sale({ totalAmount: 200 }), "amountPaid"), "PRICE_MISMATCH");
expectOk("not custom, no amountPaid: list ₱250 - ₱125 loyalty = totalAmount ₱125", omit(sale({ discountType: "PERCENT", discountAmount: 125, totalAmount: 125 }), "amountPaid"));
// Not custom, no listPrice: totalAmount is the list price, so the discount must be 0.
expectReason("not custom, no listPrice: ₱125 loyalty off a ₱250 totalAmount (no amountPaid)", omit(sale({ discountType: "PERCENT", discountAmount: 125 }), "listPrice", "amountPaid"), "PRICE_MISMATCH");
expectReason("not custom, no listPrice: ₱125 off, paid ₱125, totalAmount ₱250", omit(sale({ discountType: "PERCENT", discountAmount: 125, amountPaid: 125 }), "listPrice"), "PRICE_MISMATCH");
expectOk("not custom, no listPrice: totalAmount ₱250 = service price, no discount", omit(sale(), "listPrice"));
// Custom.
expectReason("custom: amountPaid ₱400 with totalAmount ₱300", sale({ customAmount: true, listPrice: 400, amountPaid: 400, totalAmount: 300 }), "PRICE_MISMATCH");
expectReason("custom: a ₱50 discount", sale({ customAmount: true, listPrice: 400, discountType: "PERCENT", discountAmount: 50, amountPaid: 350, totalAmount: 350 }), "PRICE_MISMATCH");
const customIgnoresList = expectOk("custom: the sent listPrice (₱250, an old POS's service price) is ignored", sale({ customAmount: true, listPrice: 250, amountPaid: 400, totalAmount: 400 }));
check("custom: …stored list price is the amount paid ₱400", customIgnoresList.ok && customIgnoresList.amounts.listPrice === 400);
const customNoPaid = expectOk("custom, no amountPaid: totalAmount ₱400 is the amount paid and list price", omit(sale({ customAmount: true, totalAmount: 400 }), "listPrice", "amountPaid"));
check("custom, no amountPaid: …stored 400/400/400", customNoPaid.ok && customNoPaid.amounts.listPrice === 400 && customNoPaid.amounts.amountPaid === 400 && customNoPaid.amounts.totalAmount === 400);

console.log("\nDecision 3: discount shape");
expectReason("FIXED ₱125 off a haircut", sale({ discountType: "FIXED", discountAmount: 125, amountPaid: 125, totalAmount: 125 }), "PRICE_MISMATCH");
expectReason("NONE with ₱125 off", sale({ discountType: "NONE", discountAmount: 125, amountPaid: 125, totalAmount: 125 }), "PRICE_MISMATCH");
expectReason("PERCENT at 20% (the removed Senior/PWD button: ₱50 off ₱250)", sale({ discountType: "PERCENT", discountAmount: 50, amountPaid: 200, totalAmount: 200 }), "PRICE_MISMATCH");
expectReason("loyalty on Shave / Facial / Massage (₱250, ₱125 off)", sale({ serviceId: SHAVE_ID, discountType: "PERCENT", discountAmount: 125, amountPaid: 125, totalAmount: 125 }), "PRICE_MISMATCH");
expectReason("loyalty on a custom ₱250 haircut", sale({ customAmount: true, discountType: "PERCENT", discountAmount: 125, amountPaid: 125, totalAmount: 125 }), "PRICE_MISMATCH");
for (const type of ["NONE", "PERCENT", "FIXED"] as const) {
  expectOk(`a zero discount with type ${type} is fine`, sale({ discountType: type, discountAmount: 0 }));
  expectOk(`a zero discount with type ${type} on a custom amount is fine`, sale({ customAmount: true, discountType: type, discountAmount: 0, amountPaid: 380, totalAmount: 380 }));
}

console.log("\nDecision 7: compared in centavos");
check("₱250 and ₱250.00 (Decimal) are the same centavos", decimalCentavos(new Prisma.Decimal("250.00")) === toCentavos(250) && toCentavos(250.0) === 25000);
expectOk("a haircut checked against the stored Decimal 250.00", sale(), decimalCentavos(new Prisma.Decimal("250.00")));
expectOk("custom 0.1 + 0.2 paid, totalAmount 0.3", sale({ customAmount: true, amountPaid: 0.1 + 0.2, totalAmount: 0.3 }));
expectOk("custom 100.1 vs 100.10000000000001", sale({ customAmount: true, amountPaid: 100.1, totalAmount: 100.10000000000001 }));
expectReason("but one centavo off is a mismatch (custom paid 100.10, total 100.11)", sale({ customAmount: true, amountPaid: 100.1, totalAmount: 100.11 }), "PRICE_MISMATCH");
check("loyaltyDiscount: ₱250 → 125, ₱500 → 250", loyaltyDiscount(250) === 125 && loyaltyDiscount(500) === 250);
// The formula priceSale used before slice 16, unchanged (float Math.round, so 0.05 → 0.02).
const before16 = (list: number) => Math.round(((list * 50) / 100) * 100) / 100;
check("loyaltyDiscount is the pre-slice-16 formula on awkward values", [0.05, 2.01, 99.99, 123.45, 250.01].every((v) => loyaltyDiscount(v) === before16(v)));

console.log("\nUnknown service");
expectReason("an unknown service is INVALID", sale({ serviceId: "no-such-service" }), "INVALID", null);
expectReason("an unknown service on a custom amount is INVALID too", sale({ serviceId: "no-such-service", customAmount: true }), "INVALID", null);

console.log("\nStored amounts are what the route stored before this slice");
const shapes: PriceCheckSale[] = [
  sale(),
  sale({ discountType: "PERCENT", discountAmount: 125, amountPaid: 125, totalAmount: 125 }),
  omit(sale(), "listPrice"),
  omit(sale(), "listPrice", "amountPaid"),
  omit(sale({ discountType: "PERCENT", discountAmount: 125, totalAmount: 125 }), "amountPaid"),
  sale({ customAmount: true, listPrice: 250, amountPaid: 400, totalAmount: 400 }),
  omit(sale({ customAmount: true, totalAmount: 380 }), "listPrice", "amountPaid"),
];
for (const [i, s] of shapes.entries()) {
  // The route before slice 16 (sync/route.ts): amountPaid ?? totalAmount; custom → amountPaid, else listPrice ?? totalAmount.
  const amountPaid = s.amountPaid ?? s.totalAmount;
  const before = { listPrice: s.customAmount ? amountPaid : (s.listPrice ?? s.totalAmount), amountPaid, totalAmount: s.totalAmount };
  const r = run(s);
  check(`shape ${i + 1}: amounts = ${JSON.stringify(before)}`, r.ok && JSON.stringify(r.amounts) === JSON.stringify(before), JSON.stringify(r));
}

console.log("\nCross-check: every sale priceSale() builds passes");
for (const service of SERVICE_CATALOG) {
  for (const loyaltyOn of [false, true]) {
    for (const customInput of ["", "400", "123.45"]) {
      const priced = priceSale({ standardPrice: service.standardPrice, customAmountInput: customInput, tipChoice: "20", customTipInput: "", serviceId: service.id, loyalty: loyaltyOn });
      // As /pos saves it (src/app/pos/page.tsx) and sync.ts sends it.
      const payload: PriceCheckSale = {
        serviceId: service.id, customAmount: priced.isCustomAmount, listPrice: priced.listPrice, totalAmount: priced.amountPaid,
        amountPaid: priced.amountPaid, discountType: priced.discountType, discountAmount: priced.discountAmount,
      };
      const r = run(payload);
      check(`${service.name}, loyalty ${loyaltyOn ? "on" : "off"}, custom ${customInput || "none"}`, r.ok, JSON.stringify({ payload, r }));
    }
  }
}

console.log("\nSlice 23: several services in one sale");
const multi = (ids: string[], over: Partial<PriceCheckSale> = {}) =>
  checkSalePrice(sale({ serviceId: ids[0], serviceIds: ids, ...over }), priceOf);
const two = multi([HAIRCUT_ID, SHAVE_ID], { listPrice: 500, amountPaid: 500, totalAmount: 500 });
check("haircut + shave at ₱500 is recorded, list ₱500 (commission base)", two.ok && two.amounts.listPrice === 500 && two.amounts.amountPaid === 500, JSON.stringify(two));
const twoLoyalty = multi([HAIRCUT_ID, SHAVE_ID], { listPrice: 500, discountType: "PERCENT", discountAmount: 125, amountPaid: 375, totalAmount: 375 });
check("R7: haircut + shave with the card: ₱125 off, paid ₱375, list stays ₱500", twoLoyalty.ok && twoLoyalty.amounts.listPrice === 500 && twoLoyalty.amounts.amountPaid === 375, JSON.stringify(twoLoyalty));
const shaveFirst = multi([SHAVE_ID, HAIRCUT_ID], { listPrice: 500, discountType: "PERCENT", discountAmount: 125, amountPaid: 375, totalAmount: 375 });
check("R7: the haircut need not be first", shaveFirst.ok, JSON.stringify(shaveFirst));
const half = multi([HAIRCUT_ID, SHAVE_ID], { listPrice: 500, discountType: "PERCENT", discountAmount: 250, amountPaid: 250, totalAmount: 250 });
check("R7: 50% of the whole sale is PRICE_MISMATCH", !half.ok && half.reason === "PRICE_MISMATCH", JSON.stringify(half));
const noHaircut = multi([SHAVE_ID, COLORING_ID], { listPrice: 750, discountType: "PERCENT", discountAmount: 125, amountPaid: 625, totalAmount: 625 });
check("R7: a loyalty discount without the haircut is PRICE_MISMATCH", !noHaircut.ok && noHaircut.reason === "PRICE_MISMATCH", JSON.stringify(noHaircut));
const wrongSum = multi([HAIRCUT_ID, SHAVE_ID], { listPrice: 250, amountPaid: 250, totalAmount: 250 });
check("a two-service sale sent at one service's price is PRICE_MISMATCH", !wrongSum.ok && wrongSum.reason === "PRICE_MISMATCH", JSON.stringify(wrongSum));
const customTwo = multi([HAIRCUT_ID, SHAVE_ID], { customAmount: true, listPrice: 400, amountPaid: 400, totalAmount: 400 });
check("R4: a custom amount on two services is PRICE_MISMATCH", !customTwo.ok && customTwo.reason === "PRICE_MISMATCH", JSON.stringify(customTwo));
const customOne = multi([COLORING_ID], { customAmount: true, listPrice: 600, amountPaid: 600, totalAmount: 600 });
check("R4: a custom amount on one service (serviceIds of one) is recorded as before", customOne.ok && customOne.amounts.listPrice === 600, JSON.stringify(customOne));
const twice = multi([HAIRCUT_ID, HAIRCUT_ID], { listPrice: 500, amountPaid: 500, totalAmount: 500 });
check("R6: the same service twice is INVALID", !twice.ok && twice.reason === "INVALID", JSON.stringify(twice));
const unknownAmong = multi([HAIRCUT_ID, "10000000-0000-0000-0000-00000000dead"], { listPrice: 500, amountPaid: 500, totalAmount: 500 });
check("an unknown service among several is INVALID", !unknownAmong.ok && unknownAmong.reason === "INVALID", JSON.stringify(unknownAmong));
const notFirst = checkSalePrice(sale({ serviceId: SHAVE_ID, serviceIds: [HAIRCUT_ID, SHAVE_ID], listPrice: 500, amountPaid: 500, totalAmount: 500 }), priceOf);
check("serviceIds not starting with serviceId is INVALID", !notFirst.ok && notFirst.reason === "INVALID", JSON.stringify(notFirst));
const eleven = Array.from({ length: 11 }, (_, i) => `10000000-0000-0000-0000-0000000001${String(i).padStart(2, "0")}`);
const tooMany = checkSalePrice(sale({ serviceId: eleven[0], serviceIds: eleven, listPrice: 2750, amountPaid: 2750, totalAmount: 2750 }), () => 25000);
check("11 services is INVALID", !tooMany.ok && tooMany.reason === "INVALID", JSON.stringify(tooMany));
const bundle = SERVICE_CATALOG.find((s) => s.standardPrice === 300);
if (bundle) {
  const withBundle = multi([bundle.id, SHAVE_ID], { listPrice: 550, amountPaid: 550, totalAmount: 550 });
  check("a bundle with another service is priced as two menu services", withBundle.ok, JSON.stringify(withBundle));
}

console.log("\nCross-check: every multi-service sale priceSale() builds passes");
for (const ids of [[HAIRCUT_ID, SHAVE_ID], [SHAVE_ID, HAIRCUT_ID], [HAIRCUT_ID, SHAVE_ID, COLORING_ID], [SHAVE_ID, COLORING_ID]]) {
  for (const loyaltyOn of [false, true]) {
    for (const customInput of ["", "999"]) {
      const services = ids.map((id) => ({ id, standardPrice: SERVICE_CATALOG.find((s) => s.id === id)!.standardPrice }));
      const priced = priceSale({ standardPrice: 0, services, customAmountInput: customInput, tipChoice: "NONE", customTipInput: "", loyalty: loyaltyOn });
      const r = checkSalePrice({
        serviceId: ids[0], serviceIds: ids, customAmount: priced.isCustomAmount, listPrice: priced.listPrice,
        totalAmount: priced.amountPaid, amountPaid: priced.amountPaid, discountType: priced.discountType, discountAmount: priced.discountAmount,
      }, priceOf);
      check(`${ids.length} services, loyalty ${loyaltyOn ? "on" : "off"}, custom input "${customInput}": the phone's sale passes`, r.ok && !priced.isCustomAmount, JSON.stringify(r));
    }
  }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}

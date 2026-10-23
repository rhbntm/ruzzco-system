/**
 * Tests POS sale pricing (src/lib/pricing.ts). No server or database needed.
 *
 *   npm run test:pricing
 */
import {
  DEFAULT_CUSTOM_NOTE,
  customNoteError,
  customNoteFor,
  discountLabel,
  loyaltyApplies,
  priceSale,
  type PriceSaleInput,
  type PricedSale,
} from "../src/lib/pricing";
import { HAIRCUT_ID, SERVICE_CATALOG, sortServices } from "../src/lib/catalog";
import { DEFAULT_SERVICES } from "../src/lib/db";

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

const base: PriceSaleInput = { standardPrice: 200, customAmountInput: "", tipChoice: "NONE", customTipInput: "" };

function expectSale(name: string, input: Partial<PriceSaleInput>, expected: Partial<PricedSale>) {
  const actual = priceSale({ ...base, ...input });
  const mismatches = (Object.keys(expected) as (keyof PricedSale)[])
    .filter((key) => actual[key] !== expected[key])
    .map((key) => `${key}: expected ${expected[key]}, got ${actual[key]}`);
  check(name, mismatches.length === 0, mismatches.join("; "));
}

const noDiscount = { discountType: "NONE", discountAmount: 0 } as const;

console.log("Standard prices");
expectSale("Haircut ₱200", {}, { listPrice: 200, amountPaid: 200, tipAmount: 0, isCustomAmount: false, ...noDiscount });
expectSale("Shave & Massage ₱150", { standardPrice: 150 }, { listPrice: 150, amountPaid: 150, isCustomAmount: false, ...noDiscount });
expectSale("Service with centavos keeps its price", { standardPrice: 99.5 }, { listPrice: 99.5, amountPaid: 99.5 });

console.log("\nCustom amount");
expectSale("₱350 replaces the service price", { customAmountInput: "350" }, { listPrice: 350, amountPaid: 350, isCustomAmount: true, ...noDiscount });
expectSale("Lower than list is allowed", { customAmountInput: "120" }, { listPrice: 120, amountPaid: 120, isCustomAmount: true });
expectSale("Surrounding spaces are accepted", { customAmountInput: "  250 " }, { listPrice: 250, isCustomAmount: true });
expectSale("Rounds to centavos", { customAmountInput: "123.456" }, { listPrice: 123.46, amountPaid: 123.46, isCustomAmount: true });
expectSale("Empty falls back to list", { customAmountInput: "" }, { listPrice: 200, isCustomAmount: false });
expectSale("Whitespace only falls back to list", { customAmountInput: "   " }, { listPrice: 200, isCustomAmount: false });
expectSale("Zero falls back to list", { customAmountInput: "0" }, { listPrice: 200, isCustomAmount: false });
expectSale("Negative falls back to list", { customAmountInput: "-50" }, { listPrice: 200, isCustomAmount: false });
expectSale("Text falls back to list", { customAmountInput: "abc" }, { listPrice: 200, isCustomAmount: false });
expectSale("Infinity falls back to list", { customAmountInput: "Infinity" }, { listPrice: 200, isCustomAmount: false });

console.log("\nTips (separate from amount paid)");
expectSale("+₱20", { tipChoice: "20" }, { tipAmount: 20, amountPaid: 200 });
expectSale("+₱50", { tipChoice: "50" }, { tipAmount: 50, amountPaid: 200 });
expectSale("Custom ₱35", { tipChoice: "CUSTOM", customTipInput: "35" }, { tipAmount: 35, amountPaid: 200 });
expectSale("Custom tip rounds to centavos", { tipChoice: "CUSTOM", customTipInput: "10.005" }, { tipAmount: 10.01 });
expectSale("Custom tip empty is 0", { tipChoice: "CUSTOM", customTipInput: "" }, { tipAmount: 0 });
expectSale("Custom tip negative is 0", { tipChoice: "CUSTOM", customTipInput: "-5" }, { tipAmount: 0 });
expectSale("Custom tip text is 0", { tipChoice: "CUSTOM", customTipInput: "abc" }, { tipAmount: 0 });
expectSale("Custom tip Infinity is 0", { tipChoice: "CUSTOM", customTipInput: "Infinity" }, { tipAmount: 0 });
expectSale("Leftover custom tip text ignored when tip is NONE", { tipChoice: "NONE", customTipInput: "35" }, { tipAmount: 0 });
expectSale("Leftover custom tip text ignored when tip is +₱20", { tipChoice: "20", customTipInput: "35" }, { tipAmount: 20 });

console.log("\nCombined");
expectSale("Custom ₱300 + ₱50 tip", { customAmountInput: "300", tipChoice: "50" }, { listPrice: 300, amountPaid: 300, tipAmount: 50, isCustomAmount: true });

console.log("\nLoyalty card (slice 13)");
const haircut = { standardPrice: 250, serviceId: HAIRCUT_ID } as const;
expectSale("Men's haircut with loyalty: list 250, PERCENT, ₱125 off, paid 125", { ...haircut, loyalty: true }, {
  listPrice: 250, discountType: "PERCENT", discountAmount: 125, amountPaid: 125, isLoyalty: true, isCustomAmount: false,
});
expectSale("Men's haircut without loyalty: 250", { ...haircut, loyalty: false }, { listPrice: 250, amountPaid: 250, isLoyalty: false, ...noDiscount });
expectSale("Loyalty is ignored on another service", { standardPrice: 300, serviceId: SERVICE_CATALOG[1].id, loyalty: true }, {
  listPrice: 300, amountPaid: 300, isLoyalty: false, ...noDiscount,
});
expectSale("Loyalty is ignored without a service id", { standardPrice: 250, loyalty: true }, { amountPaid: 250, isLoyalty: false, ...noDiscount });
expectSale("Loyalty is ignored with a custom amount", { ...haircut, loyalty: true, customAmountInput: "300" }, {
  listPrice: 300, amountPaid: 300, isCustomAmount: true, isLoyalty: false, ...noDiscount,
});
expectSale("A tip on a loyalty sale is added in full", { ...haircut, loyalty: true, tipChoice: "50" }, { amountPaid: 125, tipAmount: 50, isLoyalty: true });
check("loyaltyApplies: men's haircut, no custom amount", loyaltyApplies(HAIRCUT_ID, "") && !loyaltyApplies(HAIRCUT_ID, "300") && !loyaltyApplies(SERVICE_CATALOG[2].id, ""));
check("label: loyalty sale", discountLabel({ discountType: "PERCENT", discountAmount: 125, listPrice: 250 }) === "Loyalty 50%");
check("label: an old Senior/PWD sale is not called loyalty", discountLabel({ discountType: "PERCENT", discountAmount: 40, listPrice: 200 }) === "Discount");
check("label: no discount", discountLabel({ discountType: "NONE", discountAmount: 0, listPrice: 250 }) === null && discountLabel({}) === null);

console.log("\nCustom-amount note (slice 13)");
check("an empty note on a custom amount stores the old fixed text", customNoteFor(true, "  ") === DEFAULT_CUSTOM_NOTE && DEFAULT_CUSTOM_NOTE === "POS custom amount");
check("a note is stored trimmed", customNoteFor(true, "  Request barber ") === "Request barber");
check("no custom amount stores no note", customNoteFor(false, "Request barber") === null);
check("100 characters are accepted", customNoteError("x".repeat(100)) === null);
check("101 characters are refused with a message, not cut", /too long: 101 of 100/.test(customNoteError("x".repeat(101)) ?? ""), String(customNoteError("x".repeat(101))));
check("spaces around the note don't count", customNoteError(` ${"x".repeat(100)}  `) === null);

console.log("\nPrice list (slice 13)");
check(
  "four services in the price-list order",
  SERVICE_CATALOG.map((s) => `${s.name} ${s.standardPrice}`).join(" | ") ===
    "Men's haircut 250 | Haircut + Shampoo 300 | Shave / Facial / Massage 250 | Hair coloring 500"
);
check("the haircut and shave keep their ids", SERVICE_CATALOG[0].id.endsWith("0001") && SERVICE_CATALOG[2].id.endsWith("0002"));
check(
  "the phone's offline list matches the seed's list",
  DEFAULT_SERVICES.map((s) => `${s.id} ${s.name} ${s.standardPrice} ${s.isActive}`).join("|") ===
    SERVICE_CATALOG.map((s) => `${s.id} ${s.name} ${s.standardPrice} true`).join("|")
);
{
  // As the server sends them (by price) and with an unknown service: price-list order, unknown last.
  const byPrice = [...SERVICE_CATALOG].sort((a, b) => b.standardPrice - a.standardPrice);
  const sorted = sortServices([{ id: "x", name: "Beard trim", standardPrice: 100 }, ...byPrice]);
  check("services sort into the price-list order, unknown ones last", sorted.map((s) => s.name).join(",") === [...SERVICE_CATALOG.map((s) => s.name), "Beard trim"].join(","));
}

console.log("\nInvariants (the sync route stores these as sent)");
{
  const inputs: Partial<PriceSaleInput>[] = [{}, { standardPrice: 150 }, { customAmountInput: "123.456" }, { customAmountInput: "abc", tipChoice: "CUSTOM", customTipInput: "12.3" }, { ...haircut, loyalty: true }, { standardPrice: 99.99, serviceId: HAIRCUT_ID, loyalty: true }];
  const ok = inputs.every((input) => {
    const sale = priceSale({ ...base, ...input });
    return Math.abs(sale.listPrice - sale.discountAmount - sale.amountPaid) < 0.005 && sale.amountPaid >= 0 && sale.tipAmount >= 0;
  });
  check("listPrice − discountAmount = amountPaid, never negative", ok);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}

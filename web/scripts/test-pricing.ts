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
import { cashQuickAmounts, cashTender, collectedTotal } from "../src/lib/charge";
import { peso } from "../src/lib/peso";
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

console.log("\nCash received and change due (slice 17, never stored)");
{
  const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  check("₱250: exact, then ₱300, ₱500, ₱1,000", same(cashQuickAmounts(250), [250, 300, 500, 1000]), cashQuickAmounts(250).join(","));
  check("₱270: exact, then ₱300, ₱500, ₱1,000", same(cashQuickAmounts(270), [270, 300, 500, 1000]));
  check("₱850: exact, then ₱900, ₱1,000 (no repeats)", same(cashQuickAmounts(850), [850, 900, 1000]));
  check("₱1,000: exact only", same(cashQuickAmounts(1000), [1000]));
  check("₱125: exact, then ₱200, ₱500, ₱1,000", same(cashQuickAmounts(125), [125, 200, 500, 1000]));

  const tender = (total: number, input: string) => cashTender(total, input);
  const exact = tender(270, "");
  check("blank received means exact: change ₱0", exact.status === "ok" && exact.received === 270 && exact.change === 0);
  const more = tender(850, "1000");
  check("₱1,000 for ₱850: change ₱150", more.status === "ok" && more.change === 150);
  const short = tender(270, "200");
  check("₱200 for ₱270: short by ₱70", short.status === "short" && short.short === 70);
  check("not a number is invalid", tender(270, "abc").status === "invalid");
  check("a negative amount is invalid", tender(270, "-5").status === "invalid");
  const centavos = tender(0.3, "0.5");
  check("centavos don't drift: ₱0.50 for ₱0.30 is ₱0.20", centavos.status === "ok" && centavos.change === 0.2, centavos.status === "ok" ? String(centavos.change) : centavos.status);
  const padded = tender(250, "  300 ");
  check("spaces around the amount are ignored", padded.status === "ok" && padded.change === 50);
}

console.log("\nOne total on the phone, and how pesos are written (slice 17b, display only)");
{
  check("₱250.00", peso(250) === "₱250.00", peso(250));
  check("₱1,000.00 has a thousands separator", peso(1000) === "₱1,000.00", peso(1000));
  check("₱1,234,567.89", peso(1234567.89) === "₱1,234,567.89", peso(1234567.89));
  check("₱999.99 has none", peso(999.99) === "₱999.99", peso(999.99));
  check("centavos are rounded, not cut: ₱0.30", peso(0.1 + 0.2) === "₱0.30", peso(0.1 + 0.2));
  check("rounding carries into the thousands: ₱1,000.00", peso(999.999) === "₱1,000.00", peso(999.999));
  check("₱0.00", peso(0) === "₱0.00" && peso(-0.001) === "₱0.00", `${peso(0)} ${peso(-0.001)}`);
  check("a negative amount keeps its sign", peso(-1250.5) === "-₱1,250.50", peso(-1250.5));

  const tipped = collectedTotal({ totalAmount: 250, amountPaid: 250, tipAmount: 20 });
  check("₱250 paid + ₱20 tip is ₱270 collected", tipped.total === 270 && tipped.paid === 250 && tipped.tip === 20);
  const plain = collectedTotal({ totalAmount: 300, amountPaid: 300, tipAmount: 0 });
  check("no tip: collected is the amount paid", plain.total === 300 && plain.tip === 0);
  const loyalty = collectedTotal({ totalAmount: 125, amountPaid: 125, tipAmount: 50 });
  check("loyalty ₱125 + ₱50 tip is ₱175", loyalty.total === 175);
  const old = collectedTotal({ totalAmount: 200 });
  check("a sale saved before tips: its total amount, no tip", old.total === 200 && old.paid === 200 && old.tip === 0);
  const cents = collectedTotal({ totalAmount: 0.1, amountPaid: 0.1, tipAmount: 0.2 });
  check("centavos don't drift: ₱0.10 + ₱0.20 is ₱0.30", cents.total === 0.3, String(cents.total));
  // Same sum as the POS ticket and done screen (amountPaid + tipAmount from priceSale).
  const sale = priceSale({ ...base, ...haircut, tipChoice: "20" });
  check("matches the ticket total for the same sale", collectedTotal({ totalAmount: sale.amountPaid, amountPaid: sale.amountPaid, tipAmount: sale.tipAmount }).total === sale.amountPaid + sale.tipAmount);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}

/**
 * Tests POS sale pricing (src/lib/pricing.ts). No server or database needed.
 *
 *   npm run test:pricing
 */
import { priceSale, type PriceSaleInput, type PricedSale } from "../src/lib/pricing";

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

console.log("\nInvariants (the sync route stores these as sent)");
{
  const inputs: Partial<PriceSaleInput>[] = [{}, { standardPrice: 150 }, { customAmountInput: "123.456" }, { customAmountInput: "abc", tipChoice: "CUSTOM", customTipInput: "12.3" }];
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

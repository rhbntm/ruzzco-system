/**
 * The POS charge sheet (slice 17). Pure: no Dexie, no React. /pos and the tests share it.
 *
 * Nothing here is stored: a sale records the same fields as before slice 17. Cash received and
 * change due are worked out on the phone only, for the barber and the customer.
 */

export type TenderMethod = "CASH" | "GCASH" | "MAYA" | "QRPH";

/**
 * What tapping a payment method in the charge sheet does. No method records a sale on the tap:
 * cash records from the sheet's Record button, GCash and Maya from their QR dialog's Confirm,
 * and QR Ph keeps its own checkout.
 */
export type TenderStep = "cash" | "reference" | "qrph";

export function tenderStep(method: TenderMethod): TenderStep {
  if (method === "QRPH") return "qrph";
  if (method === "GCASH" || method === "MAYA") return "reference";
  return "cash";
}

const toCentavos = (pesos: number) => Math.round(pesos * 100);

/**
 * Cash amounts to offer with one tap: the exact total first, then what a customer usually hands
 * over for it (the next ₱100, the next ₱500, ₱1,000), at most four in all.
 */
export function cashQuickAmounts(total: number): number[] {
  const exact = toCentavos(total) / 100;
  const candidates = [Math.ceil(exact / 100) * 100, Math.ceil(exact / 500) * 500, 1000];
  const above = [...new Set(candidates)].filter((amount) => amount > exact).sort((a, b) => a - b);
  return [exact, ...above].slice(0, 4);
}

export type CashTender =
  | { status: "ok"; received: number; change: number }
  | { status: "short"; received: number; short: number }
  | { status: "invalid" };

/**
 * Cash received against the total. A blank field means the exact amount. Anything that is not a
 * non-negative number is invalid; less than the total is short (the sale can't be recorded yet).
 */
export function cashTender(total: number, receivedInput: string): CashTender {
  const totalC = toCentavos(total);
  const trimmed = receivedInput.trim();
  if (trimmed === "") return { status: "ok", received: totalC / 100, change: 0 };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return { status: "invalid" };
  const receivedC = toCentavos(parsed);
  if (receivedC < totalC) return { status: "short", received: receivedC / 100, short: (totalC - receivedC) / 100 };
  return { status: "ok", received: receivedC / 100, change: (receivedC - totalC) / 100 };
}

/**
 * Prices one POS sale from the checkout inputs. Pure: no Dexie, no React, no server.
 * /pos uses it both for the saved sale and for the on-screen preview, so the two can't disagree.
 *
 * The server snapshots commission from the listPrice this returns, so changes here are money changes:
 * run `npm run test:pricing`.
 */

export type TipChoice = "NONE" | "20" | "50" | "CUSTOM";

export interface PriceSaleInput {
  standardPrice: number;
  customAmountInput: string;
  tipChoice: TipChoice;
  customTipInput: string;
}

export interface PricedSale {
  listPrice: number;
  discountType: "NONE";
  discountAmount: number;
  amountPaid: number;
  tipAmount: number;
  isCustomAmount: boolean;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function priceSale({ standardPrice, customAmountInput, tipChoice, customTipInput }: PriceSaleInput): PricedSale {
  const parsedCustomAmount = Number(customAmountInput);
  const isCustomAmount = customAmountInput.trim().length > 0 && Number.isFinite(parsedCustomAmount) && parsedCustomAmount > 0;
  // A custom amount replaces the service price entirely: list price is the entered amount.
  // The POS offers no discounts (no PWD/senior discount); new sales always record NONE.
  const listPrice = isCustomAmount ? round2(parsedCustomAmount) : standardPrice;
  const amountPaid = round2(Math.max(0, listPrice));
  const parsedCustomTip = Number(customTipInput);
  const tipAmount =
    tipChoice === "20" ? 20
    : tipChoice === "50" ? 50
    : tipChoice === "CUSTOM" && Number.isFinite(parsedCustomTip) && parsedCustomTip >= 0 ? round2(parsedCustomTip)
    : 0;

  return { listPrice, discountType: "NONE", discountAmount: 0, amountPaid, tipAmount, isCustomAmount };
}

/**
 * Prices one POS sale from the checkout inputs. Pure: no Dexie, no React, no server.
 * /pos uses it both for the saved sale and for the on-screen preview, so the two can't disagree.
 *
 * The server snapshots commission from the listPrice this returns, so changes here are money changes:
 * run `npm run test:pricing`.
 */
import { LOYALTY_PERCENT, LOYALTY_SERVICE_ID } from "./catalog";

export type TipChoice = "NONE" | "20" | "50" | "CUSTOM";

export interface PriceSaleInput {
  standardPrice: number;
  customAmountInput: string;
  tipChoice: TipChoice;
  customTipInput: string;
  /** The selected service; loyalty applies to the men's haircut only. */
  serviceId?: string;
  /** "Loyalty card: 50% off" switched on (slice 13). */
  loyalty?: boolean;
}

export interface PricedSale {
  listPrice: number;
  discountType: "NONE" | "PERCENT";
  /** Pesos taken off the list price (the field's meaning since slice 4), not the percent. */
  discountAmount: number;
  amountPaid: number;
  tipAmount: number;
  isCustomAmount: boolean;
  /** True when the loyalty discount was applied. */
  isLoyalty: boolean;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Whether the loyalty switch may apply: men's haircut at its own price (no custom amount). */
export function loyaltyApplies(serviceId: string | undefined, customAmountInput: string): boolean {
  return serviceId === LOYALTY_SERVICE_ID && !isCustomAmountInput(customAmountInput);
}

function isCustomAmountInput(customAmountInput: string) {
  const parsed = Number(customAmountInput);
  return customAmountInput.trim().length > 0 && Number.isFinite(parsed) && parsed > 0;
}

export function priceSale({ standardPrice, customAmountInput, tipChoice, customTipInput, serviceId, loyalty = false }: PriceSaleInput): PricedSale {
  const isCustomAmount = isCustomAmountInput(customAmountInput);
  // A custom amount replaces the service price entirely: list price is the entered amount, no discount.
  const listPrice = isCustomAmount ? round2(Number(customAmountInput)) : standardPrice;
  // The only discount is the loyalty card, on a men's haircut at its own price. Anywhere else
  // the switch is ignored (the POS also hides or disables it there).
  const isLoyalty = loyalty && loyaltyApplies(serviceId, customAmountInput);
  const discountAmount = isLoyalty ? round2((listPrice * LOYALTY_PERCENT) / 100) : 0;
  const amountPaid = round2(Math.max(0, listPrice - discountAmount));
  const parsedCustomTip = Number(customTipInput);
  // Tips are never discounted.
  const tipAmount =
    tipChoice === "20" ? 20
    : tipChoice === "50" ? 50
    : tipChoice === "CUSTOM" && Number.isFinite(parsedCustomTip) && parsedCustomTip >= 0 ? round2(parsedCustomTip)
    : 0;

  return { listPrice, discountType: isLoyalty ? "PERCENT" : "NONE", discountAmount, amountPaid, tipAmount, isCustomAmount, isLoyalty };
}

// ─── Custom-amount note (slice 13) ───────────────────────────────────────────

/** Longest note the POS accepts. The column holds 255; the server refuses longer payloads. */
export const CUSTOM_NOTE_MAX = 100;
/** Stored when a custom amount has no note (the text every custom sale had before slice 13). */
export const DEFAULT_CUSTOM_NOTE = "POS custom amount";

/** A message when the note can't be saved as typed, or null. Never shortens it silently. */
export function customNoteError(note: string): string | null {
  const length = note.trim().length;
  return length > CUSTOM_NOTE_MAX ? `Note is too long: ${length} of ${CUSTOM_NOTE_MAX} characters. Shorten it to record the sale.` : null;
}

/** The note saved with a sale: the trimmed note on a custom amount, the default text when empty, null otherwise. */
export function customNoteFor(isCustomAmount: boolean, note: string): string | null {
  if (!isCustomAmount) return null;
  return note.trim() || DEFAULT_CUSTOM_NOTE;
}

/**
 * The label a sale's discount shows on the POS and the shift log. A loyalty sale is PERCENT with
 * half the list price off; older discounted sales (the removed Senior/PWD button) say "Discount".
 */
export function discountLabel(sale: { discountType?: string | null; discountAmount?: number | null; listPrice?: number | null }): string | null {
  if (!sale.discountType || sale.discountType === "NONE") return null;
  const loyaltyOff = sale.listPrice ? round2((sale.listPrice * LOYALTY_PERCENT) / 100) : null;
  const isLoyalty = sale.discountType === "PERCENT" && loyaltyOff !== null && Math.abs(Number(sale.discountAmount ?? 0) - loyaltyOff) < 0.005;
  return isLoyalty ? `Loyalty ${LOYALTY_PERCENT}%` : "Discount";
}

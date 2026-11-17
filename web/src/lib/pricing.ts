/**
 * Prices one POS sale from the checkout inputs. Pure: no Dexie, no React, no server.
 * /pos uses it both for the saved sale and for the on-screen preview, so the two can't disagree.
 *
 * The server snapshots commission from the listPrice this returns, so changes here are money changes:
 * run `npm run test:pricing`.
 */
import { LOYALTY_PERCENT, LOYALTY_SERVICE_ID } from "./catalog";

export type TipChoice = "NONE" | "20" | "50" | "CUSTOM";

/** One service picked for the sale, at its menu price (pesos). */
export type PricedService = { id: string; standardPrice: number };

export interface PriceSaleInput {
  /** The one service's price, when `services` is not given (one-service callers, older tests). */
  standardPrice: number;
  customAmountInput: string;
  tipChoice: TipChoice;
  customTipInput: string;
  /** The selected service; loyalty applies to the men's haircut only. */
  serviceId?: string;
  /**
   * Slice 23: every service picked, in tap order, each once (R6). When given it replaces
   * `standardPrice`/`serviceId`. With more than one, the custom amount is ignored (R4).
   */
  services?: readonly PricedService[];
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

/**
 * The loyalty card's discount in pesos: LOYALTY_PERCENT of the list price, rounded to the centavo.
 * The one formula for the POS (priceSale, discountLabel) and the server's price check (slice 16),
 * so the two can never round differently.
 */
export function loyaltyDiscount(listPrice: number): number {
  return round2((listPrice * LOYALTY_PERCENT) / 100);
}

/**
 * Whether the loyalty switch may apply: the men's haircut is in the sale at its own price (no
 * custom amount). Slice 23, R4: a custom amount only counts on a one-service sale, so a sale of
 * several services that includes the haircut always qualifies.
 */
export function loyaltyApplies(serviceIds: string | undefined | readonly string[], customAmountInput: string): boolean {
  const ids = typeof serviceIds === "string" ? [serviceIds] : serviceIds ?? [];
  if (!ids.includes(LOYALTY_SERVICE_ID)) return false;
  return ids.length > 1 || !isCustomAmountInput(customAmountInput);
}

function isCustomAmountInput(customAmountInput: string) {
  const parsed = Number(customAmountInput);
  return customAmountInput.trim().length > 0 && Number.isFinite(parsed) && parsed > 0;
}

/** Pesos summed through whole centavos, so ₱250 + ₱250 is exactly ₱500. */
export function sumPrices(prices: readonly number[]): number {
  return prices.reduce((sum, price) => sum + Math.round(price * 100), 0) / 100;
}

/**
 * The loyalty discount of a sale (slice 23, R7): 50% of the men's haircut's menu price, once,
 * whatever else is in the sale; 0 without the haircut. The same function the server's price
 * check uses, so the phone and the server never disagree.
 */
export function loyaltyDiscountFor(services: readonly PricedService[]): number {
  const haircut = services.find((service) => service.id === LOYALTY_SERVICE_ID);
  return haircut ? loyaltyDiscount(haircut.standardPrice) : 0;
}

export function priceSale({ standardPrice, customAmountInput, tipChoice, customTipInput, serviceId, services, loyalty = false }: PriceSaleInput): PricedSale {
  const picked: readonly PricedService[] = services && services.length > 0 ? services : [{ id: serviceId ?? "", standardPrice }];
  const ids = picked.map((service) => service.id);
  // R4: a custom amount only on a one-service sale; with several services it is ignored.
  const isCustomAmount = picked.length === 1 && isCustomAmountInput(customAmountInput);
  // A custom amount replaces the service price entirely: list price is the entered amount, no
  // discount. Otherwise the list price is the sum of the menu prices.
  const listPrice = isCustomAmount ? round2(Number(customAmountInput)) : sumPrices(picked.map((service) => service.standardPrice));
  // The only discount is the loyalty card: half the men's haircut's price (R7). Anywhere else
  // the switch is ignored (the POS also hides or disables it there).
  const isLoyalty = loyalty && !isCustomAmount && ids.includes(LOYALTY_SERVICE_ID);
  const discountAmount = isLoyalty ? loyaltyDiscountFor(picked) : 0;
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
 * half the haircut's price off: half the list price on a one-service sale, half the haircut's
 * stored price on a sale of several services (slice 23). Older discounted sales (the removed
 * Senior/PWD button) say "Discount".
 */
export function discountLabel(sale: {
  discountType?: string | null;
  discountAmount?: number | null;
  listPrice?: number | null;
  serviceIds?: readonly string[] | null;
  servicePrices?: readonly number[] | null;
}): string | null {
  if (!sale.discountType || sale.discountType === "NONE") return null;
  const ids = sale.serviceIds ?? [];
  const prices = sale.servicePrices ?? [];
  const haircutIndex = ids.length > 1 ? ids.indexOf(LOYALTY_SERVICE_ID) : -1;
  const base = haircutIndex >= 0 && prices[haircutIndex] !== undefined ? prices[haircutIndex] : sale.listPrice;
  const loyaltyOff = base ? loyaltyDiscount(base) : null;
  const isLoyalty = sale.discountType === "PERCENT" && loyaltyOff !== null && Math.abs(Number(sale.discountAmount ?? 0) - loyaltyOff) < 0.005;
  return isLoyalty ? `Loyalty ${LOYALTY_PERCENT}%` : "Discount";
}

/**
 * Slice 16: the server's price check on a synced sale. Pure: no Prisma client, no I/O.
 *
 * A sale without a custom amount must carry its service's price as the list price; the only
 * discount is the loyalty discount (half the list price, men's haircut only); and for every sale
 * amountPaid = listPrice - discountAmount and totalAmount = amountPaid. A custom amount skips the
 * list-price check (its list price is the amount typed). The server never replaces a price with
 * its own, because commission is snapshotted from the list price: a sale that fails is rejected.
 *
 * Everything is compared in whole centavos, so ₱250 and ₱250.00 match and floating-point noise
 * never rejects a sale (Decision 7). Run `npm run test:price-check` after any change here.
 */
import type { Prisma } from "@prisma/client";
import { LOYALTY_SERVICE_ID } from "./catalog";
import { loyaltyDiscount } from "./pricing";

export type PriceCheckSale = {
  serviceId: string;
  customAmount: boolean;
  listPrice?: number;
  totalAmount: number;
  amountPaid?: number;
  discountType: "NONE" | "PERCENT" | "FIXED";
  discountAmount: number;
};

/** The values the server stores for the sale: what is checked is what is stored. */
export type StoredAmounts = { listPrice: number; amountPaid: number; totalAmount: number };

export type PriceCheckResult =
  | { ok: true; amounts: StoredAmounts }
  // `why` is for the server log only, never sent to the phone.
  | { ok: false; reason: "INVALID" | "PRICE_MISMATCH"; why: string };

/** Pesos as whole centavos. */
export const toCentavos = (pesos: number) => Math.round(pesos * 100);

/** A stored price (Decimal(10,2), e.g. services.standard_price) as whole centavos. */
export const decimalCentavos = (value: Prisma.Decimal) => value.mul(100).toDecimalPlaces(0).toNumber();

const peso = (centavos: number) => (centavos / 100).toFixed(2);

/**
 * @param servicePrice the sale's service's standardPrice in centavos, active or not; null when
 *   the service doesn't exist (INVALID, custom amount or not).
 */
export function checkSalePrice(sale: PriceCheckSale, servicePrice: number | null): PriceCheckResult {
  if (servicePrice === null) return { ok: false, reason: "INVALID", why: `unknown service ${sale.serviceId}` };

  // The stored values, worked out once exactly as the sync route always has (Decision 2): the
  // amount paid falls back to totalAmount (payloads older than slice 4); a custom sale's list
  // price is its amount paid (its sent listPrice is ignored: a POS before 2026-09-24 sent the
  // service price there); otherwise the sent listPrice, else totalAmount.
  const amountPaid = sale.amountPaid ?? sale.totalAmount;
  const listPrice = sale.customAmount ? amountPaid : (sale.listPrice ?? sale.totalAmount);
  const amounts: StoredAmounts = { listPrice, amountPaid, totalAmount: sale.totalAmount };

  const list = toCentavos(listPrice);
  const paid = toCentavos(amountPaid);
  const total = toCentavos(sale.totalAmount);
  const discount = toCentavos(sale.discountAmount);
  const mismatch = (why: string): PriceCheckResult => ({ ok: false, reason: "PRICE_MISMATCH", why });

  if (!sale.customAmount && list !== servicePrice) {
    return mismatch(`list price ${peso(list)} is not the service price ${peso(servicePrice)}`);
  }

  // A zero discount is fine with any type (old payloads default to NONE). Anything else must be
  // exactly the loyalty discount (Decision 3).
  if (discount > 0) {
    if (sale.customAmount) return mismatch(`discount ${peso(discount)} on a custom amount`);
    if (sale.discountType !== "PERCENT") return mismatch(`discount type ${sale.discountType} with ${peso(discount)} off`);
    if (sale.serviceId !== LOYALTY_SERVICE_ID) return mismatch(`loyalty discount on service ${sale.serviceId}`);
    const loyalty = toCentavos(loyaltyDiscount(listPrice));
    if (discount !== loyalty) return mismatch(`discount ${peso(discount)} is not the loyalty discount ${peso(loyalty)}`);
  }

  if (list - discount !== paid) {
    return mismatch(`list ${peso(list)} - discount ${peso(discount)} is not the amount paid ${peso(paid)}`);
  }
  if (total !== paid) return mismatch(`totalAmount ${peso(total)} is not the amount paid ${peso(paid)}`);

  return { ok: true, amounts };
}

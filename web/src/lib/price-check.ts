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
  /** Slice 23: every service of the sale, `serviceId` first. Absent on older payloads: [serviceId]. */
  serviceIds?: string[];
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

/** Most services one sale may hold (slice 23); the menu has fewer. */
export const MAX_SALE_SERVICES = 10;

/** A sale's services, `serviceId` first; [serviceId] for a payload older than slice 23. */
export function saleServiceIds(sale: { serviceId: string; serviceIds?: string[] }): string[] {
  return sale.serviceIds && sale.serviceIds.length > 0 ? sale.serviceIds : [sale.serviceId];
}

/**
 * @param servicePrice each service's standardPrice in centavos, active or not, or null when the
 *   service doesn't exist (INVALID, custom amount or not). A number is the one service's price
 *   (one-service callers); a function looks up each of the sale's services.
 */
export function checkSalePrice(sale: PriceCheckSale, servicePrice: number | null | ((serviceId: string) => number | null)): PriceCheckResult {
  const ids = saleServiceIds(sale);
  // Slice 23: the list must start with serviceId, hold 1 to 10 services, and name each once (R6).
  if (ids[0] !== sale.serviceId) return { ok: false, reason: "INVALID", why: "serviceIds does not start with serviceId" };
  if (ids.length > MAX_SALE_SERVICES) return { ok: false, reason: "INVALID", why: `${ids.length} services in one sale` };
  if (new Set(ids).size !== ids.length) return { ok: false, reason: "INVALID", why: "the same service twice in one sale" };
  const priceOf = typeof servicePrice === "function" ? servicePrice : (id: string) => (id === sale.serviceId ? servicePrice : null);
  const prices: number[] = [];
  for (const id of ids) {
    const price = priceOf(id);
    if (price === null) return { ok: false, reason: "INVALID", why: `unknown service ${id}` };
    prices.push(price);
  }
  const menuTotal = prices.reduce((sum, price) => sum + price, 0);

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

  // R4 (slice 23): a custom amount only on a one-service sale.
  if (sale.customAmount && ids.length > 1) return mismatch(`custom amount on a sale of ${ids.length} services`);

  if (!sale.customAmount && list !== menuTotal) {
    return mismatch(`list price ${peso(list)} is not the service price ${peso(menuTotal)}`);
  }

  // A zero discount is fine with any type (old payloads default to NONE). Anything else must be
  // exactly the loyalty discount (Decision 3): half the men's haircut's price, once, whatever
  // else is in the sale (slice 23, R7).
  if (discount > 0) {
    if (sale.customAmount) return mismatch(`discount ${peso(discount)} on a custom amount`);
    if (sale.discountType !== "PERCENT") return mismatch(`discount type ${sale.discountType} with ${peso(discount)} off`);
    const haircut = ids.indexOf(LOYALTY_SERVICE_ID);
    if (haircut === -1) return mismatch(`loyalty discount on service ${sale.serviceId}`);
    const loyalty = toCentavos(loyaltyDiscount(prices[haircut] / 100));
    if (discount !== loyalty) return mismatch(`discount ${peso(discount)} is not the loyalty discount ${peso(loyalty)}`);
  }

  if (list - discount !== paid) {
    return mismatch(`list ${peso(list)} - discount ${peso(discount)} is not the amount paid ${peso(paid)}`);
  }
  if (total !== paid) return mismatch(`totalAmount ${peso(total)} is not the amount paid ${peso(paid)}`);

  return { ok: true, amounts };
}

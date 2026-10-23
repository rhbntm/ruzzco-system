/**
 * The shop's price list (slice 13: Ruzzco's "New Price List", 2026-10-16). Pure data, no Dexie
 * or Prisma, so the seed (prisma/seed.ts), the phone's offline list (DEFAULT_SERVICES) and the
 * tests all read the same names, prices and order.
 *
 * Ids are fixed: past sales point at them, so a service is renamed or repriced in place.
 * The order here is the POS order.
 */

export const HAIRCUT_ID = "10000000-0000-0000-0000-000000000001";

export const SERVICE_CATALOG = [
  { id: HAIRCUT_ID, name: "Men's haircut", standardPrice: 250 },
  { id: "10000000-0000-0000-0000-000000000003", name: "Haircut + Shampoo", standardPrice: 300 },
  // Was "Shave & Massage" (₱150); renamed in place so its past sales keep pointing at it.
  { id: "10000000-0000-0000-0000-000000000002", name: "Shave / Facial / Massage", standardPrice: 250 },
  // The price varies with color and hair length; the barber enters a custom amount when it differs.
  { id: "10000000-0000-0000-0000-000000000004", name: "Hair coloring", standardPrice: 500 },
] as const;

/** The loyalty card applies to a regular men's haircut only (Brent, 2026-10-23). */
export const LOYALTY_SERVICE_ID = HAIRCUT_ID;
export const LOYALTY_PERCENT = 50;

/**
 * Services in the price-list order. The server sends them by price and the phone's cache
 * returns them by id, so /pos sorts them here. Services not on the list go last, by name.
 */
export function sortServices<T extends { id: string; name: string }>(services: readonly T[]): T[] {
  const rank = new Map<string, number>(SERVICE_CATALOG.map((service, index) => [service.id, index]));
  return [...services].sort((a, b) => {
    const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return ra - rb || a.name.localeCompare(b.name);
  });
}

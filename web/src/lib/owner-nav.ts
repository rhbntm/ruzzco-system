/**
 * The owner's menu (slice 21, Decision 4): one list for the sidebar and the phone menu. Pure, so
 * `npm run test:nav` reads it without a browser. It never holds /pos or /shift-log: an owner
 * session records no sale, and the shift log is the phone's own list.
 */
export type OwnerNavItem = { href: string; label: string };

export const OWNER_NAV: readonly OwnerNavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/sales", label: "Sales" },
  { href: "/ledger", label: "Barber Ledger" },
  { href: "/reconciliation", label: "End-of-Day Cash" },
  { href: "/insights", label: "Insights" },
  { href: "/forecast", label: "Forecast" },
  { href: "/payment-qr", label: "Payment QR" },
  { href: "/devices", label: "Phones" },
  { href: "/staff", label: "Staff accounts" },
  { href: "/about", label: "About" },
];

/** Whether `pathname` is this item's page or under it ("/" matches only itself). */
export function isCurrentNav(pathname: string, href: string): boolean {
  const path = pathname.split(/[?#]/)[0] || "/";
  if (href === "/") return path === "/";
  return path === href || path.startsWith(`${href}/`);
}

/** The menu label of the page being shown, for the top bar. */
export function navTitle(pathname: string): string {
  return OWNER_NAV.find((item) => isCurrentNav(pathname, item.href))?.label ?? "Ruzzco Barbers";
}

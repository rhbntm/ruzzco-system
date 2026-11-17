/**
 * The owner's menu (slice 21, Decision 4): one list for the sidebar and the phone menu. Pure, so
 * `npm run test:nav` reads it without a browser. It never holds /pos or /shift-log: an owner
 * session records no sale, and the shift log is the phone's own list.
 */
export type OwnerNavItem = { href: string; label: string };
export type OwnerNavGroup = { label: string; items: readonly OwnerNavItem[] };

/**
 * Slice 25: the menu in groups. Grouping is presentation only: every page keeps its own route,
 * data, API and owner check. Reports (slice 27) replaced Insights; /insights redirects to /reports.
 */
export const OWNER_NAV_GROUPS: readonly OwnerNavGroup[] = [
  { label: "Overview", items: [{ href: "/", label: "Dashboard" }] },
  {
    label: "Business",
    items: [
      { href: "/sales", label: "Sales" },
      { href: "/reports", label: "Reports" },
      { href: "/forecast", label: "Forecast" },
    ],
  },
  {
    label: "Financial operations",
    items: [
      { href: "/ledger", label: "Payouts" },
      { href: "/reconciliation", label: "End-of-Day Cash" },
    ],
  },
  {
    label: "Team and administration",
    items: [
      { href: "/staff", label: "Staff accounts" },
      { href: "/payment-qr", label: "Payment QR" },
      { href: "/devices", label: "Phones" },
    ],
  },
];

/** Shown beside Lock, at the foot of the menu. */
export const OWNER_NAV_SECONDARY: readonly OwnerNavItem[] = [{ href: "/about", label: "About" }];

/** Every menu item, groups first then the secondary ones: the list the top bar and tests read. */
export const OWNER_NAV: readonly OwnerNavItem[] = [...OWNER_NAV_GROUPS.flatMap((group) => group.items), ...OWNER_NAV_SECONDARY];

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

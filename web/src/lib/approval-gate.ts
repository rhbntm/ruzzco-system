/**
 * Which screen a browser sees in front of a page (slice 19 §7, Decisions 1 and 2). Pure, so
 * `npm run test:approval-gate` runs it without a browser.
 *
 * UI gating only. Approval lives in the phone's localStorage, so only the browser can decide to
 * show the approval screen, and nothing here is proof of anything: every API route still checks
 * the real credentials (device headers, owner session) on every request, and owner pages never
 * send owner data without owner access found on the server.
 *
 * Owner access and device approval never stand in for each other: owner access opens owner pages
 * from any browser but never passes the approval screen on /pos and /shift-log; approval opens
 * no page by itself outside /pos and /shift-log (an approved browser without owner access gets a
 * sign-in screen on `/` and `/about`, the owner sign-in on owner pages).
 *
 * Role rule (slice 19b correction): a BARBER account opens /pos and /shift-log only. That part is
 * enforced on the server (`ownerPageAccess` in lib/owner-access.ts redirects a barber session to
 * /pos from every other page before it renders); `barberMayOpen` states the rule for the tests.
 */

export type GateScreen =
  /** The page itself. On an owner page without owner access it shows its own owner sign-in. */
  | "page"
  /** The approval screen alone (/pos and /shift-log: owners don't sign in there). */
  | "approval"
  /** The approval screen with an "Owner sign-in" link to /login?next=<page>. */
  | "approval-owner-link"
  /** The owner sign-in form: an approved browser on an owner page, without owner access. */
  | "owner-sign-in"
  /** /pos and /shift-log on an approved phone: the barber signs in (SignInGate). */
  | "barber-sign-in"
  /** `/` and `/about` in an approved browser without owner access: barber sign-in (on /pos) or owner sign-in. */
  | "sign-in-choice";

export type GateKind = "open" | "device" | "owner" | "general";

export const DEVICE_PAGES = ["/pos", "/shift-log"] as const;
export const OWNER_PAGES = ["/sales", "/ledger", "/devices", "/payment-qr", "/reconciliation", "/insights", "/forecast", "/staff"] as const;
const OPEN_PAGES = ["/login"] as const;
/** Where a barber session goes from any page it may not open. */
export const BARBER_HOME = "/pos";

function under(pathname: string, page: string) {
  return pathname === page || pathname.startsWith(`${page}/`);
}

/** The path without its query, hash or trailing slash ("/" stays "/"). */
export function normalizePath(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] || "/";
  return path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
}

export function gateKind(pathname: string): GateKind {
  const path = normalizePath(pathname);
  if (OPEN_PAGES.some((p) => under(path, p))) return "open";
  if (DEVICE_PAGES.some((p) => under(path, p))) return "device";
  if (OWNER_PAGES.some((p) => under(path, p))) return "owner";
  // `/`, `/about` and any other page: the rule covers every app page except /login.
  return "general";
}

export function gateScreen({ pathname, approved, ownerAccess }: { pathname: string; approved: boolean; ownerAccess: boolean }): GateScreen {
  switch (gateKind(pathname)) {
    case "open":
      return "page";
    case "device":
      // Owner access is ignored here: an owner session never records or syncs sales.
      return approved ? "barber-sign-in" : "approval";
    case "owner":
      if (ownerAccess) return "page";
      return approved ? "owner-sign-in" : "approval-owner-link";
    case "general":
      if (ownerAccess) return "page";
      return approved ? "sign-in-choice" : "approval-owner-link";
  }
}

/**
 * Pages a BARBER account session may open: /pos and /shift-log (and /login, which signs the owner
 * in). Every other page redirects it to BARBER_HOME on the server.
 */
export function barberMayOpen(pathname: string): boolean {
  const kind = gateKind(pathname);
  return kind === "device" || kind === "open";
}

/** Where "Owner sign-in" on the approval screen goes: /login, back to this page afterwards. */
export function ownerSignInHref(pathname: string): string {
  return `/login?next=${encodeURIComponent(normalizePath(pathname))}`;
}

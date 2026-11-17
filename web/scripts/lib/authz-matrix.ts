/**
 * The authorization matrix of every API route (slice 19 §7.3), as data for `npm run test:authz`.
 * The suite reads `src/app/api` and fails when a route.ts or an exported method has no row here,
 * or a row names a route or method that doesn't exist, so a new handler can't skip the audit.
 *
 * access:
 *   owner           hasOwnerAccess: an active OWNER account session (or the PIN cookie while no
 *                   active owner account exists); 401 OWNER_REQUIRED otherwise
 *   phone           approved-phone headers only (X-Ruzzco-Device + Authorization: Bearer); the
 *                   owner session doesn't count; 401 DEVICE_NOT_APPROVED otherwise
 *   phone-or-owner  approved-phone headers or owner access; 401 otherwise
 *   public          no credential (rate limits, PINs, passwords or cookies of its own; see note)
 *   signature       PayMongo's webhook signature
 */

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Access = "owner" | "phone" | "phone-or-owner" | "public" | "signature";

export type MatrixRow = {
  /** The route's folder under src/app/api, with forward slashes. */
  route: string;
  method: Method;
  access: Access;
  note: string;
};

export const AUTHZ_MATRIX: MatrixRow[] = [
  { route: "v1/transactions/sync", method: "POST", access: "phone", note: "each sale's deviceKey must be the authenticated one" },
  { route: "v1/devices/bind", method: "POST", access: "phone", note: "body key = header key; owner PIN to move a bound phone" },
  { route: "v1/devices/approve", method: "POST", access: "public", note: "owner or approval PIN, devicePinLimiter" },
  { route: "v1/devices/binding", method: "GET", access: "phone-or-owner", note: "S2: the phone with the same key, or the owner" },
  { route: "v1/devices", method: "GET", access: "owner", note: "approved phones" },
  { route: "v1/devices/revoke", method: "POST", access: "owner", note: "readJson" },
  { route: "v1/auth/login", method: "POST", access: "public", note: "password, loginLimiter; phone headers for BARBER; PHONE_ASSIGNED" },
  { route: "v1/auth/logout", method: "POST", access: "public", note: "clears its own cookie; readJson" },
  { route: "v1/auth/session", method: "GET", access: "public", note: "the cookie; phone headers for the offline-account check" },
  { route: "v1/owner/unlock", method: "POST", access: "public", note: "owner PIN, ownerPinLimiter; 409 once an owner account exists (S6)" },
  { route: "v1/owner/lock", method: "POST", access: "public", note: "clears its own cookies; readJson" },
  { route: "v1/users", method: "GET", access: "owner", note: "staff accounts" },
  { route: "v1/users", method: "POST", access: "owner", note: "readJson" },
  { route: "v1/users/[id]", method: "PATCH", access: "owner", note: "readJson" },
  { route: "v1/users/[id]", method: "DELETE", access: "owner", note: "only a deactivated account; no body" },
  { route: "v1/reports/payouts", method: "GET", access: "owner", note: "ledger rows" },
  { route: "v1/reports/payouts", method: "POST", access: "owner", note: "readJson" },
  { route: "v1/reports/reconciliation", method: "GET", access: "owner", note: "day figures and its saved counts (?date), or the latest count of recent dates (?recent=N, slice 26)" },
  { route: "v1/reports/reconciliation", method: "POST", access: "owner", note: "readJson" },
  { route: "v1/reports/sales", method: "GET", access: "owner", note: "slice 22: sales over from/to with filters and pages, read-only" },
  { route: "v1/reports/ledger-summary", method: "GET", access: "owner", note: "day/week/month summary, or from/to (slice 20)" },
  { route: "v1/reports/custom-amounts", method: "GET", access: "owner", note: "slice 16: the day's custom-amount sales (date), or slice 22: a range's (from/to), read-only" },
  { route: "v1/reports/payout-history", method: "GET", access: "owner", note: "slice 20: owed and paid per barber-day over from/to, read-only" },
  { route: "v1/reports/time-review", method: "POST", access: "owner", note: "readJson" },
  { route: "v1/forecast", method: "GET", access: "owner", note: "latest saved forecast" },
  { route: "v1/forecast/refresh", method: "POST", access: "owner", note: "C1: application/json and exactly {}, before the ml-service call" },
  { route: "v1/payment-qrs/[barberId]/[method]", method: "GET", access: "phone-or-owner", note: "S4: owner any barber; a phone only its active assignment's barber (404 otherwise)" },
  { route: "v1/payment-qrs/[barberId]/[method]", method: "PUT", access: "owner", note: "raw image, checked by file signature" },
  { route: "v1/payment-qrs/[barberId]/[method]", method: "DELETE", access: "owner", note: "no body" },
  { route: "v1/payment-qrs", method: "GET", access: "phone-or-owner", note: "S4: owner every barber; a phone only its active assignment's barber" },
  { route: "v1/catalog", method: "GET", access: "phone-or-owner", note: "S3" },
  { route: "v1/payments/qrph", method: "GET", access: "public", note: "says only whether QR Ph is on" },
  { route: "v1/payments/qrph", method: "POST", access: "phone", note: "S1: only the phone that made the sale; readJson" },
  { route: "v1/payments/qrph/check", method: "GET", access: "phone", note: "S1: only the phone that made the sale" },
  { route: "v1/payments/qrph/check", method: "POST", access: "phone", note: "S1: only the phone that made the sale; readJson" },
  { route: "v1/webhooks/paymongo", method: "POST", access: "signature", note: "PayMongo signature" },
  { route: "v1/health", method: "GET", access: "public", note: "barber and service counts only" },
];

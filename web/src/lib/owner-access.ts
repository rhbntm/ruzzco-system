import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const OWNER_COOKIE = "ruzzco_owner_access";

/** How long an owner session lasts; the server checks it, not only the browser. */
export const OWNER_SESSION_MS = 12 * 60 * 60 * 1000;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

// Compares the digests, so two strings of different lengths take the same time as equal ones.
function sameText(a: string, b: string) {
  return timingSafeEqual(Buffer.from(sha256(a)), Buffer.from(sha256(b)));
}

export function ownerPinConfigured() {
  return Boolean(process.env.OWNER_PIN);
}

export function ownerSessionConfigured() {
  return Boolean(process.env.OWNER_PIN && process.env.OWNER_SESSION_SECRET);
}

export function validOwnerPin(pin: string) {
  const configured = process.env.OWNER_PIN;
  if (!configured || !pin) return false;
  return sameText(pin, configured);
}

let warnedSamePins = false;

/**
 * The approval-only PIN (slice 15). Treated as unset when it equals the owner PIN: whoever
 * holds it would then hold the owner PIN, which is the separation it exists for.
 */
function approvalPin() {
  const pin = process.env.DEVICE_APPROVAL_PIN;
  if (!pin) return "";
  if (pin === process.env.OWNER_PIN) {
    if (!warnedSamePins) {
      warnedSamePins = true;
      console.warn("[devices] DEVICE_APPROVAL_PIN equals OWNER_PIN: ignored, only the owner PIN approves phones");
    }
    return "";
  }
  return pin;
}

/** Which PIN this is for approving a phone, or null. The approval PIN opens nothing else. */
export function approvalPinRole(pin: string): "OWNER" | "APPROVER" | null {
  if (!pin) return null;
  if (validOwnerPin(pin)) return "OWNER";
  const approver = approvalPin();
  if (approver && sameText(pin, approver)) return "APPROVER";
  return null;
}

// `<expiresAt>.<HMAC(OWNER_SESSION_SECRET, expiresAt:sha256(OWNER_PIN))>`. Changing the PIN or
// the secret ends every session, and the value reveals nothing about the PIN.
function signature(expiresAt: string) {
  const secret = process.env.OWNER_SESSION_SECRET ?? "";
  const pin = process.env.OWNER_PIN ?? "";
  return createHmac("sha256", secret).update(`${expiresAt}:${sha256(pin)}`).digest("hex");
}

/** A new owner session cookie value, valid for OWNER_SESSION_MS. Empty when not configured. */
export function ownerCookieValue(now = Date.now()) {
  if (!ownerSessionConfigured()) return "";
  const expiresAt = String(now + OWNER_SESSION_MS);
  return `${expiresAt}.${signature(expiresAt)}`;
}

// For server components, which read cookies with `await cookies()` instead of a request.
export function isOwnerCookie(value: string | undefined, now = Date.now()) {
  if (!ownerSessionConfigured() || !value) return false;
  const match = /^(\d{1,16})\.([0-9a-f]{64})$/.exec(value);
  if (!match) return false;
  const [, expiresAt, given] = match;
  if (Number(expiresAt) <= now) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(signature(expiresAt)));
}

export function hasOwnerAccess(request: NextRequest) {
  return isOwnerCookie(request.cookies.get(OWNER_COOKIE)?.value);
}

export function ownerRequiredResponse() {
  return NextResponse.json(
    { success: false, error: "Owner PIN required" },
    { status: 401 }
  );
}

/** The cookie's Secure flag follows the request protocol (the HTTPS gateway sets x-forwarded-proto). */
export function isSecureRequest(request: NextRequest) {
  return request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
}

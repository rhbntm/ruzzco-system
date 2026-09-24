import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const OWNER_COOKIE = "ruzzco_owner_access";

function tokenForPin(pin: string) {
  return createHash("sha256").update(`ruzzco-owner:${pin}`).digest("hex");
}

export function ownerPinConfigured() {
  return Boolean(process.env.OWNER_PIN);
}

export function validOwnerPin(pin: string) {
  const configured = process.env.OWNER_PIN;
  if (!configured || !pin) return false;
  return pin === configured;
}

export function ownerCookieValue() {
  return process.env.OWNER_PIN ? tokenForPin(process.env.OWNER_PIN) : "";
}

export function hasOwnerAccess(request: NextRequest) {
  const expected = ownerCookieValue();
  const actual = request.cookies.get(OWNER_COOKIE)?.value ?? "";
  if (!expected || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export function ownerRequiredResponse() {
  return NextResponse.json(
    { success: false, error: "Owner PIN required" },
    { status: 401 }
  );
}

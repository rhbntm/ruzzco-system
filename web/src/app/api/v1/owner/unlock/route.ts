import { NextRequest, NextResponse } from "next/server";
import { OWNER_COOKIE, OWNER_SESSION_MS, isSecureRequest, ownerCookieValue, ownerSessionConfigured, validOwnerPin } from "@/lib/owner-access";
import { ownerPinLimiter, pinClientKey, tooManyPinsResponse } from "@/lib/pin-attempts";
import { readJson, serverError } from "@/lib/api";
import { SESSION_COOKIE, clearSessionCookie, ownerAccountExists } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // The session is signed with OWNER_SESSION_SECRET: without it no session can be issued.
  if (!ownerSessionConfigured()) {
    return NextResponse.json({ success: false, error: "OWNER_PIN or OWNER_SESSION_SECRET is not configured" }, { status: 503 });
  }

  // Slice 19, Decision 2: once an active owner account exists, the owner signs in with it.
  // Checked before the PIN, and never counted as a wrong PIN.
  try {
    if (await ownerAccountExists()) {
      return NextResponse.json(
        { success: false, code: "OWNER_ACCOUNT_EXISTS", error: "Sign in with your owner account." },
        { status: 409 }
      );
    }
  } catch (error) {
    return serverError("[owner] unlock: account check failed", error);
  }

  // Locked out (too many wrong PINs): refuse before looking at the PIN, and don't count it.
  const client = pinClientKey(request.headers);
  let waitMs: number;
  try {
    waitMs = await ownerPinLimiter.retryAfter(client);
  } catch (error) {
    return serverError("[owner] unlock: limiter unavailable", error);
  }
  if (waitMs > 0) return tooManyPinsResponse(waitMs);

  const body = await readJson(request, "Invalid request");
  if (!body.ok) return body.response;
  const raw = body.data as { pin?: unknown } | null;
  const pin = typeof raw?.pin === "string" ? raw.pin : "";

  if (!validOwnerPin(pin)) {
    try {
      await ownerPinLimiter.recordFailure(client);
    } catch (error) {
      return serverError("[owner] unlock: limiter unavailable", error);
    }
    return NextResponse.json({ success: false, error: "Invalid owner PIN" }, { status: 401 });
  }
  try {
    await ownerPinLimiter.recordSuccess(client);
  } catch (error) {
    return serverError("[owner] unlock: limiter unavailable", error);
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set({
    name: OWNER_COOKIE,
    value: ownerCookieValue(),
    httpOnly: true,
    sameSite: "strict",
    secure: isSecureRequest(request),
    path: "/",
    // The server checks the expiry inside the value too; this only lets the browser drop it.
    maxAge: OWNER_SESSION_MS / 1000,
  });
  // Slice 19 §7.13: an account cookie left in this browser would win over the PIN session (a valid
  // session alone decides). The PIN unlocks only while no owner account exists, so that cookie can
  // only be a barber's: clear it, after the PIN cookie (which stays the first Set-Cookie).
  if (request.cookies.has(SESSION_COOKIE)) clearSessionCookie(response, request);
  return response;
}

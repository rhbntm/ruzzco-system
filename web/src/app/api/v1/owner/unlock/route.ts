import { NextRequest, NextResponse } from "next/server";
import { OWNER_COOKIE, OWNER_SESSION_MS, isSecureRequest, ownerCookieValue, ownerSessionConfigured, validOwnerPin } from "@/lib/owner-access";
import { ownerPinLimiter, pinClientKey, tooManyPinsResponse } from "@/lib/pin-attempts";
import { readJson } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // The session is signed with OWNER_SESSION_SECRET: without it no session can be issued.
  if (!ownerSessionConfigured()) {
    return NextResponse.json({ success: false, error: "OWNER_PIN or OWNER_SESSION_SECRET is not configured" }, { status: 503 });
  }

  // Locked out (too many wrong PINs): refuse before looking at the PIN, and don't count it.
  const client = pinClientKey(request.headers);
  const waitMs = ownerPinLimiter.retryAfter(client);
  if (waitMs > 0) return tooManyPinsResponse(waitMs);

  const body = await readJson(request, "Invalid request");
  if (!body.ok) return body.response;
  const raw = body.data as { pin?: unknown } | null;
  const pin = typeof raw?.pin === "string" ? raw.pin : "";

  if (!validOwnerPin(pin)) {
    ownerPinLimiter.recordFailure(client);
    return NextResponse.json({ success: false, error: "Invalid owner PIN" }, { status: 401 });
  }
  ownerPinLimiter.recordSuccess(client);

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
  return response;
}

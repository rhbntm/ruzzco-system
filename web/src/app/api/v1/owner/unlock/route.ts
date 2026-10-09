import { NextRequest, NextResponse } from "next/server";
import { OWNER_COOKIE, ownerCookieValue, ownerPinConfigured, validOwnerPin } from "@/lib/owner-access";
import { ownerPinLimiter, pinClientKey } from "@/lib/pin-attempts";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!ownerPinConfigured()) {
    return NextResponse.json({ success: false, error: "OWNER_PIN is not configured" }, { status: 503 });
  }

  // Locked out (too many wrong PINs): refuse before looking at the PIN, and don't count it.
  const client = pinClientKey(request.headers);
  const waitMs = ownerPinLimiter.retryAfter(client);
  if (waitMs > 0) {
    const minutes = Math.ceil(waitMs / 60000);
    return NextResponse.json(
      { success: false, error: `Too many wrong PINs. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` },
      { status: 429, headers: { "Retry-After": String(Math.ceil(waitMs / 1000)) } }
    );
  }

  let pin = "";
  try {
    const body = await request.json();
    pin = typeof body?.pin === "string" ? body.pin : "";
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
  }

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
    secure: request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return response;
}

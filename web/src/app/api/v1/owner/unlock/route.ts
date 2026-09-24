import { NextRequest, NextResponse } from "next/server";
import { OWNER_COOKIE, ownerCookieValue, ownerPinConfigured, validOwnerPin } from "@/lib/owner-access";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!ownerPinConfigured()) {
    return NextResponse.json({ success: false, error: "OWNER_PIN is not configured" }, { status: 503 });
  }

  let pin = "";
  try {
    const body = await request.json();
    pin = typeof body?.pin === "string" ? body.pin : "";
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
  }

  if (!validOwnerPin(pin)) {
    return NextResponse.json({ success: false, error: "Invalid owner PIN" }, { status: 401 });
  }

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

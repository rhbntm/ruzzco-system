import { NextRequest, NextResponse } from "next/server";
import { OWNER_COOKIE, isSecureRequest } from "@/lib/owner-access";
import { readJson } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/owner/lock
 * Ends the owner session on this device: clears the cookie. Other devices keep theirs until
 * they expire (12 h) or the PIN or OWNER_SESSION_SECRET changes.
 */
export async function POST(request: NextRequest) {
  const body = await readJson(request, "Invalid request");
  if (!body.ok) return body.response;
  const response = NextResponse.json({ success: true });
  response.cookies.set({
    name: OWNER_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "strict",
    secure: isSecureRequest(request),
    path: "/",
    maxAge: 0,
  });
  return response;
}

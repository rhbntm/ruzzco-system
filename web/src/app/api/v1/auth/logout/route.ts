import { NextRequest, NextResponse } from "next/server";
import { readJson } from "@/lib/api";
import { clearSessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/auth/logout
 * Clears the account session cookie on this device. Signing out on a phone never touches its
 * queued sales: they still sync on the phone's approval.
 */
export async function POST(request: NextRequest) {
  const body = await readJson(request, "Invalid request");
  if (!body.ok) return body.response;
  const response = NextResponse.json({ success: true });
  clearSessionCookie(response, request);
  return response;
}

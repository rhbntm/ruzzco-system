import { NextRequest, NextResponse } from "next/server";
import { serverError } from "@/lib/api";
import { authenticateDevice } from "@/lib/device-auth";
import { accountStateFor, ownerAccountExists, requestSession, type SessionRefusal } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/auth/session[?userId=&passwordChangedAt=]
 * The signed-in account, or 401 with `reason` NONE, EXPIRED, PASSWORD_CHANGED, INACTIVE or
 * SESSION_REPLACED (below).
 * `ownerSignIn` tells the owner sign-in dialog what to ask for: ACCOUNT once an active owner
 * account exists, otherwise PIN (Decision 2).
 *
 * A phone signed in offline has no cookie. It sends the account it holds (`userId`,
 * `passwordChangedAt`) with its approved-phone headers, and learns whether that account's
 * password was reset or the account deactivated meanwhile (Decision 10, case 4).
 *
 * Slice 19 §7.13: when the phone names its account (`userId`) and this browser's valid cookie
 * belongs to another account (the owner signed in here, on another tab or page), the answer is
 * 401 SESSION_REPLACED, and the POS ends its barber session. It says nothing about either account.
 */
export async function GET(request: NextRequest) {
  try {
    const [session, ownerAccount] = await Promise.all([requestSession(request), ownerAccountExists()]);
    const ownerSignIn = ownerAccount ? "ACCOUNT" : "PIN";
    const userId = request.nextUrl.searchParams.get("userId");
    if (session.ok) {
      if (userId !== null && userId !== session.account.id) {
        return NextResponse.json({ success: false, reason: "SESSION_REPLACED", ownerSignIn }, { status: 401 });
      }
      return NextResponse.json({ success: true, account: session.account, expiresAt: new Date(session.expiresAt).toISOString(), ownerSignIn });
    }
    let reason: SessionRefusal = session.reason;
    const changedAt = request.nextUrl.searchParams.get("passwordChangedAt");
    if ((reason === "NONE" || reason === "EXPIRED") && userId && changedAt !== null && (await authenticateDevice(request))) {
      const state = await accountStateFor(userId, changedAt);
      if (state !== "NONE") reason = state;
    }
    return NextResponse.json({ success: false, reason, ownerSignIn }, { status: 401 });
  } catch (error) {
    return serverError("[auth] session check failed", error);
  }
}

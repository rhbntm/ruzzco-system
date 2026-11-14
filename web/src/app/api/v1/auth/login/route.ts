import { NextRequest, NextResponse } from "next/server";
import { readJson, serverError } from "@/lib/api";
import { authenticateDevice } from "@/lib/device-auth";
import { dummyPasswordHash, normalizeUsername, verifyPassword } from "@/lib/passwords";
import { loginLimiter, tooManyLoginsResponse } from "@/lib/pin-attempts";
import { prisma } from "@/lib/prisma";
import { accountUsable, findAccount, sessionCookieValue, sessionExpiry, sessionSecretConfigured, setSessionCookie, toSessionAccount } from "@/lib/session";

export const dynamic = "force-dynamic";

const refuse = (status: number, code: string, error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ success: false, code, error, ...extra }, { status });

/**
 * POST /api/v1/auth/login  { username, password, deviceKey? }
 * Staff sign-in (slice 19). `deviceKey` marks a sign-in on the POS: a BARBER account needs the
 * approved-phone headers (Decision 5) and is refused on a phone assigned to another barber
 * (case 3); an OWNER account is refused there. Nothing is written on a refusal.
 * Signing in never changes attribution, the phone's binding or what lets it sync.
 */
export async function POST(request: NextRequest) {
  // The session is signed with OWNER_SESSION_SECRET: without it no session can be issued.
  if (!sessionSecretConfigured()) {
    return refuse(503, "NOT_CONFIGURED", "OWNER_SESSION_SECRET is not configured");
  }
  const body = await readJson(request, "Invalid request");
  if (!body.ok) return body.response;
  const raw = (body.data ?? {}) as { username?: unknown; password?: unknown; deviceKey?: unknown };
  const typedUsername = typeof raw.username === "string" ? raw.username.trim().toLowerCase().slice(0, 64) : "";
  const password = typeof raw.password === "string" ? raw.password : "";
  const onPos = raw.deviceKey !== undefined && raw.deviceKey !== null;
  if (!typedUsername || !password || password.length > 1024) {
    return refuse(400, "INVALID", "Username and password are required");
  }

  // Locked (too many wrong passwords for this username, or shop-wide): refuse before checking,
  // even the right password, and don't count it.
  const waitMs = loginLimiter.retryAfter(typedUsername);
  if (waitMs > 0) return tooManyLoginsResponse(waitMs);

  try {
    const username = normalizeUsername(typedUsername);
    const user = username ? await findAccount({ username }) : null;
    // Unknown usernames take as long and get the same answer as a wrong password (Decision 6).
    const passwordOk = user?.passwordHash
      ? await verifyPassword(password, user.passwordHash)
      : (await verifyPassword(password, await dummyPasswordHash()), false);
    if (!user || !passwordOk) {
      loginLimiter.recordFailure(typedUsername);
      return refuse(401, "WRONG_PASSWORD", "Wrong username or password.");
    }
    loginLimiter.recordSuccess(typedUsername);

    if (!accountUsable(user)) return refuse(403, "INACTIVE", "This account is deactivated. Ask the owner.");

    let deviceKey: string | null = null;
    if (user.role === "OWNER") {
      if (onPos) return refuse(403, "OWNER_ON_POS", "Owner accounts don't record sales.");
    } else {
      // Decision 5: a barber signs in only on an approved phone.
      deviceKey = await authenticateDevice(request);
      if (!deviceKey || (onPos && raw.deviceKey !== deviceKey)) {
        return refuse(401, "DEVICE_NOT_APPROVED", "This phone isn't approved yet");
      }
      // Case 3: a phone accepts only the barber it is assigned to. Moving it needs the owner PIN.
      const active = await prisma.deviceAssignment.findFirst({
        where: { deviceKey, revokedAt: null },
        select: { barberId: true, barber: { select: { fullName: true } } },
      });
      if (active && active.barberId !== user.barberId) {
        return refuse(403, "PHONE_ASSIGNED", `This phone is assigned to ${active.barber.fullName}.`, { barberName: active.barber.fullName });
      }
    }

    const expiresAt = sessionExpiry(user.role);
    await prisma.user.update({ where: { id: user.id }, data: { lastSignInAt: new Date() } });
    const response = NextResponse.json({
      success: true,
      account: toSessionAccount(user),
      expiresAt: new Date(expiresAt).toISOString(),
    });
    setSessionCookie(response, request, sessionCookieValue(user, expiresAt), expiresAt);
    return response;
  } catch (error) {
    return serverError("[auth] login failed", error);
  }
}

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { manilaToday, parseBusinessDate } from "@/lib/business-date";
import { isSecureRequest } from "@/lib/owner-access";

// Staff account sessions (slice 19, Decision 3). One cookie for both roles:
//   ruzzco_session = <userId>.<expiresAt>.<HMAC(OWNER_SESSION_SECRET, userId:expiresAt:passwordChangedAt)>
// The server checks the signature, the expiry, and that the account (and its barber) is still
// active on every request. A password change or reset ends every session of that account;
// changing OWNER_SESSION_SECRET ends all of them.

export const SESSION_COOKIE = "ruzzco_session";
/** Owner sessions last 12 hours, like the PIN session (Decision 4). */
export const OWNER_ACCOUNT_SESSION_MS = 12 * 60 * 60 * 1000;

export type SessionAccount = {
  id: string;
  username: string;
  name: string;
  role: "OWNER" | "BARBER" | "CASHIER";
  barberId: string | null;
  barberName: string | null;
  passwordChangedAt: string | null;
};

export type SessionRefusal = "NONE" | "EXPIRED" | "PASSWORD_CHANGED" | "INACTIVE";
export type SessionResult = { ok: true; account: SessionAccount; expiresAt: number } | { ok: false; reason: SessionRefusal };

export function sessionSecretConfigured() {
  return Boolean(process.env.OWNER_SESSION_SECRET);
}

const changedToken = (changedAt: Date | null) => String(changedAt?.getTime() ?? 0);

function signature(userId: string, expiresAt: string, changedAt: Date | null) {
  return createHmac("sha256", process.env.OWNER_SESSION_SECRET ?? "")
    .update(`${userId}:${expiresAt}:${changedToken(changedAt)}`)
    .digest("hex");
}

/** When a new session for this role ends: midnight Manila for a barber, 12 hours for the owner. */
export function sessionExpiry(role: SessionAccount["role"], now = new Date()): number {
  if (role === "OWNER") return now.getTime() + OWNER_ACCOUNT_SESSION_MS;
  return parseBusinessDate(manilaToday(now))!.end.getTime();
}

export function sessionCookieValue(user: { id: string; passwordChangedAt: Date | null }, expiresAt: number) {
  const at = String(expiresAt);
  return `${user.id}.${at}.${signature(user.id, at, user.passwordChangedAt)}`;
}

const accountSelect = {
  id: true,
  name: true,
  username: true,
  passwordHash: true,
  role: true,
  isActive: true,
  passwordChangedAt: true,
  barberId: true,
  barber: { select: { fullName: true, isActive: true } },
} as const;

type AccountRow = {
  id: string;
  name: string;
  username: string | null;
  passwordHash: string | null;
  role: SessionAccount["role"];
  isActive: boolean;
  passwordChangedAt: Date | null;
  barberId: string | null;
  barber: { fullName: string; isActive: boolean } | null;
};

/** An account may sign in and stay signed in: active, has credentials, and (BARBER) an active barber. */
export function accountUsable(user: AccountRow): boolean {
  if (!user.isActive || !user.username || !user.passwordHash) return false;
  if (user.role === "OWNER") return true;
  if (user.role === "BARBER") return Boolean(user.barberId && user.barber?.isActive);
  return false; // CASHIER stays in the enum, unused
}

export function toSessionAccount(user: AccountRow): SessionAccount {
  return {
    id: user.id,
    username: user.username ?? "",
    name: user.name,
    role: user.role,
    barberId: user.barberId,
    barberName: user.barber?.fullName ?? null,
    passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
  };
}

export function findAccount(where: { id: string } | { username: string }) {
  return prisma.user.findUnique({ where, select: accountSelect }) as Promise<AccountRow | null>;
}

/** Checks a cookie value against the database. */
export async function verifySessionCookie(value: string | undefined, now = Date.now()): Promise<SessionResult> {
  if (!value || !sessionSecretConfigured()) return { ok: false, reason: "NONE" };
  const match = /^([0-9A-Za-z-]{1,191})\.(\d{1,16})\.([0-9a-f]{64})$/.exec(value);
  if (!match) return { ok: false, reason: "NONE" };
  const [, userId, expiresAt, given] = match;
  const user = await findAccount({ id: userId });
  if (!user) return { ok: false, reason: "NONE" };
  const expected = signature(userId, expiresAt, user.passwordChangedAt);
  if (!timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    // Signed for an older password: it was changed or reset since this session began.
    const longest = OWNER_ACCOUNT_SESSION_MS + 24 * 60 * 60 * 1000;
    const changedSinceIssue = user.passwordChangedAt && user.passwordChangedAt.getTime() > Number(expiresAt) - longest;
    return { ok: false, reason: changedSinceIssue ? "PASSWORD_CHANGED" : "NONE" };
  }
  if (Number(expiresAt) <= now) return { ok: false, reason: "EXPIRED" };
  if (!accountUsable(user)) return { ok: false, reason: "INACTIVE" };
  return { ok: true, account: toSessionAccount(user), expiresAt: Number(expiresAt) };
}

/**
 * For a phone signed in offline (no cookie): is the account it holds still the one it signed in
 * to? PASSWORD_CHANGED when the server's passwordChangedAt differs, INACTIVE when the account or
 * its barber is deactivated, otherwise NONE (Decision 10, case 4).
 */
export async function accountStateFor(userId: string, passwordChangedAt: string): Promise<SessionRefusal> {
  if (!/^[0-9A-Za-z-]{1,191}$/.test(userId)) return "NONE";
  const user = await findAccount({ id: userId });
  if (!user) return "NONE";
  if (!accountUsable(user)) return "INACTIVE";
  if ((user.passwordChangedAt?.toISOString() ?? "") !== passwordChangedAt) return "PASSWORD_CHANGED";
  return "NONE";
}

/** For route handlers. */
export function requestSession(request: NextRequest): Promise<SessionResult> {
  return verifySessionCookie(request.cookies.get(SESSION_COOKIE)?.value);
}

/** For server components (`cookies()` is async in Next.js 16). */
export async function getSession(): Promise<SessionResult> {
  return verifySessionCookie((await cookies()).get(SESSION_COOKIE)?.value);
}

/** Decision 2: an OWNER account that is active and has a username and a password. */
export async function ownerAccountExists(): Promise<boolean> {
  const count = await prisma.user.count({
    where: { role: "OWNER", isActive: true, username: { not: null }, passwordHash: { not: null } },
  });
  return count > 0;
}

export function setSessionCookie(response: NextResponse, request: NextRequest, value: string, expiresAt: number) {
  response.cookies.set({
    name: SESSION_COOKIE,
    value,
    httpOnly: true,
    sameSite: "strict",
    secure: isSecureRequest(request),
    path: "/",
    // The server checks the expiry inside the value too; this only lets the browser drop it.
    maxAge: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)),
  });
}

export function clearSessionCookie(response: NextResponse, request: NextRequest) {
  response.cookies.set({ name: SESSION_COOKIE, value: "", httpOnly: true, sameSite: "strict", secure: isSecureRequest(request), path: "/", maxAge: 0 });
}

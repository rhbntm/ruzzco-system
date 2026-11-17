import { NextRequest, NextResponse } from "next/server";
import { readJson, serverError } from "@/lib/api";
import { hasOwnerAccess, ownerRequiredResponse } from "@/lib/owner-access";
import { hashPassword, normalizeUsername, passwordProblem, USERNAME_RULE } from "@/lib/passwords";
import { prisma } from "@/lib/prisma";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { loadClassifiedPhones } from "@/lib/phone-data";
import { barberPhoneCounts } from "@/lib/phone-status";
import { staffAccountSelect, toStaffAccount } from "@/lib/staff-accounts";

export const dynamic = "force-dynamic";

const fail = (status: number, code: string, error: string) => NextResponse.json({ success: false, code, error }, { status });

/** GET /api/v1/users (owner only): every account, and the barbers an account can be linked to. */
export async function GET(request: NextRequest) {
  if (!(await hasOwnerAccess(request))) return ownerRequiredResponse();
  try {
    const [users, barbers, { phones }] = await Promise.all([
      prisma.user.findMany({ select: staffAccountSelect, orderBy: [{ role: "asc" }, { name: "asc" }] }),
      prisma.barber.findMany({
        select: { id: true, fullName: true, isActive: true, account: { select: { id: true } } },
        orderBy: { fullName: "asc" },
      }),
      loadClassifiedPhones(),
    ]);
    return NextResponse.json({
      success: true,
      users: users.map(toStaffAccount),
      // Only counts per barber: /devices is where phones are listed and managed.
      barbers: barbers.map((b) => ({
        id: b.id,
        fullName: b.fullName,
        isActive: b.isActive,
        accountId: b.account?.id ?? null,
        phones: barberPhoneCounts(phones, b.id),
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return serverError("[users] list failed", error);
  }
}

/**
 * POST /api/v1/users (owner only)  { name?, username, password, role: OWNER | BARBER, barberId?, commissionRate? }
 * Decision 1: a BARBER account is linked to exactly one barber record, and a barber has at most
 * one account; an OWNER account has none.
 * A BARBER account without `barberId` creates the barber record too, in the same transaction as the
 * account: `name` is the barber's full name and `commissionRate` (a fraction, 0 to 1) is required and
 * stated by the owner, never defaulted here. With a `barberId` a commission rate is refused.
 */
export async function POST(request: NextRequest) {
  if (!(await hasOwnerAccess(request))) return ownerRequiredResponse();
  const body = await readJson(request, "Invalid request");
  if (!body.ok) return body.response;
  const raw = (body.data ?? {}) as Record<string, unknown>;

  const role = raw.role;
  if (role !== "OWNER" && role !== "BARBER") return fail(400, "INVALID", "Role must be OWNER or BARBER");
  const username = normalizeUsername(raw.username);
  if (!username) return fail(400, "INVALID", USERNAME_RULE);
  const problem = passwordProblem(raw.password);
  if (problem) return fail(400, "INVALID", problem);
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (name.length > 100) return fail(400, "INVALID", "Name is longer than 100 characters");

  try {
    let barberId: string | null = null;
    let newBarberRate: number | null = null; // set when this request also creates the barber record
    let displayName = name;
    if (role === "BARBER") {
      if (typeof raw.barberId === "string" && raw.barberId) {
        if (raw.commissionRate !== undefined) return fail(400, "INVALID", "A commission rate is only set when a new barber is created");
        const barber = await prisma.barber.findUnique({
          where: { id: raw.barberId },
          select: { id: true, fullName: true, account: { select: { id: true } } },
        });
        if (!barber) return fail(404, "UNKNOWN_BARBER", "Unknown barber");
        if (barber.account) return fail(409, "BARBER_HAS_ACCOUNT", `${barber.fullName} already has an account`);
        barberId = barber.id;
        displayName ||= barber.fullName;
      } else {
        // A new barber: the owner states the name and the commission rate.
        const rate = raw.commissionRate;
        if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 1 || Math.abs(Math.round(rate * 100) / 100 - rate) > 1e-9) {
          return fail(400, "INVALID", "A new barber needs a commission rate between 0% and 100%");
        }
        newBarberRate = Math.round(rate * 100) / 100;
      }
    } else if ((raw.barberId !== undefined && raw.barberId !== null) || raw.commissionRate !== undefined) {
      return fail(400, "INVALID", "An owner account has no barber");
    }
    if (!displayName) return fail(400, "INVALID", "Name is required");

    const passwordHash = await hashPassword(raw.password as string);
    const accountData = { name: displayName, role, username, passwordHash, passwordChangedAt: new Date(), isActive: true } as const;
    // The barber and its account are made together: a taken username leaves no barber behind.
    const created = newBarberRate !== null
      ? await prisma.$transaction(async (tx) => {
          const barber = await tx.barber.create({ data: { fullName: displayName, commissionRate: newBarberRate, isActive: true }, select: { id: true } });
          return tx.user.create({ data: { ...accountData, barberId: barber.id }, select: staffAccountSelect });
        })
      : await prisma.user.create({ data: { ...accountData, barberId }, select: staffAccountSelect });
    return NextResponse.json({ success: true, user: toStaffAccount(created) }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) return fail(409, "TAKEN", "That username is taken, or that barber already has an account");
    return serverError("[users] create failed", error);
  }
}

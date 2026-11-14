import { NextRequest, NextResponse } from "next/server";
import { readJson, serverError } from "@/lib/api";
import { hasOwnerAccess, ownerRequiredResponse } from "@/lib/owner-access";
import { hashPassword, normalizeUsername, passwordProblem, USERNAME_RULE } from "@/lib/passwords";
import { prisma } from "@/lib/prisma";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { staffAccountSelect, toStaffAccount } from "@/lib/staff-accounts";

export const dynamic = "force-dynamic";

const fail = (status: number, code: string, error: string) => NextResponse.json({ success: false, code, error }, { status });

/** GET /api/v1/users (owner only): every account, and the barbers an account can be linked to. */
export async function GET(request: NextRequest) {
  if (!(await hasOwnerAccess(request))) return ownerRequiredResponse();
  try {
    const [users, barbers] = await Promise.all([
      prisma.user.findMany({ select: staffAccountSelect, orderBy: [{ role: "asc" }, { name: "asc" }] }),
      prisma.barber.findMany({
        select: { id: true, fullName: true, isActive: true, account: { select: { id: true } } },
        orderBy: { fullName: "asc" },
      }),
    ]);
    return NextResponse.json({
      success: true,
      users: users.map(toStaffAccount),
      barbers: barbers.map((b) => ({ id: b.id, fullName: b.fullName, isActive: b.isActive, accountId: b.account?.id ?? null })),
    });
  } catch (error) {
    return serverError("[users] list failed", error);
  }
}

/**
 * POST /api/v1/users (owner only)  { name?, username, password, role: OWNER | BARBER, barberId? }
 * Decision 1: a BARBER account is linked to exactly one barber record, and a barber has at most
 * one account; an OWNER account has none.
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
    let displayName = name;
    if (role === "BARBER") {
      if (typeof raw.barberId !== "string" || !raw.barberId) return fail(400, "INVALID", "A barber account needs a barber");
      const barber = await prisma.barber.findUnique({
        where: { id: raw.barberId },
        select: { id: true, fullName: true, account: { select: { id: true } } },
      });
      if (!barber) return fail(404, "UNKNOWN_BARBER", "Unknown barber");
      if (barber.account) return fail(409, "BARBER_HAS_ACCOUNT", `${barber.fullName} already has an account`);
      barberId = barber.id;
      displayName ||= barber.fullName;
    } else if (raw.barberId !== undefined && raw.barberId !== null) {
      return fail(400, "INVALID", "An owner account has no barber");
    }
    if (!displayName) return fail(400, "INVALID", "Name is required");

    const created = await prisma.user.create({
      data: {
        name: displayName,
        role,
        username,
        passwordHash: await hashPassword(raw.password as string),
        passwordChangedAt: new Date(),
        barberId,
        isActive: true,
      },
      select: staffAccountSelect,
    });
    return NextResponse.json({ success: true, user: toStaffAccount(created) }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) return fail(409, "TAKEN", "That username is taken, or that barber already has an account");
    return serverError("[users] create failed", error);
  }
}

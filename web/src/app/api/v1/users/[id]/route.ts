import { NextRequest, NextResponse } from "next/server";
import { readJson, serverError } from "@/lib/api";
import { hasOwnerAccess, ownerRequiredResponse } from "@/lib/owner-access";
import { hashPassword, normalizeUsername, passwordProblem, USERNAME_RULE } from "@/lib/passwords";
import { prisma } from "@/lib/prisma";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { countOtherOwnerAccounts, staffAccountSelect, toStaffAccount } from "@/lib/staff-accounts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const fail = (status: number, code: string, error: string) => NextResponse.json({ success: false, code, error }, { status });

/**
 * PATCH /api/v1/users/:id (owner only)  { username?, password?, isActive? }
 * Sets a username (accounts made before slice 19 have none), sets or resets the password (which
 * ends every session of the account), deactivates or reactivates. Accounts are never deleted.
 * The last active owner account can't be deactivated (409 LAST_OWNER).
 */
export async function PATCH(request: NextRequest, { params }: Context) {
  if (!(await hasOwnerAccess(request))) return ownerRequiredResponse();
  const { id } = await params;
  const body = await readJson(request, "Invalid request");
  if (!body.ok) return body.response;
  const raw = (body.data ?? {}) as Record<string, unknown>;

  const data: { username?: string; passwordHash?: string; passwordChangedAt?: Date; isActive?: boolean } = {};
  if (raw.username !== undefined) {
    const username = normalizeUsername(raw.username);
    if (!username) return fail(400, "INVALID", USERNAME_RULE);
    data.username = username;
  }
  if (raw.password !== undefined) {
    const problem = passwordProblem(raw.password);
    if (problem) return fail(400, "INVALID", problem);
    data.passwordHash = await hashPassword(raw.password as string);
    data.passwordChangedAt = new Date();
  }
  if (raw.isActive !== undefined) {
    if (typeof raw.isActive !== "boolean") return fail(400, "INVALID", "isActive must be true or false");
    data.isActive = raw.isActive;
  }
  if (Object.keys(data).length === 0) return fail(400, "INVALID", "Nothing to change");

  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id },
        select: { id: true, role: true, isActive: true, username: true, passwordHash: true },
      });
      if (!user) return fail(404, "NOT_FOUND", "Unknown account");
      if (user.role === "CASHIER") return fail(409, "UNSUPPORTED", "Cashier accounts aren't used");
      // Decision 2: once the shop has an active owner account, never leave it without one.
      const isOwnerAccount = user.role === "OWNER" && user.isActive && Boolean(user.username && user.passwordHash);
      if (isOwnerAccount && data.isActive === false && (await countOtherOwnerAccounts(user.id, tx)) === 0) {
        return fail(409, "LAST_OWNER", "This is the last active owner account. Create or reactivate another one first.");
      }
      const updated = await tx.user.update({ where: { id }, data, select: staffAccountSelect });
      return NextResponse.json({ success: true, user: toStaffAccount(updated) });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return fail(409, "TAKEN", "That username is already taken");
    return serverError("[users] update failed", error);
  }
}

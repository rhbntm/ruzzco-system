import { prisma } from "@/lib/prisma";

// Staff accounts page (slice 19, Decision 15). What the owner sees about an account: never the
// password or its hash, only whether one is set.

export const staffAccountSelect = {
  id: true,
  name: true,
  username: true,
  role: true,
  barberId: true,
  barber: { select: { fullName: true, isActive: true } },
  isActive: true,
  passwordHash: true,
  lastSignInAt: true,
} as const;

type Row = {
  id: string;
  name: string;
  username: string | null;
  role: "OWNER" | "BARBER" | "CASHIER";
  barberId: string | null;
  barber: { fullName: string; isActive: boolean } | null;
  isActive: boolean;
  passwordHash: string | null;
  lastSignInAt: Date | null;
};

export function toStaffAccount(row: Row) {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role,
    barberId: row.barberId,
    barberName: row.barber?.fullName ?? null,
    barberActive: row.barber?.isActive ?? null,
    isActive: row.isActive,
    hasPassword: Boolean(row.passwordHash),
    lastSignInAt: row.lastSignInAt?.toISOString() ?? null,
  };
}

export type StaffAccount = ReturnType<typeof toStaffAccount>;

/** Decision 2: active OWNER accounts with a username and a password, other than `exceptId`. */
export function countOtherOwnerAccounts(exceptId: string, client: Pick<typeof prisma, "user"> = prisma) {
  return client.user.count({
    where: { id: { not: exceptId }, role: "OWNER", isActive: true, username: { not: null }, passwordHash: { not: null } },
  });
}

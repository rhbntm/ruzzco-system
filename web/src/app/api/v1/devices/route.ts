import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serverError } from "@/lib/api";
import { hasOwnerAccess, ownerRequiredResponse } from "@/lib/owner-access";
import { loadClassifiedPhones } from "@/lib/phone-data";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/devices[?barber=<id>] (owner): phones with their state, never their secrets.
 * Each phone is "assigned" (approved, current barber `barberId`), "unassigned" (approved, no
 * current barber) or "revoked" (`barberId` = its last barber, history only: revoking does not end
 * an assignment). `?barber=` keeps the phones whose barber is that one. Assignments with no device
 * record are not phones: they come back as `orphanAssignments`, for the owner to see, never cleaned up.
 */
export async function GET(request: NextRequest) {
  if (!(await hasOwnerAccess(request))) return ownerRequiredResponse();
  try {
    const barberFilter = new URL(request.url).searchParams.get("barber");
    const [{ phones, orphans }, barbers] = await Promise.all([
      loadClassifiedPhones(),
      prisma.barber.findMany({ select: { id: true, fullName: true, isActive: true }, orderBy: { fullName: "asc" } }),
    ]);
    const devices = (barberFilter ? phones.filter((p) => p.barberId === barberFilter) : phones).map((p) => ({
      deviceKey: p.deviceKey,
      label: p.label,
      approvedAt: p.approvedAt,
      approvedWith: p.approvedWith,
      revokedAt: p.revokedAt,
      lastSeenAt: p.lastSeenAt,
      state: p.state,
      barberId: p.barberId,
    }));
    const orphanAssignments = barberFilter ? orphans.filter((o) => o.barberId === barberFilter) : orphans;
    return NextResponse.json({ success: true, devices, barbers, orphanAssignments }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return serverError("[GET /api/v1/devices]", error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serverError } from "@/lib/api";
import { authenticateDevice, deviceNotApprovedResponse } from "@/lib/device-auth";
import { hasOwnerAccess } from "@/lib/owner-access";

export const dynamic = "force-dynamic";

// Barbers (names, ids, commission rates) and services. Slice 19 §7 (S3): an approved phone or the
// owner; anyone else gets 401. The POS keeps its cached catalog on a refusal.
export async function GET(request: NextRequest) {
  if (!(await authenticateDevice(request)) && !(await hasOwnerAccess(request))) return deviceNotApprovedResponse();
  try {
    const [barbers, services] = await Promise.all([
      prisma.barber.findMany({
        where: { isActive: true },
        select: {
          id: true,
          fullName: true,
          commissionRate: true,
          isActive: true,
        },
        orderBy: { fullName: "asc" },
      }),
      prisma.service.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          standardPrice: true,
          isActive: true,
        },
        orderBy: { standardPrice: "desc" },
      }),
    ]);

    return NextResponse.json({
      success: true,
      barbers: barbers.map((b) => ({
        ...b,
        commissionRate: Number(b.commissionRate),
      })),
      services: services.map((s) => ({
        ...s,
        standardPrice: Number(s.standardPrice),
      })),
    });
  } catch (error) {
    return serverError("Catalog fetch error:", error, "Failed to fetch catalog");
  }
}

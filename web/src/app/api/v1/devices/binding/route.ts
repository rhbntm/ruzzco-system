import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDevice, deviceNotApprovedResponse } from "@/lib/device-auth";
import { hasOwnerAccess } from "@/lib/owner-access";

/**
 * GET /api/v1/devices/binding?deviceKey=<uuid>
 * Returns the active DeviceAssignment for the given key, or { bound: false }.
 * Used on POS mount to verify the device is still bound server-side.
 *
 * Slice 19 §7 (S2): only that phone (its approved headers, same key) or the owner; anyone else
 * gets 401 with no assignment data.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const deviceKey = searchParams.get("deviceKey");

  if ((await authenticateDevice(request)) !== deviceKey || !deviceKey) {
    if (!(await hasOwnerAccess(request))) return deviceNotApprovedResponse();
  }

  if (!deviceKey) {
    return NextResponse.json(
      { success: false, error: "deviceKey query param is required" },
      { status: 400 }
    );
  }

  try {
    const assignment = await prisma.deviceAssignment.findFirst({
      where: { deviceKey, revokedAt: null },
      select: {
        id: true,
        deviceKey: true,
        barberId: true,
        assignedAt: true,
        barber: {
          select: { id: true, fullName: true, commissionRate: true, isActive: true },
        },
      },
      orderBy: { assignedAt: "desc" },
    });

    if (!assignment || !assignment.barber.isActive) {
      return NextResponse.json({ bound: false });
    }

    return NextResponse.json({
      bound: true,
      assignment: {
        id: assignment.id,
        deviceKey: assignment.deviceKey,
        barberId: assignment.barberId,
        assignedAt: assignment.assignedAt,
      },
      barber: {
        id: assignment.barber.id,
        fullName: assignment.barber.fullName,
        commissionRate: Number(assignment.barber.commissionRate),
        isActive: assignment.barber.isActive,
      },
    });
  } catch (error) {
    console.error("[GET /api/v1/devices/binding]", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

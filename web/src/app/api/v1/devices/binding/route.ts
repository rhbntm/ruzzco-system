import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/v1/devices/binding?deviceKey=<uuid>
 * Returns the active DeviceAssignment for the given key, or { bound: false }.
 * Used on POS mount to verify the device is still bound server-side.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const deviceKey = searchParams.get("deviceKey");

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

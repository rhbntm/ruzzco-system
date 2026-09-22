import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deviceBindSchema } from "@/lib/schemas";

/**
 * POST /api/v1/devices/bind
 * Binds a device key to a barber. Revokes any existing active binding for
 * the same device key before creating a new one.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = deviceBindSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { deviceKey, barberId } = parsed.data;

    // Verify the barber exists and is active
    const barber = await prisma.barber.findFirst({
      where: { id: barberId, isActive: true },
      select: { id: true, fullName: true, commissionRate: true },
    });

    if (!barber) {
      return NextResponse.json(
        { success: false, error: "Barber not found or inactive" },
        { status: 404 }
      );
    }

    // Revoke all existing active bindings for this device key
    await prisma.deviceAssignment.updateMany({
      where: { deviceKey, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    // Create the new binding
    const assignment = await prisma.deviceAssignment.create({
      data: { deviceKey, barberId },
      select: { id: true, deviceKey: true, barberId: true, assignedAt: true },
    });

    return NextResponse.json({
      success: true,
      assignment,
      barber: {
        id: barber.id,
        fullName: barber.fullName,
        commissionRate: Number(barber.commissionRate),
      },
    });
  } catch (error) {
    console.error("[POST /api/v1/devices/bind]", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deviceBindSchema } from "@/lib/schemas";

type AssignmentRow = { id: string; deviceKey: string; barberId: string; assignedAt: Date; revokedAt: Date | null };
type BarberRow = { id: string; fullName: string; commissionRate: Prisma.Decimal; isActive: boolean };

const assignmentSelect = { id: true, deviceKey: true, barberId: true, assignedAt: true, revokedAt: true } as const;
const barberSelect = { id: true, fullName: true, commissionRate: true, isActive: true } as const;

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isWriteConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

function success(assignment: AssignmentRow, barber: BarberRow) {
  return NextResponse.json({
    success: true,
    assignment: {
      id: assignment.id,
      deviceKey: assignment.deviceKey,
      barberId: assignment.barberId,
      assignedAt: assignment.assignedAt,
    },
    barber: {
      id: barber.id,
      fullName: barber.fullName,
      commissionRate: Number(barber.commissionRate),
    },
  });
}

function conflict(code: "ASSIGNMENT_REVOKED" | "ASSIGNMENT_CONFLICT" | "BARBER_INACTIVE", error: string) {
  return NextResponse.json({ success: false, code, error }, { status: 409 });
}

/**
 * An assignment id that already exists is never reactivated or changed: the same
 * binding retried is a no-op, anything else is a conflict.
 */
function respondToExisting(existing: AssignmentRow, deviceKey: string, barber: BarberRow) {
  if (existing.deviceKey !== deviceKey || existing.barberId !== barber.id) {
    return conflict("ASSIGNMENT_CONFLICT", "Assignment id already belongs to a different device or barber");
  }
  if (existing.revokedAt) {
    return conflict("ASSIGNMENT_REVOKED", "Assignment has been revoked. Re-bind the device.");
  }
  if (!barber.isActive) {
    return conflict("BARBER_INACTIVE", "Barber is inactive. Choose another barber.");
  }
  return success(existing, barber);
}

/**
 * POST /api/v1/devices/bind
 * Makes an assignment the device's active binding. This is the only route that
 * creates an ACTIVE assignment; sync can only record historical (revoked) ones.
 *
 * With `assignmentId` (generated on the phone), the call is idempotent by id.
 * Without it (older clients), the server generates the id.
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

    const { deviceKey, barberId, assignmentId } = parsed.data;

    const barber = await prisma.barber.findUnique({ where: { id: barberId }, select: barberSelect });
    if (!barber) {
      return NextResponse.json(
        { success: false, error: "Barber not found or inactive" },
        { status: 404 }
      );
    }

    if (assignmentId) {
      const existing = await prisma.deviceAssignment.findUnique({ where: { id: assignmentId }, select: assignmentSelect });
      if (existing) return respondToExisting(existing, deviceKey, barber);
    }

    if (!barber.isActive) {
      if (!assignmentId) {
        return NextResponse.json(
          { success: false, error: "Barber not found or inactive" },
          { status: 404 }
        );
      }
      // Record the phone's assignment as historical so sales made under it still
      // resolve, but never let it become the device's active binding.
      try {
        await prisma.deviceAssignment.create({
          data: { id: assignmentId, deviceKey, barberId, revokedAt: new Date() },
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const existing = await prisma.deviceAssignment.findUnique({ where: { id: assignmentId }, select: assignmentSelect });
        if (existing && (existing.deviceKey !== deviceKey || existing.barberId !== barberId)) {
          return conflict("ASSIGNMENT_CONFLICT", "Assignment id already belongs to a different device or barber");
        }
      }
      return conflict("BARBER_INACTIVE", "Barber is inactive. Choose another barber.");
    }

    // Revoke the device's current binding and create the new one atomically.
    // Concurrent binds for the same device can deadlock (P2034) or race on the same
    // id (P2002); either way the transaction rolled back, so re-check and retry.
    for (let attempt = 1; ; attempt++) {
      try {
        const assignment = await prisma.$transaction(async (tx) => {
          await tx.deviceAssignment.updateMany({
            where: { deviceKey, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          return tx.deviceAssignment.create({
            data: { ...(assignmentId ? { id: assignmentId } : {}), deviceKey, barberId },
            select: assignmentSelect,
          });
        });
        return success(assignment, barber);
      } catch (error) {
        const retryable = isUniqueViolation(error) || isWriteConflict(error);
        if (!retryable || attempt >= 3) throw error;
        if (assignmentId) {
          const existing = await prisma.deviceAssignment.findUnique({ where: { id: assignmentId }, select: assignmentSelect });
          if (existing) return respondToExisting(existing, deviceKey, barber);
        }
        if (isUniqueViolation(error)) throw error;
      }
    }
  } catch (error) {
    console.error("[POST /api/v1/devices/bind]", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}

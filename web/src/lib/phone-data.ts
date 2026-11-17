import { prisma } from "@/lib/prisma";
import { classifyPhones } from "@/lib/phone-status";

/** Every device record with its state (src/lib/phone-status.ts), plus assignments that have no device record. Read only. */
export async function loadClassifiedPhones() {
  const [devices, assignments] = await Promise.all([
    prisma.device.findMany({
      select: { deviceKey: true, label: true, approvedAt: true, approvedWith: true, revokedAt: true, lastSeenAt: true },
      orderBy: { approvedAt: "desc" },
    }),
    prisma.deviceAssignment.findMany({ select: { id: true, deviceKey: true, barberId: true, assignedAt: true, revokedAt: true } }),
  ]);
  return classifyPhones(devices, assignments);
}

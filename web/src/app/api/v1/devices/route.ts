import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serverError } from "@/lib/api";
import { hasOwnerAccess, ownerRequiredResponse } from "@/lib/owner-access";

export const dynamic = "force-dynamic";

/** GET /api/v1/devices (owner): approved and revoked phones, never their secrets. */
export async function GET(request: NextRequest) {
  if (!hasOwnerAccess(request)) return ownerRequiredResponse();
  try {
    const devices = await prisma.device.findMany({
      select: { deviceKey: true, label: true, approvedAt: true, approvedWith: true, revokedAt: true, lastSeenAt: true },
      orderBy: { approvedAt: "desc" },
    });
    return NextResponse.json({ success: true, devices }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return serverError("[GET /api/v1/devices]", error);
  }
}

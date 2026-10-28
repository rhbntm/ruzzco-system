import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { readJson, serverError } from "@/lib/api";
import { hasOwnerAccess, ownerRequiredResponse } from "@/lib/owner-access";

export const dynamic = "force-dynamic";

const revokeSchema = z.object({ deviceKey: z.string().min(1).max(191) });

/**
 * POST /api/v1/devices/revoke { deviceKey } (owner)
 * A lost or replaced phone: its secret stops working at once. Sales it still holds wait on the
 * phone until it is approved again. Revoking again is a no-op.
 */
export async function POST(request: NextRequest) {
  if (!hasOwnerAccess(request)) return ownerRequiredResponse();
  try {
    const body = await readJson(request, "Invalid request");
    if (!body.ok) return body.response;
    const parsed = revokeSchema.safeParse(body.data);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
    }
    const { deviceKey } = parsed.data;

    const { count } = await prisma.device.updateMany({
      where: { deviceKey, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) {
      const exists = await prisma.device.findUnique({ where: { deviceKey }, select: { deviceKey: true } });
      if (!exists) return NextResponse.json({ success: false, error: "Phone not found" }, { status: 404 });
    } else {
      console.log(`[devices] revoked ${deviceKey}`);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return serverError("[POST /api/v1/devices/revoke]", error);
  }
}

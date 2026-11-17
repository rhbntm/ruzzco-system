import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { readJson, serverError } from "@/lib/api";
import { approvalPinRole, ownerPinConfigured } from "@/lib/owner-access";
import { devicePinLimiter, pinClientKey, tooManyPinsResponse } from "@/lib/pin-attempts";
import { hashDeviceSecret, newDeviceSecret } from "@/lib/device-auth";

export const dynamic = "force-dynamic";

const approveSchema = z.object({
  deviceKey: z.string().uuid("Invalid device key"),
  pin: z.string().max(64),
  label: z.string().trim().max(60, "Label is longer than 60 characters").optional(),
});

/**
 * POST /api/v1/devices/approve { deviceKey, pin, label? }
 * Typed on the phone itself, with the owner PIN or the approval PIN (DEVICE_APPROVAL_PIN).
 * Returns a new secret once; the server keeps only its hash. Approving a phone again (browser
 * data cleared, or revoked earlier) replaces the secret, so the old one stops working, and ends
 * the phone's active barber assignment in the same transaction (the phone must be bound again).
 * There is no list of waiting phones: an unapproved phone writes nothing to the database.
 */
export async function POST(request: NextRequest) {
  if (!ownerPinConfigured()) {
    return NextResponse.json({ success: false, error: "OWNER_PIN is not configured" }, { status: 503 });
  }

  // Locked out: refuse before looking at the PIN, and don't count it.
  const client = pinClientKey(request.headers);
  try {
    const waitMs = await devicePinLimiter.retryAfter(client);
    if (waitMs > 0) return tooManyPinsResponse(waitMs);
    const body = await readJson(request, "Invalid request");
    if (!body.ok) return body.response;
    const parsed = approveSchema.safeParse(body.data);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { deviceKey, pin, label } = parsed.data;

    const role = approvalPinRole(pin);
    if (!role) {
      await devicePinLimiter.recordFailure(client);
      return NextResponse.json({ success: false, error: "Wrong PIN" }, { status: 401 });
    }
    await devicePinLimiter.recordSuccess(client);

    const secret = newDeviceSecret();
    const now = new Date();
    const record = {
      secretHash: hashDeviceSecret(secret),
      approvedAt: now,
      approvedWith: role,
      revokedAt: null,
      ...(label ? { label } : {}),
    };
    // Credential and binding change together. Approving a known phone again replaces its secret AND
    // ends its active barber assignment (history stays: the row is kept with revokedAt set, and the
    // sales made under it still sync to its barber). The phone then finds no active binding on the
    // server, drops its local one and goes through the normal bind (a first bind needs no PIN).
    // A first approval has nothing to end. Revoking a phone (the owner's /revoke) is a separate rule.
    const endedAssignments = await prisma.$transaction(async (tx) => {
      const existing = await tx.device.findUnique({ where: { deviceKey }, select: { deviceKey: true } });
      await tx.device.upsert({
        where: { deviceKey },
        create: { deviceKey, ...record },
        update: record,
      });
      if (!existing) return 0;
      const ended = await tx.deviceAssignment.updateMany({
        where: { deviceKey, revokedAt: null },
        data: { revokedAt: now },
      });
      return ended.count;
    });
    console.log(`[devices] approved ${deviceKey} with ${role}${endedAssignments ? `, ended ${endedAssignments} active assignment(s)` : ""}`);

    return NextResponse.json(
      { success: true, deviceKey, secret, approvedWith: role },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return serverError("[POST /api/v1/devices/approve]", error);
  }
}

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
 * data cleared, or revoked earlier) replaces the secret, so the old one stops working.
 * There is no list of waiting phones: an unapproved phone writes nothing to the database.
 */
export async function POST(request: NextRequest) {
  if (!ownerPinConfigured()) {
    return NextResponse.json({ success: false, error: "OWNER_PIN is not configured" }, { status: 503 });
  }

  // Locked out: refuse before looking at the PIN, and don't count it.
  const client = pinClientKey(request.headers);
  const waitMs = devicePinLimiter.retryAfter(client);
  if (waitMs > 0) return tooManyPinsResponse(waitMs);

  try {
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
      devicePinLimiter.recordFailure(client);
      return NextResponse.json({ success: false, error: "Wrong PIN" }, { status: 401 });
    }
    devicePinLimiter.recordSuccess(client);

    const secret = newDeviceSecret();
    const now = new Date();
    const record = {
      secretHash: hashDeviceSecret(secret),
      approvedAt: now,
      approvedWith: role,
      revokedAt: null,
      ...(label ? { label } : {}),
    };
    await prisma.device.upsert({
      where: { deviceKey },
      create: { deviceKey, ...record },
      update: record,
    });
    console.log(`[devices] approved ${deviceKey} with ${role}`);

    return NextResponse.json(
      { success: true, deviceKey, secret, approvedWith: role },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return serverError("[POST /api/v1/devices/approve]", error);
  }
}

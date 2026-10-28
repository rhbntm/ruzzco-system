import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Approved phones (slice 15). A phone is approved once, with the owner PIN or the approval PIN,
// and gets a random secret. Bind and sync then need the phone's device key and that secret in
// headers; the secret never travels in a sale, so payloads queued by older POS versions still
// validate. Only the secret's sha256 is stored.

export const DEVICE_HEADER = "x-ruzzco-device";

export function hashDeviceSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

/** 32 random bytes, hex. Returned to the phone once; the server keeps only the hash. */
export function newDeviceSecret() {
  return randomBytes(32).toString("hex");
}

/**
 * The device key of an approved, unrevoked phone that sent the matching secret, or null.
 * Updates the phone's last seen time.
 */
export async function authenticateDevice(request: Request): Promise<string | null> {
  const deviceKey = request.headers.get(DEVICE_HEADER)?.trim() ?? "";
  const match = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get("authorization")?.trim() ?? "");
  if (!deviceKey || deviceKey.length > 191 || !match) return null;

  const device = await prisma.device.findUnique({
    where: { deviceKey },
    select: { secretHash: true, revokedAt: true },
  });
  if (!device || device.revokedAt) return null;
  const given = Buffer.from(hashDeviceSecret(match[1]));
  const stored = Buffer.from(device.secretHash);
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) return null;

  // Bookkeeping only: a failed update never refuses the phone.
  await prisma.device
    .update({ where: { deviceKey }, data: { lastSeenAt: new Date() } })
    .catch((error) => console.error("[devices] last seen update failed", error));
  return deviceKey;
}

/** Not a per-sale rejection: the phone keeps its sales queued and sends them once approved. */
export function deviceNotApprovedResponse() {
  return NextResponse.json(
    { success: false, code: "DEVICE_NOT_APPROVED", error: "This phone isn't approved yet" },
    { status: 401 }
  );
}

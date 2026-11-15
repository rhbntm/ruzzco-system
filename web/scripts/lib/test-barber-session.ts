/**
 * A scratch BARBER account signed in through the real route (slice 19), for suites that check an
 * owner route refuses a barber session. The phone must be approved (scripts/lib/test-devices.ts)
 * and not assigned to another barber. Remove it with `cleanup()`.
 */
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/passwords";

export async function createTestBarberSession(
  base: string,
  prisma: Pick<PrismaClient, "user">,
  barberId: string,
  phoneHeaders: Record<string, string>,
  deviceKey: string,
  label = "test"
) {
  const username = `t-${label}-${randomBytes(4).toString("hex")}`.toLowerCase().slice(0, 32);
  const password = randomBytes(12).toString("hex");
  const user = await prisma.user.create({
    data: { name: `Test barber (${label})`, role: "BARBER", barberId, username, passwordHash: await hashPassword(password), passwordChangedAt: new Date() },
    select: { id: true },
  });
  const cleanup = async () => {
    await prisma.user.deleteMany({ where: { id: user.id } });
  };
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { ...phoneHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, deviceKey }),
  });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  if (!res.ok || !cookie.startsWith("ruzzco_session=")) {
    await cleanup();
    throw new Error(`test barber sign-in failed: HTTP ${res.status}`);
  }
  return { id: user.id, cookie, cleanup };
}

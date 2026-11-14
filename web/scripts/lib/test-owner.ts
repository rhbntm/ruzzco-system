/**
 * A scratch owner account for the integration suites (slice 19). Owner routes need an owner
 * account session once one exists, so each suite makes its own: a random username and password,
 * created through Prisma, signed in through the real route (POST /api/v1/auth/login), and removed
 * at the end. While it exists, the PIN unlock answers 409; run the suites one at a time.
 *
 *   const owner = await createTestOwner(BASE, prisma);
 *   fetch(url, { headers: { Cookie: owner.cookie } });
 *   await owner.cleanup();
 */
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { hashPassword } from "../../src/lib/passwords";

export type TestOwner = {
  id: string;
  username: string;
  password: string;
  /** `ruzzco_session=…`, ready for a Cookie header. */
  cookie: string;
  /** Signs in again (e.g. after a password change) and returns the new cookie. */
  signIn: () => Promise<string>;
  cleanup: () => Promise<void>;
};

export async function createTestOwner(base: string, prisma: Pick<PrismaClient, "user">, label = "test"): Promise<TestOwner> {
  const username = `t-${label}-${randomBytes(4).toString("hex")}`.toLowerCase().slice(0, 32);
  const password = randomBytes(12).toString("hex");
  const user = await prisma.user.create({
    data: { name: `Test owner (${label})`, role: "OWNER", username, passwordHash: await hashPassword(password), passwordChangedAt: new Date() },
    select: { id: true },
  });

  async function signIn() {
    const res = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
    if (!res.ok || !cookie.startsWith("ruzzco_session=")) {
      throw new Error(`test owner sign-in failed: HTTP ${res.status}`);
    }
    return cookie;
  }

  let cookie: string;
  try {
    cookie = await signIn();
  } catch (error) {
    await prisma.user.deleteMany({ where: { id: user.id } });
    throw error;
  }

  return {
    id: user.id,
    username,
    password,
    cookie,
    signIn,
    cleanup: async () => {
      await prisma.user.deleteMany({ where: { id: user.id } });
    },
  };
}

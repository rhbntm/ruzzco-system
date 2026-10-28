/**
 * Approved scratch phones for the integration suites (slice 15). Bind and sync need an approved
 * device: each suite approves the device keys it uses through the real route
 * (POST /api/v1/devices/approve, with OWNER_PIN), sends the returned secret in headers, and
 * deletes its `devices` rows at the end.
 *
 *   const devices = createTestDevices(BASE);
 *   await devices.approve(deviceKey);
 *   fetch(url, { headers: devices.headers(deviceKey), ... });
 *   await devices.cleanup(prisma);
 *
 * Correct PINs never count toward the approval route's wrong-PIN limit, so suites can approve
 * as many phones as they need.
 */
import { randomUUID } from "node:crypto";

type DeviceRows = { device: { deleteMany(args: { where: { deviceKey: { in: string[] } } }): Promise<unknown> } };

export function createTestDevices(base: string) {
  const secrets = new Map<string, string>();

  /** Approves a device key (a new one by default) and remembers its secret. Returns the key. */
  async function approve(deviceKey: string = randomUUID(), pin = process.env.OWNER_PIN ?? ""): Promise<string> {
    if (!pin) throw new Error("OWNER_PIN is not set in web/.env");
    const res = await fetch(`${base}/api/v1/devices/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "test-devices" },
      body: JSON.stringify({ deviceKey, pin, label: "test device" }),
    });
    const body = (await res.json().catch(() => null)) as { secret?: string; error?: string } | null;
    if (!res.ok || !body?.secret) {
      throw new Error(`could not approve test device ${deviceKey}: HTTP ${res.status} ${body?.error ?? ""}`);
    }
    secrets.set(deviceKey, body.secret);
    return deviceKey;
  }

  /** JSON headers plus the device's key and secret. Unknown keys get no secret (not approved). */
  function headers(deviceKey: string): Record<string, string> {
    const secret = secrets.get(deviceKey);
    return {
      "Content-Type": "application/json",
      "X-Ruzzco-Device": deviceKey,
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    };
  }

  function secretOf(deviceKey: string) {
    return secrets.get(deviceKey);
  }

  function keys() {
    return [...secrets.keys()];
  }

  /** Deletes every device this helper approved. */
  async function cleanup(prisma: DeviceRows) {
    if (secrets.size === 0) return;
    await prisma.device.deleteMany({ where: { deviceKey: { in: keys() } } });
  }

  return { approve, headers, secretOf, keys, cleanup };
}

export type TestDevices = ReturnType<typeof createTestDevices>;

/**
 * A sync request carries one phone's sales. Splits sales by their deviceKey (sales without one
 * go with `fallbackKey`), keeping the order within each phone.
 */
export function groupByDevice<T extends { deviceKey?: string }>(items: T[], fallbackKey: string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = item.deviceKey ?? fallbackKey;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

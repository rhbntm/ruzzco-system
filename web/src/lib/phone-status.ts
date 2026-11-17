// What a phone is, for the owner pages (/devices and the summary on /staff). Pure: no Prisma.
//
// A device record (devices) says whether a phone is approved or revoked. An assignment record
// (device_assignments) says which barber a phone was bound to. They are different things: revoking
// a phone does NOT end its assignment (so sales still queued on it keep their barber), so an old
// active assignment on a revoked phone says nothing about the phone being usable.
//
//   state "assigned"   : approved, and its current assignment is to `barberId`
//   state "unassigned" : approved, no current assignment (barberId null)
//   state "revoked"    : revoked; `barberId` is the barber of its latest assignment (history only)
//
// An active assignment whose device record doesn't exist is not a phone: it is an orphan, reported
// on its own and never counted as a phone.

export type DeviceRow = {
  deviceKey: string;
  label: string | null;
  approvedAt: Date;
  approvedWith: "OWNER" | "APPROVER";
  revokedAt: Date | null;
  lastSeenAt: Date | null;
};
export type AssignmentRow = { id: string; deviceKey: string; barberId: string; assignedAt: Date; revokedAt: Date | null };

export type PhoneState = "assigned" | "unassigned" | "revoked";
export type ClassifiedPhone = DeviceRow & { state: PhoneState; barberId: string | null };
export type OrphanAssignment = { id: string; barberId: string; assignedAt: Date };

export function classifyPhones(devices: DeviceRow[], assignments: AssignmentRow[]) {
  // Newest first, so the first row seen for a key is its latest assignment.
  const newestFirst = [...assignments].sort((a, b) => b.assignedAt.getTime() - a.assignedAt.getTime());
  const active = new Map<string, AssignmentRow>();
  const latest = new Map<string, AssignmentRow>();
  for (const a of newestFirst) {
    if (!latest.has(a.deviceKey)) latest.set(a.deviceKey, a);
    if (a.revokedAt === null && !active.has(a.deviceKey)) active.set(a.deviceKey, a);
  }

  const known = new Set(devices.map((d) => d.deviceKey));
  const phones: ClassifiedPhone[] = devices.map((device) => {
    if (device.revokedAt) return { ...device, state: "revoked", barberId: latest.get(device.deviceKey)?.barberId ?? null };
    const current = active.get(device.deviceKey);
    return current ? { ...device, state: "assigned", barberId: current.barberId } : { ...device, state: "unassigned", barberId: null };
  });
  const orphans: OrphanAssignment[] = [...active.values()]
    .filter((a) => !known.has(a.deviceKey))
    .map((a) => ({ id: a.id, barberId: a.barberId, assignedAt: a.assignedAt }));
  return { phones, orphans };
}

/** Per barber: approved phones currently assigned to them, and revoked phones last assigned to them (history). */
export function barberPhoneCounts(phones: ClassifiedPhone[], barberId: string) {
  let approved = 0;
  let revoked = 0;
  for (const phone of phones) {
    if (phone.barberId !== barberId) continue;
    if (phone.state === "assigned") approved++;
    else if (phone.state === "revoked") revoked++;
  }
  return { approved, revoked };
}

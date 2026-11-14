import { Prisma, type PayoutEntry } from "@prisma/client";

// Slice 18: payouts to a barber are entries, never edited or deleted. A correction undoes part
// of one entry and is stored negative, so a sum of entries is the amount paid.

const ZERO = new Prisma.Decimal(0);

// What is still to pay for the day, never below zero (paid more than earned stays at 0).
export function remainingToPay(owed: Prisma.Decimal, paid: Prisma.Decimal) {
  return Prisma.Decimal.max(owed.sub(paid), ZERO);
}

// "Additional owed": the day was fully paid when its last entry was saved, and more sales have
// counted on it since (a late sync, a confirmed QR Ph sale, a date review). An ordinary part
// payment is just Remaining. `lastOwedAtEntry` is the owed amount stored on the latest entry,
// or null when the day has no entries.
export function isAdditionalOwed(owed: Prisma.Decimal, paid: Prisma.Decimal, lastOwedAtEntry: Prisma.Decimal | null) {
  if (lastOwedAtEntry === null) return false;
  return owed.gt(paid) && paid.gte(lastOwedAtEntry);
}

type EntryLike = Pick<PayoutEntry, "id" | "kind" | "amount" | "correctsId">;

// How much of an entry is left to correct: its amount minus the corrections that name it.
export function correctableLeft(entry: EntryLike, all: EntryLike[]) {
  if (entry.kind === "CORRECTION") return ZERO;
  const corrected = all
    .filter((e) => e.kind === "CORRECTION" && e.correctsId === entry.id)
    .reduce((sum, e) => sum.add(e.amount), ZERO); // negative amounts
  return Prisma.Decimal.max(entry.amount.add(corrected), ZERO);
}

// The latest entry by time (ties: the order the database returned them, oldest first).
export function lastEntry<T extends Pick<PayoutEntry, "recordedAt">>(entries: T[]) {
  let latest: T | null = null;
  for (const entry of entries) if (!latest || entry.recordedAt >= latest.recordedAt) latest = entry;
  return latest;
}

export function serializeEntry(entry: PayoutEntry, all: PayoutEntry[]) {
  return {
    id: entry.id,
    method: entry.method,
    kind: entry.kind,
    amount: entry.amount.toFixed(2),
    correctsId: entry.correctsId,
    note: entry.note,
    recordedAt: entry.recordedAt.toISOString(),
    correctableLeft: correctableLeft(entry, all).toFixed(2),
  };
}

export type SerializedEntry = ReturnType<typeof serializeEntry>;

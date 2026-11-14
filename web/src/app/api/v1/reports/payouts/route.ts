import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma, type PayoutEntry, type PayoutMethod } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { readJson, serverError } from "@/lib/api";
import { countHeldForReview } from "@/lib/time-review";
import { totalsForDate, type Base, type BarberTotals } from "@/lib/payout-totals";
import { hasOwnerAccess, ownerRequiredResponse } from "@/lib/owner-access";
import { isBusinessDate, manilaToday, parseBusinessDate } from "@/lib/business-date";
import { correctableLeft, isAdditionalOwed, lastEntry, remainingToPay, serializeEntry } from "@/lib/payout-entries";

export const dynamic = "force-dynamic";

const businessDate = z.string().refine(isBusinessDate, "date must be a real calendar date (YYYY-MM-DD)");
const commissionBase = z.enum(["LIST_PRICE", "AMOUNT_PAID"]).default("LIST_PRICE");
const money = z.number().multipleOf(0.01).max(99_999_999.99);

const querySchema = z.object({ date: businessDate, commissionBase });

// Slice 18: one payout entry. The page generates `id`, so a repeated tap or a retry is one entry.
const entrySchema = z
  .object({
    id: z.uuid(),
    date: businessDate,
    barberId: z.string().min(1),
    commissionBase,
    method: z.enum(["CASH", "GCASH"]),
    amount: money.positive(),
    kind: z.enum(["PAYOUT", "CORRECTION"]).default("PAYOUT"),
    correctsId: z.uuid().optional(),
    note: z.string().trim().max(200).optional(),
  })
  .refine((e) => e.kind === "CORRECTION" ? !!e.correctsId && !!e.note : !e.correctsId, {
    message: "A correction needs the entry it corrects and a reason; a payout corrects nothing",
  });

// The body before slice 18: the amounts are the new totals. Each increase becomes an entry;
// a decrease is refused (use a correction); `paid` is ignored (slice 18, Decision 4).
const legacySchema = z.object({
  date: businessDate,
  barberId: z.string().min(1),
  commissionBase,
  cashPaid: money.nonnegative(),
  gcashPaid: money.nonnegative(),
  paid: z.boolean().optional(),
});

// Callers pass dates already validated by the schemas above.
const businessDay = (date: string) => parseBusinessDate(date)!;
const dateValue = (date: string) => businessDay(date).dateValue;
// Business dates compare as strings (YYYY-MM-DD).
const isFuture = (date: string) => date > manilaToday();
const futureResponse = () => NextResponse.json({ success: false, error: "That date has not happened yet" }, { status: 422 });

const ZERO = new Prisma.Decimal(0);
const sum = (entries: Pick<PayoutEntry, "amount">[]) => entries.reduce((total, e) => total.add(e.amount), ZERO);
const sumOf = (entries: Pick<PayoutEntry, "amount" | "method">[], method: PayoutMethod) => sum(entries.filter((e) => e.method === method));

// Refreshes the stored rows with the canonical LIST_PRICE totals, whatever base is viewed.
// A row covers every active barber, plus any barber (active or not) with sales or an
// existing row on this date: isActive limits the roster, never historical earnings.
async function syncLedgerRows(date: string, totals: Map<string, BarberTotals>) {
  const businessDate = dateValue(date);
  const [activeBarbers, existingRows] = await Promise.all([
    prisma.barber.findMany({ where: { isActive: true }, select: { id: true } }),
    prisma.dailyPayoutLedger.findMany({ where: { businessDate }, select: { barberId: true } }),
  ]);
  const barberIds = new Set([
    ...activeBarbers.map((b) => b.id),
    ...totals.keys(),
    ...existingRows.map((r) => r.barberId),
  ]);
  for (const barberId of barberIds) {
    const total = totals.get(barberId);
    const commissionTotal = total?.commission ?? ZERO;
    const tipTotal = total?.tips ?? ZERO;
    const totalOwed = commissionTotal.add(tipTotal);
    // Payment fields (cashPaid, gcashPaid, paidAt) are only written with a new entry.
    await prisma.dailyPayoutLedger.upsert({
      where: { barberId_businessDate: { barberId, businessDate } },
      create: { barberId, businessDate, commissionTotal, tipTotal, totalOwed },
      update: { commissionTotal, tipTotal, totalOwed },
    });
  }
  return prisma.dailyPayoutLedger.findMany({
    where: { businessDate },
    include: { barber: { select: { fullName: true } } },
    orderBy: { barber: { fullName: "asc" } },
  });
}

type Row = {
  id: bigint; barberId: string; businessDate: Date; commissionTotal: Prisma.Decimal; tipTotal: Prisma.Decimal; totalOwed: Prisma.Decimal;
  cashPaid: Prisma.Decimal; gcashPaid: Prisma.Decimal; paidAt: Date | null; barber: { fullName: string };
};

function serializeRow(row: Row, entries: PayoutEntry[], commissionBase: Base, totals: Map<string, BarberTotals>) {
  // LIST_PRICE shows the stored canonical total; AMOUNT_PAID is computed for display only.
  const commission = commissionBase === "LIST_PRICE"
    ? row.commissionTotal
    : totals.get(row.barberId)?.viewCommission ?? ZERO;
  const totalOwed = commission.add(row.tipTotal);
  const paid = row.cashPaid.add(row.gcashPaid);
  return {
    id: Number(row.id),
    barberId: row.barberId,
    barberName: row.barber.fullName,
    businessDate: row.businessDate.toISOString().slice(0, 10),
    commissionTotal: commission.toFixed(2),
    tipTotal: row.tipTotal.toFixed(2),
    totalOwed: totalOwed.toFixed(2),
    cashPaid: row.cashPaid.toFixed(2),
    gcashPaid: row.gcashPaid.toFixed(2),
    paidTotal: paid.toFixed(2),
    remaining: remainingToPay(totalOwed, paid).toFixed(2),
    paidAt: row.paidAt,
    paid: Boolean(row.paidAt), // has at least one entry
    // Against the canonical owed, the amount every entry was checked against.
    additionalOwed: isAdditionalOwed(row.totalOwed, paid, lastEntry(entries)?.owedAtEntry ?? null),
    entries: entries.map((entry) => serializeEntry(entry, entries)),
    commissionBase,
  };
}

export async function GET(request: NextRequest) {
  if (!(await hasOwnerAccess(request))) return ownerRequiredResponse();
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ success: false, error: "date and valid commissionBase are required" }, { status: 400 });
  const { date } = parsed.data;
  if (isFuture(date)) return futureResponse();
  try {
    const totals = await totalsForDate(date, parsed.data.commissionBase);
    const rows = await syncLedgerRows(date, totals);
    const [entries, heldForReview] = await Promise.all([
      prisma.payoutEntry.findMany({ where: { businessDate: dateValue(date) }, orderBy: { recordedAt: "asc" } }),
      countHeldForReview(businessDay(date)),
    ]);
    return NextResponse.json({
      success: true, date, commissionBase: parsed.data.commissionBase, expenseSharing: "SHOP_ONLY", heldForReview,
      rows: rows.map((row) => serializeRow(row, entries.filter((e) => e.ledgerId === row.id), parsed.data.commissionBase, totals)),
    });
  } catch (error) {
    return serverError("[GET /api/v1/reports/payouts]", error, "Could not load ledger");
  }
}

type NewEntry = { id: string; method: PayoutMethod; kind: "PAYOUT" | "CORRECTION"; amount: Prisma.Decimal; correctsId: string | null; note: string | null };

// What the transaction decided; turned into a response outside it.
type Outcome =
  | { ok: true; entries: PayoutEntry[]; created: PayoutEntry[]; replay: boolean }
  | { ok: false; status: number; code: string; error: string; extra?: Record<string, string> };

const refuse = (status: number, code: string, error: string, extra?: Record<string, string>): Outcome => ({ ok: false, status, code, error, extra });
const peso = (value: Prisma.Decimal) => `₱${value.toFixed(2)}`;

// Same content as a saved entry: a retry of it, not a new payout.
const sameEntry = (saved: PayoutEntry, ledgerId: bigint, e: NewEntry) =>
  saved.ledgerId === ledgerId && saved.method === e.method && saved.kind === e.kind
  && saved.amount.abs().eq(e.amount) && (saved.correctsId ?? null) === e.correctsId && (saved.note ?? null) === e.note;

// Runs `decide` while holding the day's ledger row, so two saves for one barber and day are
// checked one after the other (the overpayment and correction limits stay true).
async function withLockedRow(row: Row, owed: Prisma.Decimal, decide: (tx: Prisma.TransactionClient, entries: PayoutEntry[]) => Promise<Outcome | NewEntry[]>) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM daily_payout_ledgers WHERE id = ${row.id} FOR UPDATE`;
    const entries = await tx.payoutEntry.findMany({ where: { ledgerId: row.id }, orderBy: { recordedAt: "asc" } });
    const decision = await decide(tx, entries);
    if (!Array.isArray(decision)) return decision;
    const created: PayoutEntry[] = [];
    for (const e of decision) {
      created.push(await tx.payoutEntry.create({
        data: {
          id: e.id, ledgerId: row.id, barberId: row.barberId, businessDate: row.businessDate, method: e.method, kind: e.kind,
          amount: e.kind === "CORRECTION" ? e.amount.neg() : e.amount, correctsId: e.correctsId, note: e.note, owedAtEntry: owed,
        },
      }));
    }
    const all = [...entries, ...created];
    await tx.dailyPayoutLedger.update({
      where: { id: row.id },
      data: { cashPaid: sumOf(all, "CASH"), gcashPaid: sumOf(all, "GCASH"), ...(created.length && !row.paidAt ? { paidAt: new Date() } : {}) },
    });
    return { ok: true as const, entries: all, created, replay: false };
  });
}

export async function POST(request: NextRequest) {
  if (!(await hasOwnerAccess(request))) return ownerRequiredResponse();
  const body = await readJson(request, "Invalid payout payload");
  if (!body.ok) return body.response;
  const legacy = typeof body.data === "object" && body.data !== null && !("id" in body.data) && "cashPaid" in body.data;
  const parsed = legacy ? legacySchema.safeParse(body.data) : entrySchema.safeParse(body.data);
  if (!parsed.success) return NextResponse.json({ success: false, error: "Invalid payout payload", details: parsed.error.flatten() }, { status: 400 });
  const { date, barberId, commissionBase: base } = parsed.data;
  if (isFuture(date)) return futureResponse();

  try {
    const totals = await totalsForDate(date, base);
    const rows = await syncLedgerRows(date, totals);
    const row = rows.find((r) => r.barberId === barberId);
    if (!row) return NextResponse.json({ success: false, error: "Unknown barber" }, { status: 404 });
    const owed = row.totalOwed; // canonical (list price), whatever base is viewed

    let outcome: Outcome;
    if ("cashPaid" in parsed.data) {
      const target = { CASH: new Prisma.Decimal(parsed.data.cashPaid), GCASH: new Prisma.Decimal(parsed.data.gcashPaid) };
      outcome = await withLockedRow(row, owed, async (_tx, entries) => {
        const deltas = (["CASH", "GCASH"] as const).map((method) => ({ method, delta: target[method].sub(sumOf(entries, method)) }));
        if (deltas.some((d) => d.delta.isNegative())) {
          return refuse(409, "TOTAL_DECREASE", "A saved payout cannot be lowered; record a correction instead");
        }
        const left = remainingToPay(owed, sum(entries));
        const adding = deltas.reduce((total, d) => total.add(d.delta), ZERO);
        if (adding.gt(left)) return refuse(409, "OVERPAYMENT", `Only ${peso(left)} is still owed`, { remaining: left.toFixed(2) });
        return deltas.filter((d) => d.delta.gt(0)).map((d) => ({ id: randomUUID(), method: d.method, kind: "PAYOUT" as const, amount: d.delta, correctsId: null, note: null }));
      });
    } else {
      const e = parsed.data;
      const entry: NewEntry = { id: e.id, method: e.method, kind: e.kind, amount: new Prisma.Decimal(e.amount), correctsId: e.correctsId ?? null, note: e.note || null };
      outcome = await withLockedRow(row, owed, async (tx, entries) => {
        const saved = await tx.payoutEntry.findUnique({ where: { id: entry.id } });
        if (saved) {
          if (!sameEntry(saved, row.id, entry)) return refuse(409, "ID_CONFLICT", "This entry id was already used for a different payout");
          return { ok: true, entries, created: [saved], replay: true };
        }
        if (entry.kind === "PAYOUT") {
          const left = remainingToPay(owed, sum(entries));
          if (entry.amount.gt(left)) return refuse(409, "OVERPAYMENT", `Only ${peso(left)} is still owed`, { remaining: left.toFixed(2) });
          return [entry];
        }
        const target = entries.find((x) => x.id === entry.correctsId);
        if (!target || target.kind === "CORRECTION" || target.method !== entry.method) {
          return refuse(400, "CORRECTION_INVALID", "A correction must name a payout of this barber and day, with the same method");
        }
        const left = correctableLeft(target, entries);
        if (entry.amount.gt(left)) return refuse(409, "CORRECTION_TOO_LARGE", `At most ${peso(left)} of that payout can be corrected`, { left: left.toFixed(2) });
        return [entry];
      });
    }

    if (!outcome.ok) return NextResponse.json({ success: false, code: outcome.code, error: outcome.error, ...outcome.extra }, { status: outcome.status });
    const updated = await prisma.dailyPayoutLedger.findUniqueOrThrow({ where: { id: row.id }, include: { barber: { select: { fullName: true } } } });
    return NextResponse.json({
      success: true,
      replay: outcome.replay,
      entry: outcome.created[0] ? serializeEntry(outcome.created[0], outcome.entries) : null,
      row: serializeRow(updated, outcome.entries, base, totals),
    });
  } catch (error) {
    // The same new id raced in for another barber or day: the primary key refused the second.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ success: false, code: "ID_CONFLICT", error: "This entry id was already used for a different payout" }, { status: 409 });
    }
    return serverError("[POST /api/v1/reports/payouts]", error, "Could not save payout");
  }
}

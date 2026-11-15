import { NextRequest, NextResponse } from "next/server";
import { Prisma, type PayoutEntry } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { serverError } from "@/lib/api";
import { hasOwnerAccess, ownerRequiredResponse } from "@/lib/owner-access";
import { manilaToday } from "@/lib/business-date";
import { parseRange } from "@/lib/date-range";
import { rangeFigures } from "@/lib/range-figures";
import { countHeldForReview } from "@/lib/time-review";
import { isAdditionalOwed, lastEntry, remainingToPay, serializeEntry } from "@/lib/payout-entries";

export const dynamic = "force-dynamic";

// Slice 20: what each barber was owed and paid, per business date, over a range. Strictly
// read-only: owed comes from the sales (list-price snapshots + tips of PAID sales counting on
// the day), never from the stored daily_payout_ledgers rows, which refresh only when /ledger
// opens a day. Entries belong to the date they pay for. Remaining for the range is the sum of
// each barber-day's clamped balance, never owed − paid.

const querySchema = z.object({ from: z.string(), to: z.string() });
const ZERO = new Prisma.Decimal(0);
const money = (value: Prisma.Decimal) => value.toFixed(2);

export async function GET(request: NextRequest) {
  if (!(await hasOwnerAccess(request))) return ownerRequiredResponse();
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ success: false, error: "from and to are required (YYYY-MM-DD)" }, { status: 400 });
  const range = parseRange(parsed.data.from, parsed.data.to, manilaToday());
  if (!range.ok) return NextResponse.json({ success: false, error: range.error }, { status: range.status });
  const { first, last, dates, bounds } = range;

  try {
    const [figures, entries, heldForReview, barbers] = await Promise.all([
      rangeFigures(first, last, "LIST_PRICE"),
      prisma.payoutEntry.findMany({
        where: { businessDate: { gte: bounds.dateStart, lt: bounds.dateEnd } },
        orderBy: { recordedAt: "asc" },
      }),
      countHeldForReview(first, last),
      prisma.barber.findMany({ select: { id: true, fullName: true, isActive: true }, orderBy: { fullName: "asc" } }),
    ]);

    const entriesOf = new Map<string, PayoutEntry[]>(); // `${date}|${barberId}`
    for (const entry of entries) {
      const key = `${entry.businessDate.toISOString().slice(0, 10)}|${entry.barberId}`;
      entriesOf.set(key, [...(entriesOf.get(key) ?? []), entry]);
    }

    let owedTotal = ZERO, paidTotal = ZERO, remainingTotal = ZERO, additionalOwedDays = 0;
    const days = [];
    for (const date of [...dates].reverse()) {
      const sales = figures.perDate.get(date)!.byBarber;
      const rows = [];
      // Barbers by name; listed only with a paid sale counting on the day or an entry for it.
      for (const barber of barbers) {
        const total = sales.get(barber.id);
        const own = entriesOf.get(`${date}|${barber.id}`) ?? [];
        if (!total && own.length === 0) continue;
        const commission = total?.commission ?? ZERO;
        const tips = total?.tips ?? ZERO;
        const owed = commission.add(tips);
        const paid = own.reduce((sum, e) => sum.add(e.amount), ZERO); // signed: corrections are negative
        const remaining = remainingToPay(owed, paid);
        const additionalOwed = isAdditionalOwed(owed, paid, lastEntry(own)?.owedAtEntry ?? null);
        owedTotal = owedTotal.add(owed);
        paidTotal = paidTotal.add(paid);
        remainingTotal = remainingTotal.add(remaining);
        if (additionalOwed) additionalOwedDays++;
        rows.push({
          barberId: barber.id,
          barberName: barber.fullName,
          active: barber.isActive,
          commission: money(commission),
          tips: money(tips),
          owed: money(owed),
          paid: money(paid),
          remaining: money(remaining),
          additionalOwed,
          entries: own.map((entry) => serializeEntry(entry, own)),
        });
      }
      if (rows.length > 0) days.push({ date, barbers: rows });
    }

    return NextResponse.json({
      success: true,
      from: first.date,
      to: last.date,
      heldForReview,
      totals: { owed: money(owedTotal), paid: money(paidTotal), remaining: money(remainingTotal), additionalOwedDays },
      days,
    });
  } catch (error) {
    return serverError("[GET /api/v1/reports/payout-history]", error, "Could not load the payout history");
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { serverError } from "@/lib/api";
import { hasOwnerAccess, ownerRequiredResponse } from "@/lib/owner-access";
import { isBusinessDate, manilaToday, parseBusinessDate } from "@/lib/business-date";
import { parseRange } from "@/lib/date-range";
import { countsInRange, countsOnDay } from "@/lib/time-review";

export const dynamic = "force-dynamic";

// Slice 16, Decision 4: the day's custom-amount sales, for the owner. Custom amounts skip the
// server's price check, so this list is how the owner sees them. Strictly read-only: it never
// creates, updates or upserts a row (unlike the payouts GET).
const querySchema = z.object({
  date: z.string().refine(isBusinessDate, "date must be a real calendar date (YYYY-MM-DD)"),
});

/**
 * GET /api/v1/reports/custom-amounts?date=YYYY-MM-DD, or ?from=&to= (slice 22, Decision 12: the
 * range's sales, countsInRange; never both) (owner access)
 * Custom-amount sales that count on that Manila business date (countsOnDay: a flagged sale waiting
 * for its date review is on no day), PAID or PENDING, newest first, inactive barbers and services
 * included. `commission` is the sale's stored snapshot, never recomputed; `menuPriceNow` is the
 * service's price today, a reference only, not the sale's price.
 */
export async function GET(request: NextRequest) {
  if (!(await hasOwnerAccess(request))) return ownerRequiredResponse();
  const params = new URL(request.url).searchParams;
  const isRange = params.has("from") || params.has("to");
  if (isRange && params.has("date")) {
    return NextResponse.json({ success: false, error: "Use either from and to, or date, not both" }, { status: 400 });
  }
  let when: ReturnType<typeof countsOnDay>;
  let echo: { date: string } | { from: string; to: string };
  if (isRange) {
    const from = params.get("from");
    const to = params.get("to");
    if (!from || !to) return NextResponse.json({ success: false, error: "from and to are required (YYYY-MM-DD)" }, { status: 400 });
    const range = parseRange(from, to, manilaToday());
    if (!range.ok) return NextResponse.json({ success: false, error: range.error }, { status: range.status });
    when = countsInRange(range.first, range.last);
    echo = { from: range.first.date, to: range.last.date };
  } else {
    const parsed = querySchema.safeParse(Object.fromEntries(params));
    if (!parsed.success) return NextResponse.json({ success: false, error: "date must be a real calendar date (YYYY-MM-DD)" }, { status: 400 });
    when = countsOnDay(parseBusinessDate(parsed.data.date)!);
    echo = { date: parsed.data.date };
  }

  try {
    const sales = await prisma.transaction.findMany({
      where: { AND: [when, { customAmount: true, paymentStatus: { in: ["PAID", "PENDING"] } }] },
      orderBy: [{ transactionTime: "desc" }, { id: "asc" }],
      select: {
        id: true,
        transactionTime: true,
        amountPaid: true,
        totalAmount: true,
        customAmountNote: true,
        paymentMethod: true,
        paymentStatus: true,
        barberCommissionAmount: true,
        barber: { select: { fullName: true } },
        items: { select: { service: { select: { name: true, standardPrice: true } } }, take: 1 },
      },
    });

    return NextResponse.json({
      success: true,
      ...echo,
      sales: sales.map((sale) => {
        const service = sale.items[0]?.service ?? null;
        return {
          id: sale.id,
          time: sale.transactionTime.toISOString(),
          barberName: sale.barber.fullName,
          serviceName: service?.name ?? null,
          // Older rows may have no amountPaid; totalAmount is what was paid then.
          amountPaid: (sale.amountPaid ?? sale.totalAmount).toFixed(2),
          note: sale.customAmountNote,
          paymentMethod: sale.paymentMethod,
          paymentStatus: sale.paymentStatus,
          commission: sale.barberCommissionAmount.toFixed(2),
          menuPriceNow: service ? service.standardPrice.toFixed(2) : null,
        };
      }),
    });
  } catch (error) {
    return serverError("[GET /api/v1/reports/custom-amounts]", error, "Could not load the custom amounts");
  }
}

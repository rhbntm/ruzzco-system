import { NextRequest, NextResponse } from "next/server";
import { serverError } from "@/lib/api";
import { hasOwnerAccess, ownerRequiredResponse } from "@/lib/owner-access";
import { manilaToday } from "@/lib/business-date";
import { parseRange } from "@/lib/date-range";
import { listSales, parseSalesQuery } from "@/lib/sales-list";

export const dynamic = "force-dynamic";

// Slice 22, Decision 8: the owner's sales over a range, with filters, newest first, paged on the
// server. Totals cover every sale matching the range and filters (PAID sales counting on a day
// only), never just the page shown. Strictly read-only.

/** GET /api/v1/reports/sales?from&to[&barberId][&method][&status][&serviceId][&kind][&page][&pageSize] */
export async function GET(request: NextRequest) {
  if (!(await hasOwnerAccess(request))) return ownerRequiredResponse();
  const params = new URL(request.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  if (!from || !to) return NextResponse.json({ success: false, error: "from and to are required (YYYY-MM-DD)" }, { status: 400 });
  const range = parseRange(from, to, manilaToday());
  if (!range.ok) return NextResponse.json({ success: false, error: range.error }, { status: range.status });
  const query = parseSalesQuery(params);
  if ("error" in query) return NextResponse.json({ success: false, error: query.error }, { status: 400 });

  try {
    const answer = await listSales(range, query);
    return NextResponse.json({ success: true, from: range.first.date, to: range.last.date, ...answer });
  } catch (error) {
    return serverError("[GET /api/v1/reports/sales]", error, "Could not load the sales");
  }
}

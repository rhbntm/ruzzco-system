import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasOwnerAccess, ownerRequiredResponse } from "@/lib/owner-access";
import { readJson, serverError } from "@/lib/api";
import { reviewSaleDate } from "@/lib/time-review";

export const dynamic = "force-dynamic";

const reviewSchema = z.object({
  transactionId: z.string().uuid(),
  choice: z.enum(["STATED_DATE", "RECEIVED_DATE"]),
});

/**
 * POST /api/v1/reports/time-review { transactionId, choice } (owner PIN).
 * Confirms the business day of a sale flagged for a suspicious phone timestamp (L5):
 * the day the phone stated, or the Manila date the server received it. From then on the sale
 * counts on that day only. The same choice again is a no-op; a different one is refused.
 */
export async function POST(request: NextRequest) {
  if (!hasOwnerAccess(request)) return ownerRequiredResponse();
  const body = await readJson(request, "Invalid review payload");
  if (!body.ok) return body.response;
  const parsed = reviewSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "transactionId (UUID) and choice (STATED_DATE or RECEIVED_DATE) are required" }, { status: 400 });
  }

  try {
    const result = await reviewSaleDate(parsed.data.transactionId, parsed.data.choice);
    switch (result.status) {
      case "reviewed":
      case "unchanged":
        return NextResponse.json({ success: true, ...result });
      case "not_found":
        return NextResponse.json({ success: false, error: "Sale not found" }, { status: 404 });
      case "not_flagged":
        return NextResponse.json({ success: false, error: "This sale's date does not need review" }, { status: 409 });
      case "already_reviewed":
        return NextResponse.json(
          { success: false, error: `Already reviewed: counted on ${result.businessDate}`, ...result },
          { status: 409 }
        );
      case "future_date":
        return NextResponse.json(
          { success: false, error: `The stated date ${result.businessDate} has not happened yet. Use the date it was received.`, ...result },
          { status: 422 }
        );
    }
  } catch (error) {
    return serverError("[POST /api/v1/reports/time-review]", error, "Could not record the review");
  }
}

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasOwnerAccess, ownerRequiredResponse } from "@/lib/owner-access";
import { isBusinessDate, manilaToday, parseBusinessDate } from "@/lib/business-date";
import {
  computeExpected,
  computeStaleness,
  latestRevision,
  serializeExpected,
  serializeSaved,
  serializeStaleness,
} from "@/lib/reconciliation";
import { z } from "zod";

const reconcileSchema = z.object({
  date: z.string().refine(isBusinessDate, "date must be a real calendar date (YYYY-MM-DD)"),
  countedCash: z
    .number()
    .nonnegative("Counted cash cannot be negative")
    .max(1_000_000, "Counted cash exceeds sanity limit (₱1,000,000)")
    .multipleOf(0.01),
  note: z.string().max(500).optional(),
  pettyCashAmount: z.number().nonnegative().max(1_000_000).multipleOf(0.01).default(0),
  pettyCashNote: z.string().max(255).optional(),
});

const MAX_REVISION_ATTEMPTS = 3;

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * GET /api/v1/reports/reconciliation?date=YYYY-MM-DD
 * Returns the live expected totals for the Manila business date, the latest saved revision
 * (a frozen snapshot) if any, and whether that revision is stale against the live state.
 */
export async function GET(request: NextRequest) {
  const day = parseBusinessDate(new URL(request.url).searchParams.get("date") ?? "");
  if (!day) {
    return NextResponse.json(
      { success: false, error: "date query param required (a real calendar date, YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  try {
    const saved = await latestRevision(day);
    // Live figures use the latest revision's petty cash: it is only recorded at reconciliation.
    const live = await computeExpected(day, saved?.pettyCashAmount ?? 0);
    const staleness = saved ? await computeStaleness(day, saved, live) : null;

    return NextResponse.json({
      success: true,
      date: day.date,
      expected: serializeExpected(live),
      saved: saved ? serializeSaved(saved) : null,
      staleness: staleness ? serializeStaleness(staleness) : null,
    });
  } catch (error) {
    console.error("[GET /api/v1/reports/reconciliation]", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/v1/reports/reconciliation
 * Records the physical drawer count for a date as a new revision (N+1). Earlier revisions
 * are never modified: each one is what the owner counted and the system expected at its
 * reconciledAt.
 */
export async function POST(request: NextRequest) {
  if (!hasOwnerAccess(request)) return ownerRequiredResponse();
  try {
    const body = await request.json();
    const parsed = reconcileSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { date, countedCash, note, pettyCashAmount, pettyCashNote } = parsed.data;
    const day = parseBusinessDate(date)!;

    // Server-side future-date guard: the UI's max is trivially bypassed.
    if (date > manilaToday()) {
      return NextResponse.json(
        { success: false, error: "Reconciliation date cannot be in the future" },
        { status: 422 }
      );
    }

    // Taken before reading, so a sale that syncs while this runs counts as late, not missed.
    const reconciledAt = new Date();
    const live = await computeExpected(day, String(pettyCashAmount));
    const counted = new Prisma.Decimal(String(countedCash));

    // Two saves racing for the same revision number: the loser retries with the next one.
    for (let attempt = 1; ; attempt++) {
      const previous = await latestRevision(day);
      try {
        const record = await prisma.shiftReconciliation.create({
          data: {
            reconciliationDate: day.dateValue,
            revision: (previous?.revision ?? 0) + 1,
            expectedCash: live.expectedDrawerCash,
            countedCash: counted,
            variance: counted.sub(live.expectedDrawerCash),
            gcashTotal: live.gcashTotal,
            mayaTotal: live.mayaTotal,
            totalRevenue: live.totalRevenue,
            pettyCashAmount: live.pettyCash,
            pettyCashNote: pettyCashNote ?? null,
            note: note ?? null,
            reconciledAt,
          },
        });
        const staleness = await computeStaleness(day, record, live);
        return NextResponse.json({
          success: true,
          date: day.date,
          expected: serializeExpected(live),
          saved: serializeSaved(record),
          staleness: serializeStaleness(staleness),
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        if (attempt >= MAX_REVISION_ATTEMPTS) {
          return NextResponse.json(
            { success: false, error: "Another reconciliation was saved at the same time. Reload and try again." },
            { status: 409 }
          );
        }
      }
    }
  } catch (error) {
    console.error("[POST /api/v1/reports/reconciliation]", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}

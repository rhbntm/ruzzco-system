import { prisma } from "@/lib/prisma";
import { parseBusinessDate } from "@/lib/business-date";
import { parseRange, presetRange, type DateRange, type Preset } from "@/lib/date-range";
import { rangeSummary } from "@/lib/range-summary";
import { rangeFigures } from "@/lib/range-figures";
import { computeExpected, computeStaleness, latestRevision, serializeExpected, serializeSaved, serializeStaleness } from "@/lib/reconciliation";
import { countHeldForReview } from "@/lib/time-review";

// Slice 21a: what the owner dashboard on `/` reads. Nothing is computed here a second way: the
// period cards come from rangeSummary (the ledger summary's own function) and rangeFigures (its
// sales query), the drawer card from the functions End-of-Day Cash uses. Read-only, and only
// called once owner access was found on the server.

export const DASHBOARD_PERIODS = ["today", "week", "month"] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

/** Anything but "week" or "month" is Today, the default. */
export function parseDashboardPeriod(value: unknown): DashboardPeriod {
  return value === "week" || value === "month" ? value : "today";
}

const PRESET: Record<DashboardPeriod, Preset> = { today: "today", week: "thisWeek", month: "thisMonth" };

/** Today, Monday to today, or the 1st to today (presetRange): a period always ends today. */
export function dashboardRange(period: DashboardPeriod, today: string): { from: string; to: string } {
  return presetRange(PRESET[period], today);
}

function rangeOf(period: DashboardPeriod, today: string): DateRange {
  const { from, to } = dashboardRange(period, today);
  const range = parseRange(from, to, today);
  if (!range.ok) throw new Error(`dashboard range ${from}..${to}: ${range.error}`);
  return range;
}

/** The ledger summary's answer for the period, at the default commission base (list price). */
export function loadPeriodSummary(period: DashboardPeriod, today: string) {
  return rangeSummary(rangeOf(period, today), "LIST_PRICE");
}
export type PeriodSummary = Awaited<ReturnType<typeof loadPeriodSummary>>;

/** Each barber's paid sales, amount paid, commission and tips in the period, highest amount first. */
export async function loadPeriodBarbers(period: DashboardPeriod, today: string) {
  const { first, last } = rangeOf(period, today);
  const { total } = await rangeFigures(first, last, "LIST_PRICE");
  const ids = [...total.byBarber.keys()];
  const names = ids.length === 0 ? [] : await prisma.barber.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
  const nameOf = new Map(names.map((barber) => [barber.id, barber.fullName]));
  return ids
    .map((id) => {
      const row = total.byBarber.get(id)!;
      return { id, name: nameOf.get(id) ?? "Unknown barber", sales: row.count, revenue: row.revenue, commission: row.viewCommission, tips: row.tips };
    })
    .sort((a, b) => b.revenue.comparedTo(a.revenue) || a.name.localeCompare(b.name))
    .map((row) => ({ ...row, revenue: row.revenue.toFixed(2), commission: row.commission.toFixed(2), tips: row.tips.toFixed(2) }));
}
export type PeriodBarbers = Awaited<ReturnType<typeof loadPeriodBarbers>>;

/** Today's drawer exactly as GET /api/v1/reports/reconciliation reports it, plus the held-sale count. */
export async function loadTodayDrawer(today: string) {
  const day = parseBusinessDate(today)!;
  const saved = await latestRevision(day);
  // Live figures use the latest revision's petty cash: it is only recorded at reconciliation.
  const live = await computeExpected(day, saved?.pettyCashAmount ?? 0);
  const [staleness, heldForReview] = await Promise.all([saved ? computeStaleness(day, saved, live) : null, countHeldForReview(day)]);
  return {
    expected: serializeExpected(live),
    saved: saved ? serializeSaved(saved) : null,
    staleness: staleness ? serializeStaleness(staleness) : null,
    heldForReview,
  };
}
export type TodayDrawer = Awaited<ReturnType<typeof loadTodayDrawer>>;

/** The approved phones (not revoked): label and when each last reached the shop PC. */
export function loadPhones() {
  return prisma.device.findMany({
    where: { revokedAt: null },
    select: { deviceKey: true, label: true, lastSeenAt: true },
    orderBy: { approvedAt: "desc" },
  });
}
export type Phones = Awaited<ReturnType<typeof loadPhones>>;

import type { ReactNode } from "react";
import { ownerPageAccess } from "@/lib/owner-access";
import { manilaToday } from "@/lib/business-date";
import { ApprovalGate } from "@/components/ApprovalScreen";
import { OwnerShell } from "@/components/OwnerShell";

// Business dates are YYYY-MM-DD calendar dates, so they are formatted as dates, not instants.
export const formatBusinessDay = (date: string) =>
  new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`)
  );

/** The owner's menu around a page, for a caller that has already found owner access on the server. */
export function OwnerFrame({ children }: { children: ReactNode }) {
  const today = manilaToday();
  return (
    <OwnerShell today={today} todayLabel={formatBusinessDay(today)}>
      {children}
    </OwnerShell>
  );
}

/**
 * Server half of the gate on owner pages (slice 19 §7, Decision 2), used by their layouts: owner
 * access is checked here, on the server; the approval state is read in the browser. With owner
 * access, the page inside the owner's menu (slice 21); without it, the approval screen with
 * "Owner sign-in" in an unapproved browser, or the page's own owner sign-in in an approved one
 * (no menu). The pages and routes keep their own checks.
 */
export async function OwnerPageGate({ pathname, title, children }: { pathname: string; title: string; children: ReactNode }) {
  const ownerAccess = await ownerPageAccess();
  return (
    <ApprovalGate pathname={pathname} title={title} ownerAccess={ownerAccess}>
      {ownerAccess ? <OwnerFrame>{children}</OwnerFrame> : children}
    </ApprovalGate>
  );
}

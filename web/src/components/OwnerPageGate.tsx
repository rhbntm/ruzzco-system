import type { ReactNode } from "react";
import { requireOwnerPage } from "@/lib/owner-access";
import { manilaToday } from "@/lib/business-date";
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
 * Server gate on owner pages, used by their layouts: owner access is checked here, on the server.
 * With it, the page inside the owner's menu (slice 21); without it, a redirect to /login?next=<page>
 * (the owner sign-in works from any browser, approved or not) before anything renders. The pages
 * and routes keep their own checks.
 */
export async function OwnerPageGate({ pathname, children }: { pathname: string; children: ReactNode }) {
  await requireOwnerPage(pathname);
  return <OwnerFrame>{children}</OwnerFrame>;
}

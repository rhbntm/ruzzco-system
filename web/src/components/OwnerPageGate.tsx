import type { ReactNode } from "react";
import { ownerPageAccess } from "@/lib/owner-access";
import { ApprovalGate } from "@/components/ApprovalScreen";

/**
 * Server half of the gate on owner pages (slice 19 §7, Decision 2), used by their layouts: owner
 * access is checked here, on the server; the approval state is read in the browser. With owner
 * access, the page; without it, the approval screen with "Owner sign-in" in an unapproved browser,
 * or the page's own owner sign-in in an approved one. The pages and routes keep their own checks.
 */
export async function OwnerPageGate({ pathname, title, children }: { pathname: string; title: string; children: ReactNode }) {
  return (
    <ApprovalGate pathname={pathname} title={title} ownerAccess={await ownerPageAccess()}>
      {children}
    </ApprovalGate>
  );
}

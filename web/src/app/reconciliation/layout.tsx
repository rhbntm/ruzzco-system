import type { ReactNode } from "react";
import { OwnerPageGate } from "@/components/OwnerPageGate";

// Server gate: owner access, or a redirect to /login?next=<page> before this page renders.
// The page and its routes still check owner access themselves.
export default function ReconciliationLayout({ children }: { children: ReactNode }) {
  return <OwnerPageGate pathname="/reconciliation">{children}</OwnerPageGate>;
}

import type { ReactNode } from "react";
import { OwnerPageGate } from "@/components/OwnerPageGate";

// Server gate: owner access, or a redirect to /login?next=<page> before this page renders.
// The page and its routes still check owner access themselves.
// Slice 27: Reports (was Insights at /insights, which now redirects here).
export default function ReportsLayout({ children }: { children: ReactNode }) {
  return <OwnerPageGate pathname="/reports">{children}</OwnerPageGate>;
}

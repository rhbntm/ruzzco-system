import type { ReactNode } from "react";
import { OwnerPageGate } from "@/components/OwnerPageGate";

// Slice 19 §7: the approval screen in front of this owner page for a browser that is neither
// approved nor signed in as the owner. UI gating only; the page and its routes check owner access.
// Slice 27: Reports (was Insights at /insights, which now redirects here).
export default function ReportsLayout({ children }: { children: ReactNode }) {
  return <OwnerPageGate pathname="/reports" title="Reports">{children}</OwnerPageGate>;
}

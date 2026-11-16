import type { ReactNode } from "react";
import { OwnerPageGate } from "@/components/OwnerPageGate";

// Slice 22: the approval screen in front of this owner page for a browser that is neither
// approved nor signed in as the owner. UI gating only; the page and its route check owner access.
export default function SalesLayout({ children }: { children: ReactNode }) {
  return <OwnerPageGate pathname="/sales" title="Sales">{children}</OwnerPageGate>;
}

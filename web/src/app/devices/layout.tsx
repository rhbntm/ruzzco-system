import type { ReactNode } from "react";
import { OwnerPageGate } from "@/components/OwnerPageGate";

// Slice 19 §7: the approval screen in front of this owner page for a browser that is neither
// approved nor signed in as the owner. UI gating only; the page and its routes check owner access.
export default function DevicesLayout({ children }: { children: ReactNode }) {
  return <OwnerPageGate pathname="/devices" title="Phones">{children}</OwnerPageGate>;
}

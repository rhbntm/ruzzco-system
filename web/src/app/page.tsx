import { ownerPageAccess } from "@/lib/owner-access";
import { parseDashboardPeriod } from "@/lib/dashboard";
import { ApprovalGate } from "@/components/ApprovalScreen";
import { OwnerFrame } from "@/components/OwnerPageGate";
import { Dashboard } from "@/components/dashboard/Dashboard";

export const dynamic = "force-dynamic";

// `/` is the owner dashboard (slice 21a). Owner access is checked on the server first, and a
// barber session is redirected to /pos by ownerPageAccess before anything renders. Without owner
// access nothing is queried: no roster, price list or figure reaches the HTML, only the approval
// or sign-in screen (slice 19 §7), which ApprovalGate picks in the browser. The Dashboard
// component, which holds every query, is rendered in the owner branch only
// (test:approval-gate A8).
export default async function HomePage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const isOwner = await ownerPageAccess();
  if (!isOwner) {
    return (
      <ApprovalGate pathname="/" title="Ruzzco Barbers" ownerAccess={false}>
        {null}
      </ApprovalGate>
    );
  }
  const { period } = await searchParams;
  return (
    <OwnerFrame>
      <Dashboard period={parseDashboardPeriod(period)} />
    </OwnerFrame>
  );
}

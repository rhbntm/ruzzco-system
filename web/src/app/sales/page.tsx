import { ownerPageAccess } from "@/lib/owner-access";
import { prisma } from "@/lib/prisma";
import { SalesList } from "./SalesList";

// Slice 22: the owner's Sales page. Checked on the server (a barber session is sent to /pos).
// Every barber and every service is offered as a filter, inactive ones included, so old sales
// stay findable. Read-only: nothing here writes.
export const dynamic = "force-dynamic";

export default async function SalesPage() {
  const ownerAccess = await ownerPageAccess();
  if (!ownerAccess) return <SalesList isOwner={false} barbers={[]} services={[]} />; // queries nothing
  const [barbers, services] = await Promise.all([
    prisma.barber.findMany({ select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
    prisma.service.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return <SalesList isOwner barbers={barbers.map((b) => ({ id: b.id, name: b.fullName }))} services={services} />;
}

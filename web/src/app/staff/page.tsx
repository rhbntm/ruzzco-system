import { ownerAccessFromCookies } from "@/lib/owner-access";
import { StaffAccounts } from "./StaffAccounts";

// Slice 19, Decision 15: staff accounts, owner only. Checked on the server: an owner account
// session, or the owner PIN session while no active owner account exists (so the first one can
// be created here).
export const dynamic = "force-dynamic";

export default async function StaffPage() {
  return <StaffAccounts isOwner={await ownerAccessFromCookies()} />;
}

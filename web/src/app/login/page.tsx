import { safeNext } from "@/lib/safe-next";
import { OwnerLogin } from "./OwnerLogin";

// Slice 19, Decision 13: the owner sign-in for a direct visit. `?next=` is followed only when it
// is a path on this site, never another origin.
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { next } = await searchParams;
  return <OwnerLogin next={safeNext(next)} />;
}

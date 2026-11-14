"use client";

import { OwnerSignInPage } from "@/components/OwnerSignIn";

export function OwnerLogin({ next }: { next: string }) {
  // A full load, so the next page renders on the server with the new session.
  return <OwnerSignInPage title="Owner sign-in" what="open the owner pages" submitLabel="Sign in" onSignedIn={() => window.location.assign(next)} />;
}

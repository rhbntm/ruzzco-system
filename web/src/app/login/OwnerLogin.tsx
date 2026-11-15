"use client";

import { OwnerSignInPage } from "@/components/OwnerSignIn";
import { ApprovePhoneButton } from "@/components/DeviceApprovalBanner";

export function OwnerLogin({ next }: { next: string }) {
  // A full load, so the next page renders on the server with the new session.
  return (
    <OwnerSignInPage
      title="Owner sign-in"
      what="open the owner pages"
      submitLabel="Sign in"
      onSignedIn={() => window.location.assign(next)}
      // Slice 21b: a shop phone can be approved from here too. Approval opens no owner page; it
      // only lets this phone sync and its barbers sign in on /pos.
      footer={
        <div className="border-t border-seam pt-4 space-y-2 text-center">
          <p className="text-xs text-dust">Setting up a shop phone?</p>
          <ApprovePhoneButton className="rz-btn rz-btn-secondary w-full min-h-11 text-sm" />
        </div>
      }
    />
  );
}

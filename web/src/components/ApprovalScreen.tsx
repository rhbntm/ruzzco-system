"use client";

// The one approval screen in front of the app (slice 19 §7, Decisions 1 to 3), for a browser that
// isn't an approved phone. UI gating only: it hides pages, it never authorizes anything. Every API
// route still checks the phone's key and secret, or the owner session, on the server.

import { useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { LockKeyhole, Scissors } from "lucide-react";
import { BARBER_HOME, gateScreen, ownerSignInHref } from "@/lib/approval-gate";
import { isWaitingForApproval, subscribeApproval } from "@/lib/sync";
import { DeviceApprovalBanner } from "@/components/DeviceApprovalBanner";
import { BarberPoleIcon } from "@/components/RuzzcoBrand";
import { Logo } from "@/components/Logo";

/** The approval step: the approve-this-phone banner, and on non-POS pages a link to the owner sign-in. */
export function ApprovalScreen({ title, ownerSignIn, message }: {
  title: string;
  /** "/login?next=…"; omitted on /pos and /shift-log, where owners don't sign in. */
  ownerSignIn?: string;
  message?: string;
}) {
  return (
    <main className="rz-page flex-1 flex items-center justify-center p-4 sm:p-6 w-full">
      <div className="animate-pop rz-panel w-full max-w-sm p-6 sm:p-7 space-y-5">
        <div className="flex flex-col items-center text-center gap-3">
          <Logo stacked />
          <h1 className="rz-title text-2xl break-words">{title}</h1>
          <p className="text-sm text-dust leading-relaxed">
            {ownerSignIn
              ? "This browser isn't an approved shop phone. Approve it first, or sign in as the owner."
              : "Approve this phone first. Then each barber signs in with their own account."}
          </p>
        </div>
        <DeviceApprovalBanner message={message} />
        {ownerSignIn && (
          <Link href={ownerSignIn} className="rz-btn rz-btn-secondary w-full min-h-12">
            <LockKeyhole className="w-4 h-4" />
            Owner sign-in
          </Link>
        )}
      </div>
    </main>
  );
}

/**
 * `/` and `/about` in an approved browser without owner access (slice 19b correction): these pages
 * are the owner's, so the phone is offered its two ways in. Barbers sign in on the POS (and stay on
 * /pos and /shift-log); the owner signs in on /login and comes back here.
 */
export function SignInChoiceScreen({ title, ownerSignIn }: { title: string; ownerSignIn: string }) {
  return (
    <main className="rz-page flex-1 flex items-center justify-center p-4 sm:p-6 w-full">
      <div className="animate-pop rz-panel w-full max-w-sm p-6 sm:p-7 space-y-5">
        <div className="flex flex-col items-center text-center gap-3">
          <Logo stacked />
          <h1 className="rz-title text-2xl break-words">{title}</h1>
          <p className="text-sm text-dust leading-relaxed">
            Sign in to continue. Barbers sign in on the POS; this page is for the owner.
          </p>
        </div>
        <div className="space-y-2">
          <Link href={BARBER_HOME} className="rz-btn rz-btn-primary w-full min-h-12">
            <Scissors className="w-4 h-4" />
            Barber sign-in (POS)
          </Link>
          <Link href={ownerSignIn} className="rz-btn rz-btn-secondary w-full min-h-12">
            <LockKeyhole className="w-4 h-4" />
            Owner sign-in
          </Link>
        </div>
      </div>
    </main>
  );
}

// Unknown on the server and during hydration: approval lives in localStorage.
const approvedSnapshot = () => !isWaitingForApproval();
const unknownOnServer = () => null;

/**
 * Wraps a page that isn't /pos or /shift-log (those use SignInGate). `ownerAccess` comes from the
 * server (`ownerPageAccess`, which has already redirected a barber session to /pos); the approval
 * state from the browser. Until the browser has read it, a gated page shows the loading state,
 * never its content (Decision 1).
 */
export function ApprovalGate({ pathname, title, ownerAccess, children }: {
  pathname: string;
  title: string;
  ownerAccess: boolean;
  children: ReactNode;
}) {
  const approved = useSyncExternalStore<boolean | null>(subscribeApproval, approvedSnapshot, unknownOnServer);

  // With owner access the decision doesn't depend on the browser, so the page renders at once.
  if (ownerAccess && gateScreen({ pathname, approved: false, ownerAccess }) === "page") return <>{children}</>;

  if (approved === null) {
    return (
      <div role="status" className="rz-page flex-1 flex items-center justify-center gap-3 text-dust">
        <BarberPoleIcon className="w-3.5 h-8" spinning />
        <span>Loading…</span>
      </div>
    );
  }

  const screen = gateScreen({ pathname, approved, ownerAccess });
  if (screen === "approval-owner-link") {
    return (
      <ApprovalScreen
        title={title}
        ownerSignIn={ownerSignInHref(pathname)}
        message="This browser isn't approved yet. Bayani or Mart approves a shop phone with the approval PIN."
      />
    );
  }
  if (screen === "approval") return <ApprovalScreen title={title} />;
  if (screen === "sign-in-choice") return <SignInChoiceScreen title={title} ownerSignIn={ownerSignInHref(pathname)} />;
  // "page", or "owner-sign-in": an owner page without owner access shows its own owner sign-in.
  return <>{children}</>;
}

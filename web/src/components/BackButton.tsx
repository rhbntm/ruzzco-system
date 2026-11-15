"use client";

// Back on the sign-in and approval screens (slice 21b). It steps back through this tab's history,
// so it never names a page: the POS still links to neither `/` nor an owner page (slice 19 §7.13).
// With no earlier page on this site (the app opened from the home screen) it shows nothing, unless
// the screen gives a `fallbackHref` (only /login does, to `/`).

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

type NavigationLike = { canGoBack?: boolean; addEventListener?: (type: string, cb: () => void) => void; removeEventListener?: (type: string, cb: () => void) => void };

function navigationApi(): NavigationLike | undefined {
  return (globalThis as { navigation?: NavigationLike }).navigation;
}

function subscribe(callback: () => void) {
  const nav = navigationApi();
  nav?.addEventListener?.("currententrychange", callback);
  window.addEventListener("popstate", callback);
  return () => {
    nav?.removeEventListener?.("currententrychange", callback);
    window.removeEventListener("popstate", callback);
  };
}

/** True when this tab has an earlier entry to go back to. The Navigation API counts only this
 *  site's entries; without it, any earlier entry counts. */
function canGoBack(): boolean {
  const nav = navigationApi();
  if (typeof nav?.canGoBack === "boolean") return nav.canGoBack;
  return window.history.length > 1;
}

const CLASS = "rz-btn rz-btn-ghost self-start -ml-2 min-h-11 px-2 text-sm text-dust hover:text-bone";

export function BackButton({ fallbackHref }: { fallbackHref?: string }) {
  const back = useSyncExternalStore(subscribe, canGoBack, () => false);
  if (back) {
    return (
      <button type="button" onClick={() => window.history.back()} className={CLASS}>
        <ChevronLeft aria-hidden="true" className="w-4 h-4" />
        Back
      </button>
    );
  }
  if (!fallbackHref) return null;
  return (
    <Link href={fallbackHref} className={CLASS}>
      <ChevronLeft aria-hidden="true" className="w-4 h-4" />
      Back
    </Link>
  );
}

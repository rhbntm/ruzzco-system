"use client";

// The barber's header (slice 21b, Decision 5), shared by /pos and /shift-log: the logo, whose
// sales this phone records, the connection, sync with its counts, settings, and the two-item
// switch between the barber's two pages. It links to /pos and /shift-log only, never to an owner
// page (`npm run test:nav`), and it asks the server nothing: both pages are stored on the phone
// and must draw with the shop PC off.
//
// Two different facts, kept apart on purpose. "Sales on this phone" is the phone's assignment
// (its binding): every sale recorded here is that barber's, whoever is signed in. The signed-in
// account is shown beside it only when it is someone else's, or when nobody is signed in.

import Link from "next/link";
import { History, RefreshCw, Scissors, Settings, User, UserX } from "lucide-react";
import { Logo } from "@/components/Logo";
import { BarberPoleIcon } from "@/components/RuzzcoBrand";
import { ConnectionBadge, type ShopPcState } from "@/components/ShopPcStatus";

export const BARBER_PAGES = [
  { href: "/pos", label: "POS", icon: Scissors },
  { href: "/shift-log", label: "Shift Log", icon: History },
] as const;

type Account = { username: string; barberId: string; barberName: string };

/** What the header says about the signed-in account, or null when it is the assigned barber's own. */
export function accountNote(assignedBarberId: string | null, account: Account | null): string | null {
  if (!account) return "Nobody signed in";
  if (assignedBarberId !== null && account.barberId === assignedBarberId) return null;
  return `Signed in: ${account.barberName} (${account.username})`;
}

export function BarberHeader({
  current,
  title,
  assignedBarber,
  account,
  isOnline,
  shopPc,
  isSyncing,
  onSync,
  pendingCount,
  rejectedCount,
  onSettings,
  width = "max-w-6xl",
}: {
  current: (typeof BARBER_PAGES)[number]["href"];
  /** The page's name for screen readers (the visible name is the switch's current item). */
  title: string;
  /** The barber this phone is assigned to, or null while it has no assignment. */
  assignedBarber: { id: string; name: string } | null;
  /** Today's sign-in on this phone, or null. */
  account: Account | null;
  isOnline: boolean;
  shopPc: ShopPcState;
  isSyncing: boolean;
  onSync: () => void;
  pendingCount: number;
  rejectedCount: number;
  /** Opens the phone's settings (change the barber, sign out). The shift log has none. */
  onSettings?: () => void;
  width?: string;
}) {
  const note = accountNote(assignedBarber?.id ?? null, account);
  return (
    <header className="rz-banner sticky top-0 z-40">
      <div className={`${width} mx-auto px-3 sm:px-4 pt-2 pb-2 space-y-2`}>
        <div className="flex items-center justify-between gap-2">
          <h1 className="sr-only">{title}</h1>
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-2.5">
            {/* Not a link: barbers open /pos and /shift-log only (slice 19b correction). The wrappers
                carry the breakpoints, since Logo sets its own display. */}
            <span className="flex shrink-0 sm:hidden"><Logo markOnly /></span>
            <span className="hidden shrink-0 sm:flex"><Logo /></span>
            {/* The station light: it turns while a sync is running. From sm up only: on a phone the
                sync button's own spin says the same and the barber's name needs the room. */}
            <BarberPoleIcon className="hidden sm:inline-flex w-2.5 h-7 shrink-0" spinning={isSyncing} />
            <div className="min-w-0 flex-1 leading-tight" title={assignedBarber?.name}>
              <p className="truncate text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-dust">Sales on this phone</p>
              <p className="flex items-center gap-1 text-sm font-semibold text-bone">
                <User aria-hidden="true" className="w-3.5 h-3.5 shrink-0 text-dust" />
                <span className="truncate">{assignedBarber ? assignedBarber.name : "No barber assigned"}</span>
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <ConnectionBadge isOnline={isOnline} shopPc={shopPc} />
            {/* Manual sync. The counts are in the button's name; the badges only show them. */}
            <button
              type="button"
              onClick={onSync}
              disabled={isSyncing || !isOnline}
              title="Sync pending transactions"
              aria-label={`Sync now${pendingCount > 0 ? `, ${pendingCount} waiting` : ""}${rejectedCount > 0 ? `, ${rejectedCount} need attention` : ""}`}
              className="rz-btn rz-btn-secondary rz-btn-icon relative min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? "animate-spin" : ""}`} />
              {pendingCount > 0 && (
                <span aria-hidden="true" title="Sales waiting to sync" className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-bone text-wall text-xs font-bold ring-2 ring-panel flex items-center justify-center">
                  {pendingCount}
                </span>
              )}
              {rejectedCount > 0 && (
                <span aria-hidden="true" title="Sales needing attention" className="absolute -bottom-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-warn text-on-warn text-xs font-bold ring-2 ring-panel flex items-center justify-center">
                  {rejectedCount}
                </span>
              )}
            </button>
            {onSettings && (
              <button
                type="button"
                onClick={onSettings}
                title="Phone settings"
                aria-label="Phone settings and change barber"
                className="rz-btn rz-btn-secondary rz-btn-icon min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 pointer-coarse:min-h-11 pointer-coarse:min-w-11 text-dust"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <nav aria-label="Barber pages" className="rz-seg w-full sm:w-auto">
            {BARBER_PAGES.map((page) => (
              <Link
                key={page.href}
                href={page.href}
                aria-current={page.href === current ? "page" : undefined}
                className="rz-seg-item flex-1 gap-1.5 px-4 min-h-11 sm:min-h-9 sm:flex-none"
              >
                <page.icon aria-hidden="true" className="w-4 h-4" />
                {page.label}
              </Link>
            ))}
          </nav>
          {note && (
            <p className="rz-pill rz-pill-warn max-w-full whitespace-normal">
              <UserX aria-hidden="true" className="w-3.5 h-3.5 shrink-0" />
              <span className="min-w-0 break-words">{note}</span>
            </p>
          )}
        </div>
      </div>
    </header>
  );
}

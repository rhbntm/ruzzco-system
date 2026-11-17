"use client";

// The owner's shell (slice 21, Decision 4): one menu around every owner page. From 1024px a fixed
// sidebar; below it a top bar with a menu button that opens the same list. Rendered only once
// owner access was found on the server (OwnerPageGate, the dashboard on `/`, /about); it checks
// nothing itself, and every page and route keeps its own check. It links to no barber page.

import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { BarChart3, ClipboardCheck, Info, LayoutDashboard, LineChart, LockKeyhole, Menu, QrCode, Receipt, Smartphone, Users, Wallet, X } from "lucide-react";
import { OWNER_NAV_GROUPS, OWNER_NAV_SECONDARY, isCurrentNav, navTitle, type OwnerNavItem } from "@/lib/owner-nav";
import { Logo } from "@/components/Logo";

const ICONS: Record<string, LucideIcon> = {
  "/": LayoutDashboard,
  "/sales": Receipt,
  "/ledger": Wallet,
  "/reconciliation": ClipboardCheck,
  "/reports": BarChart3,
  "/forecast": LineChart,
  "/payment-qr": QrCode,
  "/devices": Smartphone,
  "/staff": Users,
  "/about": Info,
};

// The phone menu's history entry: the phone's Back closes the menu instead of leaving the page.
const MENU_MARK = "rzOwnerMenu";

type Pick = (event: MouseEvent<HTMLAnchorElement>, href: string) => void;

function NavItems({ items, pathname, onPick }: { items: readonly OwnerNavItem[]; pathname: string; onPick?: Pick }) {
  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const Icon = ICONS[item.href] ?? LayoutDashboard;
        const current = isCurrentNav(pathname, item.href);
        return (
          <li key={item.href}>
            <Link href={item.href} aria-current={current ? "page" : undefined} onClick={onPick ? (event) => onPick(event, item.href) : undefined} className="rz-nav-item">
              <Icon aria-hidden="true" className="h-4.5 w-4.5 shrink-0" />
              <span>{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// Slice 25: the menu in groups, each list under its own small heading.
function NavList({ pathname, onPick, idPrefix }: { pathname: string; onPick?: Pick; idPrefix: string }) {
  return (
    <div className="space-y-4">
      {OWNER_NAV_GROUPS.map((group, index) => (
        <div key={group.label} role="group" aria-labelledby={`${idPrefix}-group-${index}`} className="space-y-1">
          <p id={`${idPrefix}-group-${index}`} className="rz-label px-3">{group.label}</p>
          <NavItems items={group.items} pathname={pathname} onPick={onPick} />
        </div>
      ))}
    </div>
  );
}

function LockButton() {
  const router = useRouter();
  const [locking, setLocking] = useState(false);
  // Ends the owner session on this device only, then loads `/` again: the sign-in screen.
  async function lock() {
    setLocking(true);
    try {
      await fetch("/api/v1/owner/lock", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    } finally {
      // To `/`, rendered again on the server without the session: the sign-in screen. The
      // refresh also drops every owner page the router kept.
      router.replace("/");
      router.refresh();
    }
  }
  return (
    <button type="button" onClick={() => void lock()} disabled={locking} className="rz-btn rz-btn-secondary w-full min-h-11 justify-start">
      <LockKeyhole aria-hidden="true" className="h-4 w-4" />
      {locking ? "Locking…" : "Lock"}
    </button>
  );
}

export function OwnerShell({ today, todayLabel, children }: {
  /** Today's Manila business date (YYYY-MM-DD) and how the top bar prints it; both from the server. */
  today: string;
  todayLabel: string;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // A link picked in the phone menu: followed once the menu's own history entry is gone.
  const pending = useRef<string | null>(null);
  const wasOpen = useRef(false);

  function openMenu() {
    window.history.pushState({ [MENU_MARK]: 1 }, "");
    setOpen(true);
  }

  // Every way of closing goes through Back, so the menu's history entry never outlives it.
  function closeMenu() {
    if (open) window.history.back();
  }

  useEffect(() => {
    if (!open) return;
    const onPopState = () => {
      setOpen(false);
      const href = pending.current;
      pending.current = null;
      if (href) router.push(href);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") window.history.back();
    };
    window.addEventListener("popstate", onPopState);
    window.addEventListener("keydown", onKeyDown);
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, router]);

  // Closed again: focus goes back to the button that opened it.
  useEffect(() => {
    if (wasOpen.current && !open) buttonRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  function pick(event: MouseEvent<HTMLAnchorElement>, href: string) {
    // A new tab or window: the browser's own business.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    pending.current = pathname === href ? null : href;
    window.history.back();
  }

  return (
    <div className="flex-1 flex flex-col lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden lg:block border-r border-seam bg-panel">
        <div className="sticky top-0 flex h-[calc(100dvh-5px)] flex-col">
          <div className="flex h-14 shrink-0 items-center border-b border-seam px-4">
            <Link href="/" className="rounded-lg" aria-label="Ruzzco Barbers, dashboard">
              <Logo />
            </Link>
          </div>
          <nav aria-label="Owner pages" className="flex-1 overflow-y-auto p-3">
            <NavList pathname={pathname} idPrefix={`${menuId}-side`} />
          </nav>
          <div className="shrink-0 border-t border-seam p-3 space-y-2">
            <nav aria-label="More">
              <NavItems items={OWNER_NAV_SECONDARY} pathname={pathname} />
            </nav>
            <LockButton />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-seam bg-panel px-3 sm:px-5">
          <button
            ref={buttonRef}
            type="button"
            onClick={openMenu}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={menuId}
            aria-label="Open the menu"
            className="rz-btn rz-btn-secondary rz-btn-icon min-h-11 min-w-11 lg:hidden"
          >
            <Menu aria-hidden="true" className="h-5 w-5" />
          </button>
          <Logo markOnly className="lg:hidden" />
          <p className="min-w-0 flex-1 truncate font-display text-base font-semibold uppercase tracking-[0.08em] text-bone">
            <span className="hidden text-dust sm:inline">Owner <span aria-hidden="true">/</span> </span>
            {navTitle(pathname)}
          </p>
          <p className="shrink-0 text-right text-xs leading-tight text-dust sm:text-sm">
            <span className="sr-only">Today: </span>
            <time dateTime={today}>{todayLabel}</time>
          </p>
        </div>
        {children}
      </div>

      {open && (
        <div className="rz-overlay justify-start p-0 lg:hidden" onClick={(event) => { if (event.target === event.currentTarget) closeMenu(); }}>
          <div id={menuId} role="dialog" aria-modal="true" aria-label="Owner pages" className="animate-fade flex h-full w-72 max-w-[85vw] flex-col border-r border-seam bg-panel rz-shadow-modal">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-seam px-4">
              <Logo />
              <button ref={closeRef} type="button" onClick={closeMenu} aria-label="Close the menu" className="rz-btn rz-btn-ghost rz-btn-icon min-h-11 min-w-11">
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>
            <nav aria-label="Owner pages" className="flex-1 overflow-y-auto p-3">
              <NavList pathname={pathname} onPick={pick} idPrefix={`${menuId}-drawer`} />
            </nav>
            <div className="shrink-0 border-t border-seam p-3 space-y-2">
              <nav aria-label="More">
                <NavItems items={OWNER_NAV_SECONDARY} pathname={pathname} onPick={pick} />
              </nav>
              <LockButton />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

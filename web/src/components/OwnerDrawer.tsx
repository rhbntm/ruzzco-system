"use client";

// The owner's drawer: the counter's own drawer, under the day's tools. It starts shut: the front
// carries a brass nameplate, the lock and the pull, and the whole front is its handle. Out slides a
// tray with the owner's tools: Barber Ledger, Detailed Forecast, Insights, Payment QR and Phones (each page
// still asks for the PIN itself) and the 7/14/30-day forecast, which shows its numbers only once the
// owner PIN has been entered on this device. Until then no figure reaches the page.
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, LayoutDashboard, LineChart, LockKeyhole, LockKeyholeOpen, QrCode, Smartphone, TriangleAlert, Wallet } from "lucide-react";
import type { SerializedForecast } from "@/lib/forecast";
import { ForecastLocked, ForecastPanel } from "@/components/ForecastPanel";

type OwnerPage = { href: string; title: string; body: string; icon: LucideIcon };

// In the order Mart reaches for them at closing.
const ownerPages: OwnerPage[] = [
  { href: "/ledger", title: "Barber Ledger", body: "View and record each barber's daily payout.", icon: Wallet },
  { href: "/forecast", title: "Detailed Forecast", body: "How the 7-day forecast compares with simpler guesses and other models.", icon: LineChart },
  { href: "/insights", title: "Insights", body: "Dashboards, trends and calculations from the shop's own numbers.", icon: LayoutDashboard },
  { href: "/payment-qr", title: "Payment QR", body: "Add or change the GCash and Maya QR shown for each barber.", icon: QrCode },
  { href: "/devices", title: "Phones", body: "See the approved phones and revoke a lost or replaced one.", icon: Smartphone },
];

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// While the drawer slides out, the page must not scroll to hold its place: the front moves down
// and the tray opens above it, as it would at the counter.
function holdScroll(ms: number) {
  const root = document.documentElement;
  root.style.overflowAnchor = "none";
  window.setTimeout(() => {
    root.style.overflowAnchor = "";
  }, ms);
}

export function OwnerDrawer({
  isOwner,
  forecast,
  today,
}: {
  isOwner: boolean;
  forecast: SerializedForecast | null;
  today: string;
}) {
  const titleId = useId();
  const trayId = useId();
  const [open, setOpen] = useState(false);
  // The page re-renders with the owner cookie once the PIN is accepted in the tray: the forecast
  // takes the reader's focus in place of the PIN field it replaces.
  const [ownerSeen, setOwnerSeen] = useState(isOwner);
  const [justUnlocked, setJustUnlocked] = useState(false);
  if (ownerSeen !== isOwner) {
    setOwnerSeen(isOwner);
    setJustUnlocked(isOwner);
  }
  const frontRef = useRef<HTMLDivElement>(null);
  const firstToolRef = useRef<HTMLAnchorElement>(null);
  const forecastRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [locking, setLocking] = useState(false);

  // Ends the owner session on this device only; the page re-renders locked.
  async function lock() {
    setLocking(true);
    try {
      await fetch("/api/v1/owner/lock", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    } finally {
      setLocking(false);
      router.refresh();
    }
  }

  useEffect(() => {
    if (justUnlocked) forecastRef.current?.focus({ preventScroll: true });
  }, [justUnlocked]);

  function toggle() {
    if (open) {
      setOpen(false);
      // Shut from far down the tray, the front would end up above the screen: bring it back.
      if (reducedMotion()) requestAnimationFrame(() => frontRef.current?.scrollIntoView({ block: "nearest" }));
      return;
    }
    holdScroll(900);
    setOpen(true);
    // The tray sits before the front in reading order, so the reader moves into it.
    requestAnimationFrame(() => firstToolRef.current?.focus({ preventScroll: true }));
  }

  return (
    <section aria-labelledby={titleId} className="animate-rise [animation-delay:140ms]">
      <div
        id={trayId}
        data-open={open}
        className="rz-tray"
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget && !open) {
            frontRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
          }
        }}
      >
        <div inert={!open}>
          <div className="rz-tray-box">
            <div className="grid gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1fr)_3px_minmax(0,2.6fr)] lg:gap-5">
              <ul className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-1 lg:sticky lg:top-6 self-start">
                {ownerPages.map((page, i) => (
                  <li key={page.href}>
                    <Link
                      ref={i === 0 ? firstToolRef : undefined}
                      href={page.href}
                      className="rz-plate group gap-2 p-3 sm:p-4 items-center text-center sm:items-start sm:text-left lg:grid lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:gap-x-3.5 lg:gap-y-1"
                    >
                      <page.icon className="w-5 h-5 shrink-0 text-crimson-ink lg:row-span-2 lg:mt-0.5" />
                      <span className="font-display font-semibold uppercase tracking-[0.04em] text-[0.9375rem] sm:text-lg leading-[1.1] lg:col-start-2">
                        {page.title}
                      </span>
                      <span className="hidden sm:block text-[0.8125rem] text-dust leading-relaxed lg:col-start-2">{page.body}</span>
                      <ArrowRight className="hidden sm:block mt-auto self-end w-4 h-4 text-dust transition-[color,transform] duration-200 group-hover:text-crimson-ink motion-safe:group-hover:translate-x-1 lg:col-start-3 lg:row-start-1 lg:row-span-2 lg:self-center lg:mt-0" />
                    </Link>
                  </li>
                ))}
              </ul>
              <span aria-hidden="true" className="rz-tray-divider h-0.75 lg:h-auto" />
              <div id="forecast" ref={forecastRef} tabIndex={-1} className="scroll-mt-6 min-w-0 rounded-[14px]">
                {!isOwner ? (
                  <ForecastLocked />
                ) : forecast ? (
                  <ForecastPanel initial={forecast} today={today} />
                ) : (
                  <p className="rz-notice rz-notice-danger">
                    <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                    The saved forecast can&apos;t be loaded right now because the database is unreachable.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div ref={frontRef} className="rz-drawer-front" data-out={open ? "true" : undefined}>
        <div className="flex flex-col items-center text-center">
          <h2 id={titleId} className="rz-nameplate">
            <span className="rz-nameplate-card">Owner&apos;s drawer</span>
          </h2>
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-dust">
            {isOwner ? (
              <>
                <LockKeyholeOpen className="w-3.5 h-3.5 text-brass" /> Unlocked on this device
                {/* Above the pull's hit area (z-index 1), so it locks instead of opening the drawer. */}
                <button
                  type="button"
                  onClick={() => void lock()}
                  disabled={locking}
                  className="relative z-2 ml-1.5 rz-btn rz-btn-secondary px-2.5 py-1 text-xs pointer-coarse:min-h-11"
                >
                  {locking ? "Locking…" : "Lock"}
                </button>
              </>
            ) : (
              <>
                <LockKeyhole className="w-3.5 h-3.5 text-brass" /> Locked · owner PIN
              </>
            )}
          </p>
          <span aria-hidden="true" className="rz-escutcheon rz-escutcheon-lg mt-4" data-open={isOwner ? "true" : undefined}>
            <span className="rz-keyhole" />
          </span>
        </div>
        {/* The pull. Its hit area is the whole front, so the drawer opens wherever it is taken. */}
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls={trayId} className="rz-drawer-handle mt-3">
          <span aria-hidden="true" className="rz-bar-pull" />
          <span className="rz-pull-hint">
            {open ? "Push to close" : "Pull to open"}
            <span className="sr-only"> the owner&apos;s drawer</span>
          </span>
        </button>
      </div>
    </section>
  );
}

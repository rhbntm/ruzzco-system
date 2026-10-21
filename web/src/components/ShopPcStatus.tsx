"use client";

import { useEffect, useRef, useState } from "react";
import { ServerOff, Wifi, WifiOff } from "lucide-react";
import { fetchWithTimeout } from "@/lib/fetch-timeout";

/**
 * Whether the shop PC can record sales right now. The phone's own network state says nothing
 * about the PC: with the PC off, a phone on the shop Wi-Fi still counts as online.
 * "checking" until the first answer, so nothing flashes while a page loads.
 */
export type ShopPcState = "checking" | "online" | "unreachable" | "database-down";

const CHECK_TIMEOUT_MS = 5_000;
// While the PC is down, look more often, so waiting sales go out soon after it is back.
const CHECK_EVERY_MS = { up: 15_000, down: 10_000 };

async function checkShopPc(): Promise<ShopPcState> {
  if (!navigator.onLine) return "unreachable";
  try {
    const res = await fetchWithTimeout("/api/v1/health", { cache: "no-store" }, CHECK_TIMEOUT_MS);
    if (res.ok) return "online";
    // 503 is Ruzzco itself with MySQL down; 502 is the HTTPS gateway with Ruzzco stopped.
    return res.status === 503 ? "database-down" : "unreachable";
  } catch {
    return "unreachable";
  }
}

export function isShopPcDown(state: ShopPcState): boolean {
  return state === "unreachable" || state === "database-down";
}

/**
 * Asks the shop PC on load, then every 15 s (10 s while it is down) while the page is visible,
 * on network changes and when the page comes back to the front. onBack runs when the PC
 * answers again after being down, so the page can send its waiting sales at once.
 */
export function useShopPc(onBack?: () => void): ShopPcState {
  const [state, setState] = useState<ShopPcState>("checking");
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    let active = true;
    let checking = false;
    let last: ShopPcState = "checking";
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      if (checking) return;
      checking = true;
      clearTimeout(timer);
      const next = await checkShopPc();
      checking = false;
      if (!active) return;
      const back = next === "online" && isShopPcDown(last);
      last = next;
      setState(next);
      if (back) onBackRef.current?.();
      // A hidden page stops asking; it asks again when it comes back to the front.
      if (document.visibilityState === "visible") {
        timer = setTimeout(check, next === "online" ? CHECK_EVERY_MS.up : CHECK_EVERY_MS.down);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };

    void check();
    window.addEventListener("online", check);
    window.addEventListener("offline", check);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener("online", check);
      window.removeEventListener("offline", check);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return state;
}

/** The header pill: Online, PC offline (the phone is on the network, the shop PC isn't answering) or Offline. */
export function ConnectionBadge({ isOnline, shopPc }: { isOnline: boolean; shopPc: ShopPcState }) {
  const pcDown = isOnline && isShopPcDown(shopPc);
  return (
    <div className={`rz-pill transition-colors duration-300 ${!isOnline ? "rz-pill-danger" : pcDown ? "rz-pill-warn" : "rz-pill-ok"}`}>
      {/* The word is visible from sm up; on phones it stays readable for screen readers. */}
      {!isOnline ? (
        <><WifiOff className="w-3.5 h-3.5" /><span className="sr-only sm:not-sr-only">Offline</span></>
      ) : pcDown ? (
        <><ServerOff className="w-3.5 h-3.5" /><span className="sr-only sm:not-sr-only">PC offline</span></>
      ) : (
        <><Wifi className="w-3.5 h-3.5" /><span className="sr-only sm:not-sr-only">Online</span></>
      )}
    </div>
  );
}

/**
 * Shown while the shop PC can't record sales: reminds the barber that sales stay on this phone
 * until it reaches the PC again, and what to check. pending = sales waiting to sync.
 */
export function ShopPcReminder({ isOnline, shopPc, pending }: { isOnline: boolean; shopPc: ShopPcState; pending: number }) {
  if (isOnline && !isShopPcDown(shopPc)) return null;

  const one = pending === 1;
  const them = one ? "it" : "them";
  const saved =
    pending === 0
      ? "New sales are saved on this phone only."
      : `${pending} ${one ? "sale is" : "sales are"} saved on this phone only.`;
  const title = !isOnline ? "This phone is offline" : shopPc === "database-down" ? "Shop PC can't record sales" : "Shop PC offline";
  const fix = !isOnline
    ? `To record ${them}, connect this phone to the shop Wi-Fi.`
    : shopPc === "database-down"
      ? "Its database isn't running: tell the owner."
      : `To record ${them}, connect to the shop PC: keep this phone on the shop Wi-Fi, and check that the PC is on and running Ruzzco.`;
  const sent = one ? "It's sent by itself" : "They're sent by themselves";
  const Icon = isOnline ? ServerOff : WifiOff;

  return (
    <div role="status" className="animate-drop rz-notice rz-notice-warn">
      <Icon className="w-4.5 h-4.5 shrink-0 mt-px" />
      <div className="space-y-0.5">
        <p className="font-semibold">{title}</p>
        <p className="text-bone-2">
          {saved} {fix} {sent} once the PC answers, while the POS is open.
        </p>
      </div>
    </div>
  );
}

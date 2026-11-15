"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  Scissors,
  Clock,
  CheckCircle2,
  Banknote,
  Smartphone,
  QrCode,
  TriangleAlert,
  HardDrive,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { db, getOrCreateDeviceKey, type LocalTransaction } from "@/lib/db";
import { DEFAULT_CUSTOM_NOTE, discountLabel } from "@/lib/pricing";
import { collectedTotal } from "@/lib/charge";
import { peso } from "@/lib/peso";
import { paginate } from "@/lib/paginate";
import { countPending, isRejected, listRejected, retryRejected, summarizeSync, syncNow } from "@/lib/sync";
import { useLiveQuery } from "dexie-react-hooks";
import { BarberPoleIcon } from "@/components/RuzzcoBrand";
import { RejectedSales } from "@/components/RejectedSales";
import { DeviceApprovalBanner } from "@/components/DeviceApprovalBanner";
import { SignInGate, useStaffSession } from "@/components/SignInGate";
import { BarberHeader } from "@/components/BarberHeader";
import { QrPhCheckout } from "@/components/QrPhCheckout";
import { ShopPcReminder, isShopPcDown, useShopPc } from "@/components/ShopPcStatus";
import { manilaToday, parseBusinessDate } from "@/lib/business-date";

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}
function getOnlineSnapshot() {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}
const emptySubscribe = () => () => {};
function useMounted() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

// Slice 19: the shift log opens after the barber signs in, like the POS.
export default function ShiftLogPageWithSignIn() {
  return (
    <SignInGate title="Shift log">
      <ShiftLogPage />
    </SignInGate>
  );
}

function ShiftLogPage() {
  const mounted = useMounted();
  const staff = useStaffSession();
  // The phone's assignment, read from the phone itself: whose sales it records (the header says so).
  const binding = useLiveQuery(async () => {
    if (typeof window === "undefined") return null;
    return (await db.deviceBindings.get(getOrCreateDeviceKey()).catch(() => undefined)) ?? null;
  }, []);
  const isOnline = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, () => true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  // QR payment for a synced QRPH sale (after a Retry, or the row's "QR payment" button).
  const [qrSale, setQrSale] = useState<{ id: string; amount: number } | null>(null);
  // Slice 13: 20 sales a page, newest first, from the phone's own store (works with the PC off).
  const [page, setPage] = useState(1);

  const localTransactions = useLiveQuery(
    async () => {
      if (typeof window === "undefined") return [];
      return await db.transactions.orderBy("transactionTime").reverse().toArray();
    },
    [],
    [] as LocalTransaction[]
  );

  const pendingCount = useLiveQuery(
    async () => {
      if (typeof window === "undefined") return 0;
      return await countPending();
    },
    [],
    0
  );

  // Sales the server refused: kept on this device, not auto-retried, shown for attention
  const rejectedSales = useLiveQuery(
    async () => {
      if (typeof window === "undefined") return [];
      return await listRejected();
    },
    [],
    [] as LocalTransaction[]
  );

  // Daily summary
  // Today's Manila business day, [start, end); transactionTime is a UTC ISO instant.
  const today = parseBusinessDate(manilaToday())!;
  const todayTransactions = (localTransactions || []).filter((t) => {
    const at = new Date(t.transactionTime).getTime();
    return at >= today.start.getTime() && at < today.end.getTime();
  });
  const cashTotal = todayTransactions
    .filter((t) => t.paymentMethod === "CASH")
    .reduce((s, t) => s + Number(t.totalAmount), 0);
  const gcashTotal = todayTransactions
    .filter((t) => t.paymentMethod === "GCASH")
    .reduce((s, t) => s + Number(t.totalAmount), 0);
  const mayaTotal = todayTransactions
    .filter((t) => t.paymentMethod === "MAYA")
    .reduce((s, t) => s + Number(t.totalAmount), 0);

  const handleSync = useCallback(async () => {
    if (!navigator.onLine) return;
    setIsSyncing(true);
    try {
      // Same lifecycle as the POS: register the pending assignment, then sync.
      const outcome = await syncNow();
      setSyncFeedback(outcome.status === "failed" ? "Sync failed — queued locally" : summarizeSync(outcome));
      setTimeout(() => setSyncFeedback(null), 3000);
    } catch (err) {
      console.error("Sync error:", err);
      setSyncFeedback("Sync failed — queued locally");
      setTimeout(() => setSyncFeedback(null), 3000);
    } finally {
      setIsSyncing(false);
    }
  }, []);

  // Explicit retry of a rejected sale: re-queue it unchanged, then run the normal sync. A QRPH
  // sale that now reached the server goes straight to its QR payment (one charge per sale).
  const handleRetryRejected = useCallback(async (id: string) => {
    if (!navigator.onLine) return;
    setIsSyncing(true);
    try {
      const { outcome, qrCharge } = await retryRejected(id);
      setSyncFeedback(outcome.status === "failed" ? "Sync failed — queued locally" : summarizeSync(outcome));
      setTimeout(() => setSyncFeedback(null), 3000);
      if (qrCharge) setQrSale(qrCharge);
    } catch (err) {
      console.error("Retry error:", err);
      setSyncFeedback("Sync failed — queued locally");
      setTimeout(() => setSyncFeedback(null), 3000);
    } finally {
      setIsSyncing(false);
    }
  }, []);

  // The QR checkout only charges a sale that is on the server; it is already synced here.
  const qrSaleId = qrSale?.id;
  const ensureQrSaleSynced = useCallback(async () => {
    if (!qrSaleId || !navigator.onLine) return false;
    await syncNow();
    return (await db.transactions.get(qrSaleId))?.synced === 1;
  }, [qrSaleId]);

  // Auto-sync on reconnect
  useEffect(() => {
    window.addEventListener("online", handleSync);
    return () => window.removeEventListener("online", handleSync);
  }, [handleSync]);

  // ...and when the shop PC answers again after being down (the phone may have stayed online).
  const shopPc = useShopPc(handleSync);
  // An unsynced sale is "saved on this phone" while the phone can't reach the shop PC, and
  // "waiting to sync" once it can.
  const cannotSyncNow = !isOnline || isShopPcDown(shopPc);

  // The page number is clamped, so a list that shrank still shows a page that exists.
  const shown = paginate(localTransactions ?? [], page);

  if (!mounted) {
    return (
      <div role="status" className="rz-page flex-1 flex items-center justify-center gap-3 text-dust">
        <BarberPoleIcon className="w-3.5 h-8" spinning />
        <span>Loading shift log…</span>
      </div>
    );
  }

  return (
    <div className="flex-1">
      {qrSale && (
        <QrPhCheckout
          transactionId={qrSale.id}
          amount={qrSale.amount}
          ensureSynced={ensureQrSaleSynced}
          onClose={() => setQrSale(null)}
        />
      )}

      {/* The barber's header (slice 21b): shared with the POS. */}
      <BarberHeader
        current="/shift-log"
        title="Shift log"
        width="max-w-3xl"
        assignedBarber={binding ? { id: binding.barberId, name: binding.barberName } : null}
        account={staff.session}
        isOnline={isOnline}
        shopPc={shopPc}
        isSyncing={isSyncing}
        onSync={() => void handleSync()}
        pendingCount={pendingCount ?? 0}
        rejectedCount={rejectedSales?.length ?? 0}
      />

      <div className="rz-page relative max-w-3xl mx-auto px-4 py-5 space-y-5">
        {/* Announces sync results to screen readers; out of the layout flow. */}
        <p aria-live="polite" className="sr-only">{syncFeedback ?? ""}</p>

        {/* While the shop PC can't record sales: they stay on this phone until it can. */}
        <ShopPcReminder isOnline={isOnline} shopPc={shopPc} pending={pendingCount ?? 0} />

        <DeviceApprovalBanner onApproved={() => void handleSync()} />

        {/* Sync feedback */}
        {syncFeedback && (
          <div className="animate-drop rz-notice py-2.5">
            <Scissors className="w-4 h-4 text-brass shrink-0 mt-0.5" />
            {syncFeedback}
          </div>
        )}

        <RejectedSales sales={rejectedSales ?? []} busy={isSyncing} onRetry={handleRetryRejected} />

        {/* Today's Summary Cards: this phone's own records, provisional */}
        <p className="text-sm text-dust leading-relaxed">
          Totals below are from this phone only, leave out tips, and are provisional: they include sales not yet synced,
          and sales the server holds for a date review. End-of-Day Cash has the shop&apos;s official figures.
        </p>
        <section className="rz-strip grid-cols-2 sm:grid-cols-5 rz-stagger">
          {[
            {
              label: "Cuts Today",
              value: todayTransactions.length,
              accent: "text-bone",
              sub: "this phone (provisional)",
            },
            {
              label: "Total Revenue",
              value: peso(cashTotal + gcashTotal + mayaTotal),
              accent: "text-brass-bright",
              sub: "this phone (provisional)",
            },
            {
              // Bone, not red: in figures, red means "cash short".
              label: "Cash",
              value: peso(cashTotal),
              accent: "text-bone",
              sub: "this phone, cash",
            },
            {
              label: "GCash",
              value: peso(gcashTotal),
              accent: "text-gcash-ink",
              sub: "digital",
            },
            {
              label: "Maya",
              value: peso(mayaTotal),
              accent: "text-maya-ink",
              sub: "digital",
            },
          ].map((card) => (
            <div
              key={card.label}
              className="space-y-1 first:col-span-2 sm:first:col-span-1"
            >
              <div className="rz-label">
                {card.label}
              </div>
              <div className={`rz-figure text-2xl ${card.accent}`}>{card.value}</div>
              <div className="text-xs text-dust">{card.sub}</div>
            </div>
          ))}
        </section>

        {/* Transaction Feed */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="rz-heading">
              All Transactions (This Device)
            </h2>
            <span className="text-xs text-dust shrink-0">{localTransactions?.length ?? 0} total cuts</span>
          </div>

          {(!localTransactions || localTransactions.length === 0) ? (
            <div className="rz-panel p-8 text-center text-sm text-dust space-y-1.5">
              <p>No transactions logged on this device yet.</p>
              <p>
                Head back to the{" "}
                <Link href="/pos" className="rz-link">POS station</Link> to record a cut.
              </p>
            </div>
          ) : (
            <>
            <ul className="rz-panel overflow-hidden rz-rows rz-stagger">
              {shown.items.map((tx) => {
                const discount = discountLabel(tx);
                const note = tx.customAmount && tx.customAmountNote && tx.customAmountNote !== DEFAULT_CUSTOM_NOTE ? tx.customAmountNote : null;
                // Slice 17b: the row shows what was collected, tip included, like the POS done screen.
                const collected = collectedTotal(tx);
                return (
                <li
                  key={tx.id}
                  className="px-3.5 py-3 flex items-center justify-between gap-3 text-sm transition-colors duration-150 hover:bg-hover"
                >
                  <div className="space-y-0.5 truncate min-w-0">
                    <div className="font-semibold text-bone truncate flex items-center gap-1.5">
                      <span className="truncate">{tx.serviceName}</span>
                      {/* On a narrow phone the barber's name gives way first, so the service stays readable. */}
                      <span className="text-xs font-normal text-dust min-w-0 truncate shrink-[9999]">• {tx.barberName}</span>
                    </div>
                    <div className="text-xs text-dust flex items-center gap-2">
                      <span>
                        {new Date(tx.transactionTime).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className="font-mono text-dust-2">{tx.id.slice(0, 8)}…</span>
                    </div>
                    <SyncState state={syncStateOf(tx, cannotSyncNow)} />
                    {/* Slice 13: a loyalty sale says so; a custom amount shows its note. */}
                    {(discount || tx.customAmount) && (
                      <div className="text-xs text-bone-2 whitespace-normal break-words">
                        {discount && <span className="text-brass">{discount}</span>}
                        {tx.customAmount && <span>{discount ? " · " : ""}Custom amount{note ? `: ${note}` : ""}</span>}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    {/* Payment method badge */}
                    {tx.paymentMethod === "GCASH" ? (
                      <span className="rz-pill rz-pill-gcash">
                        <Smartphone className="w-3 h-3" />
                        GCash
                      </span>
                    ) : tx.paymentMethod === "QRPH" ? (
                      tx.synced === 1 ? (
                        // "Retry QR payment": opens the sale's QR (or shows its status). The server
                        // returns the existing charge, so this never charges a sale twice.
                        <button
                          type="button"
                          onClick={() => setQrSale({ id: tx.id, amount: Number(tx.totalAmount) })}
                          disabled={!isOnline}
                          className="rz-pill rz-pill-qrph min-h-6 pointer-coarse:min-h-11 transition-colors hover:bg-qrph/25 disabled:opacity-40"
                          title="Show this sale's QR payment and its status"
                        >
                          <QrCode className="w-3 h-3" />
                          QR payment
                        </button>
                      ) : (
                        <span className="rz-pill rz-pill-qrph" title="Paid status is on the server">
                          <QrCode className="w-3 h-3" />
                          QR Ph (test)
                        </span>
                      )
                    ) : tx.paymentMethod === "MAYA" ? (
                      <span className="rz-pill rz-pill-maya">
                        <Smartphone className="w-3 h-3" />
                        Maya
                      </span>
                    ) : (
                      <span className="rz-pill rz-pill-cash">
                        <Banknote className="w-3 h-3" />
                        Cash
                      </span>
                    )}

                    <span className="text-right">
                      <span className="block rz-figure text-base text-bone">{peso(collected.total)}</span>
                      {collected.tip > 0 && <span className="block text-xs text-dust tabular-nums">incl. {peso(collected.tip)} tip</span>}
                    </span>

                  </div>
                </li>
                );
              })}
            </ul>
            {shown.pageCount > 1 && (
              <nav aria-label="Sales pages" className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setPage(shown.page - 1)}
                  disabled={shown.page <= 1}
                  className="rz-btn rz-btn-secondary min-h-11 px-4 disabled:opacity-40"
                >
                  <ChevronLeft className="w-4 h-4" /> Previous
                </button>
                <span aria-live="polite" className="text-sm text-dust tabular-nums">Page {shown.page} of {shown.pageCount}</span>
                <button
                  type="button"
                  onClick={() => setPage(shown.page + 1)}
                  disabled={shown.page >= shown.pageCount}
                  className="rz-btn rz-btn-secondary min-h-11 px-4 disabled:opacity-40"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </nav>
            )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

// The four states a sale on this phone can be in, each with an icon and a word (slice 21b).
type SaleSyncState = "synced" | "attention" | "waiting" | "on-phone";

function syncStateOf(tx: LocalTransaction, cannotSyncNow: boolean): SaleSyncState {
  if (tx.synced === 1) return "synced";
  if (isRejected(tx)) return "attention";
  return cannotSyncNow ? "on-phone" : "waiting";
}

const SYNC_STATES: Record<SaleSyncState, { label: string; title: string; className: string; icon: typeof Clock }> = {
  synced: { label: "Synced", title: "Synced to the shop PC", className: "rz-pill-ok", icon: CheckCircle2 },
  attention: { label: "Needs attention", title: "The shop PC did not accept this sale; see the notice above", className: "rz-pill-warn", icon: TriangleAlert },
  waiting: { label: "Waiting to sync", title: "Saved on this phone; it is sent by itself", className: "", icon: Clock },
  "on-phone": { label: "Saved on this phone", title: "Saved on this phone only until it reaches the shop PC", className: "", icon: HardDrive },
};

function SyncState({ state }: { state: SaleSyncState }) {
  const { label, title, className, icon: Icon } = SYNC_STATES[state];
  return (
    <div>
      <span title={title} className={`rz-pill mt-1 ${className}`}>
        <Icon aria-hidden="true" className="w-3 h-3" />
        {label}
      </span>
    </div>
  );
}

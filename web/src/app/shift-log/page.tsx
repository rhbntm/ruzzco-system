"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Scissors,
  Clock,
  CheckCircle2,
  RefreshCw,
  Wifi,
  WifiOff,
  Banknote,
  Smartphone,
  QrCode,
  TriangleAlert,
} from "lucide-react";
import { db, type LocalTransaction } from "@/lib/db";
import { countPending, isRejected, listRejected, retryRejected, summarizeSync, syncNow } from "@/lib/sync";
import { useLiveQuery } from "dexie-react-hooks";
import { RuzzcoLogoBadge, BarberPoleIcon } from "@/components/RuzzcoBrand";
import { RejectedSales } from "@/components/RejectedSales";
import { QrPhCheckout } from "@/components/QrPhCheckout";
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

export default function ShiftLogPage() {
  const mounted = useMounted();
  const isOnline = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, () => true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  // QR payment for a synced QRPH sale (after a Retry, or the row's "QR payment" button).
  const [qrSale, setQrSale] = useState<{ id: string; amount: number } | null>(null);

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

  if (!mounted) {
    return (
      <div role="status" className="min-h-dvh bg-[#0b0c10] flex items-center justify-center text-zinc-400">
        <RefreshCw className="w-5 h-5 animate-spin text-red-500 mr-2" />
        <span>Loading shift log…</span>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-[#0b0c10] text-zinc-100 font-sans antialiased selection:bg-red-600 selection:text-white">
      {qrSale && (
        <QrPhCheckout
          transactionId={qrSale.id}
          amount={qrSale.amount}
          ensureSynced={ensureQrSaleSynced}
          onClose={() => setQrSale(null)}
        />
      )}

      {/* Ambient Crimson Glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-3xl h-48 bg-red-600/10 blur-3xl pointer-events-none" />

      <div className="relative max-w-3xl mx-auto px-4 py-4 space-y-5">
        {/* Header */}
        <header className="flex items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
          <Link
            href="/pos"
            className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors py-1.5 pr-2 pointer-coarse:min-h-11"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>POS Station</span>
          </Link>

          <div className="flex items-center gap-2">
            <RuzzcoLogoBadge size={28} showBorder={false} alt="" />
            <h1 className="font-extrabold tracking-wider text-base text-white uppercase font-(family-name:--font-oswald)">
              RUZZCO SHIFT LOG
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <div
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                isOnline
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-red-500/10 text-red-400 border-red-500/20"
              }`}
            >
              {isOnline ? (
                <><Wifi className="w-3 h-3" /><span>Online</span></>
              ) : (
                <><WifiOff className="w-3 h-3" /><span>Offline</span></>
              )}
            </div>
            {/* The counts are in the button's name; the badges only show them. */}
            <button
              onClick={handleSync}
              disabled={isSyncing || !isOnline}
              title="Sync pending transactions"
              aria-label={`Sync now${(pendingCount ?? 0) > 0 ? `, ${pendingCount} waiting` : ""}${(rejectedSales?.length ?? 0) > 0 ? `, ${rejectedSales?.length} need attention` : ""}`}
              className="relative inline-flex items-center justify-center min-h-9 min-w-9 pointer-coarse:min-h-11 pointer-coarse:min-w-11 rounded-lg bg-[#12141a] border border-[#232734] text-zinc-300 hover:text-white hover:bg-zinc-800 disabled:opacity-40 transition-all cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin text-red-400" : ""}`} />
              {(pendingCount ?? 0) > 0 && (
                <span aria-hidden="true" className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-red-600 text-white text-xs font-extrabold flex items-center justify-center animate-pulse">
                  {pendingCount}
                </span>
              )}
              {(rejectedSales?.length ?? 0) > 0 && (
                <span aria-hidden="true" title="Sales needing attention" className="absolute -bottom-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-amber-500 text-black text-xs font-extrabold flex items-center justify-center">
                  {rejectedSales?.length}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Announces sync results to screen readers; out of the layout flow. */}
        <p aria-live="polite" className="sr-only">{syncFeedback ?? ""}</p>

        {/* Sync feedback */}
        {syncFeedback && (
          <div className="p-2.5 rounded-lg bg-[#12141a] border border-red-500/30 text-xs text-red-300 flex items-center gap-2">
            <Scissors className="w-3.5 h-3.5 text-red-400 shrink-0" />
            {syncFeedback}
          </div>
        )}

        <RejectedSales sales={rejectedSales ?? []} busy={isSyncing} onRetry={handleRetryRejected} />

        {/* Today's Summary Cards: this phone's own records, provisional */}
        <p className="text-xs text-zinc-400">
          Totals below are from this phone only and are provisional: they include sales not yet synced, and sales the
          server holds for a date review. End-of-Day Cash has the shop&apos;s official figures.
        </p>
        <section className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            {
              label: "Cuts Today",
              value: todayTransactions.length,
              accent: "text-zinc-100",
              sub: "this phone (provisional)",
            },
            {
              label: "Total Revenue",
              value: `₱${(cashTotal + gcashTotal + mayaTotal).toFixed(2)}`,
              accent: "text-red-400 font-bold",
              sub: "this phone (provisional)",
            },
            {
              label: "Cash",
              value: `₱${cashTotal.toFixed(2)}`,
              accent: "text-emerald-400",
              sub: "this phone, cash",
            },
            {
              label: "GCash",
              value: `₱${gcashTotal.toFixed(2)}`,
              accent: "text-blue-400",
              sub: "digital",
            },
            {
              label: "Maya",
              value: `₱${mayaTotal.toFixed(2)}`,
              accent: "text-emerald-400",
              sub: "digital",
            },
          ].map((card) => (
            <div
              key={card.label}
              className="p-3.5 rounded-xl bg-[#12141a] border border-[#232734] space-y-1 relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 right-0 h-0.5 bg-barber-pole opacity-60" />
              <div className="text-xs text-zinc-400 uppercase tracking-wider font-semibold">
                {card.label}
              </div>
              <div className={`text-xl font-extrabold font-(family-name:--font-oswald) ${card.accent}`}>{card.value}</div>
              <div className="text-xs text-zinc-400">{card.sub}</div>
            </div>
          ))}
        </section>

        {/* Transaction Feed */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-zinc-300 uppercase tracking-wider font-(family-name:--font-oswald) flex items-center gap-1.5">
              <BarberPoleIcon className="w-2.5 h-4" />
              All Transactions (This Device)
            </h2>
            <span className="text-xs text-zinc-400">{localTransactions?.length ?? 0} total cuts</span>
          </div>

          <div className="space-y-2">
            {(!localTransactions || localTransactions.length === 0) ? (
              <div className="p-8 rounded-xl bg-[#12141a]/60 border border-dashed border-[#232734] text-center text-xs text-zinc-400 space-y-1">
                <p>No transactions logged on this device yet.</p>
                <p className="text-xs text-zinc-400">
                  Head back to the{" "}
                  <Link href="/pos" className="underline hover:text-white">POS station</Link> to record a cut.
                </p>
              </div>
            ) : (
              localTransactions.map((tx) => (
                <div
                  key={tx.id}
                  className="p-3 rounded-xl bg-[#12141a] border border-[#232734] flex items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-0.5 truncate min-w-0">
                    <div className="font-semibold text-zinc-200 truncate flex items-center gap-1.5">
                      <span>{tx.serviceName}</span>
                      <span className="text-xs text-zinc-400 shrink-0">• {tx.barberName}</span>
                    </div>
                    <div className="text-xs text-zinc-400 flex items-center gap-1.5">
                      <span>
                        {new Date(tx.transactionTime).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className="font-mono text-zinc-400">{tx.id.slice(0, 8)}…</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    {/* Payment method badge */}
                    {tx.paymentMethod === "GCASH" ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold">
                        <Smartphone className="w-2.5 h-2.5" />
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
                          className="inline-flex items-center gap-1 px-2.5 py-0.5 min-h-6 pointer-coarse:min-h-11 rounded-full bg-violet-500/10 border border-violet-500/30 text-violet-300 text-xs font-semibold hover:bg-violet-500/20 disabled:opacity-40 cursor-pointer"
                          title="Show this sale's QR payment and its status"
                        >
                          <QrCode className="w-2.5 h-2.5" />
                          QR payment
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs font-semibold" title="Paid status is on the server">
                          <QrCode className="w-2.5 h-2.5" />
                          QR Ph (test)
                        </span>
                      )
                    ) : tx.paymentMethod === "MAYA" ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
                        <Smartphone className="w-2.5 h-2.5" />
                        Maya
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-red-600/10 border border-red-500/20 text-red-400 text-xs font-semibold">
                        <Banknote className="w-2.5 h-2.5" />
                        Cash
                      </span>
                    )}

                    <span className="font-bold text-base text-zinc-100 font-(family-name:--font-oswald)">
                      ₱{Number(tx.totalAmount).toFixed(2)}
                    </span>

                    {/* Sync status dot */}
                    {/* Sync status: icon and colour for sighted users, a name for screen readers. */}
                    {tx.synced === 1 ? (
                      <span
                        role="img"
                        aria-label="Synced to server"
                        title="Synced to server"
                        className="w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                      </span>
                    ) : isRejected(tx) ? (
                      <span
                        role="img"
                        aria-label="Needs attention"
                        title="Needs attention"
                        className="w-5 h-5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center justify-center"
                      >
                        <TriangleAlert className="w-3 h-3" />
                      </span>
                    ) : (
                      <span
                        role="img"
                        aria-label="Pending sync"
                        title="Pending sync"
                        className="w-5 h-5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 flex items-center justify-center"
                      >
                        <Clock className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

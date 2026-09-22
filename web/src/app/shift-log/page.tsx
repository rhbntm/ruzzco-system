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
} from "lucide-react";
import { db, type LocalTransaction } from "@/lib/db";
import { useLiveQuery } from "dexie-react-hooks";

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
      return await db.transactions.where("synced").equals(0).count();
    },
    [],
    0
  );

  // Daily summary
  const todayStr = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD local
  const todayTransactions = (localTransactions || []).filter((t) =>
    t.transactionTime.startsWith(todayStr)
  );
  const cashTotal = todayTransactions
    .filter((t) => t.paymentMethod === "CASH")
    .reduce((s, t) => s + Number(t.totalAmount), 0);
  const gcashTotal = todayTransactions
    .filter((t) => t.paymentMethod === "GCASH")
    .reduce((s, t) => s + Number(t.totalAmount), 0);

  const handleSync = useCallback(async () => {
    if (!navigator.onLine) return;
    setIsSyncing(true);
    try {
      const pending = await db.transactions.where("synced").equals(0).toArray();
      if (pending.length === 0) {
        setSyncFeedback("All transactions are synced ✓");
        setTimeout(() => setSyncFeedback(null), 2500);
        return;
      }
      const deviceKey = localStorage.getItem("ruzzco_device_key") ?? undefined;
      const payload = {
        transactions: pending.map((t) => ({
          id: t.id,
          barberId: t.barberId,
          serviceId: t.serviceId,
          totalAmount: t.totalAmount,
          paymentMethod: t.paymentMethod,
          paymentReference: t.paymentReference ?? null,
          transactionTime: t.transactionTime,
          deviceKey,
        })),
      };
      const res = await fetch("/api/v1/transactions/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      if (result.success && Array.isArray(result.syncedIds)) {
        await db.transaction("rw", db.transactions, async () => {
          for (const id of result.syncedIds) {
            await db.transactions.update(id, { synced: 1, syncedAt: new Date().toISOString() });
          }
        });
        setSyncFeedback(`Synced ${result.processedCount} new, ${result.duplicatesSkipped} verified`);
        setTimeout(() => setSyncFeedback(null), 3000);
      }
    } catch (err) {
      console.error("Sync error:", err);
      setSyncFeedback("Sync failed — queued locally");
      setTimeout(() => setSyncFeedback(null), 3000);
    } finally {
      setIsSyncing(false);
    }
  }, []);

  // Auto-sync on reconnect
  useEffect(() => {
    window.addEventListener("online", handleSync);
    return () => window.removeEventListener("online", handleSync);
  }, [handleSync]);

  if (!mounted) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-400">
        <RefreshCw className="w-5 h-5 animate-spin text-amber-500 mr-2" />
        <span>Loading shift log…</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans antialiased">
      {/* Glow accent */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-3xl h-48 bg-amber-500/8 blur-3xl pointer-events-none" />

      <div className="relative max-w-3xl mx-auto px-4 py-4 space-y-5">
        {/* Header */}
        <header className="flex items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
          <Link
            href="/pos"
            className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors py-1.5 pr-2"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>POS</span>
          </Link>

          <div className="flex items-center gap-1.5">
            <div className="w-6 h-6 rounded-md bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <Scissors className="w-3.5 h-3.5" />
            </div>
            <span className="font-bold tracking-tight text-sm text-white">SHIFT LOG</span>
          </div>

          <div className="flex items-center gap-2">
            <div
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
                isOnline
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-rose-500/10 text-rose-400 border-rose-500/20"
              }`}
            >
              {isOnline ? (
                <><Wifi className="w-3 h-3" /><span>Online</span></>
              ) : (
                <><WifiOff className="w-3 h-3" /><span>Offline</span></>
              )}
            </div>
            <button
              onClick={handleSync}
              disabled={isSyncing || !isOnline}
              title="Sync pending transactions"
              className="relative p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-800 disabled:opacity-40 transition-all cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin text-amber-400" : ""}`} />
              {(pendingCount ?? 0) > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 text-black text-[9px] font-extrabold flex items-center justify-center animate-pulse">
                  {pendingCount}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Sync feedback */}
        {syncFeedback && (
          <div className="p-2.5 rounded-lg bg-zinc-900/90 border border-amber-500/30 text-xs text-amber-300 flex items-center gap-2">
            <Scissors className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            {syncFeedback}
          </div>
        )}

        {/* Today's Summary Cards */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: "Cuts Today",
              value: todayTransactions.length,
              accent: "text-zinc-100",
              sub: "this device",
            },
            {
              label: "Total Revenue",
              value: `₱${(cashTotal + gcashTotal).toFixed(2)}`,
              accent: "text-amber-400",
              sub: "all methods",
            },
            {
              label: "Cash",
              value: `₱${cashTotal.toFixed(2)}`,
              accent: "text-emerald-400",
              sub: "in drawer",
            },
            {
              label: "GCash",
              value: `₱${gcashTotal.toFixed(2)}`,
              accent: "text-blue-400",
              sub: "digital",
            },
          ].map((card) => (
            <div
              key={card.label}
              className="p-3 rounded-xl bg-zinc-900/70 border border-zinc-800/80 space-y-1"
            >
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
                {card.label}
              </div>
              <div className={`text-lg font-extrabold ${card.accent}`}>{card.value}</div>
              <div className="text-[10px] text-zinc-600">{card.sub}</div>
            </div>
          ))}
        </section>

        {/* Transaction Feed */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              All Transactions (This Device)
            </span>
            <span className="text-[11px] text-zinc-500">{localTransactions?.length ?? 0} total</span>
          </div>

          <div className="space-y-2">
            {(!localTransactions || localTransactions.length === 0) ? (
              <div className="p-8 rounded-xl bg-zinc-900/30 border border-dashed border-zinc-800 text-center text-xs text-zinc-500 space-y-1">
                <p>No transactions logged on this device yet.</p>
                <p className="text-[11px] text-zinc-600">Head back to the POS to record a cut.</p>
              </div>
            ) : (
              localTransactions.map((tx) => (
                <div
                  key={tx.id}
                  className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/80 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-0.5 truncate min-w-0">
                    <div className="font-medium text-zinc-200 truncate flex items-center gap-1.5">
                      <span>{tx.serviceName}</span>
                      <span className="text-[10px] text-zinc-500 shrink-0">• {tx.barberName}</span>
                    </div>
                    <div className="text-[10px] text-zinc-500 flex items-center gap-1.5">
                      <span>
                        {new Date(tx.transactionTime).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className="font-mono text-zinc-600">{tx.id.slice(0, 8)}…</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    {/* Payment method badge */}
                    {tx.paymentMethod === "GCASH" ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-semibold">
                        <Smartphone className="w-2.5 h-2.5" />
                        GCash
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-semibold">
                        <Banknote className="w-2.5 h-2.5" />
                        Cash
                      </span>
                    )}

                    <span className="font-bold text-sm text-zinc-100">
                      ₱{Number(tx.totalAmount).toFixed(2)}
                    </span>

                    {/* Sync status dot */}
                    {tx.synced === 1 ? (
                      <span
                        title="Synced to server"
                        className="w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center text-[10px]"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                      </span>
                    ) : (
                      <span
                        title="Pending sync"
                        className="w-5 h-5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center text-[10px]"
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

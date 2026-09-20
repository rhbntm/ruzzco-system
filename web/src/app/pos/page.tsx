"use client";

import { useEffect, useState, useCallback, useTransition, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  Scissors,
  Wifi,
  WifiOff,
  RefreshCw,
  CheckCircle2,
  Clock,
  User,
  ArrowLeft,
  Sparkles,
  DollarSign,
  Layers,
} from "lucide-react";
import {
  db,
  initializeLocalCatalog,
  type LocalTransaction,
  type CachedBarber,
  type CachedService,
  DEFAULT_BARBERS,
  DEFAULT_SERVICES,
} from "@/lib/db";
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

function getServerOnlineSnapshot() {
  return true;
}

const emptySubscribe = () => () => {};

function useMounted() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

export default function MobilePOSPage() {
  const mounted = useMounted();
  const isOnline = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, getServerOnlineSnapshot);
  const [barbers, setBarbers] = useState<CachedBarber[]>(DEFAULT_BARBERS);
  const [services, setServices] = useState<CachedService[]>(DEFAULT_SERVICES);
  const [selectedBarberId, setSelectedBarberId] = useState<string>(DEFAULT_BARBERS[0].id);
  const [selectedServiceId, setSelectedServiceId] = useState<string>(DEFAULT_SERVICES[0].id);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [lastActionToast, setLastActionToast] = useState<{
    message: string;
    type: "success" | "info";
  } | null>(null);

  const [, startTransition] = useTransition();

  // Reactive IndexedDB queries via Dexie React Hooks
  const localTransactions = useLiveQuery(
    async () => {
      if (typeof window === "undefined") return [];
      return await db.transactions.reverse().sortBy("transactionTime");
    },
    [],
    []
  );

  const pendingCount = useLiveQuery(
    async () => {
      if (typeof window === "undefined") return 0;
      return await db.transactions.where("synced").equals(0).count();
    },
    [],
    0
  );

  // Sync dispatcher function
  const triggerSync = useCallback(async () => {
    if (typeof window === "undefined" || !navigator.onLine) return;

    try {
      setIsSyncing(true);
      const pending = await db.transactions.where("synced").equals(0).toArray();

      if (pending.length === 0) {
        setSyncFeedback("All transactions are synced");
        setTimeout(() => setSyncFeedback(null), 2500);
        return;
      }

      const payload = {
        transactions: pending.map((t) => ({
          id: t.id,
          barberId: t.barberId,
          serviceId: t.serviceId,
          totalAmount: t.totalAmount,
          paymentMethod: t.paymentMethod,
          paymentReference: t.paymentReference ?? null,
          transactionTime: t.transactionTime,
        })),
      };

      const response = await fetch("/api/v1/transactions/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Sync failed with HTTP ${response.status}`);
      }

      const result = await response.json();

      if (result.success && Array.isArray(result.syncedIds)) {
        // Mark all confirmed IDs as synced in Dexie
        await db.transaction("rw", db.transactions, async () => {
          for (const syncedId of result.syncedIds) {
            await db.transactions.update(syncedId, {
              synced: 1,
              syncedAt: new Date().toISOString(),
            });
          }
        });

        setSyncFeedback(`Synced ${result.processedCount} new, ${result.duplicatesSkipped} verified`);
        setTimeout(() => setSyncFeedback(null), 3500);
      }
    } catch (err) {
      console.error("Auto-sync error:", err);
      setSyncFeedback("Sync failed. Queued locally.");
      setTimeout(() => setSyncFeedback(null), 3000);
    } finally {
      setIsSyncing(false);
    }
  }, []);

  // Listen for online reconnect events to trigger auto-sync
  useEffect(() => {
    const handleOnline = () => {
      triggerSync();
    };

    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [triggerSync]);

  // Initialize DB catalog on mount
  useEffect(() => {
    let active = true;

    async function setupCatalog() {
      await initializeLocalCatalog();

      // Read initial cache from Dexie
      const cachedB = await db.barbers.filter((b) => b.isActive).toArray();
      if (!active) return;
      if (cachedB.length > 0) setBarbers(cachedB);

      const cachedS = await db.services.filter((s) => s.isActive).toArray();
      if (!active) return;
      if (cachedS.length > 0) setServices(cachedS);

      // Restore saved barber preference
      const savedBarber = localStorage.getItem("ruzzco_active_barber_id");
      if (savedBarber && cachedB.some((b) => b.id === savedBarber)) {
        setSelectedBarberId(savedBarber);
      } else if (cachedB.length > 0) {
        setSelectedBarberId(cachedB[0].id);
      }

      // Try fetching fresh catalog if online
      if (navigator.onLine) {
        try {
          const res = await fetch("/api/v1/catalog");
          if (res.ok && active) {
            const data = await res.json();
            if (data.barbers && data.services) {
              setBarbers(data.barbers);
              setServices(data.services);
              await db.barbers.clear();
              await db.barbers.bulkPut(data.barbers);
              await db.services.clear();
              await db.services.bulkPut(data.services);
            }
          }
        } catch (e) {
          console.warn("Could not refresh catalog online, using cache:", e);
        }
      }
    }

    setupCatalog();

    return () => {
      active = false;
    };
  }, []);

  // Handle selecting a barber & save to localStorage
  const handleSelectBarber = (barberId: string) => {
    setSelectedBarberId(barberId);
    localStorage.setItem("ruzzco_active_barber_id", barberId);
  };

  // 2-Tap Cash Checkout Handler
  const handleCashCheckout = async () => {
    const barber = barbers.find((b) => b.id === selectedBarberId);
    const service = services.find((s) => s.id === selectedServiceId);

    if (!barber || !service) return;

    const newTransaction: LocalTransaction = {
      id: crypto.randomUUID(),
      barberId: barber.id,
      barberName: barber.fullName,
      serviceId: service.id,
      serviceName: service.name,
      price: service.standardPrice,
      totalAmount: service.standardPrice,
      paymentMethod: "CASH",
      transactionTime: new Date().toISOString(),
      synced: 0,
      syncedAt: null,
    };

    // 1. Write to Dexie IndexedDB
    await db.transactions.add(newTransaction);

    // 2. Show fast UI feedback
    setLastActionToast({
      message: `₱${service.standardPrice} Cash collected for ${barber.fullName}`,
      type: "success",
    });
    setTimeout(() => setLastActionToast(null), 3000);

    // 3. Trigger immediate sync if online
    if (navigator.onLine) {
      startTransition(() => {
        triggerSync();
      });
    }
  };

  const selectedBarber = barbers.find((b) => b.id === selectedBarberId) || barbers[0];
  const selectedService = services.find((s) => s.id === selectedServiceId) || services[0];

  // Daily totals calculated locally from device transactions
  const totalAmountToday = (localTransactions || []).reduce(
    (sum, t) => sum + Number(t.totalAmount),
    0
  );
  const totalCutsToday = (localTransactions || []).length;

  if (!mounted) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-400">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-5 h-5 animate-spin text-amber-500" />
          <span>Loading Ruzzco POS...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans antialiased selection:bg-amber-500 selection:text-black pb-24">
      {/* Glow background accent */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-md h-64 bg-amber-500/10 blur-3xl pointer-events-none" />

      {/* Main Container */}
      <div className="relative max-w-md mx-auto px-4 py-4 space-y-5">
        {/* Navigation & Status Header */}
        <header className="flex items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors py-1.5 pr-2"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Hub</span>
          </Link>

          <div className="flex items-center gap-1.5">
            <div className="w-6 h-6 rounded-md bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
              <Scissors className="w-3.5 h-3.5" />
            </div>
            <span className="font-bold tracking-tight text-sm text-white">RUZZCO POS</span>
          </div>

          {/* Network & Sync Badge */}
          <div className="flex items-center gap-2">
            <div
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
                isOnline
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-rose-500/10 text-rose-400 border-rose-500/20"
              }`}
            >
              {isOnline ? (
                <>
                  <Wifi className="w-3 h-3 text-emerald-400" />
                  <span>Online</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3 h-3 text-rose-400" />
                  <span>Offline</span>
                </>
              )}
            </div>

            {/* Manual Sync Trigger */}
            <button
              onClick={triggerSync}
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

        {/* Sync Feedback Toast */}
        {syncFeedback && (
          <div className="p-2.5 rounded-lg bg-zinc-900/90 border border-amber-500/30 text-xs text-amber-300 flex items-center justify-between animate-fadeIn">
            <span className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              {syncFeedback}
            </span>
          </div>
        )}

        {/* Action Confirmation Toast */}
        {lastActionToast && (
          <div className="p-3 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-xs text-emerald-200 flex items-center gap-2 animate-fadeIn shadow-lg shadow-emerald-950/50">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-medium">{lastActionToast.message}</span>
          </div>
        )}

        {/* STEP 1: Select Active Barber (1-Tap Sticky Switcher) */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-amber-400" />
              1. Active Barber
            </span>
            <span className="text-[11px] text-zinc-500">Tap to switch</span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {barbers.map((barber) => {
              const isSelected = barber.id === selectedBarberId;
              return (
                <button
                  key={barber.id}
                  onClick={() => handleSelectBarber(barber.id)}
                  type="button"
                  className={`min-h-[52px] p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between ${
                    isSelected
                      ? "bg-amber-500/15 border-amber-500/80 text-white shadow-sm shadow-amber-500/20"
                      : "bg-zinc-900/70 border-zinc-800/80 text-zinc-300 hover:bg-zinc-800/60"
                  }`}
                >
                  <div className="space-y-0.5 truncate">
                    <div className="font-semibold text-sm truncate">{barber.fullName}</div>
                    <div className="text-[10px] text-zinc-400">
                      {Math.round(barber.commissionRate * 100)}% commission
                    </div>
                  </div>
                  {isSelected && (
                    <div className="w-5 h-5 rounded-full bg-amber-500 text-black flex items-center justify-center text-xs font-bold shrink-0 ml-2">
                      ✓
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        {/* STEP 2: Service Selection (Touch Targets >= 56px) */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              2. Select Service
            </span>
            <span className="text-[11px] text-zinc-500">Tap service</span>
          </div>

          <div className="grid grid-cols-1 gap-2.5">
            {services.map((service) => {
              const isSelected = service.id === selectedServiceId;
              return (
                <button
                  key={service.id}
                  onClick={() => setSelectedServiceId(service.id)}
                  type="button"
                  className={`min-h-[58px] p-4 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between ${
                    isSelected
                      ? "bg-gradient-to-r from-amber-500/20 to-zinc-900 border-amber-500/80 text-white shadow-md shadow-amber-500/10"
                      : "bg-zinc-900/70 border-zinc-800/80 text-zinc-300 hover:bg-zinc-800/60"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                        isSelected ? "bg-amber-500 text-black font-bold" : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      <Scissors className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-semibold text-sm text-white">{service.name}</div>
                      <div className="text-[11px] text-zinc-400">Standard Service</div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="font-extrabold text-base text-amber-400">
                      ₱{service.standardPrice.toFixed(2)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* 2-Tap Primary Checkout Action */}
        <section className="pt-2">
          <button
            onClick={handleCashCheckout}
            type="button"
            className="w-full min-h-[56px] py-4 px-6 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 active:scale-[0.98] text-black font-bold text-base shadow-lg shadow-amber-500/25 flex items-center justify-center gap-2.5 transition-all cursor-pointer"
          >
            <DollarSign className="w-5 h-5 stroke-[2.5]" />
            <span>
              Record Cash — ₱{selectedService ? selectedService.standardPrice.toFixed(2) : "0.00"}
            </span>
          </button>
          <p className="text-center text-[11px] text-zinc-500 mt-2">
            Logging cut for <strong className="text-zinc-300">{selectedBarber?.fullName}</strong> •
            Saves offline immediately
          </p>
        </section>

        {/* Device Shift Summary & Queue Feed */}
        <section className="space-y-3 pt-4 border-t border-zinc-800/80">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                Shift Log (This Device)
              </h2>
              <div className="text-xs text-zinc-500">
                {totalCutsToday} cuts logged • ₱{totalAmountToday.toFixed(2)} total
              </div>
            </div>

            {(pendingCount ?? 0) > 0 ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                <Clock className="w-3 h-3" />
                {pendingCount} Pending Sync
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                <CheckCircle2 className="w-3 h-3" />
                Cloud Synced
              </span>
            )}
          </div>

          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {(!localTransactions || localTransactions.length === 0) ? (
              <div className="p-6 rounded-xl bg-zinc-900/30 border border-dashed border-zinc-800 text-center text-xs text-zinc-500 space-y-1">
                <p>No haircuts logged on this device today.</p>
                <p className="text-[11px] text-zinc-600">
                  Tap service and record above to start shift.
                </p>
              </div>
            ) : (
              localTransactions.map((tx) => (
                <div
                  key={tx.id}
                  className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/80 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-0.5 truncate">
                    <div className="font-medium text-zinc-200 truncate flex items-center gap-1.5">
                      <span>{tx.serviceName}</span>
                      <span className="text-[10px] text-zinc-500">• {tx.barberName}</span>
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      {new Date(tx.transactionTime).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {" • "}
                      <span className="font-mono text-zinc-400">
                        {tx.id.slice(0, 8)}...
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-bold text-sm text-zinc-100">
                      ₱{Number(tx.totalAmount).toFixed(2)}
                    </span>

                    {tx.synced === 1 ? (
                      <span
                        title="Synced to cloud"
                        className="w-5 h-5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center text-[10px]"
                      >
                        ✓
                      </span>
                    ) : (
                      <span
                        title="Queued in local storage"
                        className="w-5 h-5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center justify-center text-[10px]"
                      >
                        ⏱
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

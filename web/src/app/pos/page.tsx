"use client";

import {
  useEffect,
  useState,
  useCallback,
  useTransition,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import {
  Scissors,
  Wifi,
  WifiOff,
  RefreshCw,
  CheckCircle2,
  Clock,
  User,
  Sparkles,
  Layers,
  Banknote,
  Smartphone,
  Settings,
  List,
  X,
  ChevronRight,
} from "lucide-react";
import {
  db,
  initializeLocalCatalog,
  getOrCreateDeviceKey,
  generateUUID,
  type LocalTransaction,
  type CachedBarber,
  type CachedService,
  type LocalDeviceBinding,
  DEFAULT_BARBERS,
  DEFAULT_SERVICES,
} from "@/lib/db";
import { useLiveQuery } from "dexie-react-hooks";
import { RuzzcoLogoBadge, MustacheIcon, BarberPoleIcon } from "@/components/RuzzcoBrand";

// ─── Online status hooks ───────────────────────────────────────────────────────

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
// ─── Component ────────────────────────────────────────────────────────────────

export default function MobilePOSPage() {
  const isOnline = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, () => true);

  // Catalog state
  const [barbers, setBarbers] = useState<CachedBarber[]>(DEFAULT_BARBERS);
  const [services, setServices] = useState<CachedService[]>(DEFAULT_SERVICES);
  const [selectedServiceId, setSelectedServiceId] = useState<string>(DEFAULT_SERVICES[0].id);

  // Device binding state
  const [binding, setBinding] = useState<LocalDeviceBinding | null>(null);
  const [bindingLoaded, setBindingLoaded] = useState(false);
  const [showBindModal, setShowBindModal] = useState(false);
  const [isBinding, setIsBinding] = useState(false);
  const [loadTimeout, setLoadTimeout] = useState(false);

  // GCash modal state
  const [showGCashModal, setShowGCashModal] = useState(false);
  const [gcashRef, setGcashRef] = useState("");
  const [isGCashSubmitting, setIsGCashSubmitting] = useState(false);

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [lastActionToast, setLastActionToast] = useState<{
    message: string;
    type: "success" | "info";
  } | null>(null);

  const [, startTransition] = useTransition();

  // Safety fallback if local IndexedDB or catalog takes long on mobile
  useEffect(() => {
    const timer = setTimeout(() => setLoadTimeout(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  // ── Live IndexedDB queries ──────────────────────────────────────────────────

  const pendingCount = useLiveQuery(
    async () => {
      try {
        if (typeof window === "undefined") return 0;
        return await db.transactions.where("synced").equals(0).count();
      } catch {
        return 0;
      }
    },
    [],
    0
  );

  // Last 5 transactions for sidebar preview
  const recentTransactions = useLiveQuery(
    async () => {
      try {
        if (typeof window === "undefined") return [];
        return await db.transactions.orderBy("transactionTime").reverse().limit(5).toArray();
      } catch {
        return [];
      }
    },
    [],
    [] as LocalTransaction[]
  );

  // ── Sync dispatcher ─────────────────────────────────────────────────────────

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
      const deviceKey = getOrCreateDeviceKey();
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
      const response = await fetch("/api/v1/transactions/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`Sync failed: HTTP ${response.status}`);
      const result = await response.json();
      if (result.success && Array.isArray(result.syncedIds)) {
        await db.transaction("rw", db.transactions, async () => {
          for (const id of result.syncedIds) {
            await db.transactions.update(id, { synced: 1, syncedAt: new Date().toISOString() });
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

  // Flush a pending offline bind to the server on reconnect
  const flushPendingBind = useCallback(async () => {
    try {
      const PENDING_KEY = "ruzzco_pending_bind";
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(PENDING_KEY) : null;
      if (!raw) return;
      const { deviceKey, barberId } = JSON.parse(raw) as { deviceKey: string; barberId: string };
      const res = await fetch("/api/v1/devices/bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceKey, barberId }),
      });
      if (res.ok) {
        localStorage.removeItem(PENDING_KEY);
        console.info("[bind] Offline bind flushed to server.");
      }
      // If not ok, leave it in localStorage — will retry next online event
    } catch {
      // Server unreachable — will retry next time
    }
  }, []);

  // Auto-sync and flush pending bind on reconnect
  useEffect(() => {
    const handleOnline = () => {
      flushPendingBind();
      triggerSync();
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [triggerSync, flushPendingBind]);

  // ── Device binding initialization ───────────────────────────────────────────

  useEffect(() => {
    let active = true;

    async function initBinding() {
      try {
        await initializeLocalCatalog();

        // Load catalog
        const cachedB = await db.barbers.filter((b) => b.isActive).toArray();
        if (active && cachedB.length > 0) setBarbers(cachedB);
        const cachedS = await db.services.filter((s) => s.isActive).toArray();
        if (active && cachedS.length > 0) setServices(cachedS);

        // Refresh catalog from server if online
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
            console.warn("Could not refresh catalog, using cache:", e);
          }
        }

        // Load local binding
        const deviceKey = getOrCreateDeviceKey();
        const localBinding = await db.deviceBindings.get(deviceKey);

        if (localBinding) {
          if (active) {
            setBinding(localBinding);
            setBindingLoaded(true);
          }
          // Background verify server-side binding if online
          if (navigator.onLine) {
            try {
              const res = await fetch(`/api/v1/devices/binding?deviceKey=${encodeURIComponent(deviceKey)}`);
              if (res.ok) {
                const data = await res.json();
                if (!data.bound) {
                  // Server revoked — clear local and prompt re-bind
                  await db.deviceBindings.delete(deviceKey);
                  if (active) {
                    setBinding(null);
                    setShowBindModal(true);
                  }
                }
              }
            } catch {
              // Stay with local binding if server is unreachable
            }
          }
        } else {
          // No local binding — show first-boot modal
          if (active) {
            setBindingLoaded(true);
            setShowBindModal(true);
          }
        }
      } catch (err) {
        console.error("Failed to initialize POS binding/catalog:", err);
        if (active) {
          // Fallback to defaults and allow modal/POS to render instead of locking on loading screen
          setBindingLoaded(true);
          setShowBindModal(true);
        }
      }
    }

    initBinding();
    return () => { active = false; };
  }, []);

  // ── Device bind action ──────────────────────────────────────────────────────

  const handleBindDevice = async (barber: CachedBarber) => {
    setIsBinding(true);
    try {
      const deviceKey = getOrCreateDeviceKey();
      const newBinding: LocalDeviceBinding = {
        deviceKey,
        barberId: barber.id,
        barberName: barber.fullName,
        assignedAt: new Date().toISOString(),
      };

      // Persist locally first — POS is usable immediately even if offline
      await db.deviceBindings.put(newBinding);
      setBinding(newBinding);
      setShowBindModal(false);

      // Always store a pending bind so it can be flushed on reconnect
      const PENDING_KEY = "ruzzco_pending_bind";
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(PENDING_KEY, JSON.stringify({ deviceKey, barberId: barber.id }));
      }

      // Attempt server sync immediately if online; clear pending on success
      if (navigator.onLine) {
        try {
          const res = await fetch("/api/v1/devices/bind", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deviceKey, barberId: barber.id }),
          });
          if (res.ok && typeof localStorage !== "undefined") {
            localStorage.removeItem(PENDING_KEY);
          }
          // If server returned an error, leave pending — flushPendingBind will retry
        } catch {
          // Network failure — flushPendingBind will retry on next online event
        }
      }
    } catch (e) {
      console.error("Error binding device:", e);
    } finally {
      setIsBinding(false);
    }
  };

  // ── Transaction recording ───────────────────────────────────────────────────

  const recordTransaction = useCallback(
    async (method: "CASH" | "GCASH", reference?: string) => {
      if (!binding) return;
      const service = services.find((s) => s.id === selectedServiceId) || services[0];
      if (!service) return;

      const newTransaction: LocalTransaction = {
        id: generateUUID(),
        barberId: binding.barberId,
        barberName: binding.barberName,
        serviceId: service.id,
        serviceName: service.name,
        price: service.standardPrice,
        totalAmount: service.standardPrice,
        paymentMethod: method,
        paymentReference: reference ?? null,
        transactionTime: new Date().toISOString(),
        synced: 0,
        syncedAt: null,
      };

      await db.transactions.add(newTransaction);

      const methodLabel = method === "GCASH" ? "GCash" : "Cash";
      setLastActionToast({
        message: `₱${service.standardPrice.toFixed(2)} ${methodLabel} — ${binding.barberName}`,
        type: "success",
      });
      setTimeout(() => setLastActionToast(null), 3000);

      if (navigator.onLine) {
        startTransition(() => { triggerSync(); });
      }
    },
    [binding, services, selectedServiceId, triggerSync]
  );

  const handleCashCheckout = () => recordTransaction("CASH");

  const handleGCashConfirm = async () => {
    setIsGCashSubmitting(true);
    await recordTransaction("GCASH", gcashRef.trim() || undefined);
    setIsGCashSubmitting(false);
    setShowGCashModal(false);
    setGcashRef("");
  };

  // ── Derived values ──────────────────────────────────────────────────────────

  const selectedService = services.find((s) => s.id === selectedServiceId) || services[0];

  // ── Loading screen ──────────────────────────────────────────────────────────

  if (!bindingLoaded) {
    return (
      <div className="min-h-screen bg-[#0b0c10] flex flex-col items-center justify-center text-zinc-400 p-6 space-y-5">
        <div className="flex flex-col items-center gap-3">
          <RuzzcoLogoBadge size={72} />
          <div className="text-center space-y-1">
            <h2 className="text-xl font-extrabold uppercase font-[family-name:var(--font-oswald)] tracking-wider text-white">
              Ruzzco Barbers
            </h2>
            <p className="text-[11px] uppercase tracking-[0.2em] text-red-500 font-semibold">
              Premium Cut &amp; Shave
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-400 pt-2">
            <RefreshCw className="w-4 h-4 animate-spin text-red-500" />
            <span>Initializing POS station…</span>
          </div>
        </div>
        {loadTimeout && (
          <div className="text-center space-y-2 max-w-xs pt-4">
            <p className="text-xs text-zinc-500">
              Taking longer to initialize local cache.
            </p>
            <button
              onClick={() => {
                setBindingLoaded(true);
                setShowBindModal(true);
              }}
              className="px-4 py-2 text-xs font-semibold bg-[#161822] hover:bg-zinc-800 active:scale-95 text-red-400 rounded-lg border border-[#232734] cursor-pointer transition-all"
            >
              Skip Loading &amp; Continue
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── First-boot binding modal ────────────────────────────────────────────────

  if (showBindModal) {
    return (
      <div className="min-h-screen bg-[#0b0c10] text-zinc-100 font-sans antialiased flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-3">
            <div className="mx-auto flex justify-center">
              <RuzzcoLogoBadge size={64} />
            </div>
            <div>
              <span className="text-[10px] font-bold tracking-[0.25em] text-red-500 uppercase">
                Station Setup
              </span>
              <h1 className="text-2xl font-bold uppercase font-[family-name:var(--font-oswald)] text-white tracking-wide">
                Assign Station Barber
              </h1>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Select the barber operating this station. All cuts logged here will automatically attribute to their commission and shift record.
            </p>
          </div>

          <div className="space-y-3">
            {barbers.map((barber) => (
              <button
                key={barber.id}
                onClick={() => handleBindDevice(barber)}
                disabled={isBinding}
                className="w-full min-h-[64px] p-4 rounded-xl border border-[#232734] bg-[#12141a] hover:border-red-500/70 hover:bg-red-950/20 active:scale-[0.98] text-left transition-all cursor-pointer disabled:opacity-50 flex items-center justify-between gap-3 group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-600/20 border border-red-500/30 text-red-400 group-hover:bg-red-600 group-hover:text-white transition-colors flex items-center justify-center font-bold text-sm">
                    {barber.fullName.charAt(0)}
                  </div>
                  <div>
                    <div className="font-semibold text-white">{barber.fullName}</div>
                    <div className="text-xs text-zinc-500">
                      {Math.round(barber.commissionRate * 100)}% commission rate
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-red-400 transition-colors" />
              </button>
            ))}
          </div>

          {!isOnline && (
            <p className="text-center text-[11px] text-zinc-500">
              Station is offline — barber assignment will sync upon reconnection.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Main POS UI ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0b0c10] text-zinc-100 font-sans antialiased selection:bg-red-600 selection:text-white">
      {/* Ambient Crimson Glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-5xl h-64 bg-red-600/10 blur-3xl pointer-events-none" />

      {/* GCash Reference Modal */}
      {showGCashModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-[#12141a] border border-[#232734] rounded-2xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-blue-400" />
                <span className="font-bold text-white font-[family-name:var(--font-oswald)] uppercase tracking-wide">
                  GCash Payment
                </span>
              </div>
              <button
                onClick={() => { setShowGCashModal(false); setGcashRef(""); }}
                className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <div className="text-3xl font-extrabold text-blue-400 text-center py-2 font-[family-name:var(--font-oswald)]">
                ₱{selectedService?.standardPrice.toFixed(2)}
              </div>
              <p className="text-xs text-zinc-400 text-center mb-3">
                Have the customer scan the QR code and send{" "}
                <strong className="text-white">₱{selectedService?.standardPrice.toFixed(2)}</strong>,
                then enter the reference number below.
              </p>
              <input
                type="text"
                inputMode="numeric"
                placeholder="GCash ref. no. (optional)"
                value={gcashRef}
                onChange={(e) => setGcashRef(e.target.value)}
                maxLength={20}
                className="w-full px-3 py-2.5 rounded-lg bg-[#181b24] border border-[#232734] text-white text-sm placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 transition-colors"
                autoFocus
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => { setShowGCashModal(false); setGcashRef(""); }}
                className="flex-1 py-3 rounded-xl border border-[#232734] bg-[#181b24] text-zinc-300 font-semibold text-sm hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleGCashConfirm}
                disabled={isGCashSubmitting}
                className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-60 cursor-pointer shadow-lg shadow-blue-950/50"
              >
                {isGCashSubmitting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <><Smartphone className="w-4 h-4" /> Confirm GCash</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Layout: 1-col mobile → 2-col tablet → 3-col desktop ── */}
      <div className="relative max-w-6xl mx-auto">

        {/* Header — full width */}
        <header className="flex items-center justify-between gap-2 border-b border-zinc-800/80 px-4 py-3 bg-[#0b0c10]/95 backdrop-blur-md sticky top-0 z-40">
          <Link href="/" className="inline-flex items-center gap-2 text-zinc-400 hover:text-white transition-colors group">
            <RuzzcoLogoBadge size={30} showBorder={false} />
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold tracking-wider text-base text-white uppercase font-[family-name:var(--font-oswald)]">
                RUZZCO POS
              </span>
              <MustacheIcon className="w-4 h-2 text-red-600 hidden sm:inline-block" />
            </div>
          </Link>

          {/* Bound barber badge */}
          {binding && (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-600/10 border border-red-500/30 text-red-300 text-[11px] font-medium">
              <User className="w-3 h-3 text-red-400" />
              <span className="font-bold">{binding.barberName}</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            {/* Network badge */}
            <div
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border ${
                isOnline
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : "bg-red-500/10 text-red-400 border-red-500/20"
              }`}
            >
              {isOnline ? (
                <><Wifi className="w-3 h-3" /><span className="hidden sm:inline">Online</span></>
              ) : (
                <><WifiOff className="w-3 h-3" /><span className="hidden sm:inline">Offline</span></>
              )}
            </div>

            {/* Manual sync */}
            <button
              onClick={triggerSync}
              disabled={isSyncing || !isOnline}
              title="Sync pending transactions"
              className="relative p-2 rounded-lg bg-[#12141a] border border-[#232734] text-zinc-300 hover:text-white hover:bg-zinc-800 disabled:opacity-40 transition-all cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin text-red-400" : ""}`} />
              {(pendingCount ?? 0) > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-600 text-white text-[9px] font-extrabold flex items-center justify-center animate-pulse">
                  {pendingCount}
                </span>
              )}
            </button>

            {/* Re-bind ("Not you?") */}
            <button
              onClick={() => setShowBindModal(true)}
              title="Change device assignment"
              className="p-2 rounded-lg bg-[#12141a] border border-[#232734] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-all cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        </header>

        {/* Feedback toasts */}
        <div className="px-4 pt-2 space-y-1.5">
          {syncFeedback && (
            <div className="p-2.5 rounded-lg bg-[#12141a] border border-red-500/30 text-xs text-red-300 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-red-400 shrink-0" />
              {syncFeedback}
            </div>
          )}
          {lastActionToast && (
            <div className="p-3 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-xs text-emerald-200 flex items-center gap-2 shadow-lg shadow-emerald-950/50">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="font-medium">{lastActionToast.message}</span>
            </div>
          )}
        </div>

        {/* Main grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 px-4 py-4">

          {/* ── Col 1: Service Selection ── */}
          <section className="space-y-3 sm:col-span-1">
            <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider font-[family-name:var(--font-oswald)] flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-red-500" />
              Select Service
            </span>

            <div className="space-y-2.5">
              {services.map((service) => {
                const isSelected = service.id === selectedServiceId;
                return (
                  <button
                    key={service.id}
                    onClick={() => setSelectedServiceId(service.id)}
                    type="button"
                    className={`w-full min-h-[64px] p-4 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between ${
                      isSelected
                        ? "bg-gradient-to-r from-red-950/40 via-[#181a24] to-[#12141a] border-red-600/80 text-white shadow-lg shadow-red-950/30 ring-1 ring-red-500/40"
                        : "bg-[#12141a] border-[#232734] text-zinc-300 hover:bg-[#181b24] hover:border-zinc-700"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                          isSelected ? "bg-red-600 text-white shadow-md shadow-red-900/50" : "bg-zinc-800/80 text-zinc-400"
                        }`}
                      >
                        <Scissors className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-semibold text-sm text-white">{service.name}</div>
                        <div className="text-[11px] text-zinc-400">Standard Service</div>
                      </div>
                    </div>
                    <div
                      className={`font-extrabold text-lg font-[family-name:var(--font-oswald)] tracking-wide ${
                        isSelected ? "text-white" : "text-zinc-300"
                      }`}
                    >
                      ₱{service.standardPrice.toFixed(2)}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Col 2: Checkout ── */}
          <section className="space-y-3 sm:col-span-1">
            <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider font-[family-name:var(--font-oswald)] flex items-center gap-1.5">
              <Banknote className="w-3.5 h-3.5 text-red-500" />
              Checkout — ₱{selectedService?.standardPrice.toFixed(2)}
            </span>

            {/* Barber attribution display */}
            {binding && (
              <div className="p-3.5 rounded-xl bg-[#12141a] border border-[#232734] flex items-center justify-between gap-3 relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-barber-pole opacity-60" />
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-600/20 border border-red-500/30 text-red-400 flex items-center justify-center font-bold text-sm shrink-0">
                    {binding.barberName.charAt(0)}
                  </div>
                  <div>
                    <div className="font-bold text-sm text-white">{binding.barberName}</div>
                    <div className="text-[11px] text-zinc-500">Attributed Barber for this station</div>
                  </div>
                </div>
                <BarberPoleIcon className="w-2.5 h-6 opacity-75 shrink-0" />
              </div>
            )}

            {/* Cash button */}
            <button
              onClick={handleCashCheckout}
              disabled={!binding}
              type="button"
              className="w-full min-h-[60px] py-4 px-6 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 active:scale-[0.98] text-white font-extrabold text-base shadow-xl shadow-red-950/60 ring-1 ring-red-400/40 flex items-center justify-center gap-2.5 transition-all cursor-pointer disabled:opacity-50"
            >
              <Banknote className="w-5 h-5 stroke-[2.5]" />
              <span className="font-[family-name:var(--font-oswald)] uppercase tracking-wider text-lg">
                Cash — ₱{selectedService?.standardPrice.toFixed(2) ?? "0.00"}
              </span>
            </button>

            {/* GCash button */}
            <button
              onClick={() => { setGcashRef(""); setShowGCashModal(true); }}
              disabled={!binding}
              type="button"
              className="w-full min-h-[60px] py-4 px-6 rounded-xl border-2 border-blue-500/60 bg-blue-600/15 hover:bg-blue-600/25 active:scale-[0.98] text-blue-300 font-extrabold text-base flex items-center justify-center gap-2.5 transition-all cursor-pointer disabled:opacity-50 shadow-lg shadow-blue-950/30"
            >
              <Smartphone className="w-5 h-5 stroke-[2.5]" />
              <span className="font-[family-name:var(--font-oswald)] uppercase tracking-wider text-lg">
                GCash — ₱{selectedService?.standardPrice.toFixed(2) ?? "0.00"}
              </span>
            </button>

            <p className="text-center text-[11px] text-zinc-500">
              Saves to device immediately — syncs to server when online
            </p>
          </section>

          {/* ── Col 3: Mini shift preview + link ── */}
          <section className="space-y-3 sm:col-span-2 lg:col-span-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider font-[family-name:var(--font-oswald)] flex items-center gap-1.5">
                <List className="w-3.5 h-3.5 text-red-500" />
                Recent Cuts
              </span>
              <Link
                href="/shift-log"
                className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-red-400 transition-colors"
              >
                View all
                {(pendingCount ?? 0) > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full bg-red-600 text-white text-[9px] font-extrabold">
                    {pendingCount}
                  </span>
                )}
                <ChevronRight className="w-3 h-3" />
              </Link>
            </div>

            <div className="space-y-2">
              {(!recentTransactions || recentTransactions.length === 0) ? (
                <div className="p-5 rounded-xl bg-[#12141a]/60 border border-dashed border-[#232734] text-center text-xs text-zinc-500 space-y-1">
                  <p>No cuts logged yet today.</p>
                </div>
              ) : (
                recentTransactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="p-2.5 rounded-lg bg-[#12141a] border border-[#232734] flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="truncate">
                      <span className="font-medium text-zinc-200">{tx.serviceName}</span>
                      <span className="text-zinc-500 ml-1">• {tx.barberName}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {tx.paymentMethod === "GCASH" ? (
                        <span className="w-4 h-4 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center" title="GCash">
                          <Smartphone className="w-2.5 h-2.5" />
                        </span>
                      ) : (
                        <span className="w-4 h-4 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center" title="Cash">
                          <Banknote className="w-2.5 h-2.5" />
                        </span>
                      )}
                      <span className="font-bold text-zinc-100 font-[family-name:var(--font-oswald)]">₱{Number(tx.totalAmount).toFixed(2)}</span>
                      {tx.synced === 1 ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Clock className="w-3 h-3 text-red-400" />
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Links to full shift log & reconciliation */}
            <div className="space-y-2 pt-1">
              <Link
                href="/shift-log"
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[#232734] bg-[#12141a] text-xs text-zinc-400 hover:text-white hover:border-red-500/40 transition-all"
              >
                <List className="w-3.5 h-3.5 text-red-500" />
                Full Shift Log &amp; EOD Summary
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
              <Link
                href="/reconciliation"
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[#232734] bg-[#12141a] text-xs text-zinc-400 hover:text-white hover:border-red-500/40 transition-all"
              >
                <Banknote className="w-3.5 h-3.5 text-red-500" />
                Daily Cash Reconciliation
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}

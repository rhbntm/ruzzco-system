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
import {
  createLocalAssignment,
  ensureAssignmentId,
  registerPendingAssignment,
  syncNow,
  verifyCurrentAssignment,
} from "@/lib/sync";
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
  const [discountType, setDiscountType] = useState<"NONE" | "PERCENT" | "FIXED">("NONE");
  const [customAmountInput, setCustomAmountInput] = useState("");
  const [tipChoice, setTipChoice] = useState<"NONE" | "20" | "50" | "CUSTOM">("NONE");
  const [customTipInput, setCustomTipInput] = useState("");

  // Device binding state
  const [binding, setBinding] = useState<LocalDeviceBinding | null>(null);
  const [bindingLoaded, setBindingLoaded] = useState(false);
  const [showBindModal, setShowBindModal] = useState(false);
  const [isBinding, setIsBinding] = useState(false);
  const [loadTimeout, setLoadTimeout] = useState(false);

  // Digital payment reference modal state
  const [digitalMethod, setDigitalMethod] = useState<"GCASH" | "MAYA" | null>(null);
  const [digitalRef, setDigitalRef] = useState("");
  const [isDigitalSubmitting, setIsDigitalSubmitting] = useState(false);

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

  const requireRebind = useCallback(() => {
    setBinding(null);
    setShowBindModal(true);
  }, []);

  // Register the pending assignment, then sync queued sales (see lib/sync.ts).
  const triggerSync = useCallback(async () => {
    if (typeof window === "undefined" || !navigator.onLine) return;
    try {
      setIsSyncing(true);
      const outcome = await syncNow();
      if (outcome.bind.bindingCleared) requireRebind();
      if (outcome.status === "failed") {
        setSyncFeedback("Sync failed. Queued locally.");
      } else if (outcome.status === "synced") {
        const notSynced = outcome.held + outcome.rejected;
        setSyncFeedback(`Synced ${outcome.processed} new, ${outcome.duplicates} verified${notSynced ? `, ${notSynced} still queued` : ""}`);
      } else if (outcome.held > 0) {
        setSyncFeedback(`${outcome.held} queued until barber assignment reaches the server`);
      } else {
        setSyncFeedback("All transactions are synced");
      }
      setTimeout(() => setSyncFeedback(null), 3000);
    } catch (err) {
      console.error("Auto-sync error:", err);
      setSyncFeedback("Sync failed. Queued locally.");
      setTimeout(() => setSyncFeedback(null), 3000);
    } finally {
      setIsSyncing(false);
    }
  }, [requireRebind]);

  // Full lifecycle for load and reconnect: register, sync, then recheck the binding.
  const reconcileWithServer = useCallback(async () => {
    await triggerSync();
    if (await verifyCurrentAssignment()) requireRebind();
  }, [triggerSync, requireRebind]);

  useEffect(() => {
    const handleOnline = () => { reconcileWithServer(); };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [reconcileWithServer]);

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
        const storedBinding = await db.deviceBindings.get(deviceKey);

        if (storedBinding) {
          // Bindings from before assignment ids get one now, so new sales are assignment-backed.
          const localBinding = await ensureAssignmentId(storedBinding);
          if (active) {
            setBinding(localBinding);
            setBindingLoaded(true);
          }
          // Register the pending assignment, sync queued sales, then recheck the binding.
          // Offline or unreachable: keep the local binding; sales stay queued with their assignment.
          if (navigator.onLine && active) await reconcileWithServer();
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
  }, [reconcileWithServer]);

  // ── Device bind action ──────────────────────────────────────────────────────

  const handleBindDevice = async (barber: CachedBarber) => {
    setIsBinding(true);
    try {
      // New assignment id generated on the phone; persisted locally first so the POS is
      // usable offline. Sales already queued keep the assignment they were made under.
      const newBinding = await createLocalAssignment(barber);
      setBinding(newBinding);
      setShowBindModal(false);

      // Make it active on the server now if online; otherwise the next sync registers it.
      if (navigator.onLine) {
        const result = await registerPendingAssignment();
        if (result.bindingCleared) requireRebind();
      }
    } catch (e) {
      console.error("Error binding device:", e);
    } finally {
      setIsBinding(false);
    }
  };

  // ── Transaction recording ───────────────────────────────────────────────────

  const recordTransaction = useCallback(
    async (method: "CASH" | "GCASH" | "MAYA", reference?: string) => {
      if (!binding) return;
      const service = services.find((s) => s.id === selectedServiceId) || services[0];
      if (!service) return;

      const parsedCustomAmount = Number(customAmountInput);
      const isCustomAmount = customAmountInput.trim().length > 0 && Number.isFinite(parsedCustomAmount) && parsedCustomAmount > 0;
      // A custom amount replaces the service price entirely: list price is the entered amount, with no discount.
      const listPrice = isCustomAmount ? Math.round(parsedCustomAmount * 100) / 100 : service.standardPrice;
      const effectiveDiscountType = isCustomAmount ? "NONE" : discountType;
      const discountAmount = effectiveDiscountType === "PERCENT" ? Math.round(listPrice * 0.2 * 100) / 100 : 0;
      const discountedPrice = Math.max(0, listPrice - discountAmount);
      const amountPaid = Math.round(discountedPrice * 100) / 100;
      const parsedCustomTip = Number(customTipInput);
      const tipAmount = tipChoice === "20" ? 20 : tipChoice === "50" ? 50 : tipChoice === "CUSTOM" && Number.isFinite(parsedCustomTip) && parsedCustomTip >= 0 ? Math.round(parsedCustomTip * 100) / 100 : 0;

      const newTransaction: LocalTransaction = {
        id: generateUUID(),
        barberId: binding.barberId,
        barberName: binding.barberName,
        serviceId: service.id,
        serviceName: service.name,
        price: listPrice,
        totalAmount: amountPaid,
        listPrice,
        discountType: effectiveDiscountType,
        discountAmount,
        amountPaid,
        tipAmount,
        customAmount: isCustomAmount,
        customAmountNote: isCustomAmount ? "POS custom amount" : null,
        paymentMethod: method,
        paymentReference: reference ?? null,
        transactionTime: new Date().toISOString(),
        synced: 0,
        syncedAt: null,
        // Sale-time attribution: fixed now, never rewritten by a later rebind.
        assignmentId: binding.assignmentId,
        deviceKey: binding.deviceKey,
      };

      await db.transactions.add(newTransaction);

      const methodLabel = method === "GCASH" ? "GCash" : method === "MAYA" ? "Maya" : "Cash";
      setLastActionToast({
        message: `₱${amountPaid.toFixed(2)} ${methodLabel}${tipAmount ? ` + ₱${tipAmount.toFixed(2)} tip` : ""} — ${binding.barberName}`,
        type: "success",
      });
      setTimeout(() => setLastActionToast(null), 3000);

      if (navigator.onLine) {
        startTransition(() => { triggerSync(); });
      }
    },
    [binding, services, selectedServiceId, discountType, customAmountInput, tipChoice, customTipInput, triggerSync]
  );

  const handleCashCheckout = () => recordTransaction("CASH");

  const handleDigitalConfirm = async () => {
    if (!digitalMethod) return;
    setIsDigitalSubmitting(true);
    await recordTransaction(digitalMethod, digitalRef.trim() || undefined);
    setIsDigitalSubmitting(false);
    setDigitalMethod(null);
    setDigitalRef("");
  };

  // ── Derived values ──────────────────────────────────────────────────────────

  const selectedService = services.find((s) => s.id === selectedServiceId) || services[0];
  const previewListPrice = selectedService?.standardPrice ?? 0;
  const previewDiscount = discountType === "PERCENT" ? Math.round(previewListPrice * 0.2 * 100) / 100 : 0;
  const previewAmount = customAmountInput.trim() && Number(customAmountInput) > 0 ? Number(customAmountInput) : previewListPrice - previewDiscount;
  const previewTip = tipChoice === "20" ? 20 : tipChoice === "50" ? 50 : tipChoice === "CUSTOM" && Number(customTipInput) >= 0 ? Number(customTipInput) : 0;
  const digitalLabel = digitalMethod === "MAYA" ? "Maya" : "GCash";
  const digitalColor = digitalMethod === "MAYA" ? "emerald" : "blue";

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

      {/* Digital payment reference modal */}
      {digitalMethod && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-[#12141a] border border-[#232734] rounded-2xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Smartphone className={`w-5 h-5 ${digitalColor === "emerald" ? "text-emerald-400" : "text-blue-400"}`} />
                <span className="font-bold text-white font-[family-name:var(--font-oswald)] uppercase tracking-wide">
                  {digitalLabel} Payment
                </span>
              </div>
              <button
                onClick={() => { setDigitalMethod(null); setDigitalRef(""); }}
                className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <div className={`text-3xl font-extrabold text-center py-2 font-[family-name:var(--font-oswald)] ${digitalColor === "emerald" ? "text-emerald-400" : "text-blue-400"}`}>
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
                placeholder={`${digitalLabel} ref. no. (optional)`}
                value={digitalRef}
                onChange={(e) => setDigitalRef(e.target.value)}
                maxLength={20}
                className={`w-full px-3 py-2.5 rounded-lg bg-[#181b24] border border-[#232734] text-white text-sm placeholder:text-zinc-500 focus:outline-none transition-colors ${digitalColor === "emerald" ? "focus:border-emerald-500" : "focus:border-blue-500"}`}
                autoFocus
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => { setDigitalMethod(null); setDigitalRef(""); }}
                className="flex-1 py-3 rounded-xl border border-[#232734] bg-[#181b24] text-zinc-300 font-semibold text-sm hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleDigitalConfirm}
                disabled={isDigitalSubmitting}
                className={`flex-1 py-3 rounded-xl active:scale-[0.98] text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-60 cursor-pointer shadow-lg ${digitalColor === "emerald" ? "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-950/50" : "bg-blue-600 hover:bg-blue-500 shadow-blue-950/50"}`}
              >
                {isDigitalSubmitting ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <><Smartphone className="w-4 h-4" /> Confirm {digitalLabel}</>
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
              Checkout — ₱{previewAmount.toFixed(2)}
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

            <div className="p-3 rounded-xl bg-[#12141a] border border-[#232734] space-y-2.5">
              <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold">Adjust total</div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setDiscountType("NONE")} className={`flex-1 py-2 rounded-lg text-xs font-semibold border ${discountType === "NONE" ? "bg-zinc-700 text-white border-zinc-500" : "bg-[#181b24] text-zinc-400 border-[#232734]"}`}>No discount</button>
                <button type="button" onClick={() => setDiscountType("PERCENT")} className={`flex-1 py-2 rounded-lg text-xs font-semibold border ${discountType === "PERCENT" ? "bg-red-600/30 text-red-200 border-red-500/60" : "bg-[#181b24] text-zinc-400 border-[#232734]"}`}>Senior/PWD −20%</button>
              </div>
              <div className="flex gap-2">
                {(["NONE", "20", "50"] as const).map((choice) => (
                  <button key={choice} type="button" onClick={() => setTipChoice(choice)} className={`flex-1 py-2 rounded-lg text-xs font-semibold border ${tipChoice === choice ? "bg-emerald-600/30 text-emerald-200 border-emerald-500/60" : "bg-[#181b24] text-zinc-400 border-[#232734]"}`}>{choice === "NONE" ? "No tip" : `+₱${choice} tip`}</button>
                ))}
                <button type="button" onClick={() => setTipChoice("CUSTOM")} className={`flex-1 py-2 rounded-lg text-xs font-semibold border ${tipChoice === "CUSTOM" ? "bg-emerald-600/30 text-emerald-200 border-emerald-500/60" : "bg-[#181b24] text-zinc-400 border-[#232734]"}`}>Custom tip</button>
              </div>
              {tipChoice === "CUSTOM" && <input type="number" min="0" step="0.01" inputMode="decimal" placeholder="Tip amount" value={customTipInput} onChange={(e) => setCustomTipInput(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-[#181b24] border border-[#232734] text-white text-sm" />}
              <input type="number" min="0.01" step="0.01" inputMode="decimal" placeholder={`Custom amount (default ₱${(previewListPrice - previewDiscount).toFixed(2)})`} value={customAmountInput} onChange={(e) => setCustomAmountInput(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-[#181b24] border border-[#232734] text-white text-sm" />
              <div className="flex justify-between text-[11px] text-zinc-500"><span>List ₱{previewListPrice.toFixed(2)} · discount ₱{previewDiscount.toFixed(2)}</span><span className="text-zinc-300">Paid ₱{previewAmount.toFixed(2)} · tip ₱{previewTip.toFixed(2)}</span></div>
            </div>

            {/* Cash button */}
            <button
              onClick={handleCashCheckout}
              disabled={!binding}
              type="button"
              className="w-full min-h-[60px] py-4 px-6 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 active:scale-[0.98] text-white font-extrabold text-base shadow-xl shadow-red-950/60 ring-1 ring-red-400/40 flex items-center justify-center gap-2.5 transition-all cursor-pointer disabled:opacity-50"
            >
              <Banknote className="w-5 h-5 stroke-[2.5]" />
              <span className="font-[family-name:var(--font-oswald)] uppercase tracking-wider text-lg">
                Cash — ₱{previewAmount.toFixed(2)}
              </span>
            </button>

            {/* GCash button */}
            <button
              onClick={() => { setDigitalRef(""); setDigitalMethod("GCASH"); }}
              disabled={!binding}
              type="button"
              className="w-full min-h-[60px] py-4 px-6 rounded-xl border-2 border-blue-500/60 bg-blue-600/15 hover:bg-blue-600/25 active:scale-[0.98] text-blue-300 font-extrabold text-base flex items-center justify-center gap-2.5 transition-all cursor-pointer disabled:opacity-50 shadow-lg shadow-blue-950/30"
            >
              <Smartphone className="w-5 h-5 stroke-[2.5]" />
              <span className="font-[family-name:var(--font-oswald)] uppercase tracking-wider text-lg">
                GCash — ₱{previewAmount.toFixed(2)}
              </span>
            </button>

            <button
              onClick={() => { setDigitalRef(""); setDigitalMethod("MAYA"); }}
              disabled={!binding}
              type="button"
              className="w-full min-h-[60px] py-4 px-6 rounded-xl border-2 border-emerald-500/60 bg-emerald-600/15 hover:bg-emerald-600/25 active:scale-[0.98] text-emerald-300 font-extrabold text-base flex items-center justify-center gap-2.5 transition-all cursor-pointer disabled:opacity-50 shadow-lg shadow-emerald-950/30"
            >
              <Smartphone className="w-5 h-5 stroke-[2.5]" />
              <span className="font-[family-name:var(--font-oswald)] uppercase tracking-wider text-lg">
                Maya — ₱{previewAmount.toFixed(2)}
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
                      {tx.paymentMethod === "GCASH" || tx.paymentMethod === "MAYA" ? (
                        <span className={`w-4 h-4 rounded-full flex items-center justify-center ${tx.paymentMethod === "MAYA" ? "bg-emerald-500/20 text-emerald-400" : "bg-blue-500/20 text-blue-400"}`} title={tx.paymentMethod === "MAYA" ? "Maya" : "GCash"}>
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

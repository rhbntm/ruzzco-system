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
  RefreshCw,
  CheckCircle2,
  Clock,
  TriangleAlert,
  User,
  Sparkles,
  Layers,
  Banknote,
  Smartphone,
  Settings,
  List,
  X,
  ChevronRight,
  QrCode,
  BadgePercent,
  Repeat,
} from "lucide-react";
import {
  CUSTOM_NOTE_MAX,
  customNoteError,
  customNoteFor,
  loyaltyApplies,
  priceSale,
  type PricedSale,
  type TipChoice,
} from "@/lib/pricing";
import { LOYALTY_PERCENT, LOYALTY_SERVICE_ID, sortServices } from "@/lib/catalog";
import {
  firstCheckoutStep,
  readAskBeforeRecording,
  subscribeAskBeforeRecording,
  writeAskBeforeRecording,
} from "@/lib/confirm-setting";
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
  countPending,
  createLocalAssignment,
  ensureAssignmentId,
  isRejected,
  listRejected,
  readPendingBind,
  registerPendingAssignment,
  retryRejected,
  summarizeSync,
  syncNow,
  verifyCurrentAssignment,
} from "@/lib/sync";
import { REQUEST_TIMEOUT_MS, fetchWithTimeout } from "@/lib/fetch-timeout";
import { checkQrphAvailable } from "@/lib/qrph-client";
import { refreshPaymentQrs } from "@/lib/payment-qr-cache";
import { qrCacheId } from "@/lib/payment-qr-plan";
import { RejectedSales } from "@/components/RejectedSales";
import { QrPhCheckout } from "@/components/QrPhCheckout";
import { ConnectionBadge, ShopPcReminder, isShopPcDown, useShopPc } from "@/components/ShopPcStatus";
import { createSubmitLock } from "@/lib/submit-lock";
import { useLiveQuery } from "dexie-react-hooks";
import { RuzzcoLogoBanner, MustacheIcon, BarberPoleIcon } from "@/components/RuzzcoBrand";

// After a sale is saved, further payment taps are ignored this long, so a double tap
// that lands after the (millisecond-fast) local write still records only one sale.
const SALE_REPEAT_GUARD_MS = 800;

type PaymentMethod = LocalTransaction["paymentMethod"];

// ─── Online status hooks ───────────────────────────────────────────────────────

// While sales (or a barber binding) are waiting, retry the sync this often. Otherwise a
// failed sync waits for the next sale, a reconnect or a reload.
const AUTO_RETRY_MS = 60_000;

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
  const [customAmountInput, setCustomAmountInput] = useState("");
  const [tipChoice, setTipChoice] = useState<TipChoice>("NONE");
  const [customTipInput, setCustomTipInput] = useState("");
  // Slice 13: loyalty card (men's haircut only) and the note on a custom amount.
  const [loyalty, setLoyalty] = useState(false);
  const [customNote, setCustomNote] = useState("");

  // "Ask before recording a sale": per phone, off when storage is unavailable.
  const askBeforeRecording = useSyncExternalStore(subscribeAskBeforeRecording, () => readAskBeforeRecording(), () => false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingNotSaved, setSettingNotSaved] = useState(false);
  const [confirmingCash, setConfirmingCash] = useState(false);

  // Device binding state
  const [binding, setBinding] = useState<LocalDeviceBinding | null>(null);
  const [bindingLoaded, setBindingLoaded] = useState(false);
  const [showBindModal, setShowBindModal] = useState(false);
  const [isBinding, setIsBinding] = useState(false);
  const [loadTimeout, setLoadTimeout] = useState(false);

  // Digital payment reference modal state
  const [digitalMethod, setDigitalMethod] = useState<"GCASH" | "MAYA" | null>(null);
  const [digitalRef, setDigitalRef] = useState("");
  // QR Ph (test): shown only when the server reports the gateway on. Last known value is kept offline.
  const [gatewayEnabled, setGatewayEnabled] = useState(false);
  const [qrSale, setQrSale] = useState<{ id: string; amount: number } | null>(null);
  // True while a sale is being written and for a short repeat guard after it (UX only;
  // correctness comes from the synchronous lock).
  const [isRecording, setIsRecording] = useState(false);
  const [checkoutLock] = useState(() =>
    createSubmitLock({ holdAfterSuccessMs: SALE_REPEAT_GUARD_MS, onChange: setIsRecording })
  );

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
        return await countPending();
      } catch {
        return 0;
      }
    },
    [],
    0
  );

  // Sales the server refused: kept on this device, not auto-retried, shown for attention
  const rejectedSales = useLiveQuery(
    async () => {
      try {
        if (typeof window === "undefined") return [];
        return await listRejected();
      } catch {
        return [];
      }
    },
    [],
    [] as LocalTransaction[]
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

  // QR shown in the GCash/Maya modal: the bound barber's, from the device cache, so it
  // still shows offline. Undefined while loading, null when none is set up.
  const modalQr = useLiveQuery(
    async () => {
      if (!binding || !digitalMethod) return null;
      try {
        return (await db.paymentQrs.get(qrCacheId(binding.barberId, digitalMethod))) ?? null;
      } catch {
        return null;
      }
    },
    [binding?.barberId, digitalMethod],
    undefined
  );

  // ── Sync dispatcher ─────────────────────────────────────────────────────────

  const requireRebind = useCallback(() => {
    setBinding(null);
    setShowBindModal(true);
  }, []);

  // Register the pending assignment, then sync queued sales (see lib/sync.ts).
  // quiet: the background retry; it only speaks up when something actually synced.
  const triggerSync = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (typeof window === "undefined" || !navigator.onLine) return;
    const { quiet = false } = options;
    try {
      if (!quiet) setIsSyncing(true);
      const outcome = await syncNow();
      if (outcome.bind.bindingCleared) requireRebind();
      if (quiet && outcome.status !== "synced") return;
      setSyncFeedback(outcome.status === "failed" ? "Sync failed. Queued locally." : summarizeSync(outcome));
      setTimeout(() => setSyncFeedback(null), 3000);
    } catch (err) {
      console.error("Auto-sync error:", err);
      if (quiet) return;
      setSyncFeedback("Sync failed. Queued locally.");
      setTimeout(() => setSyncFeedback(null), 3000);
    } finally {
      if (!quiet) setIsSyncing(false);
    }
  }, [requireRebind]);

  // Explicit retry of a rejected sale: re-queue it unchanged, then run the normal sync. A QRPH
  // sale that now reached the server goes straight to its QR payment (one charge per sale).
  const handleRetryRejected = useCallback(async (id: string) => {
    if (typeof window === "undefined" || !navigator.onLine) return;
    setIsSyncing(true);
    try {
      const { outcome, qrCharge } = await retryRejected(id);
      if (outcome.bind.bindingCleared) requireRebind();
      setSyncFeedback(outcome.status === "failed" ? "Sync failed. Queued locally." : summarizeSync(outcome));
      setTimeout(() => setSyncFeedback(null), 3000);
      if (qrCharge) setQrSale(qrCharge);
    } catch (err) {
      console.error("Retry error:", err);
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

  // The phone can be online while the shop PC is off. When the PC answers again, send the
  // waiting sales at once instead of at the next background retry.
  const shopPc = useShopPc(reconcileWithServer);
  const pcDown = isShopPcDown(shopPc);

  useEffect(() => {
    const handleOnline = () => { reconcileWithServer(); };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [reconcileWithServer]);

  // Background retry: the server may be down while the phone still counts as online.
  // Only while the page is visible and something is waiting (queued sales or a pending bind).
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      void countPending()
        .then((pending) => {
          if (pending > 0 || readPendingBind()) void triggerSync({ quiet: true });
        })
        .catch(() => {});
    }, AUTO_RETRY_MS);
    return () => window.clearInterval(timer);
  }, [triggerSync]);

  // Gateway availability: 200 = on, 404 = off (PAYMENT_GATEWAY). Rechecked when back online.
  useEffect(() => {
    if (!isOnline) return;
    let active = true;
    fetch("/api/v1/payments/qrph", { cache: "no-store" })
      .then((res) => { if (active) setGatewayEnabled(res.ok); })
      .catch(() => {});
    return () => { active = false; };
  }, [isOnline]);

  // Payment QR cache: refreshed on load while online and on every reconnect. Offline, the
  // cached copies stay as they are.
  useEffect(() => {
    if (isOnline) void refreshPaymentQrs();
  }, [isOnline]);

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
        if (active && cachedS.length > 0) setServices(sortServices(cachedS));

        // Refresh catalog from server if online
        const refreshCatalog = async () => {
          if (!navigator.onLine) return;
          try {
            const res = await fetchWithTimeout("/api/v1/catalog", {}, REQUEST_TIMEOUT_MS.catalog);
            if (res.ok && active) {
              const data = await res.json();
              if (data.barbers && data.services) {
                setBarbers(data.barbers);
                setServices(sortServices(data.services as CachedService[]));
                // One transaction: an interrupted refresh never leaves an empty cache.
                await db.transaction("rw", db.barbers, db.services, async () => {
                  await db.barbers.clear();
                  await db.barbers.bulkPut(data.barbers);
                  await db.services.clear();
                  await db.services.bulkPut(data.services);
                });
              }
            }
          } catch (e) {
            console.warn("Could not refresh catalog, using cache:", e);
          }
        };

        // Load local binding
        const deviceKey = getOrCreateDeviceKey();
        const storedBinding = await db.deviceBindings.get(deviceKey);

        if (storedBinding) {
          // Bindings from before assignment ids get one now, so new sales are assignment-backed.
          const localBinding = await ensureAssignmentId(storedBinding);
          // A bound phone opens at once with its cached catalog, which is refreshed meanwhile:
          // with the shop PC off, the refresh would hold the POS for its whole timeout.
          if (active) {
            setBinding(localBinding);
            setBindingLoaded(true);
          }
          await refreshCatalog();
          // Register the pending assignment, sync queued sales, then recheck the binding.
          // Offline or unreachable: keep the local binding; sales stay queued with their assignment.
          if (navigator.onLine && active) await reconcileWithServer();
        } else {
          // No local binding — show first-boot modal, with the server's barber list when it answers
          await refreshCatalog();
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
        void refreshPaymentQrs();
      }
    } catch (e) {
      console.error("Error binding device:", e);
    } finally {
      setIsBinding(false);
    }
  };

  // ── Transaction recording ───────────────────────────────────────────────────

  // Writes one sale to Dexie and returns it. Call only through recordTransaction, which holds the checkout lock.
  const createSale = useCallback(
    async (method: PaymentMethod, reference?: string): Promise<{ id: string; amount: number } | null> => {
      if (!binding) return null;
      const service = services.find((s) => s.id === selectedServiceId) || services[0];
      if (!service) return null;

      const { listPrice, discountType, discountAmount, amountPaid, tipAmount, isCustomAmount, isLoyalty } = priceSale({
        standardPrice: service.standardPrice,
        customAmountInput,
        tipChoice,
        customTipInput,
        serviceId: service.id,
        loyalty,
      });
      // The buttons are disabled while the note is too long; never save a shortened note.
      if (isCustomAmount && customNoteError(customNote)) return null;

      const newTransaction: LocalTransaction = {
        id: generateUUID(),
        barberId: binding.barberId,
        barberName: binding.barberName,
        serviceId: service.id,
        serviceName: service.name,
        price: listPrice,
        totalAmount: amountPaid,
        listPrice,
        discountType,
        discountAmount,
        amountPaid,
        tipAmount,
        customAmount: isCustomAmount,
        customAmountNote: customNoteFor(isCustomAmount, customNote),
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
      // The loyalty card is per customer: the next sale starts without it.
      if (isLoyalty) setLoyalty(false);

      const methodLabel = method === "GCASH" ? "GCash" : method === "MAYA" ? "Maya" : method === "QRPH" ? "QR Ph (pending)" : "Cash";
      setLastActionToast({
        // While the shop PC can't record it, say where the sale is.
        message: `₱${amountPaid.toFixed(2)} ${methodLabel}${isLoyalty ? ` (Loyalty ${LOYALTY_PERCENT}%)` : ""}${tipAmount ? ` + ₱${tipAmount.toFixed(2)} tip` : ""} — ${binding.barberName}${pcDown || !navigator.onLine ? " · saved on this phone" : ""}`,
        type: "success",
      });
      setTimeout(() => setLastActionToast(null), 3000);

      // A QRPH sale is synced by the QR checkout, which waits for the sync before charging.
      if (navigator.onLine && method !== "QRPH") {
        startTransition(() => { triggerSync(); });
      }
      return { id: newTransaction.id, amount: amountPaid };
    },
    [binding, services, selectedServiceId, customAmountInput, tipChoice, customTipInput, loyalty, customNote, triggerSync, pcDown]
  );

  // Every payment method records through here. The lock is checked synchronously before
  // any await, so a second tap cannot generate a second transaction id (see lib/submit-lock.ts).
  const recordTransaction = useCallback(
    async (method: PaymentMethod, reference?: string): Promise<{ outcome: "saved" | "skipped" | "busy" | "failed"; sale?: { id: string; amount: number } }> => {
      const result = await checkoutLock.run(() => createSale(method, reference));
      if (result.status === "busy") return { outcome: "busy" };
      if (result.status === "failed") {
        console.error("Error recording sale:", result.error);
        setLastActionToast({ message: "Sale not saved. Try again.", type: "info" });
        setTimeout(() => setLastActionToast(null), 3000);
        return { outcome: "failed" };
      }
      return result.value ? { outcome: "saved", sale: result.value } : { outcome: "skipped" };
    },
    [checkoutLock, createSale]
  );

  // Cash records on one tap, or asks first when the phone's setting is on (slice 13).
  const handleCashCheckout = () => {
    if (firstCheckoutStep("CASH", askBeforeRecording) === "confirm") setConfirmingCash(true);
    else void recordTransaction("CASH");
  };

  const handleConfirmCash = async () => {
    const { outcome } = await recordTransaction("CASH");
    // Same rule as the GCash/Maya step: a duplicate tap leaves the dialog to the tap that owns the sale.
    if (outcome === "saved" || outcome === "skipped") setConfirmingCash(false);
  };

  // Picking another service turns the loyalty card off; picking the same one keeps it.
  const handleSelectService = (id: string) => {
    if (id !== selectedServiceId) setLoyalty(false);
    setSelectedServiceId(id);
  };

  // A custom amount replaces the discount, so entering one turns the loyalty card off.
  const handleCustomAmountChange = (value: string) => {
    setCustomAmountInput(value);
    if (!loyaltyApplies(LOYALTY_SERVICE_ID, value)) setLoyalty(false);
  };

  const handleAskBeforeRecording = (on: boolean) => {
    setSettingNotSaved(!writeAskBeforeRecording(on));
  };

  const handleDigitalConfirm = async () => {
    if (!digitalMethod) return;
    const { outcome } = await recordTransaction(digitalMethod, digitalRef.trim() || undefined);
    // A duplicate tap ("busy") leaves the modal to the tap that owns the sale;
    // a failure keeps it open so the reference is not lost.
    if (outcome === "saved" || outcome === "skipped") {
      setDigitalMethod(null);
      setDigitalRef("");
    }
  };

  // The sale is written to Dexie first like any other; the QR checkout then syncs and charges it.
  // First re-ask the server: the button may be stale if QR Ph was switched off since it loaded.
  const handleQrphCheckout = async () => {
    if (!(await checkQrphAvailable())) {
      setGatewayEnabled(false);
      setLastActionToast({ message: "QR Ph is switched off. Use cash, GCash or Maya.", type: "info" });
      setTimeout(() => setLastActionToast(null), 3000);
      return;
    }
    const { outcome, sale } = await recordTransaction("QRPH");
    if (outcome === "saved" && sale) setQrSale(sale);
  };

  // Resolves true once the QR sale is on the server (synced), so the charge can be created.
  const qrSaleId = qrSale?.id;
  const ensureQrSaleSynced = useCallback(async () => {
    if (!qrSaleId || !navigator.onLine) return false;
    await triggerSync();
    return (await db.transactions.get(qrSaleId))?.synced === 1;
  }, [qrSaleId, triggerSync]);

  // Escape closes the GCash/Maya dialog, like its Cancel button: nothing is recorded.
  useEffect(() => {
    if (!digitalMethod) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDigitalMethod(null);
        setDigitalRef("");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [digitalMethod]);

  // Escape closes the cash confirmation (records nothing) and the settings sheet.
  useEffect(() => {
    if (!confirmingCash && !showSettings) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setConfirmingCash(false);
      setShowSettings(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmingCash, showSettings]);

  // ── Derived values ──────────────────────────────────────────────────────────

  const selectedService = services.find((s) => s.id === selectedServiceId) || services[0];
  const previewListPrice = selectedService?.standardPrice ?? 0;
  // Same function as createSale, so the checkout buttons show exactly what will be recorded.
  const preview = priceSale({
    standardPrice: previewListPrice,
    customAmountInput,
    tipChoice,
    customTipInput,
    serviceId: selectedService?.id,
    loyalty,
  });
  const { amountPaid: previewAmount, tipAmount: previewTip } = preview;
  const loyaltyOffered = selectedService?.id === LOYALTY_SERVICE_ID;
  const noteError = preview.isCustomAmount ? customNoteError(customNote) : null;
  // A payment button records (or opens a step that records) only when the sale can be saved as shown.
  const payDisabled = !binding || isRecording || Boolean(noteError);
  // What the customer sends by GCash/Maya: the amount paid plus any tip entered before payment.
  const digitalTotal = previewAmount + previewTip;
  const digitalLabel = digitalMethod === "MAYA" ? "Maya" : "GCash";
  const digitalColor = digitalMethod === "MAYA" ? "emerald" : "blue";

  // ── Loading screen ──────────────────────────────────────────────────────────

  if (!bindingLoaded) {
    return (
      <div className="rz-page flex-1 flex flex-col items-center justify-center p-6 gap-8">
        <div className="flex flex-col items-center gap-6 text-center">
          {/* The banner carries the name and "Premium Cut & Shave"; the heading names the page for screen readers. */}
          <RuzzcoLogoBanner className="w-64 sm:w-72" alt="" />
          <h1 className="sr-only">Ruzzco Barbers</h1>
          <div role="status" className="flex items-center gap-3 text-sm text-dust">
            {/* The station light turns while the station starts up. */}
            <BarberPoleIcon className="w-3.5 h-8" spinning />
            <span>Initializing POS station…</span>
          </div>
        </div>
        {loadTimeout && (
          <div className="animate-rise text-center space-y-3 max-w-xs">
            <p className="text-sm text-dust">
              Taking longer to initialize local cache.
            </p>
            <button
              onClick={() => {
                setBindingLoaded(true);
                setShowBindModal(true);
              }}
              className="rz-btn rz-btn-secondary pointer-coarse:min-h-11"
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
      <div className="rz-page flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-4">
            <RuzzcoLogoBanner className="w-56 mx-auto" alt="" />
            <h1 className="rz-title text-3xl">
              Assign Station Barber
            </h1>
            <p className="text-sm text-dust leading-relaxed">
              Select the barber operating this station. All cuts logged here will automatically attribute to their commission and shift record.
            </p>
          </div>

          <div className="rz-panel overflow-hidden">
            <div className="px-4 py-2.5 border-b border-seam rz-label">
              Station Setup
            </div>
            <div className="rz-rows rz-stagger">
              {barbers.map((barber) => (
                <button
                  key={barber.id}
                  onClick={() => handleBindDevice(barber)}
                  disabled={isBinding}
                  className="rz-press w-full min-h-16 px-4 py-3.5 text-left flex items-center justify-between gap-3 group transition-[background-color,transform] duration-200 hover:bg-crimson/10 disabled:opacity-50"
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="w-11 h-11 rounded-full bg-panel-2 ring-1 ring-seam-strong text-bone flex items-center justify-center font-display font-semibold text-lg shrink-0 transition-colors duration-200 group-hover:bg-crimson group-hover:ring-crimson-bright group-hover:text-white">
                      {barber.fullName.charAt(0)}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold text-bone truncate">{barber.fullName}</span>
                      <span className="block text-xs text-dust">
                        {Math.round(barber.commissionRate * 100)}% commission rate
                      </span>
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-dust shrink-0 transition-[color,transform] duration-200 group-hover:text-crimson-ink group-hover:translate-x-0.5" />
                </button>
              ))}
            </div>
          </div>

          {(!isOnline || pcDown) && (
            <p className="animate-rise text-center text-sm text-dust">
              Station is offline — barber assignment will sync upon reconnection.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Main POS UI ─────────────────────────────────────────────────────────────

  return (
    <div className="flex-1">
      {/* Digital payment reference modal */}
      {qrSale && (
        <QrPhCheckout
          transactionId={qrSale.id}
          amount={qrSale.amount}
          ensureSynced={ensureQrSaleSynced}
          onClose={() => setQrSale(null)}
        />
      )}

      {digitalMethod && (
        <div className="rz-overlay items-end sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="digital-payment-title"
            className="rz-dialog rz-dialog-sheet p-5 space-y-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className={`w-9 h-9 rounded-full flex items-center justify-center ${digitalColor === "emerald" ? "bg-maya/15 text-maya-ink" : "bg-gcash/15 text-gcash-ink"}`}>
                  <Smartphone className="w-4.5 h-4.5" />
                </span>
                <h2 id="digital-payment-title" className="rz-title text-xl">
                  {digitalLabel} Payment
                </h2>
              </div>
              <button
                onClick={() => { setDigitalMethod(null); setDigitalRef(""); }}
                aria-label="Close"
                className="rz-btn rz-btn-ghost rz-btn-icon pointer-coarse:min-h-11 pointer-coarse:min-w-11"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              {modalQr ? (
                <div className="animate-fade mx-auto mb-1 w-52 space-y-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- cached data URL from IndexedDB */}
                  <img src={modalQr.dataUrl} alt={`${digitalLabel} QR on file for ${binding?.barberName ?? "this barber"}`} className="w-full aspect-square object-contain rounded-xl bg-white p-2.5 shadow-[0_12px_28px_-14px_rgb(0_0_0/0.9)]" />
                  <p className="text-xs text-dust text-center">{digitalLabel} QR on file for {binding?.barberName}</p>
                </div>
              ) : modalQr === null ? (
                <div className="mb-1 p-3 rounded-xl border border-dashed border-seam-strong text-center text-sm text-dust">
                  No {digitalLabel} QR set up for {binding?.barberName}. Ask the owner to add one.
                </div>
              ) : null}
              <div className={`rz-figure text-4xl text-center pt-3 ${digitalColor === "emerald" ? "text-maya-ink" : "text-gcash-ink"}`}>
                ₱{digitalTotal.toFixed(2)}
              </div>
              {previewTip > 0 && (
                <p className="text-xs text-dust text-center mt-1">
                  ₱{previewAmount.toFixed(2)} + ₱{previewTip.toFixed(2)} tip
                </p>
              )}
              <p className="text-sm text-dust text-center mt-2 mb-3 leading-relaxed">
                {modalQr ? "Have the customer scan the QR and send " : "Have the customer send "}
                <strong className="text-bone">₱{digitalTotal.toFixed(2)}</strong> by {digitalLabel}. If you have the{" "}
                {digitalLabel} reference number, enter it below.
              </p>
              <input
                type="text"
                inputMode="numeric"
                placeholder={`${digitalLabel} ref. no. (optional)`}
                aria-label={`${digitalLabel} reference number (optional)`}
                value={digitalRef}
                onChange={(e) => setDigitalRef(e.target.value)}
                maxLength={20}
                className={`rz-field sm:text-sm pointer-coarse:min-h-11 ${digitalColor === "emerald" ? "focus:border-maya focus:shadow-[0_0_0_3px_rgb(23_178_106/0.25)]" : "focus:border-gcash focus:shadow-[0_0_0_3px_rgb(47_124_246/0.28)]"}`}
                autoFocus
              />
            </div>

            {/* With "Ask before recording a sale" on, this step is the confirmation: one per sale. */}
            {askBeforeRecording && selectedService && (
              <SaleSummary serviceName={selectedService.name} sale={preview} note={customNote} method={digitalLabel} />
            )}

            <div className="flex gap-2">
              <button
                onClick={() => { setDigitalMethod(null); setDigitalRef(""); }}
                className="rz-btn rz-btn-secondary flex-1 min-h-12"
              >
                Cancel
              </button>
              <button
                onClick={handleDigitalConfirm}
                disabled={isRecording}
                className={`rz-btn flex-1 min-h-12 text-white border-white/10 shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_10px_22px_-12px_rgb(0_0_0/0.9)] ${digitalColor === "emerald" ? "bg-[#0d7f4a] hover:bg-[#0f8d52]" : "bg-[#1f66d9] hover:bg-[#2a72e6]"}`}
              >
                {isRecording ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <><Smartphone className="w-4 h-4" /> {askBeforeRecording ? "Record sale" : `Confirm ${digitalLabel}`}</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cash confirmation: only with "Ask before recording a sale" on. Cancel records nothing and keeps the inputs. */}
      {confirmingCash && selectedService && (
        <div className="rz-overlay items-end sm:items-center">
          <div role="dialog" aria-modal="true" aria-labelledby="confirm-sale-title" className="rz-dialog rz-dialog-sheet p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-full flex items-center justify-center bg-crimson/15 text-crimson-ink">
                <Banknote className="w-4.5 h-4.5" />
              </span>
              <h2 id="confirm-sale-title" className="rz-title text-xl">Record this sale?</h2>
            </div>
            <SaleSummary serviceName={selectedService.name} sale={preview} note={customNote} method="Cash" />
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmingCash(false)} className="rz-btn rz-btn-secondary flex-1 min-h-12">
                Cancel
              </button>
              <button type="button" onClick={() => void handleConfirmCash()} disabled={payDisabled} className="rz-btn rz-btn-primary flex-1 min-h-12">
                {isRecording ? <RefreshCw className="w-4 h-4 animate-spin" /> : <><Banknote className="w-4 h-4" /> Record sale</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phone settings, from the header's gear: the confirmation switch and changing the barber. */}
      {showSettings && (
        <div className="rz-overlay items-end sm:items-center" onClick={(event) => { if (event.target === event.currentTarget) setShowSettings(false); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="phone-settings-title" className="rz-dialog rz-dialog-sheet p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 id="phone-settings-title" className="rz-title text-xl">This phone</h2>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                aria-label="Close"
                className="rz-btn rz-btn-ghost rz-btn-icon pointer-coarse:min-h-11 pointer-coarse:min-w-11"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="rz-panel p-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div id="ask-before-label" className="font-semibold text-bone">Ask before recording a sale</div>
                <p id="ask-before-help" className="text-xs text-dust leading-relaxed">
                  Shows the service, amount, tip and payment, with Record sale and Cancel. Saved on this phone only.
                </p>
              </div>
              <Switch
                checked={askBeforeRecording}
                onChange={handleAskBeforeRecording}
                labelledBy="ask-before-label"
                describedBy="ask-before-help"
              />
            </div>
            {settingNotSaved && (
              <p className="rz-notice rz-notice-warn text-sm">
                <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                This phone can&apos;t save settings (private browsing or blocked site data), so it records without asking.
              </p>
            )}
            <button
              type="button"
              onClick={() => { setShowSettings(false); setShowBindModal(true); }}
              className="rz-btn rz-btn-secondary w-full min-h-12 group"
            >
              <Repeat className="w-4 h-4 text-crimson-ink" />
              Change the barber for this phone
              <ChevronRight className="w-4 h-4 text-dust transition-transform duration-200 group-hover:translate-x-0.5" />
            </button>
          </div>
        </div>
      )}

      {/* Header — full width: the black banner */}
      <header className="rz-banner sticky top-0 z-40">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-2 px-4 py-2.5">
          <h1 className="sr-only">Point of sale</h1>
          <Link href="/" className="inline-flex items-center gap-2 sm:gap-2.5 shrink-0 pointer-coarse:min-h-11 text-bone hover:text-white transition-colors group">
            {/* The station light: it turns while a sync is running. */}
            <BarberPoleIcon className="w-3 h-7" spinning={isSyncing} />
            <span className="flex items-center gap-1.5">
              <span className="font-display font-semibold whitespace-nowrap tracking-[0.06em] sm:tracking-[0.12em] text-base sm:text-lg leading-none uppercase">
                RUZZCO POS
              </span>
              <MustacheIcon className="w-4 h-2 text-crimson hidden sm:inline-block" />
            </span>
          </Link>

          {/* Bound barber badge */}
          {binding && (
            // One line: on narrow phones the name is shortened here (title has it in full); the card below shows it whole.
            <div title={binding.barberName} className="rz-pill min-w-0 bg-panel-2 text-bone">
              <User className="w-3.5 h-3.5 shrink-0 text-crimson-ink" />
              <span className="font-semibold truncate">{binding.barberName}</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            {/* Network badge */}
            <ConnectionBadge isOnline={isOnline} shopPc={shopPc} />

            {/* Manual sync. The counts are in the button's name; the badges only show them. */}
            <button
              onClick={() => void triggerSync()}
              disabled={isSyncing || !isOnline}
              title="Sync pending transactions"
              aria-label={`Sync now${(pendingCount ?? 0) > 0 ? `, ${pendingCount} waiting` : ""}${(rejectedSales?.length ?? 0) > 0 ? `, ${rejectedSales?.length} need attention` : ""}`}
              className="rz-btn rz-btn-secondary rz-btn-icon relative pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? "animate-spin text-crimson-ink" : ""}`} />
              {(pendingCount ?? 0) > 0 && (
                <span aria-hidden="true" className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-crimson text-white text-xs font-bold ring-2 ring-wall flex items-center justify-center animate-pulse">
                  {pendingCount}
                </span>
              )}
              {(rejectedSales?.length ?? 0) > 0 && (
                <span aria-hidden="true" title="Sales needing attention" className="absolute -bottom-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-warn text-black text-xs font-bold ring-2 ring-wall flex items-center justify-center">
                  {rejectedSales?.length}
                </span>
              )}
            </button>

            {/* Phone settings: "Ask before recording a sale" and changing the barber ("Not you?"). */}
            <button
              onClick={() => { setSettingNotSaved(false); setShowSettings(true); }}
              title="Phone settings"
              aria-label="Phone settings and change barber"
              className="rz-btn rz-btn-secondary rz-btn-icon pointer-coarse:min-h-11 pointer-coarse:min-w-11 text-dust"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Layout: 1-col mobile → 2-col tablet → 3-col desktop ── */}
      {/* On phones, room at the end of the page for the payment bar fixed to the bottom. */}
      <div className="rz-page relative max-w-6xl mx-auto max-sm:pb-48">

        {/* While the shop PC can't record sales: they stay on this phone until it can. */}
        {(!isOnline || pcDown) && (
          <div className="px-4 pt-3">
            <ShopPcReminder isOnline={isOnline} shopPc={shopPc} pending={pendingCount ?? 0} />
          </div>
        )}

        {/* Feedback toasts. A polite live region, so screen readers announce a saved sale or a sync result. */}
        <div aria-live="polite" className="px-4 pt-3 space-y-2">
          {syncFeedback && (
            <div className="animate-drop rz-notice py-2.5 text-sm">
              <Sparkles className="w-4 h-4 text-brass shrink-0 mt-0.5" />
              {syncFeedback}
            </div>
          )}
          <RejectedSales sales={rejectedSales ?? []} busy={isSyncing} onRetry={handleRetryRejected} />
          {/* A saved sale is green; "not saved" and "switched off" messages are warnings. */}
          {lastActionToast && (
            <div className={`animate-drop rz-notice text-sm shadow-[0_14px_30px_-18px_rgb(0_0_0/0.9)] ${lastActionToast.type === "success" ? "rz-notice-ok" : "rz-notice-warn"}`}>
              {lastActionToast.type === "success" ? (
                <CheckCircle2 className="w-4.5 h-4.5 text-ok shrink-0 mt-px" />
              ) : (
                <TriangleAlert className="w-4.5 h-4.5 text-warn shrink-0 mt-px" />
              )}
              <span className="font-semibold">{lastActionToast.message}</span>
            </div>
          )}
        </div>

        {/* Main grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 lg:gap-6 px-4 py-5">

          {/* ── Col 1: Service Selection ── */}
          <section className="space-y-3 sm:col-span-1">
            <h2 className="rz-heading">
              <Layers className="w-4 h-4 text-crimson-ink" />
              Select Service
            </h2>

            <div className="space-y-2.5 rz-stagger">
              {services.map((service) => {
                const isSelected = service.id === selectedServiceId;
                return (
                  <button
                    key={service.id}
                    onClick={() => handleSelectService(service.id)}
                    type="button"
                    aria-pressed={isSelected}
                    className={`rz-press relative overflow-hidden w-full min-h-16 p-3.5 pr-4 rounded-xl border text-left flex items-center justify-between gap-3 transition-[background-color,border-color,box-shadow,transform] duration-200 ${
                      isSelected
                        ? "pl-5 bg-panel-2 border-chrome text-bone shadow-[inset_0_1px_0_rgb(214_228_250/0.14),0_14px_26px_-18px_rgb(0_0_0/0.95)]"
                        : "bg-panel border-seam text-bone-2 shadow-[inset_0_1px_0_rgb(214_228_250/0.08)] hover:bg-panel-2 hover:border-seam-strong"
                    }`}
                  >
                    {/* The chosen service is edged by the barber pole, which turns once as it is picked. */}
                    {isSelected && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1.5 rz-stripes rz-pole-once" />}
                    <span className="flex items-center gap-3 min-w-0">
                      {/* The chosen service lights its pole; the others show the scissors. */}
                      <span
                        className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 transition-colors duration-200 ${
                          isSelected ? "bg-black/45 ring-1 ring-white/10" : "bg-panel-2 ring-1 ring-seam text-dust"
                        }`}
                      >
                        {isSelected ? <BarberPoleIcon className="w-3.5 h-8" turnOnce /> : <Scissors className="w-4 h-4" />}
                      </span>
                      <span className="min-w-0">
                        {/* Two lines on a narrow phone rather than "Shave / Facial / Ma…". */}
                        <span className="block font-semibold text-[0.9375rem] leading-snug text-bone line-clamp-2 break-words">{service.name}</span>
                        <span className="block text-xs text-dust">Standard Service</span>
                      </span>
                    </span>
                    <span
                      className={`rz-figure text-xl shrink-0 transition-colors duration-200 ${
                        isSelected ? "text-bone" : "text-bone-2"
                      }`}
                    >
                      ₱{service.standardPrice.toFixed(2)}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Col 2: Checkout ── */}
          <section className="space-y-3 sm:col-span-1">
            <h2 className="rz-heading">
              <Banknote className="w-4 h-4 text-crimson-ink" />
              {/* Keyed by the amount, so a new total lights up brass for a moment. */}
              Checkout — <span key={previewAmount} className="animate-value text-bone">₱{previewAmount.toFixed(2)}</span>
            </h2>

            {/* Barber attribution display */}
            {binding && (
              <div className="rz-panel p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-full bg-crimson/15 ring-1 ring-crimson-bright/45 text-crimson-ink flex items-center justify-center font-display font-semibold text-lg shrink-0">
                    {binding.barberName.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-[0.9375rem] text-bone truncate">{binding.barberName}</div>
                    <div className="text-xs text-dust">Attributed Barber for this station</div>
                  </div>
                </div>
              </div>
            )}

            <div className="rz-panel p-3.5 space-y-3">
              <div id="adjust-total-label" className="rz-label">Adjust total</div>
              {/* aria-pressed tells screen readers which tip is chosen; sighted users see the raised fill. */}
              <div role="group" aria-labelledby="adjust-total-label" className="rz-seg">
                {(["NONE", "20", "50"] as const).map((choice) => (
                  <button key={choice} type="button" aria-pressed={tipChoice === choice} onClick={() => setTipChoice(choice)} className="rz-seg-item flex-1 px-1.5 text-xs pointer-coarse:min-h-11">{choice === "NONE" ? "No tip" : `+₱${choice} tip`}</button>
                ))}
                <button type="button" aria-pressed={tipChoice === "CUSTOM"} onClick={() => setTipChoice("CUSTOM")} className="rz-seg-item flex-1 px-1.5 text-xs pointer-coarse:min-h-11">Custom tip</button>
              </div>
              {/* 16px text on phones so iOS does not zoom in on focus. */}
              {tipChoice === "CUSTOM" && <input type="number" min="0" step="0.01" inputMode="decimal" placeholder="Tip amount" aria-label="Custom tip amount (₱)" value={customTipInput} onChange={(e) => setCustomTipInput(e.target.value)} className="rz-field animate-rise sm:text-sm pointer-coarse:min-h-11" />}
              <input type="number" min="0.01" step="0.01" inputMode="decimal" placeholder={`Custom amount (default ₱${previewListPrice.toFixed(2)})`} aria-label={`Custom amount (₱), optional. Default ₱${previewListPrice.toFixed(2)}`} value={customAmountInput} onChange={(e) => handleCustomAmountChange(e.target.value)} className="rz-field sm:text-sm pointer-coarse:min-h-11" />
              {/* A note on a custom amount, e.g. "Request barber" or "VIP". No maxLength: a pasted
                  note is never cut silently; the counter says when it is too long. */}
              {preview.isCustomAmount && (
                <div className="animate-rise space-y-1">
                  <input
                    type="text"
                    placeholder="Note (optional), e.g. Request barber"
                    aria-label="Note for this custom amount (optional)"
                    aria-describedby="custom-note-help"
                    aria-invalid={Boolean(noteError)}
                    value={customNote}
                    onChange={(e) => setCustomNote(e.target.value)}
                    className={`rz-field sm:text-sm pointer-coarse:min-h-11 ${noteError ? "border-warn" : ""}`}
                  />
                  <p id="custom-note-help" className={`text-xs ${noteError ? "text-warn-ink" : "text-dust"}`}>
                    {noteError ?? `${customNote.trim().length} of ${CUSTOM_NOTE_MAX} characters`}
                  </p>
                </div>
              )}
              {/* The paper card is checked by the barber; the POS only applies the discount. */}
              {loyaltyOffered && (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div id="loyalty-label" className="text-sm font-semibold text-bone flex items-center gap-1.5">
                      <BadgePercent className="w-4 h-4 text-brass shrink-0" />
                      Loyalty card: {LOYALTY_PERCENT}% off
                    </div>
                    {preview.isCustomAmount && (
                      <p id="loyalty-help" className="text-xs text-dust">Not with a custom amount.</p>
                    )}
                  </div>
                  <Switch
                    checked={preview.isLoyalty}
                    onChange={setLoyalty}
                    labelledBy="loyalty-label"
                    describedBy={preview.isCustomAmount ? "loyalty-help" : undefined}
                    disabled={preview.isCustomAmount}
                  />
                </div>
              )}
              <div className="flex justify-between gap-3 text-xs text-dust tabular-nums">
                <span>List ₱{preview.listPrice.toFixed(2)}{preview.isLoyalty && ` · loyalty −₱${preview.discountAmount.toFixed(2)}`}</span>
                <span className="text-bone-2">Paid ₱{previewAmount.toFixed(2)} · tip ₱{previewTip.toFixed(2)}</span>
              </div>
            </div>

            {/* Payment buttons (slice 13). On phones they sit in a bar fixed to the bottom of the
                screen, two by two with the method over the amount, so every one is in reach without
                scrolling; from tablet width they are the stacked column beside the services. */}
            <div className="fixed inset-x-0 bottom-0 z-30 border-t border-seam-strong bg-wall/95 backdrop-blur px-4 pt-2 pb-[max(0.625rem,env(safe-area-inset-bottom))] shadow-[0_-14px_30px_-18px_rgb(0_0_0/0.95)] sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:backdrop-blur-none sm:p-0 sm:shadow-none">
              <p className="sm:hidden mb-1.5 flex justify-between gap-3 text-xs text-dust tabular-nums">
                <span className="truncate">{selectedService?.name}{preview.isLoyalty && ` · Loyalty ${LOYALTY_PERCENT}%`}</span>
                <span className="text-bone-2 shrink-0">Paid ₱{previewAmount.toFixed(2)}{previewTip > 0 && ` + ₱${previewTip.toFixed(2)} tip`}</span>
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-1 sm:gap-3">
                <button
                  onClick={handleCashCheckout}
                  disabled={payDisabled}
                  type="button"
                  className="rz-btn rz-btn-primary rz-pay max-sm:min-h-14 max-sm:px-2 max-sm:py-1.5 gap-2.5 max-sm:gap-2"
                >
                  <Banknote className="w-5 h-5 stroke-[2.5] shrink-0" />
                  <PayLabel method="Cash" amount={previewAmount} />
                </button>

                <button
                  onClick={() => { setDigitalRef(""); setDigitalMethod("GCASH"); }}
                  disabled={payDisabled}
                  type="button"
                  className="rz-btn rz-pay rz-pay-gcash max-sm:min-h-14 max-sm:px-2 max-sm:py-1.5 gap-2.5 max-sm:gap-2"
                >
                  <Smartphone className="w-5 h-5 stroke-[2.5] shrink-0" />
                  <PayLabel method="GCash" amount={previewAmount} />
                </button>

                <button
                  onClick={() => { setDigitalRef(""); setDigitalMethod("MAYA"); }}
                  disabled={payDisabled}
                  type="button"
                  className={`rz-btn rz-pay rz-pay-maya max-sm:min-h-14 max-sm:px-2 max-sm:py-1.5 gap-2.5 max-sm:gap-2 ${gatewayEnabled ? "" : "max-sm:col-span-2"}`}
                >
                  <Smartphone className="w-5 h-5 stroke-[2.5] shrink-0" />
                  <PayLabel method="Maya" amount={previewAmount} />
                </button>

                {gatewayEnabled && (
                  <button
                    onClick={() => { void handleQrphCheckout(); }}
                    disabled={payDisabled || !isOnline || pcDown}
                    type="button"
                    className="animate-rise rz-btn rz-pay rz-pay-qrph max-sm:min-h-14 max-sm:px-2 max-sm:py-1.5 gap-2.5 max-sm:gap-2"
                  >
                    <QrCode className="w-5 h-5 stroke-[2.5] shrink-0" />
                    <PayLabel method="QR Ph (test)" shortMethod="QR Ph" amount={previewAmount} />
                  </button>
                )}
              </div>
              {gatewayEnabled && (!isOnline || pcDown) && (
                <p className="mt-1.5 text-center text-xs text-warn-ink">
                  {!isOnline ? "QR Ph needs internet. Use cash, GCash or Maya." : "QR Ph needs the shop PC. Use cash, GCash or Maya."}
                </p>
              )}
              {noteError && <p className="sm:hidden mt-1.5 text-center text-xs text-warn-ink">Note too long: shorten it to record the sale.</p>}
            </div>

            {/* Under the buttons the reminder at the top has usually scrolled away, so repeat it here. */}
            {!isOnline || pcDown ? (
              <p className="text-center text-xs text-warn-ink">
                {(pendingCount ?? 0) > 0
                  ? `Not connected to the shop PC: ${pendingCount} ${pendingCount === 1 ? "sale is" : "sales are"} on this phone only until it reconnects.`
                  : "Not connected to the shop PC: sales stay on this phone until it reconnects."}
              </p>
            ) : (
              <p className="text-center text-xs text-dust">
                Saves to device immediately — syncs to server when online
              </p>
            )}
          </section>

          {/* ── Col 3: Mini shift preview + link ── */}
          <section className="space-y-3 sm:col-span-2 lg:col-span-1">
            <div className="flex items-center justify-between">
              <h2 className="rz-heading">
                <List className="w-4 h-4 text-crimson-ink" />
                Recent Cuts
              </h2>
              {/* Padding with matching negative margins: a bigger target without moving the layout. */}
              <Link
                href="/shift-log"
                aria-label={`View all cuts${(pendingCount ?? 0) > 0 ? `, ${pendingCount} waiting to sync` : ""}`}
                className="inline-flex items-center gap-1 -my-2 py-2 pointer-coarse:-my-3.5 pointer-coarse:py-3.5 text-xs font-semibold text-dust hover:text-bone transition-colors group"
              >
                View all
                {(pendingCount ?? 0) > 0 && (
                  <span className="ml-1 min-w-5 px-1.5 py-0.5 rounded-full bg-crimson text-white text-xs font-bold text-center">
                    {pendingCount}
                  </span>
                )}
                <ChevronRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            </div>

            <div className="rz-panel overflow-hidden">
              {(!recentTransactions || recentTransactions.length === 0) ? (
                <div className="p-6 text-center text-sm text-dust">
                  <p>No cuts logged yet today.</p>
                </div>
              ) : (
                <ul className="rz-rows rz-stagger">
                  {recentTransactions.map((tx) => (
                    <li
                      key={tx.id}
                      className="px-3.5 py-3 flex items-center justify-between gap-2 text-sm"
                    >
                      <div className="truncate min-w-0">
                        <span className="font-medium text-bone">{tx.serviceName}</span>
                        <span className="text-dust ml-1">• {tx.barberName}</span>
                      </div>
                      {/* Icons carry the payment method and sync status, so each one has a name for screen readers. */}
                      <div className="flex items-center gap-2 shrink-0">
                        {tx.paymentMethod === "QRPH" ? (
                          <span role="img" aria-label="QR Ph (test)" className="w-5 h-5 rounded-full flex items-center justify-center bg-qrph/20 text-qrph-ink" title="QR Ph (test)">
                            <QrCode className="w-3 h-3" />
                          </span>
                        ) : tx.paymentMethod === "GCASH" || tx.paymentMethod === "MAYA" ? (
                          <span role="img" aria-label={tx.paymentMethod === "MAYA" ? "Maya" : "GCash"} className={`w-5 h-5 rounded-full flex items-center justify-center ${tx.paymentMethod === "MAYA" ? "bg-maya/20 text-maya-ink" : "bg-gcash/20 text-gcash-ink"}`} title={tx.paymentMethod === "MAYA" ? "Maya" : "GCash"}>
                            <Smartphone className="w-3 h-3" />
                          </span>
                        ) : (
                          <span role="img" aria-label="Cash" className="w-5 h-5 rounded-full bg-crimson/20 text-crimson-ink flex items-center justify-center" title="Cash">
                            <Banknote className="w-3 h-3" />
                          </span>
                        )}
                        <span className="rz-figure text-base text-bone">₱{Number(tx.totalAmount).toFixed(2)}</span>
                        {tx.synced === 1 ? (
                          <span role="img" aria-label="Synced" title="Synced"><CheckCircle2 className="w-4 h-4 text-ok" /></span>
                        ) : isRejected(tx) ? (
                          <span role="img" aria-label="Needs attention" title="Needs attention"><TriangleAlert className="w-4 h-4 text-warn" /></span>
                        ) : (
                          <span role="img" aria-label="Waiting to sync" title="Waiting to sync"><Clock className="w-4 h-4 text-crimson-ink" /></span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Links to full shift log & reconciliation */}
            <div className="space-y-2 pt-1">
              <Link
                href="/shift-log"
                className="rz-btn rz-btn-secondary w-full pointer-coarse:min-h-11 group"
              >
                <List className="w-4 h-4 text-crimson-ink" />
                Full Shift Log &amp; EOD Summary
                <ChevronRight className="w-4 h-4 text-dust transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/reconciliation"
                className="rz-btn rz-btn-secondary w-full pointer-coarse:min-h-11 group"
              >
                <Banknote className="w-4 h-4 text-crimson-ink" />
                Daily Cash Reconciliation
                <ChevronRight className="w-4 h-4 text-dust transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}

// ─── Payment button label (slice 13) ─────────────────────────────────────────

/** "Cash — ₱250.00" on one line from tablet width; on phones the method sits over the amount. */
function PayLabel({ method, shortMethod = method, amount }: { method: string; shortMethod?: string; amount: number }) {
  return (
    <span className="flex flex-col items-start leading-tight sm:flex-row sm:items-baseline sm:gap-1.5 min-w-0">
      <span className="sm:hidden truncate max-w-full">{shortMethod}</span>
      <span className="hidden sm:inline">{method} —</span>
      <span className="max-sm:text-[0.9375rem] tabular-nums">₱{amount.toFixed(2)}</span>
    </span>
  );
}

// ─── Switch (slice 13) ───────────────────────────────────────────────────────

/** An on/off switch: a button with role="switch", at least 44 px tall to tap. */
function Switch({ checked, onChange, labelledBy, describedBy, disabled = false }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  labelledBy: string;
  describedBy?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="shrink-0 min-h-11 min-w-14 flex items-center justify-center rounded-full disabled:opacity-40 disabled:cursor-not-allowed group"
    >
      <span
        aria-hidden="true"
        className={`relative w-12 h-7 rounded-full ring-1 transition-colors duration-200 ${checked ? "bg-crimson ring-crimson-bright" : "bg-panel-2 ring-seam-strong"}`}
      >
        <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-bone shadow transition-transform duration-200 ${checked ? "translate-x-5" : ""}`} />
      </span>
    </button>
  );
}

// ─── Sale summary (slice 13) ─────────────────────────────────────────────────

/** What "Ask before recording a sale" shows: the sale exactly as it will be recorded. */
function SaleSummary({ serviceName, sale, note, method }: { serviceName: string; sale: PricedSale; note: string; method: string }) {
  const amountDetail = sale.isLoyalty
    ? `Loyalty ${LOYALTY_PERCENT}%, list ₱${sale.listPrice.toFixed(2)}`
    : sale.isCustomAmount
      ? `Custom amount${note.trim() ? `: ${note.trim()}` : ""}`
      : null;
  const rows: [string, string, string | null][] = [
    ["Service", serviceName, null],
    ["Amount", `₱${sale.amountPaid.toFixed(2)}`, amountDetail],
    ["Tip", sale.tipAmount > 0 ? `₱${sale.tipAmount.toFixed(2)}` : "No tip", null],
    ["Payment", method, null],
  ];
  return (
    <dl className="rz-panel divide-y divide-seam text-sm">
      {rows.map(([label, value, detail]) => (
        <div key={label} className="px-3.5 py-2.5 flex items-baseline justify-between gap-3">
          <dt className="text-dust shrink-0">{label}</dt>
          <dd className="text-right min-w-0">
            <span className="font-semibold text-bone break-words">{value}</span>
            {detail && <span className="block text-xs text-dust break-words">{detail}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

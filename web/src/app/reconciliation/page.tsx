"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Scissors,
  Banknote,
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ClipboardCheck,
  QrCode,
  LockKeyhole,
} from "lucide-react";
import { BarberPoleIcon } from "@/components/RuzzcoBrand";
import { manilaToday } from "@/lib/business-date";

interface ExpectedTotals {
  cashTotal: string;
  gcashTotal: string;
  mayaTotal: string;
  digitalTotal: string;
  qrphTotal: string;
  gatewaySales: GatewaySale[];
  cashTips: string;
  cashPayouts: string;
  pettyCash: string;
  expectedDrawerCash: string;
  totalRevenue: string;
  transactionCount: number;
}

// QR Ph (PayMongo test) sales on this date. Only PAID ones count; the rest are listed only.
interface GatewaySale {
  id: string;
  status: "PAID" | "PENDING" | "EXPIRED" | "FAILED";
  amount: string;
  transactionTime: string;
  paidAt: string | null;
  late: boolean; // confirmed after this business day ended
}

interface SavedRecord {
  id: number;
  revision: number;
  expectedCash: string;
  countedCash: string;
  variance: string;
  gcashTotal: string;
  mayaTotal: string;
  digitalTotal: string;
  pettyCashAmount: string;
  pettyCashNote: string | null;
  totalRevenue: string;
  note: string | null;
  reconciledAt: string;
}

interface Staleness {
  stale: boolean;
  staleReasons: ("EXPECTED_CASH_CHANGED" | "LATE_SYNCED_TRANSACTIONS" | "LATE_GATEWAY_CONFIRMATIONS" | "TIME_REVIEWED")[];
  lateSyncedCount: number;
  lateConfirmedCount: number;
  lateReviewedCount: number;
  expectedCashDelta: string;
}

// A sale whose phone timestamp is suspect (L5). It counts on no day until the owner picks one.
interface NeedsReviewSale {
  id: string;
  barberName: string;
  paymentMethod: string;
  amount: string;
  tipAmount: string;
  flag: "FUTURE_TIMESTAMP" | "DEVICE_CLOCK_SKEW";
  skewSeconds: number | null;
  transactionTime: string;
  receivedAt: string;
  statedDate: string;
  receivedDate: string;
}

const manilaTime = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// The save message ends in a "✓" glyph; the notice already draws a real check icon.
const withoutTick = (text: string) => text.replace(/\s*✓$/, "");

export default function ReconciliationPage() {
  const todayStr = manilaToday(); // business date, whatever the device's timezone
  const [date, setDate] = useState(todayStr);
  const [expected, setExpected] = useState<ExpectedTotals | null>(null);
  const [saved, setSaved] = useState<SavedRecord | null>(null);
  const [staleness, setStaleness] = useState<Staleness | null>(null);
  const [needsReview, setNeedsReview] = useState<NeedsReviewSale[]>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [countedCash, setCountedCash] = useState("");
  const [note, setNote] = useState("");
  const [pettyCashAmount, setPettyCashAmount] = useState("");
  const [pettyCashNote, setPettyCashNote] = useState("");
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);
  const [ownerPin, setOwnerPin] = useState("");
  const [showOwnerUnlock, setShowOwnerUnlock] = useState(false);

  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadData() {
      setIsLoading(true);
      setExpected(null);
      setSaved(null);
      setStaleness(null);
      setNeedsReview([]);
      setFeedback(null);
      try {
        const res = await fetch(`/api/v1/reports/reconciliation?date=${date}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!active) return;
        if (data.success) {
          setExpected(data.expected);
          setSaved(data.saved);
          setStaleness(data.staleness);
          setNeedsReview(data.needsDateReview ?? []);
          if (data.saved) {
            setCountedCash(data.saved.countedCash);
            setNote(data.saved.note ?? "");
            setPettyCashAmount(data.saved.pettyCashAmount ?? "0.00");
            setPettyCashNote(data.saved.pettyCashNote ?? "");
          } else {
            setCountedCash("");
            setNote("");
            setPettyCashAmount("");
            setPettyCashNote("");
          }
        }
      } catch (err) {
        if (!active) return;
        console.error(err);
        setFeedback({ msg: "Could not load data — are you online?", ok: false });
      } finally {
        if (active) setIsLoading(false);
      }
    }

    loadData();
    return () => { active = false; };
  }, [date, refreshKey]);

  const handleSubmit = async () => {
    const parsed = parseFloat(countedCash);
    if (isNaN(parsed) || parsed < 0) {
      setFeedback({ msg: "Enter a valid cash amount (e.g. 1500.00)", ok: false });
      return;
    }
    setIsSaving(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/v1/reports/reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, countedCash: parsed, note: note.trim() || undefined, pettyCashAmount: parseFloat(pettyCashAmount) || 0, pettyCashNote: pettyCashNote.trim() || undefined }),
      });
      const data = await res.json();
      if (res.status === 401) {
        setShowOwnerUnlock(true);
        setFeedback({ msg: "Owner PIN required to save reconciliation.", ok: false });
        return;
      }
      if (data.success) {
        setExpected(data.expected);
        setSaved(data.saved);
        setStaleness(data.staleness);
        setFeedback({ msg: `Reconciliation saved as revision ${data.saved.revision} ✓`, ok: true });
      } else {
        setFeedback({ msg: data.error ?? "Save failed", ok: false });
      }
    } catch (err) {
      console.error(err);
      setFeedback({ msg: "Save failed — check connection", ok: false });
    } finally {
      setIsSaving(false);
    }
  };

  // Owner confirms a flagged sale's business day; the figures then reload.
  const handleReview = async (id: string, choice: "STATED_DATE" | "RECEIVED_DATE") => {
    setReviewingId(id);
    setFeedback(null);
    try {
      const res = await fetch("/api/v1/reports/time-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: id, choice }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 401) {
        setShowOwnerUnlock(true);
        setFeedback({ msg: "Owner PIN required to confirm a sale's date.", ok: false });
        return;
      }
      if (!res.ok || !data?.success) {
        setFeedback({ msg: data?.error ?? "Could not record the review", ok: false });
        return;
      }
      setFeedback({ msg: `Sale counted on ${data.businessDate}.`, ok: true });
      setRefreshKey((k) => k + 1);
    } catch {
      setFeedback({ msg: "Could not record the review — check connection", ok: false });
    } finally {
      setReviewingId(null);
    }
  };

  // Escape closes the owner PIN dialog, like its Cancel button.
  useEffect(() => {
    if (!showOwnerUnlock) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setShowOwnerUnlock(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showOwnerUnlock]);

  const variance = saved ? parseFloat(saved.variance) : null;
  const previewExpectedDrawer = expected
    ? parseFloat(expected.expectedDrawerCash) - (parseFloat(pettyCashAmount) || 0) + parseFloat(expected.pettyCash)
    : 0;
  const previewVariance =
    expected && countedCash !== ""
      ? parseFloat(countedCash) - previewExpectedDrawer
      : null;

  return (
    <div className="flex-1">
      {showOwnerUnlock && (
        <div className="rz-overlay items-center">
          <form role="dialog" aria-modal="true" aria-labelledby="owner-pin-title" onSubmit={async (event) => { event.preventDefault(); const res = await fetch("/api/v1/owner/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: ownerPin }) }); if (res.ok) { setShowOwnerUnlock(false); setOwnerPin(""); setFeedback({ msg: "Owner access granted. Save again.", ok: true }); } else { const data = await res.json().catch(() => null); setFeedback({ msg: data?.error ?? "Invalid owner PIN.", ok: false }); } }} className="rz-dialog p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <span aria-hidden="true" className="w-9 h-9 rounded-full bg-brass/10 ring-1 ring-brass/40 text-brass-bright flex items-center justify-center shrink-0">
                <LockKeyhole className="w-4 h-4" />
              </span>
              <h2 id="owner-pin-title" className="rz-title text-xl">Owner PIN required</h2>
            </div>
            <input autoFocus type="password" inputMode="numeric" aria-label="Owner PIN" value={ownerPin} onChange={(event) => setOwnerPin(event.target.value)} className="rz-field min-h-12 text-center text-lg tracking-[0.4em] placeholder:text-base placeholder:tracking-normal" placeholder="Owner PIN" />
            <div className="flex gap-2"><button type="button" onClick={() => setShowOwnerUnlock(false)} className="rz-btn rz-btn-secondary flex-1 pointer-coarse:min-h-11">Cancel</button><button type="submit" className="rz-btn rz-btn-primary flex-1 pointer-coarse:min-h-11">Unlock</button></div>
          </form>
        </div>
      )}

      {/* Header: the black banner */}
      <header className="rz-banner">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-2 px-4 py-3">
          {/* Padding with matching negative margins: bigger targets without moving the layout. */}
          <Link
            href="/shift-log"
            className="inline-flex items-center gap-1.5 -my-2 py-2 pointer-coarse:-my-3.5 pointer-coarse:py-3.5 text-sm text-dust hover:text-bone transition-colors group shrink-0"
          >
            <ArrowLeft className="w-4 h-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
            <span>Shift Log</span>
          </Link>
          <div className="flex items-center gap-2 min-w-0">
            {/* The station light: it turns while the totals load. */}
            <BarberPoleIcon className="w-2.5 h-6" spinning={isLoading} />
            <h1 className="font-display font-semibold tracking-wide sm:tracking-widest text-[0.9375rem] sm:text-lg leading-none text-bone uppercase truncate">
              EOD CASH RECONCILIATION
            </h1>
          </div>
          <Link
            href="/pos"
            className="inline-flex items-center justify-center gap-1 min-w-6 -my-2 py-2 pointer-coarse:-my-3.5 pointer-coarse:py-3.5 pointer-coarse:min-w-11 text-sm font-semibold text-dust hover:text-bone transition-colors shrink-0"
          >
            <span>POS</span>
          </Link>
        </div>
      </header>

      <div className="rz-page relative max-w-2xl mx-auto px-4 py-5 space-y-5">
        {/* Date picker */}
        <div className="rz-panel flex items-center gap-3 p-3">
          <label htmlFor="reconciliation-date" className="rz-label shrink-0">
            Select Date:
          </label>
          {/* 16px text on phones so iOS does not zoom in on focus. */}
          <input
            id="reconciliation-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            max={todayStr}
            className="rz-field flex-1 min-w-0 py-1.5 pointer-coarse:min-h-11 sm:text-sm scheme-dark"
          />
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={isLoading}
            title="Refresh expected totals"
            aria-label="Refresh expected totals"
            className="rz-btn rz-btn-secondary rz-btn-icon pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin text-crimson-ink" : ""}`} />
          </button>
        </div>

        {/* While the register totals load: the strip's shape, not a spinner. */}
        {isLoading && !expected && (
          <div aria-hidden="true" className="rz-strip grid-cols-2 sm:grid-cols-6">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className={`space-y-2.5 ${i < 3 ? "sm:col-span-2" : "sm:col-span-3"} last:col-span-2 sm:last:col-span-3`}>
                <div className="rz-skeleton h-3 w-20" />
                <div className="rz-skeleton h-6 w-24" />
              </div>
            ))}
          </div>
        )}

        {/* Expected totals from server */}
        {expected && (
          <section className="animate-rise space-y-2.5">
            <h2 className="rz-heading">
              Synced Totals From Register
            </h2>
            {/* Sales by method on top; the two totals the drawer is checked against below them. */}
            <div className="rz-strip grid-cols-2 sm:grid-cols-6 rz-stagger">
              {/* Cash keeps its crimson on the icon only: in figures, red means "cash short". */}
              {[
                { label: "Cash Sales", value: `₱${expected.cashTotal}`, icon: Banknote, color: "text-bone", iconColor: "text-crimson-ink" },
                { label: "GCash Sales", value: `₱${expected.gcashTotal}`, icon: Smartphone, color: "text-gcash-ink", iconColor: "text-gcash-ink" },
                { label: "Maya Sales", value: `₱${expected.mayaTotal}`, icon: Smartphone, color: "text-maya-ink", iconColor: "text-maya-ink" },
                { label: "Expected Drawer", value: `₱${expected.expectedDrawerCash}`, icon: Banknote, color: "text-brass-bright", iconColor: "text-brass-bright" },
                { label: "Total Revenue", value: `₱${expected.totalRevenue}`, icon: Scissors, color: "text-bone", iconColor: "text-dust" },
              ].map((c, i) => (
                <div key={c.label} className={`space-y-1 ${i < 3 ? "sm:col-span-2" : "sm:col-span-3"} last:col-span-2 sm:last:col-span-3`}>
                  <div className="rz-label flex items-center gap-1.5">
                    <c.icon className={`w-3.5 h-3.5 shrink-0 ${c.iconColor}`} />
                    {c.label}
                  </div>
                  <div className={`rz-figure text-2xl ${c.color}`}>{c.value}</div>
                </div>
              ))}
            </div>
            {(parseFloat(expected.qrphTotal) > 0 || expected.gatewaySales.length > 0) && (
              <div className="rz-panel p-3.5 space-y-2.5 border-qrph/30">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-1.5 text-qrph-ink font-semibold">
                    <QrCode className="w-4 h-4" /> QR Ph (PayMongo test) collected
                  </span>
                  <span className="rz-figure text-lg text-qrph-ink">₱{expected.qrphTotal}</span>
                </div>
                <p className="text-xs text-dust">Gateway money is not in the drawer. Only paid QR sales count.</p>
                <ul className="rz-well overflow-hidden divide-y divide-seam empty:hidden">
                  {expected.gatewaySales.map((g) => (
                    <li key={g.id} className="flex items-center justify-between gap-2 text-xs px-3 py-2">
                      <span className="text-dust">
                        {new Date(g.transactionTime).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" })}
                        <span className="font-mono text-dust-2 ml-1.5">{g.id.slice(0, 8)}…</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className={`rz-pill ${g.status === "PAID" ? "rz-pill-ok" : g.status === "PENDING" ? "rz-pill-warn" : "rz-pill-danger"}`}>
                          {g.status}{g.late ? " · late confirmation" : ""}
                        </span>
                        <span className={`rz-figure text-sm ${g.status === "PAID" ? "text-bone" : "text-dust line-through"}`}>₱{g.amount}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-dust">
              {expected.transactionCount} paid synced transactions on {date}
            </p>
          </section>
        )}

        {/* Sales held for date review (L5) */}
        {needsReview.length > 0 && (
          <section className="animate-rise p-4 rounded-xl bg-warn/7 border border-warn/35 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-warn-ink uppercase tracking-wider">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {needsReview.length} {needsReview.length === 1 ? "sale needs" : "sales need"} a date
            </div>
            <p className="text-sm text-warn-ink/90 leading-relaxed">
              The phone&apos;s clock looked wrong when {needsReview.length === 1 ? "this sale" : "these sales"} synced, so{" "}
              {needsReview.length === 1 ? "it is" : "they are"} not counted in any day&apos;s cash, revenue or payouts yet. Pick the day each
              one belongs to.
            </p>
            {needsReview.map((sale) => (
              <div key={sale.id} className="p-3 rounded-lg bg-black/30 border border-warn/20 text-xs space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-bone">{sale.barberName} · {sale.paymentMethod}</span>
                  <span className="rz-figure text-sm text-bone">₱{sale.amount}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-dust">
                  <div>Phone said: <span className="text-bone-2">{manilaTime(sale.transactionTime)}</span></div>
                  <div>Server got it: <span className="text-bone-2">{manilaTime(sale.receivedAt)}</span></div>
                </div>
                <div className="text-xs text-warn-ink">
                  {sale.flag === "FUTURE_TIMESTAMP"
                    ? "Stamped later than it reached the server."
                    : `The phone's clock was off by about ${Math.round(Math.abs(sale.skewSeconds ?? 0) / 60)} minutes.`}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleReview(sale.id, "STATED_DATE")}
                    disabled={reviewingId !== null || sale.statedDate > todayStr}
                    className="rz-btn rz-btn-secondary flex-1 min-h-9 px-3 text-xs pointer-coarse:min-h-11"
                    title={sale.statedDate > todayStr ? "That date has not happened yet" : undefined}
                  >
                    Keep {sale.statedDate}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReview(sale.id, "RECEIVED_DATE")}
                    disabled={reviewingId !== null}
                    className="rz-btn rz-btn-warn flex-1 min-h-9 px-3 text-xs pointer-coarse:min-h-11"
                  >
                    Use {sale.receivedDate}
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Drawer count form */}
        <section className="rz-panel p-4 sm:p-5 space-y-4">
          <h2 className="rz-heading text-bone">
            Physical Drawer Cash Count
          </h2>

          <div>
            <label htmlFor="counted-cash" className="rz-field-label">Actual cash counted in drawer (₱)</label>
            <input
              id="counted-cash"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="e.g. 2100.00"
              value={countedCash}
              onChange={(e) => setCountedCash(e.target.value)}
              className="rz-field min-h-14 px-4 font-display text-2xl tracking-wide placeholder:font-sans placeholder:text-base placeholder:tracking-normal"
            />
          </div>

          {/* Live variance preview */}
          {previewVariance !== null && (
            <div
              className={`animate-fade rz-notice items-center font-semibold ${
                Math.abs(previewVariance) < 0.01
                  ? "rz-notice-ok"
                  : previewVariance > 0
                  ? "rz-notice-over"
                  : "rz-notice-danger"
              }`}
            >
              {Math.abs(previewVariance) < 0.01 ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              )}
              <span>
                Variance:{" "}
                {previewVariance > 0 ? "+" : ""}
                ₱{previewVariance.toFixed(2)}{" "}
                {Math.abs(previewVariance) < 0.01
                  ? "— Drawer is balanced"
                  : previewVariance < 0
                  ? "— Cash short (Abono check required)"
                  : "— Cash over"}
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="petty-cash-amount" className="rz-field-label">Petty cash taken from drawer (₱)</label>
              <input id="petty-cash-amount" type="number" inputMode="decimal" min="0" step="0.01" placeholder="e.g. 150.00" value={pettyCashAmount} onChange={(e) => setPettyCashAmount(e.target.value)} className="rz-field pointer-coarse:min-h-11 sm:text-sm" />
            </div>
            <div>
              <label htmlFor="petty-cash-note" className="rz-field-label">Petty cash note</label>
              <input id="petty-cash-note" type="text" maxLength={255} placeholder="Ice, snacks, supplies" value={pettyCashNote} onChange={(e) => setPettyCashNote(e.target.value)} className="rz-field pointer-coarse:min-h-11 sm:text-sm" />
            </div>
          </div>

          <div>
            <label htmlFor="audit-note" className="rz-field-label">Audit note (optional)</label>
            <input
              id="audit-note"
              type="text"
              placeholder="e.g. Short ₱50 — discrepancy in coin change"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              className="rz-field pointer-coarse:min-h-11 sm:text-sm"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={isSaving || !countedCash || !expected}
            className="rz-btn rz-btn-primary w-full min-h-13 font-display text-base uppercase tracking-wider"
          >
            {isSaving ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <><ClipboardCheck className="w-4 h-4" /> {saved ? `Save As Revision ${saved.revision + 1}` : "Save End-Of-Day Reconciliation"}</>
            )}
          </button>
        </section>

        {/* Announces save and review results to screen readers; out of the layout flow. */}
        <p aria-live="polite" className="sr-only">{feedback ? withoutTick(feedback.msg) : ""}</p>

        {/* Feedback */}
        {feedback && (
          <div
            className={`animate-rise rz-notice items-center ${
              feedback.ok
                ? "rz-notice-ok"
                : "rz-notice-danger"
            }`}
          >
            {feedback.ok ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            {withoutTick(feedback.msg)}
          </div>
        )}

        {/* Saved record */}
        {saved && (
          <section className="animate-rise rz-panel p-4 sm:p-5 space-y-3.5">
            <h2 className="rz-heading">
              Saved Audit Record · Revision {saved.revision}
            </h2>
            {staleness?.stale && (
              <div className="rz-notice rz-notice-warn text-xs">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-bold">Out of date: this record no longer matches the register.</p>
                  {staleness.staleReasons.includes("LATE_SYNCED_TRANSACTIONS") && (
                    <p>{staleness.lateSyncedCount} sale{staleness.lateSyncedCount === 1 ? "" : "s"} for this date synced after it was saved.</p>
                  )}
                  {staleness.staleReasons.includes("LATE_GATEWAY_CONFIRMATIONS") && (
                    <p>{staleness.lateConfirmedCount} QR Ph sale{staleness.lateConfirmedCount === 1 ? " was" : "s were"} confirmed paid after it was saved (revenue changed; the drawer did not).</p>
                  )}
                  {staleness.staleReasons.includes("TIME_REVIEWED") && (
                    <p>{staleness.lateReviewedCount} sale{staleness.lateReviewedCount === 1 ? " was" : "s were"} confirmed onto this date after it was saved.</p>
                  )}
                  {staleness.staleReasons.includes("EXPECTED_CASH_CHANGED") && (
                    <p>Expected drawer cash is now ₱{expected?.expectedDrawerCash} ({parseFloat(staleness.expectedCashDelta) > 0 ? "+" : ""}₱{staleness.expectedCashDelta}).</p>
                  )}
                  <p>The variance below was correct when saved. Count the drawer again and save a new revision.</p>
                </div>
              </div>
            )}
            <div className="rz-well grid grid-cols-1 sm:grid-cols-2 overflow-hidden">
              {[
                { label: "Expected Cash", value: `₱${saved.expectedCash}` },
                { label: "Petty Cash", value: `₱${saved.pettyCashAmount}` },
                { label: "Counted Cash", value: `₱${saved.countedCash}` },
                { label: "GCash Total", value: `₱${saved.gcashTotal}` },
                { label: "Maya Total", value: `₱${saved.mayaTotal}` },
                { label: "Total Revenue", value: `₱${saved.totalRevenue}` },
              ].map((r) => (
                <div key={r.label} className="flex items-baseline justify-between gap-3 px-3.5 py-2.5 text-sm shadow-[0_1px_0_var(--color-seam),1px_0_0_var(--color-seam)]">
                  <span className="text-dust">{r.label}</span>
                  <span className="rz-figure text-base text-bone">{r.value}</span>
                </div>
              ))}
            </div>
            <div
              className={`rz-notice items-center font-bold ${
                variance !== null && Math.abs(variance) < 0.01
                  ? "rz-notice-ok"
                  : variance !== null && variance < 0
                  ? "rz-notice-danger"
                  : "rz-notice-over"
              }`}
            >
              {variance !== null && Math.abs(variance) < 0.01 ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              )}
              <span>
                {staleness?.stale ? "Variance when saved" : "Variance"}: {variance !== null && variance > 0 ? "+" : ""}₱{saved.variance}{" "}
                {variance !== null && Math.abs(variance) < 0.01
                  ? "— Balanced"
                  : variance !== null && variance < 0
                  ? "— Cash short"
                  : "— Cash over"}
              </span>
            </div>
            {saved.note && (
              <p className="text-sm text-dust italic">Note: {saved.note}</p>
            )}
            {saved.pettyCashNote && (
              <p className="text-sm text-dust italic">Petty cash: {saved.pettyCashNote}</p>
            )}
            <p className="text-xs text-dust">
              Reconciled at {manilaTime(saved.reconciledAt)} (Manila time)
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, type CSSProperties } from "react";
import {
  Banknote,
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ClipboardCheck,
  QrCode,
  LockKeyhole,
} from "lucide-react";
import { PageContainer, PageHeader } from "@/components/PageHeader";
import { OwnerSignInDialog } from "@/components/OwnerSignIn";
import { manilaToday } from "@/lib/business-date";
import { peso } from "@/lib/peso";

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

// Slice 26: one date in the recent list, with its latest saved count.
interface RecentCount {
  date: string;
  latest: SavedRecord;
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

// Amounts arrive as fixed-2 strings; lib/peso.ts prints them ("₱1,000.00", "-₱50.00").
const pesoOf = (amount: string) => peso(Number(amount));
// A variance or a change with its sign: "+₱50.00", "-₱50.00", "₱0.00".
const signedPeso = (amount: number) => `${amount > 0.004 ? "+" : ""}${peso(amount)}`;

// The save message ends in a "✓" glyph; the notice already draws a real check icon.
const withoutTick = (text: string) => text.replace(/\s*✓$/, "");

// A KPI tile's coloured top edge (--kpi in globals.css).
const kpiEdge = (color: string) => ({ "--kpi": `var(--color-${color})` }) as CSSProperties;

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
  const [showOwnerUnlock, setShowOwnerUnlock] = useState(false);
  // The day's figures need the owner to sign in to view, not only to save.
  const [locked, setLocked] = useState(false);

  const [refreshKey, setRefreshKey] = useState(0);
  // Slice 26: every saved count of the selected date (newest first), and the latest count of the
  // last 30 dates that have one. Read-only.
  const [revisions, setRevisions] = useState<SavedRecord[]>([]);
  const [recent, setRecent] = useState<RecentCount[] | null>(null);
  const [recentKey, setRecentKey] = useState(0);

  useEffect(() => {
    if (locked) return;
    let active = true;
    fetch("/api/v1/reports/reconciliation?recent=30", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (active) setRecent(data?.success ? data.recent : null); })
      .catch(() => { if (active) setRecent(null); });
    return () => { active = false; };
  }, [locked, refreshKey, recentKey]);

  useEffect(() => {
    let active = true;

    async function loadData() {
      setIsLoading(true);
      setExpected(null);
      setSaved(null);
      setStaleness(null);
      setNeedsReview([]);
      setRevisions([]);
      setFeedback(null);
      try {
        const res = await fetch(`/api/v1/reports/reconciliation?date=${date}`);
        // Owner-only (slice 15): no figure is shown until the owner signs in.
        if (res.status === 401) {
          if (!active) return;
          setLocked(true);
          setShowOwnerUnlock(true);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!active) return;
        setLocked(false);
        if (data.success) {
          setExpected(data.expected);
          setSaved(data.saved);
          setStaleness(data.staleness);
          setNeedsReview(data.needsDateReview ?? []);
          setRevisions(data.revisions ?? []);
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
        setRevisions(data.revisions ?? []);
        setRecentKey((k) => k + 1);
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
        <OwnerSignInDialog
          what="see and save End-of-Day Cash"
          onSignedIn={() => { setShowOwnerUnlock(false); if (locked) { setLocked(false); setRefreshKey((k) => k + 1); } else { setFeedback({ msg: "Owner access granted. Save again.", ok: true }); } }}
          onCancel={() => setShowOwnerUnlock(false)}
        />
      )}

      <PageContainer>
        <PageHeader
          title="End-of-Day Cash"
          description="Cash the register says should be in the drawer, and the count at closing."
          onReload={() => setRefreshKey((k) => k + 1)}
          reloading={isLoading}
          reloadLabel="Reload the expected totals"
        />
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
            className="rz-field flex-1 min-w-0 py-1.5 pointer-coarse:min-h-11 sm:text-sm"
          />
        </div>

        {/* Owner-only: nothing below shows until the owner signs in. */}
        {locked && !showOwnerUnlock && (
          <div className="rz-notice flex-wrap items-center">
            <LockKeyhole className="w-4 h-4 text-brass shrink-0" />
            <span className="flex-1 min-w-48">End-of-Day Cash needs the owner to sign in.</span>
            <button type="button" onClick={() => setShowOwnerUnlock(true)} className="rz-btn rz-btn-secondary text-sm pointer-coarse:min-h-11">Unlock</button>
          </div>
        )}

        {/* While the register totals load: the KPI row's shape, not a spinner. */}
        {isLoading && !expected && (
          <div aria-hidden="true" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rz-kpi space-y-2.5">
                <div className="rz-skeleton h-3 w-20" />
                <div className="rz-skeleton h-7 w-28" />
                <div className="rz-skeleton h-3 w-24" />
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
            {/* The four figures the close-out turns on. Cash is neutral (slice 21): red is kept for "cash short". */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 rz-stagger">
              <div className="rz-kpi" style={kpiEdge("bone")}>
                <p className="rz-label flex items-center gap-1.5"><Banknote className="w-3.5 h-3.5 shrink-0 text-cash" />Expected drawer</p>
                <p className="rz-figure mt-2 truncate text-2xl sm:text-[1.75rem] text-bone tabular-nums">{pesoOf(expected.expectedDrawerCash)}</p>
                <p className="mt-1 text-xs text-dust">Cash that should be in the drawer</p>
              </div>
              <div className="rz-kpi" style={kpiEdge(!saved ? "seam-hover" : staleness?.stale ? "warn" : "ok")}>
                <p className="rz-label flex items-center gap-1.5"><ClipboardCheck className="w-3.5 h-3.5 shrink-0 text-dust" />Counted</p>
                <p className="rz-figure mt-2 truncate text-2xl sm:text-[1.75rem] text-bone tabular-nums">{saved ? pesoOf(saved.countedCash) : "—"}</p>
                <p className={`mt-1 flex items-center gap-1 text-xs ${!saved ? "text-dust" : staleness?.stale ? "text-warn-ink" : "text-ok-ink"}`}>
                  {saved && (staleness?.stale ? <AlertTriangle className="w-3 h-3 shrink-0" /> : <CheckCircle2 className="w-3 h-3 shrink-0" />)}
                  {!saved ? "Not counted yet" : staleness?.stale ? "Out of date: count again" : `Saved, revision ${saved.revision}`}
                </p>
              </div>
              <div className="rz-kpi" style={kpiEdge(variance === null ? "seam-hover" : Math.abs(variance) < 0.01 ? "ok" : variance < 0 ? "crimson" : "over")}>
                <p className="rz-label">{staleness?.stale ? "Variance when saved" : "Variance"}</p>
                <p className={`rz-figure mt-2 truncate text-2xl sm:text-[1.75rem] tabular-nums ${variance === null || Math.abs(variance) < 0.01 ? "text-bone" : variance < 0 ? "text-crimson-ink" : "text-over-ink"}`}>
                  {variance === null ? "—" : signedPeso(variance)}
                </p>
                <p className="mt-1 text-xs text-dust">
                  {variance === null ? "Counted − expected, once saved" : Math.abs(variance) < 0.01 ? "Balanced" : variance < 0 ? "Cash short" : "Cash over"}
                </p>
              </div>
              <div className="rz-kpi" style={kpiEdge("gcash")}>
                <p className="rz-label flex items-center gap-1.5"><Smartphone className="w-3.5 h-3.5 shrink-0 text-dust" />Digital, not in the drawer</p>
                <p className="rz-figure mt-2 truncate text-2xl sm:text-[1.75rem] text-bone tabular-nums">{pesoOf(expected.digitalTotal)}</p>
                <p className="mt-1 text-xs text-dust tabular-nums">
                  <span className="text-gcash-ink">GCash {pesoOf(expected.gcashTotal)}</span> · <span className="text-maya-ink">Maya {pesoOf(expected.mayaTotal)}</span>
                </p>
              </div>
            </div>

            {/* The one definition of expected drawer cash, term by term. */}
            <div className="rz-panel p-4 sm:p-5">
              <h3 className="rz-label">How expected drawer cash is worked out</h3>
              <dl className="mt-3 grid grid-cols-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1.2fr] gap-x-3 gap-y-3 items-end">
                {[
                  { sign: "", label: "Cash sales", value: expected.cashTotal },
                  { sign: "+", label: "Cash tips", value: expected.cashTips },
                  { sign: "−", label: "Cash payouts", value: expected.cashPayouts },
                  { sign: "−", label: "Petty cash", value: expected.pettyCash },
                ].flatMap((term) => [
                  ...(term.sign ? [<span key={`${term.label}-sign`} aria-hidden="true" className="hidden sm:block pb-0.5 text-lg font-semibold text-dust">{term.sign}</span>] : []),
                  <div key={term.label} className="min-w-0">
                    <dt className="text-xs text-dust"><span className="sm:hidden font-semibold">{term.sign} </span>{term.label}</dt>
                    <dd className="rz-figure text-lg text-bone tabular-nums">{pesoOf(term.value)}</dd>
                  </div>,
                ])}
                <span aria-hidden="true" className="hidden sm:block pb-0.5 text-lg font-semibold text-dust">=</span>
                <div className="col-span-2 sm:col-span-1 min-w-0 border-t border-seam-hover pt-2 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4">
                  <dt className="text-xs font-semibold text-bone"><span className="sm:hidden">= </span>Expected in the drawer</dt>
                  <dd className="rz-figure text-2xl text-bone tabular-nums">{pesoOf(expected.expectedDrawerCash)}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-dust leading-relaxed">
                Cash payouts are the cash entries recorded on Payouts for this date. Petty cash is recorded with the count below{saved ? "" : " (none saved yet)"}. Total revenue {pesoOf(expected.totalRevenue)}: cash, GCash, Maya{parseFloat(expected.qrphTotal) > 0 ? " and QR Ph" : ""}, tips not included.
              </p>
            </div>
            {(parseFloat(expected.qrphTotal) > 0 || expected.gatewaySales.length > 0) && (
              <div className="rz-panel p-3.5 space-y-2.5 border-qrph/30">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-1.5 text-qrph-ink font-semibold">
                    <QrCode className="w-4 h-4" /> QR Ph (PayMongo test) collected
                  </span>
                  <span className="rz-figure text-lg text-qrph-ink">{pesoOf(expected.qrphTotal)}</span>
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
                        <span className={`rz-figure text-sm ${g.status === "PAID" ? "text-bone" : "text-dust line-through"}`}>{pesoOf(g.amount)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-dust">
              {expected.transactionCount} paid synced {expected.transactionCount === 1 ? "transaction" : "transactions"} on {date}
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
              <div key={sale.id} className="p-3 rounded-lg bg-well border border-warn/20 text-xs space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-bone">{sale.barberName} · {sale.paymentMethod}</span>
                  <span className="rz-figure text-sm text-bone">{pesoOf(sale.amount)}</span>
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
                {signedPeso(previewVariance)}{" "}
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
                    <p>Expected drawer cash is now {expected ? pesoOf(expected.expectedDrawerCash) : "—"} ({signedPeso(parseFloat(staleness.expectedCashDelta))}).</p>
                  )}
                  <p>The variance below was correct when saved. Count the drawer again and save a new revision.</p>
                </div>
              </div>
            )}
            <div className="rz-well grid grid-cols-1 sm:grid-cols-2 overflow-hidden">
              {[
                { label: "Expected Cash", value: pesoOf(saved.expectedCash) },
                { label: "Petty Cash", value: pesoOf(saved.pettyCashAmount) },
                { label: "Counted Cash", value: pesoOf(saved.countedCash) },
                { label: "GCash Total", value: pesoOf(saved.gcashTotal) },
                { label: "Maya Total", value: pesoOf(saved.mayaTotal) },
                { label: "Total Revenue", value: pesoOf(saved.totalRevenue) },
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
                {staleness?.stale ? "Variance when saved" : "Variance"}: {signedPeso(parseFloat(saved.variance))}{" "}
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

        {/* Slice 26: every saved count of this date. Read-only; only the current one is checked for staleness. */}
        {revisions.length > 1 && (
          <section aria-labelledby="revisions-title" className="rz-panel p-4 sm:p-5 space-y-3">
            <h2 id="revisions-title" className="rz-heading">Saved counts for {date}</h2>
            <p className="text-xs text-dust">Each save is kept as it was. Older counts are never changed or recomputed.</p>
            <ol className="rz-well overflow-hidden divide-y divide-seam text-sm">
              {revisions.map((r, i) => (
                <li key={r.revision} className="px-3.5 py-2.5 space-y-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="font-semibold text-bone">
                      Revision {r.revision}
                      <span className="ml-2 text-xs font-normal text-dust">{i === 0 ? "Current" : `Replaced by revision ${revisions[i - 1].revision}`}</span>
                    </span>
                    <span className="text-xs text-dust">{manilaTime(r.reconciledAt)}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-xs tabular-nums">
                    <span className="text-dust">Expected <span className="text-bone">{pesoOf(r.expectedCash)}</span></span>
                    <span className="text-dust">Counted <span className="text-bone">{pesoOf(r.countedCash)}</span></span>
                    <span className="text-dust">Variance <span className="text-bone">{signedPeso(parseFloat(r.variance))}</span> {varianceWord(r.variance)}</span>
                    <span className="text-dust">Petty cash <span className="text-bone">{pesoOf(r.pettyCashAmount)}</span></span>
                  </div>
                  {r.pettyCashNote && <p className="text-xs text-dust">Petty cash note: {r.pettyCashNote}</p>}
                  {r.note && <p className="text-xs text-dust">Note: {r.note}</p>}
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Slice 26: the latest count of the last 30 dates that have one. Read-only. */}
        {!locked && recent !== null && (
          <section aria-labelledby="recent-title" className="rz-panel p-4 sm:p-5 space-y-3">
            <h2 id="recent-title" className="rz-heading">Recent counts</h2>
            <p className="text-xs text-dust">The last 30 dates with a saved count, newest first, each with its latest revision. A date with no saved count is not listed; pick it above to see &quot;Not counted yet&quot;.</p>
            {recent.length === 0 ? (
              <p className="rz-notice">No drawer count has been saved yet.</p>
            ) : (
              <ul className="rz-well overflow-hidden divide-y divide-seam text-sm">
                {recent.map((row) => (
                  <li key={row.date}>
                    <button
                      type="button"
                      onClick={() => setDate(row.date)}
                      aria-current={row.date === date ? "true" : undefined}
                      className="w-full text-left px-3.5 py-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 hover:bg-panel-2 pointer-coarse:min-h-11"
                    >
                      <span className="font-semibold text-bone">{row.date} <span className="ml-1 text-xs font-normal text-dust">revision {row.latest.revision}</span></span>
                      <span className="text-xs text-dust tabular-nums">
                        Counted <span className="text-bone">{pesoOf(row.latest.countedCash)}</span> · {varianceWord(row.latest.variance)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </PageContainer>
    </div>
  );
}

// The same thresholds as the saved record above: within a centavo is balanced.
function varianceWord(variance: string) {
  const v = parseFloat(variance);
  return Math.abs(v) < 0.01 ? "Balanced" : v < 0 ? "Cash short" : "Cash over";
}

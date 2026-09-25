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
} from "lucide-react";
import { RuzzcoLogoBadge, BarberPoleIcon } from "@/components/RuzzcoBrand";
import { manilaToday } from "@/lib/business-date";

interface ExpectedTotals {
  cashTotal: string;
  gcashTotal: string;
  mayaTotal: string;
  digitalTotal: string;
  cashTips: string;
  cashPayouts: string;
  pettyCash: string;
  expectedDrawerCash: string;
  totalRevenue: string;
  transactionCount: number;
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
  staleReasons: ("EXPECTED_CASH_CHANGED" | "LATE_SYNCED_TRANSACTIONS")[];
  lateSyncedCount: number;
  expectedCashDelta: string;
}

export default function ReconciliationPage() {
  const todayStr = manilaToday(); // business date, whatever the device's timezone
  const [date, setDate] = useState(todayStr);
  const [expected, setExpected] = useState<ExpectedTotals | null>(null);
  const [saved, setSaved] = useState<SavedRecord | null>(null);
  const [staleness, setStaleness] = useState<Staleness | null>(null);
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

  const variance = saved ? parseFloat(saved.variance) : null;
  const previewExpectedDrawer = expected
    ? parseFloat(expected.expectedDrawerCash) - (parseFloat(pettyCashAmount) || 0) + parseFloat(expected.pettyCash)
    : 0;
  const previewVariance =
    expected && countedCash !== ""
      ? parseFloat(countedCash) - previewExpectedDrawer
      : null;

  return (
    <div className="min-h-screen bg-[#0b0c10] text-zinc-100 font-sans antialiased selection:bg-red-600 selection:text-white">
      {showOwnerUnlock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
          <form onSubmit={async (event) => { event.preventDefault(); const res = await fetch("/api/v1/owner/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: ownerPin }) }); if (res.ok) { setShowOwnerUnlock(false); setOwnerPin(""); setFeedback({ msg: "Owner access granted. Save again.", ok: true }); } else setFeedback({ msg: "Invalid owner PIN.", ok: false }); }} className="w-full max-w-sm p-5 rounded-2xl bg-[#12141a] border border-[#232734] space-y-3">
            <h2 className="font-bold text-lg">Owner PIN required</h2>
            <input autoFocus type="password" inputMode="numeric" value={ownerPin} onChange={(event) => setOwnerPin(event.target.value)} className="w-full px-3 py-2.5 rounded-lg bg-[#181b24] border border-[#232734] text-white" placeholder="Owner PIN" />
            <div className="flex gap-2"><button type="button" onClick={() => setShowOwnerUnlock(false)} className="flex-1 py-2 rounded-lg border border-[#232734] text-zinc-300">Cancel</button><button type="submit" className="flex-1 py-2 rounded-lg bg-red-600 text-white font-bold">Unlock</button></div>
          </form>
        </div>
      )}
      {/* Ambient Crimson Glow */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-2xl h-48 bg-red-600/10 blur-3xl pointer-events-none" />

      <div className="relative max-w-2xl mx-auto px-4 py-4 space-y-5">
        {/* Header */}
        <header className="flex items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
          <Link
            href="/shift-log"
            className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Shift Log</span>
          </Link>
          <div className="flex items-center gap-2">
            <RuzzcoLogoBadge size={28} showBorder={false} />
            <span className="font-extrabold tracking-wider text-base text-white uppercase font-[family-name:var(--font-oswald)]">
              EOD CASH RECONCILIATION
            </span>
          </div>
          <Link
            href="/pos"
            className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-white transition-colors"
          >
            <span>POS</span>
          </Link>
        </header>

        {/* Date picker */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-[#12141a] border border-[#232734]">
          <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider font-[family-name:var(--font-oswald)] shrink-0 flex items-center gap-1.5">
            <BarberPoleIcon className="w-2 h-3.5" />
            Select Date:
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            max={todayStr}
            className="flex-1 px-3 py-1.5 rounded-lg bg-[#181b24] border border-[#232734] text-white text-sm focus:outline-none focus:border-red-500 transition-colors"
          />
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={isLoading}
            title="Refresh expected totals"
            className="p-2 rounded-lg bg-[#181b24] border border-[#232734] text-zinc-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin text-red-400" : ""}`} />
          </button>
        </div>

        {/* Expected totals from server */}
        {expected && (
          <section className="space-y-2">
            <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider font-[family-name:var(--font-oswald)] flex items-center gap-1.5">
              Synced Totals From Register
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { label: "Cash Sales", value: `₱${expected.cashTotal}`, icon: Banknote, color: "text-emerald-400" },
                { label: "GCash Sales", value: `₱${expected.gcashTotal}`, icon: Smartphone, color: "text-blue-400" },
                { label: "Maya Sales", value: `₱${expected.mayaTotal}`, icon: Smartphone, color: "text-emerald-400" },
                { label: "Expected Drawer", value: `₱${expected.expectedDrawerCash}`, icon: Banknote, color: "text-amber-300 font-bold" },
                { label: "Total Revenue", value: `₱${expected.totalRevenue}`, icon: Scissors, color: "text-red-400 font-bold" },
              ].map((c) => (
                <div key={c.label} className="p-3.5 rounded-xl bg-[#12141a] border border-[#232734] space-y-1 relative overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-0.5 bg-barber-pole opacity-60" />
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold flex items-center gap-1">
                    <c.icon className={`w-3 h-3 ${c.color}`} />
                    {c.label}
                  </div>
                  <div className={`text-xl font-extrabold font-[family-name:var(--font-oswald)] ${c.color}`}>{c.value}</div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-zinc-500">
              {expected.transactionCount} synced transactions on {date}
            </p>
          </section>
        )}

        {/* Drawer count form */}
        <section className="space-y-3.5 p-4 rounded-xl bg-[#12141a] border border-[#232734] relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-barber-pole opacity-60" />
          <span className="text-xs font-bold text-zinc-200 uppercase tracking-wider font-[family-name:var(--font-oswald)]">
            Physical Drawer Cash Count
          </span>

          <div>
            <label className="block text-xs text-zinc-400 mb-1 font-medium">Actual cash counted in drawer (₱)</label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="e.g. 2100.00"
              value={countedCash}
              onChange={(e) => setCountedCash(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#181b24] border border-[#232734] text-white text-base font-[family-name:var(--font-oswald)] placeholder:text-zinc-600 focus:outline-none focus:border-red-500 transition-colors"
            />
          </div>

          {/* Live variance preview */}
          {previewVariance !== null && (
            <div
              className={`flex items-center gap-2 p-3 rounded-xl text-sm font-semibold border ${
                Math.abs(previewVariance) < 0.01
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                  : previewVariance > 0
                  ? "bg-blue-500/10 border-blue-500/20 text-blue-400"
                  : "bg-red-500/10 border-red-500/20 text-red-400"
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
              <label className="block text-xs text-zinc-400 mb-1 font-medium">Petty cash taken from drawer (₱)</label>
              <input type="number" inputMode="decimal" min="0" step="0.01" placeholder="e.g. 150.00" value={pettyCashAmount} onChange={(e) => setPettyCashAmount(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-[#181b24] border border-[#232734] text-white text-sm" />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1 font-medium">Petty cash note</label>
              <input type="text" maxLength={255} placeholder="Ice, snacks, supplies" value={pettyCashNote} onChange={(e) => setPettyCashNote(e.target.value)} className="w-full px-3.5 py-2.5 rounded-xl bg-[#181b24] border border-[#232734] text-white text-sm" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1 font-medium">Audit note (optional)</label>
            <input
              type="text"
              placeholder="e.g. Short ₱50 — discrepancy in coin change"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#181b24] border border-[#232734] text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-red-500 transition-colors"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={isSaving || !countedCash || !expected}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 active:scale-[0.98] text-white font-extrabold text-sm uppercase tracking-wider font-[family-name:var(--font-oswald)] shadow-xl shadow-red-950/60 ring-1 ring-red-400/40 flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
          >
            {isSaving ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <><ClipboardCheck className="w-4 h-4" /> {saved ? `Save As Revision ${saved.revision + 1}` : "Save End-Of-Day Reconciliation"}</>
            )}
          </button>
        </section>

        {/* Feedback */}
        {feedback && (
          <div
            className={`p-3 rounded-xl border text-sm flex items-center gap-2 ${
              feedback.ok
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                : "bg-red-500/10 border-red-500/20 text-red-400"
            }`}
          >
            {feedback.ok ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            {feedback.msg}
          </div>
        )}

        {/* Saved record */}
        {saved && (
          <section className="p-4 rounded-xl bg-[#12141a] border border-[#232734] space-y-3">
            <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider font-[family-name:var(--font-oswald)]">
              Saved Audit Record · Revision {saved.revision}
            </span>
            {staleness?.stale && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg text-xs border bg-amber-500/10 border-amber-500/30 text-amber-300">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-bold">Out of date: this record no longer matches the register.</p>
                  {staleness.staleReasons.includes("LATE_SYNCED_TRANSACTIONS") && (
                    <p>{staleness.lateSyncedCount} sale{staleness.lateSyncedCount === 1 ? "" : "s"} for this date synced after it was saved.</p>
                  )}
                  {staleness.staleReasons.includes("EXPECTED_CASH_CHANGED") && (
                    <p>Expected drawer cash is now ₱{expected?.expectedDrawerCash} ({parseFloat(staleness.expectedCashDelta) > 0 ? "+" : ""}₱{staleness.expectedCashDelta}).</p>
                  )}
                  <p>The variance below was correct when saved. Count the drawer again and save a new revision.</p>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                { label: "Expected Cash", value: `₱${saved.expectedCash}` },
                { label: "Petty Cash", value: `₱${saved.pettyCashAmount}` },
                { label: "Counted Cash", value: `₱${saved.countedCash}` },
                { label: "GCash Total", value: `₱${saved.gcashTotal}` },
                { label: "Maya Total", value: `₱${saved.mayaTotal}` },
                { label: "Total Revenue", value: `₱${saved.totalRevenue}` },
              ].map((r) => (
                <div key={r.label} className="flex justify-between gap-2 text-xs p-2 rounded-lg bg-[#181b24] border border-[#232734]">
                  <span className="text-zinc-500">{r.label}</span>
                  <span className="font-bold text-zinc-200 font-[family-name:var(--font-oswald)]">{r.value}</span>
                </div>
              ))}
            </div>
            <div
              className={`flex items-center gap-2 p-2.5 rounded-lg text-sm font-bold border ${
                variance !== null && Math.abs(variance) < 0.01
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                  : variance !== null && variance < 0
                  ? "bg-red-500/10 border-red-500/20 text-red-400"
                  : "bg-blue-500/10 border-blue-500/20 text-blue-400"
              }`}
            >
              {variance !== null && Math.abs(variance) < 0.01 ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <AlertTriangle className="w-4 h-4" />
              )}
              {staleness?.stale ? "Variance when saved" : "Variance"}: {variance !== null && variance > 0 ? "+" : ""}₱{saved.variance}{" "}
              {variance !== null && Math.abs(variance) < 0.01
                ? "— Balanced"
                : variance !== null && variance < 0
                ? "— Cash short"
                : "— Cash over"}
            </div>
            {saved.note && (
              <p className="text-xs text-zinc-400 italic">Note: {saved.note}</p>
            )}
            {saved.pettyCashNote && (
              <p className="text-xs text-zinc-400 italic">Petty cash: {saved.pettyCashNote}</p>
            )}
            <p className="text-[10px] text-zinc-600">
              Reconciled at {new Date(saved.reconciledAt).toLocaleString()}
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

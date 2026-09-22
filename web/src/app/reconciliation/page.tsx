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

interface ExpectedTotals {
  cashTotal: string;
  gcashTotal: string;
  totalRevenue: string;
  transactionCount: number;
}

interface SavedRecord {
  id: number;
  expectedCash: string;
  countedCash: string;
  variance: string;
  gcashTotal: string;
  totalRevenue: string;
  note: string | null;
  reconciledAt: string;
}

export default function ReconciliationPage() {
  const todayStr = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD local
  const [date, setDate] = useState(todayStr);
  const [expected, setExpected] = useState<ExpectedTotals | null>(null);
  const [saved, setSaved] = useState<SavedRecord | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [countedCash, setCountedCash] = useState("");
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);

  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadData() {
      setIsLoading(true);
      setExpected(null);
      setSaved(null);
      setFeedback(null);
      try {
        const res = await fetch(`/api/v1/reports/reconciliation?date=${date}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!active) return;
        if (data.success) {
          setExpected(data.expected);
          setSaved(data.saved);
          if (data.saved) {
            setCountedCash(data.saved.countedCash);
            setNote(data.saved.note ?? "");
          } else {
            setCountedCash("");
            setNote("");
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
        body: JSON.stringify({ date, countedCash: parsed, note: note.trim() || undefined }),
      });
      const data = await res.json();
      if (data.success) {
        setSaved(data.record);
        setFeedback({ msg: "Reconciliation saved ✓", ok: true });
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
  const previewVariance =
    expected && countedCash !== ""
      ? parseFloat(countedCash) - parseFloat(expected.cashTotal)
      : null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans antialiased">
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-2xl h-48 bg-amber-500/8 blur-3xl pointer-events-none" />

      <div className="relative max-w-2xl mx-auto px-4 py-4 space-y-5">
        {/* Header */}
        <header className="flex items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
          <Link
            href="/shift-log"
            className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Shift Log
          </Link>
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-6 rounded-md bg-amber-500/20 flex items-center justify-center">
              <ClipboardCheck className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <span className="font-bold tracking-tight text-sm text-white">EOD RECONCILIATION</span>
          </div>
          <div className="w-20" />
        </header>

        {/* Date picker */}
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider shrink-0">
            Date
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            max={todayStr}
            className="flex-1 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-white text-sm focus:outline-none focus:border-amber-500 transition-colors"
          />
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={isLoading}
            className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin text-amber-400" : ""}`} />
          </button>
        </div>

        {/* Expected totals from server */}
        {expected && (
          <section className="space-y-2">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              From Synced Transactions
            </span>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Cash Sales", value: `₱${expected.cashTotal}`, icon: Banknote, color: "text-emerald-400" },
                { label: "GCash Sales", value: `₱${expected.gcashTotal}`, icon: Smartphone, color: "text-blue-400" },
                { label: "Total Revenue", value: `₱${expected.totalRevenue}`, icon: Scissors, color: "text-amber-400" },
              ].map((c) => (
                <div key={c.label} className="p-3 rounded-xl bg-zinc-900/70 border border-zinc-800/80 space-y-1">
                  <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold flex items-center gap-1">
                    <c.icon className={`w-3 h-3 ${c.color}`} />
                    {c.label}
                  </div>
                  <div className={`text-lg font-extrabold ${c.color}`}>{c.value}</div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-zinc-500">
              {expected.transactionCount} synced transactions on {date}
            </p>
          </section>
        )}

        {/* Drawer count form */}
        <section className="space-y-3 p-4 rounded-xl bg-zinc-900/70 border border-zinc-800/80">
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Physical Drawer Count
          </span>

          <div>
            <label className="block text-xs text-zinc-500 mb-1">Cash counted in drawer (₱)</label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="e.g. 2100.00"
              value={countedCash}
              onChange={(e) => setCountedCash(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm placeholder:text-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
            />
          </div>

          {/* Live variance preview */}
          {previewVariance !== null && (
            <div
              className={`flex items-center gap-2 p-2.5 rounded-lg text-sm font-semibold border ${
                Math.abs(previewVariance) < 0.01
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                  : previewVariance > 0
                  ? "bg-blue-500/10 border-blue-500/20 text-blue-400"
                  : "bg-rose-500/10 border-rose-500/20 text-rose-400"
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
                  ? "— Cash balanced"
                  : previewVariance < 0
                  ? "— Cash short"
                  : "— Cash over"}
              </span>
            </div>
          )}

          <div>
            <label className="block text-xs text-zinc-500 mb-1">Note (optional)</label>
            <input
              type="text"
              placeholder="e.g. Short ₱50 — mismatch from change"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              className="w-full px-3 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm placeholder:text-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={isSaving || !countedCash || !expected}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 active:scale-[0.98] text-black font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
          >
            {isSaving ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <><ClipboardCheck className="w-4 h-4" /> Save Reconciliation</>
            )}
          </button>
        </section>

        {/* Feedback */}
        {feedback && (
          <div
            className={`p-3 rounded-lg border text-sm flex items-center gap-2 ${
              feedback.ok
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                : "bg-rose-500/10 border-rose-500/20 text-rose-400"
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
          <section className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800 space-y-2">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              Saved Record
            </span>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                { label: "Expected Cash", value: `₱${saved.expectedCash}` },
                { label: "Counted Cash", value: `₱${saved.countedCash}` },
                { label: "GCash Total", value: `₱${saved.gcashTotal}` },
                { label: "Total Revenue", value: `₱${saved.totalRevenue}` },
              ].map((r) => (
                <div key={r.label} className="flex justify-between gap-2 text-xs">
                  <span className="text-zinc-500">{r.label}</span>
                  <span className="font-semibold text-zinc-200">{r.value}</span>
                </div>
              ))}
            </div>
            <div
              className={`flex items-center gap-2 p-2.5 rounded-lg text-sm font-bold border ${
                variance !== null && Math.abs(variance) < 0.01
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                  : variance !== null && variance < 0
                  ? "bg-rose-500/10 border-rose-500/20 text-rose-400"
                  : "bg-blue-500/10 border-blue-500/20 text-blue-400"
              }`}
            >
              {variance !== null && Math.abs(variance) < 0.01 ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <AlertTriangle className="w-4 h-4" />
              )}
              Variance: {variance !== null && variance > 0 ? "+" : ""}₱{saved.variance}{" "}
              {variance !== null && Math.abs(variance) < 0.01
                ? "— Balanced"
                : variance !== null && variance < 0
                ? "— Cash short"
                : "— Cash over"}
            </div>
            {saved.note && (
              <p className="text-xs text-zinc-400 italic">Note: {saved.note}</p>
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

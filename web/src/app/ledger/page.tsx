"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, LockKeyhole, RefreshCw, Save, Scissors } from "lucide-react";

type Base = "LIST_PRICE" | "AMOUNT_PAID";
type LedgerRow = { barberId: string; barberName: string; commissionTotal: string; tipTotal: string; totalOwed: string; cashPaid: string; gcashPaid: string; paid: boolean; paidAt: string | null; additionalOwed: boolean };

function todayPHT() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date()); }

export default function LedgerPage() {
  const [date, setDate] = useState(todayPHT());
  const [pin, setPin] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [base, setBase] = useState<Base>("LIST_PRICE");
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savingBarberId, setSavingBarberId] = useState<string | null>(null);
  const [savedBarberId, setSavedBarberId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/v1/reports/payouts?date=${date}&commissionBase=${base}`);
      const data = await response.json();
      if (response.status === 401) { setUnlocked(false); throw new Error("Enter the owner PIN to continue."); }
      if (!response.ok || !data.success) throw new Error(data.error ?? "Could not load ledger");
      setRows(data.rows);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load ledger"); }
    finally { setBusy(false); }
  }, [date, base]);

  useEffect(() => {
    if (!unlocked) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [unlocked, load]);

  async function unlock() {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/v1/owner/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error ?? "Invalid owner PIN");
      setPin(""); setUnlocked(true);
    } catch (err) { setError(err instanceof Error ? err.message : "Unlock failed"); }
    finally { setBusy(false); }
  }

  async function save(row: LedgerRow) {
    setSavingBarberId(row.barberId); setSavedBarberId(null); setError(null);
    try {
      const response = await fetch("/api/v1/reports/payouts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, barberId: row.barberId, commissionBase: base, cashPaid: Number(row.cashPaid) || 0, gcashPaid: Number(row.gcashPaid) || 0, paid: row.paid }) });
      const data = await response.json();
      if (response.status === 401) { setUnlocked(false); throw new Error("Owner PIN required."); }
      if (!response.ok || !data.success) throw new Error(data.error ?? "Could not save payout");
      setRows((current) => current.map((item) => item.barberId === row.barberId ? data.row : item));
      setSavedBarberId(row.barberId);
      window.setTimeout(() => setSavedBarberId(null), 2200);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save payout"); }
    finally { setSavingBarberId(null); }
  }

  if (!unlocked) {
    return <main className="min-h-screen bg-[#0b0c10] text-zinc-100 flex items-center justify-center p-6"><form onSubmit={(event) => { event.preventDefault(); void unlock(); }} className="w-full max-w-sm p-6 rounded-2xl bg-[#12141a] border border-[#232734] space-y-4"><LockKeyhole className="w-8 h-8 text-red-400" /><h1 className="text-2xl font-bold">Owner ledger</h1><p className="text-sm text-zinc-400">Enter the owner PIN to view and record barber payouts.</p><input autoFocus type="password" inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value)} className="w-full px-3 py-3 rounded-xl bg-[#181b24] border border-[#232734] text-white" placeholder="Owner PIN" /><button disabled={busy || !pin} className="w-full py-3 rounded-xl bg-red-600 text-white font-bold disabled:opacity-50">{busy ? "Checking…" : "Unlock ledger"}</button>{error && <p className="text-sm text-red-300">{error}</p>}<Link href="/" className="block text-center text-xs text-zinc-500 hover:text-white">Back to home</Link></form></main>;
  }

  return <main className="min-h-screen bg-[#0b0c10] text-zinc-100"><div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5"><header className="flex items-center justify-between border-b border-zinc-800 pb-4"><Link href="/" className="text-zinc-400 hover:text-white"><ArrowLeft className="w-4 h-4 inline mr-1" />Home</Link><h1 className="text-xl font-bold uppercase tracking-wide">Daily payout ledger</h1><button onClick={() => void load()} className="text-zinc-400 hover:text-white"><RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} /></button></header><div className="flex flex-wrap gap-3 items-center"><label className="text-sm text-zinc-400">Business date <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="ml-2 px-2 py-1.5 rounded-lg bg-[#181b24] border border-[#232734] text-white" /></label><label className="text-sm text-zinc-400">Commission base <select value={base} onChange={(event) => setBase(event.target.value as Base)} className="ml-2 px-2 py-1.5 rounded-lg bg-[#181b24] border border-[#232734] text-white"><option value="LIST_PRICE">List price (default)</option><option value="AMOUNT_PAID">Amount paid</option></select></label><span className="text-xs text-zinc-500">Expense sharing: SHOP_ONLY</span></div>{error && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300">{error}</div>}<div className="space-y-3">{rows.map((row) => { const remaining = Math.max(Number(row.totalOwed) - Number(row.cashPaid) - Number(row.gcashPaid), 0); const saving = savingBarberId === row.barberId; const saved = savedBarberId === row.barberId; return <section key={row.barberId} className="p-4 rounded-xl bg-[#12141a] border border-[#232734] space-y-3"><div className="flex items-center justify-between"><div><h2 className="font-bold text-lg">{row.barberName}</h2><p className="text-xs text-zinc-500">Commission ₱{row.commissionTotal} · Tips ₱{row.tipTotal}</p></div><div className="text-right"><div className="text-xs text-zinc-500">Total earned today</div><div className="text-2xl font-bold text-red-300">₱{row.totalOwed}</div></div></div>{row.additionalOwed && <div className="p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm">Additional owed: cuts synced after this payout was marked.</div>}<div className="grid grid-cols-1 sm:grid-cols-4 gap-2"><label className="text-xs text-zinc-400">Cash paid<input type="number" min="0" step="0.01" value={row.cashPaid} onChange={(event) => setRows((current) => current.map((item) => item.barberId === row.barberId ? { ...item, cashPaid: event.target.value } : item))} className="mt-1 w-full px-2.5 py-2 rounded-lg bg-[#181b24] border border-[#232734] text-white" /></label><label className="text-xs text-zinc-400">GCash paid<input type="number" min="0" step="0.01" value={row.gcashPaid} onChange={(event) => setRows((current) => current.map((item) => item.barberId === row.barberId ? { ...item, gcashPaid: event.target.value } : item))} className="mt-1 w-full px-2.5 py-2 rounded-lg bg-[#181b24] border border-[#232734] text-white" /></label><div className="text-xs text-zinc-400">Remaining to pay<div className="mt-1 px-2.5 py-2 rounded-lg bg-[#181b24] border border-[#232734] text-amber-200 font-bold">₱{remaining.toFixed(2)}</div></div><label className="flex items-end gap-2 text-sm text-zinc-300 pb-2"><input type="checkbox" checked={row.paid} onChange={(event) => setRows((current) => current.map((item) => item.barberId === row.barberId ? { ...item, paid: event.target.checked } : item))} /> Paid confirmation</label></div><button onClick={() => void save(row)} disabled={saving} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-bold disabled:opacity-50"><Save className="w-4 h-4" />{saving ? "Saving…" : saved ? "Saved ✓" : "Save payout"}</button></section>; })}{rows.length === 0 && <div className="p-8 text-center text-zinc-500">No active barbers found.</div>}</div><p className="text-xs text-zinc-600"><Scissors className="w-3 h-3 inline mr-1" />Total earned stays as the daily record; Remaining to pay subtracts recorded cash and GCash payouts.</p></div></main>;
}

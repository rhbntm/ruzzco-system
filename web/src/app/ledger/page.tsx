"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, LockKeyhole, RefreshCw, Save, Scissors } from "lucide-react";
import { manilaToday } from "@/lib/business-date";

type Base = "LIST_PRICE" | "AMOUNT_PAID";
type Period = "day" | "week" | "month";
type Summary = {
  from: string; to: string; period: Period;
  sales: { cash: string; gcash: string; maya: string; qrph: string; total: string; count: number };
  shared: { commissions: string; tips: string; pettyCash: string; pettyCashRecorded: boolean };
  leftForShop: string;
  payouts: { owed: string; paid: string; remaining: string };
  services: { name: string; count: number; listSales: string }[];
  serviceGap: string;
  days: { date: string; revenue: string; commissions: string }[];
  pettyCashMissingDays: number;
};
type LedgerRow = { barberId: string; barberName: string; commissionTotal: string; tipTotal: string; totalOwed: string; cashPaid: string; gcashPaid: string; paid: boolean; paidAt: string | null; additionalOwed: boolean };

export default function LedgerPage() {
  const [date, setDate] = useState(manilaToday());
  const [pin, setPin] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [base, setBase] = useState<Base>("LIST_PRICE");
  const [period, setPeriod] = useState<Period>("day");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  // Sales stated on this date but held for the owner's date review (L5); not in these totals.
  const [heldForReview, setHeldForReview] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savingBarberId, setSavingBarberId] = useState<string | null>(null);
  const [savedBarberId, setSavedBarberId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null); setSummaryError(null);
    // The summary loads beside the cards; if it fails the cards still work.
    const summaryRequest = fetch(`/api/v1/reports/ledger-summary?date=${date}&period=${period}&commissionBase=${base}`)
      .then(async (res) => { const body = await res.json(); if (!res.ok || !body.success) throw new Error(body.error ?? "Could not load the summary"); setSummary(body); })
      .catch((err) => { setSummary(null); setSummaryError(err instanceof Error ? err.message : "Could not load the summary"); });
    try {
      const response = await fetch(`/api/v1/reports/payouts?date=${date}&commissionBase=${base}`);
      const data = await response.json();
      if (response.status === 401) { setUnlocked(false); throw new Error("Enter the owner PIN to continue."); }
      if (!response.ok || !data.success) throw new Error(data.error ?? "Could not load ledger");
      setRows(data.rows);
      setHeldForReview(data.heldForReview ?? 0);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load ledger"); }
    finally { await summaryRequest; setBusy(false); }
  }, [date, base, period]);

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

  return <main className="min-h-screen bg-[#0b0c10] text-zinc-100"><div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5"><header className="flex items-center justify-between border-b border-zinc-800 pb-4"><Link href="/" className="text-zinc-400 hover:text-white"><ArrowLeft className="w-4 h-4 inline mr-1" />Home</Link><h1 className="text-xl font-bold uppercase tracking-wide">Daily payout ledger</h1><button onClick={() => void load()} className="text-zinc-400 hover:text-white"><RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} /></button></header><div className="flex flex-wrap gap-3 items-center"><label className="text-sm text-zinc-400">Business date <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="ml-2 px-2 py-1.5 rounded-lg bg-[#181b24] border border-[#232734] text-white" /></label><label className="text-sm text-zinc-400">Commission base <select value={base} onChange={(event) => setBase(event.target.value as Base)} className="ml-2 px-2 py-1.5 rounded-lg bg-[#181b24] border border-[#232734] text-white"><option value="LIST_PRICE">List price (default)</option><option value="AMOUNT_PAID">Amount paid</option></select></label><label className="text-sm text-zinc-400">Summary for <select value={period} onChange={(event) => setPeriod(event.target.value as Period)} className="ml-2 px-2 py-1.5 rounded-lg bg-[#181b24] border border-[#232734] text-white"><option value="day">The day</option><option value="week">The week (Mon to Sun)</option><option value="month">The month</option></select></label><span className="text-xs text-zinc-500">Expense sharing: SHOP_ONLY</span></div>{error && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300">{error}</div>}{heldForReview > 0 && <div className="p-3 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm">{heldForReview} {heldForReview === 1 ? "sale stamped on this date is" : "sales stamped on this date are"} held for date review and not in these totals. Confirm {heldForReview === 1 ? "its" : "their"} date on <Link href="/reconciliation" className="underline">End-of-Day Cash</Link>.</div>}{summaryError && <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">Summary: {summaryError}</div>}{summary && <SummarySection summary={summary} />}<div className="space-y-3">{rows.map((row) => { const remaining = Math.max(Number(row.totalOwed) - Number(row.cashPaid) - Number(row.gcashPaid), 0); const saving = savingBarberId === row.barberId; const saved = savedBarberId === row.barberId; return <section key={row.barberId} className="p-4 rounded-xl bg-[#12141a] border border-[#232734] space-y-3"><div className="flex items-center justify-between"><div><h2 className="font-bold text-lg">{row.barberName}</h2><p className="text-xs text-zinc-500">Commission ₱{row.commissionTotal} · Tips ₱{row.tipTotal}</p></div><div className="text-right"><div className="text-xs text-zinc-500">Total earned today</div><div className="text-2xl font-bold text-red-300">₱{row.totalOwed}</div></div></div>{row.additionalOwed && <div className="p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm">Additional owed: cuts synced or confirmed onto this date after this payout was marked. The amount already paid is unchanged.</div>}<div className="grid grid-cols-1 sm:grid-cols-4 gap-2"><label className="text-xs text-zinc-400">Cash paid<input type="number" min="0" step="0.01" value={row.cashPaid} onChange={(event) => setRows((current) => current.map((item) => item.barberId === row.barberId ? { ...item, cashPaid: event.target.value } : item))} className="mt-1 w-full px-2.5 py-2 rounded-lg bg-[#181b24] border border-[#232734] text-white" /></label><label className="text-xs text-zinc-400">GCash paid<input type="number" min="0" step="0.01" value={row.gcashPaid} onChange={(event) => setRows((current) => current.map((item) => item.barberId === row.barberId ? { ...item, gcashPaid: event.target.value } : item))} className="mt-1 w-full px-2.5 py-2 rounded-lg bg-[#181b24] border border-[#232734] text-white" /></label><div className="text-xs text-zinc-400">Remaining to pay<div className="mt-1 px-2.5 py-2 rounded-lg bg-[#181b24] border border-[#232734] text-amber-200 font-bold">₱{remaining.toFixed(2)}</div></div><label className="flex items-end gap-2 text-sm text-zinc-300 pb-2"><input type="checkbox" checked={row.paid} onChange={(event) => setRows((current) => current.map((item) => item.barberId === row.barberId ? { ...item, paid: event.target.checked } : item))} /> Paid confirmation</label></div><button onClick={() => void save(row)} disabled={saving} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-bold disabled:opacity-50"><Save className="w-4 h-4" />{saving ? "Saving…" : saved ? "Saved ✓" : "Save payout"}</button></section>; })}{rows.length === 0 && <div className="p-8 text-center text-zinc-500">No active barbers found.</div>}</div><p className="text-xs text-zinc-600"><Scissors className="w-3 h-3 inline mr-1" />Total earned stays as the daily record; Remaining to pay subtracts recorded cash and GCash payouts.</p></div></main>;
}

const peso = (value: string) => `₱${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDate = (iso: string) => new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

function Line({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  return <div className={`flex items-baseline justify-between gap-3 py-1 ${strong ? "border-t border-zinc-700 mt-1 pt-2 font-bold text-white" : "text-zinc-300"}`}><span>{label}{note && <span className="ml-2 text-[11px] font-normal text-zinc-500">{note}</span>}</span><span className="tabular-nums">{value}</span></div>;
}

// Slice 10: money in, money out and what is left, for the picked day, week or month.
function SummarySection({ summary }: { summary: Summary }) {
  const range = summary.from === summary.to ? shortDate(summary.from) : `${shortDate(summary.from)} to ${shortDate(summary.to)}`;
  const { sales, shared, payouts } = summary;
  return <section className="p-4 rounded-xl bg-[#12141a] border border-[#232734] space-y-4 text-sm"><div><h2 className="font-bold text-lg uppercase tracking-wide">Summary</h2><p className="text-xs text-zinc-500">{range} · {sales.count} paid {sales.count === 1 ? "sale" : "sales"}</p></div>
    <div><h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-1">Money in</h3><Line label="Cash" value={peso(sales.cash)} /><Line label="GCash" value={peso(sales.gcash)} note="not in the drawer" /><Line label="Maya" value={peso(sales.maya)} note="not in the drawer" />{Number(sales.qrph) > 0 && <Line label="QR Ph" value={peso(sales.qrph)} note="not in the drawer" />}<Line label="Total revenue" value={peso(sales.total)} strong /></div>
    <div><h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-1">Shared out</h3><Line label="Barber commissions" value={peso(shared.commissions)} /><Line label="Tips (100% to the barber, not in revenue)" value={peso(shared.tips)} /><Line label="Petty cash" value={peso(shared.pettyCash)} note={shared.pettyCashRecorded ? undefined : summary.period === "day" ? "Not recorded yet (End-of-Day Cash)" : `${summary.pettyCashMissingDays} ${summary.pettyCashMissingDays === 1 ? "day has" : "days have"} no End-of-Day Cash saved`} /><Line label="Left for the shop" value={peso(summary.leftForShop)} note="before the owner's own costs" strong /></div>
    <div><h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-1">Barber payouts</h3><Line label="Owed (commission + tips)" value={peso(payouts.owed)} /><Line label="Recorded as paid" value={peso(payouts.paid)} /><Line label="Still to pay" value={peso(payouts.remaining)} strong /></div>
    <div><h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-1">By service</h3>{summary.services.length === 0 ? <p className="text-zinc-500">No sales in this period.</p> : <>{summary.services.map((row) => <Line key={row.name} label={row.name} note={`${row.count} sold`} value={peso(row.listSales)} />)}{Number(summary.serviceGap) !== 0 && <Line label="Discounts and custom amounts" value={peso(summary.serviceGap)} note="services are at list price, so they differ from total revenue" />}</>}</div>
    {summary.days.length > 0 && <div><h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-1">Day by day</h3><div className="grid grid-cols-[1fr_auto_auto] gap-x-4 text-xs text-zinc-500"><span /><span className="text-right">Revenue</span><span className="text-right">Commissions</span></div>{summary.days.map((day) => <div key={day.date} className="grid grid-cols-[1fr_auto_auto] gap-x-4 py-0.5 text-zinc-300"><span>{shortDate(day.date)}</span><span className="text-right tabular-nums">{peso(day.revenue)}</span><span className="text-right tabular-nums">{peso(day.commissions)}</span></div>)}</div>}
  </section>;
}

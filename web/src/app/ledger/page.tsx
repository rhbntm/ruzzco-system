"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, LockKeyhole, RefreshCw, Save, Scissors, TriangleAlert } from "lucide-react";
import { manilaToday } from "@/lib/business-date";
import { BarberPoleIcon, MustacheIcon } from "@/components/RuzzcoBrand";

type Base = "LIST_PRICE" | "AMOUNT_PAID";
type LedgerRow = { barberId: string; barberName: string; commissionTotal: string; tipTotal: string; totalOwed: string; cashPaid: string; gcashPaid: string; paid: boolean; paidAt: string | null; additionalOwed: boolean };

export default function LedgerPage() {
  const [date, setDate] = useState(manilaToday());
  const [pin, setPin] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [base, setBase] = useState<Base>("LIST_PRICE");
  const [rows, setRows] = useState<LedgerRow[]>([]);
  // Sales stated on this date but held for the owner's date review (L5); not in these totals.
  const [heldForReview, setHeldForReview] = useState(0);
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
      setHeldForReview(data.heldForReview ?? 0);
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
    return (
      <main className="rz-page flex-1 flex items-center justify-center p-4 sm:p-6">
        <form
          onSubmit={(event) => { event.preventDefault(); void unlock(); }}
          className="animate-pop rz-panel w-full max-w-sm p-6 sm:p-7 space-y-5"
        >
          <div className="flex flex-col items-center text-center gap-3">
            <span aria-hidden="true" className="w-14 h-14 rounded-full bg-brass/10 ring-1 ring-brass/45 text-brass-bright flex items-center justify-center">
              <LockKeyhole className="w-6 h-6" />
            </span>
            <h1 className="rz-title text-3xl">Owner ledger</h1>
            <p className="text-sm text-dust leading-relaxed">Enter the owner PIN to view and record barber payouts.</p>
          </div>
          <div className="rz-ornament" aria-hidden="true"><MustacheIcon className="w-8 h-3 text-brass" /></div>
          <input
            autoFocus
            type="password"
            inputMode="numeric"
            aria-label="Owner PIN"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            className="rz-field min-h-12 text-center text-lg tracking-[0.4em] placeholder:text-base placeholder:tracking-normal"
            placeholder="Owner PIN"
          />
          <button disabled={busy || !pin} className="rz-btn rz-btn-primary w-full min-h-12">
            {busy ? "Checking…" : "Unlock ledger"}
          </button>
          {error && <p role="alert" className="animate-rise rz-notice rz-notice-danger">{error}</p>}
          <Link href="/" className="block py-2 pointer-coarse:py-3.5 text-center text-sm text-dust hover:text-bone transition-colors">Back to home</Link>
        </form>
      </main>
    );
  }

  // Inputs: 16px text on phones (no iOS zoom on focus), 44px tall on touch screens.
  const field = "rz-field py-1.5 pointer-coarse:min-h-11 sm:text-sm";
  return (
    <main className="flex-1">
      <header className="rz-banner">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3 px-4 sm:px-6 py-3">
          <Link href="/" className="inline-flex items-center gap-1.5 -my-2 py-2 pointer-coarse:-my-3.5 pointer-coarse:py-3.5 text-sm text-dust hover:text-bone transition-colors group">
            <ArrowLeft className="w-4 h-4 transition-transform duration-200 group-hover:-translate-x-0.5" />Home
          </Link>
          <h1 className="flex items-center gap-2 font-display font-semibold text-base sm:text-lg leading-none uppercase tracking-widest text-bone">
            {/* The station light: it turns while the ledger loads. */}
            <BarberPoleIcon className="w-2.5 h-6" spinning={busy} />
            Daily payout ledger
          </h1>
          <button onClick={() => void load()} aria-label="Reload the ledger" title="Reload" className="rz-btn rz-btn-ghost rz-btn-icon -my-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11">
            <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <div className="rz-page max-w-4xl mx-auto p-4 sm:p-6 space-y-5">
        <div className="rz-panel flex flex-wrap gap-x-5 gap-y-3 items-center p-3 sm:p-4">
          <label className="flex items-center gap-2 text-sm text-dust">
            Business date <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={`scheme-dark w-auto ${field}`} />
          </label>
          <label className="flex items-center gap-2 text-sm text-dust">
            Commission base{" "}
            <select value={base} onChange={(event) => setBase(event.target.value as Base)} className={`w-auto ${field}`}>
              <option value="LIST_PRICE">List price (default)</option>
              <option value="AMOUNT_PAID">Amount paid</option>
            </select>
          </label>
          <span className="rz-pill text-dust">Expense sharing: SHOP_ONLY</span>
        </div>

        {error && <div role="alert" className="animate-rise rz-notice rz-notice-danger">{error}</div>}
        <p aria-live="polite" className="sr-only">{savedBarberId ? "Payout saved." : ""}</p>
        {heldForReview > 0 && (
          <div className="animate-rise rz-notice rz-notice-warn">
            <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <p>
              {heldForReview} {heldForReview === 1 ? "sale stamped on this date is" : "sales stamped on this date are"} held for date review and not in these totals. Confirm {heldForReview === 1 ? "its" : "their"} date on <Link href="/reconciliation" className="underline hover:text-white">End-of-Day Cash</Link>.
            </p>
          </div>
        )}

        <div className="space-y-4 rz-stagger">
          {rows.map((row) => {
            const remaining = Math.max(Number(row.totalOwed) - Number(row.cashPaid) - Number(row.gcashPaid), 0);
            const saving = savingBarberId === row.barberId;
            const saved = savedBarberId === row.barberId;
            return (
              <section key={row.barberId} className="rz-panel p-4 sm:p-5 space-y-4">
                {/* Phones: the earned total on its own row under the name, so the name is never cut. */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <span aria-hidden="true" className="w-11 h-11 rounded-full bg-panel-2 ring-1 ring-seam-strong flex items-center justify-center font-display font-semibold text-lg text-bone shrink-0">
                      {row.barberName.charAt(0)}
                    </span>
                    <div className="min-w-0">
                      <h2 className="rz-title text-xl truncate">{row.barberName}</h2>
                      <p className="text-xs text-dust tabular-nums">Commission ₱{row.commissionTotal} · Tips ₱{row.tipTotal}</p>
                    </div>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 pt-3 border-t border-seam sm:block sm:pt-0 sm:border-0 sm:text-right shrink-0">
                    <div className="rz-label">Total earned today</div>
                    <div className="rz-figure text-3xl text-brass-bright">₱{row.totalOwed}</div>
                  </div>
                </div>
                {row.additionalOwed && (
                  <div className="rz-notice rz-notice-warn">
                    <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
                    <p>Additional owed: cuts synced or confirmed onto this date after this payout was marked. The amount already paid is unchanged.</p>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 sm:items-end">
                  <label className="block text-[0.8125rem] font-medium text-bone-2">
                    Cash paid
                    <input type="number" min="0" step="0.01" inputMode="decimal" value={row.cashPaid} onChange={(event) => setRows((current) => current.map((item) => item.barberId === row.barberId ? { ...item, cashPaid: event.target.value } : item))} className={`mt-1.5 w-full ${field}`} />
                  </label>
                  <label className="block text-[0.8125rem] font-medium text-bone-2">
                    GCash paid
                    <input type="number" min="0" step="0.01" inputMode="decimal" value={row.gcashPaid} onChange={(event) => setRows((current) => current.map((item) => item.barberId === row.barberId ? { ...item, gcashPaid: event.target.value } : item))} className={`mt-1.5 w-full ${field}`} />
                  </label>
                  <div className="text-[0.8125rem] font-medium text-bone-2">
                    Remaining to pay
                    <div className={`mt-1.5 min-h-10 px-3 flex items-center rounded-[10px] bg-black/30 border border-seam rz-figure text-lg transition-colors duration-300 ${remaining > 0 ? "text-warn-ink" : "text-ok-ink"}`}>
                      ₱{remaining.toFixed(2)}
                    </div>
                  </div>
                  <label className="flex items-center gap-2.5 min-h-10 text-sm text-bone-2 pointer-coarse:min-h-11">
                    <input type="checkbox" checked={row.paid} onChange={(event) => setRows((current) => current.map((item) => item.barberId === row.barberId ? { ...item, paid: event.target.checked } : item))} className="size-4.5 accent-crimson" /> Paid confirmation
                  </label>
                </div>
                <button
                  onClick={() => void save(row)}
                  disabled={saving}
                  className={`rz-btn pointer-coarse:min-h-11 ${saved ? "rz-btn-secondary border-ok/45 text-ok-ink" : "rz-btn-primary"}`}
                >
                  {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}{saving ? "Saving…" : saved ? "Saved" : "Save payout"}
                </button>
              </section>
            );
          })}
          {/* While the first load runs, the panels' shape instead of "no barbers". */}
          {rows.length === 0 && (busy ? (
            <div aria-hidden="true" className="rz-panel p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="rz-skeleton h-5 w-36" />
                <div className="rz-skeleton h-8 w-28" />
              </div>
              <div className="rz-skeleton h-10 w-full" />
            </div>
          ) : (
            <div className="rz-panel p-8 text-center text-dust">No active barbers found.</div>
          ))}
        </div>
        <p className="text-xs text-dust flex items-start gap-1.5"><Scissors className="w-3.5 h-3.5 mt-px shrink-0" />Total earned stays as the daily record; Remaining to pay subtracts recorded cash and GCash payouts.</p>
      </div>
    </main>
  );
}

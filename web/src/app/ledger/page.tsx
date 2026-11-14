"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Plus, RefreshCw, Scissors, TriangleAlert, Undo2 } from "lucide-react";
import { manilaToday } from "@/lib/business-date";
import { generateUUID } from "@/lib/db";
import { createSubmitLock } from "@/lib/submit-lock";
import { BarberPoleIcon } from "@/components/RuzzcoBrand";
import { OwnerSignInPage } from "@/components/OwnerSignIn";

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
type Method = "CASH" | "GCASH";
// Slice 18: one payout, never edited. A correction is stored negative and names the entry it undoes.
type Entry = { id: string; method: Method; kind: "PAYOUT" | "CORRECTION" | "OPENING"; amount: string; correctsId: string | null; note: string | null; recordedAt: string; correctableLeft: string };
type LedgerRow = {
  barberId: string; barberName: string; commissionTotal: string; tipTotal: string; totalOwed: string;
  cashPaid: string; gcashPaid: string; paidTotal: string; remaining: string; additionalOwed: boolean; entries: Entry[];
};
// The amount box for one barber. `id` is the entry's idempotency key: kept for a retry of the
// same amount and method, replaced when either changes and after a save (edge case 2).
type Draft = { id: string; amount: string; method: Method };
type Correcting = { barberId: string; entry: Entry; id: string; amount: string; note: string };

const newDraft = (method: Method = "CASH"): Draft => ({ id: generateUUID(), amount: "", method });
// Repeated taps right after a save land on the lock instead of the button.
const SAVE_REPEAT_GUARD_MS = 600;

export default function LedgerPage() {
  const [date, setDate] = useState(manilaToday());
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
  // Keyed by date and barber, so another day starts with empty boxes.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [correcting, setCorrecting] = useState<Correcting | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [saveLock] = useState(() => createSubmitLock({ holdAfterSuccessMs: SAVE_REPEAT_GUARD_MS }));
  const draftKey = (barberId: string) => `${date}:${barberId}`;
  const draftFor = (barberId: string) => drafts[draftKey(barberId)] ?? null;

  const load = useCallback(async () => {
    setBusy(true); setError(null); setSummaryError(null);
    // The summary loads beside the cards; if it fails the cards still work.
    const summaryRequest = fetch(`/api/v1/reports/ledger-summary?date=${date}&period=${period}&commissionBase=${base}`)
      .then(async (res) => { const body = await res.json(); if (!res.ok || !body.success) throw new Error(body.error ?? "Could not load the summary"); setSummary(body); })
      .catch((err) => { setSummary(null); setSummaryError(err instanceof Error ? err.message : "Could not load the summary"); });
    try {
      const response = await fetch(`/api/v1/reports/payouts?date=${date}&commissionBase=${base}`);
      const data = await response.json();
      if (response.status === 401) { setUnlocked(false); throw new Error("Owner sign-in required."); }
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

  // Posts one entry; on success the card shows the row the server sent back.
  async function postEntry(barberId: string, body: Record<string, unknown>) {
    setSavingBarberId(barberId); setSavedBarberId(null); setError(null);
    setCardErrors((current) => ({ ...current, [barberId]: "" }));
    const result = await saveLock.run(async () => {
      const response = await fetch("/api/v1/reports/payouts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, barberId, commissionBase: base, ...body }) });
      const data = await response.json();
      if (response.status === 401) { setUnlocked(false); throw new Error("Owner sign-in required."); }
      if (!response.ok || !data.success) throw new Error(data.error ?? "Could not save payout");
      return data.row as LedgerRow;
    });
    setSavingBarberId(null);
    if (result.status === "busy") return false;
    if (result.status === "failed") {
      const message = result.error instanceof Error ? result.error.message : "Could not save payout";
      setCardErrors((current) => ({ ...current, [barberId]: message }));
      return false;
    }
    setRows((current) => current.map((item) => item.barberId === barberId ? result.value : item));
    setSavedBarberId(barberId);
    window.setTimeout(() => setSavedBarberId(null), 2200);
    return true;
  }

  async function record(row: LedgerRow) {
    const draft = draftFor(row.barberId);
    const amount = Number(draft?.amount);
    if (!draft || !(amount > 0)) return;
    const saved = await postEntry(row.barberId, { id: draft.id, method: draft.method, amount });
    // The box starts empty after each save; the method stays as it was.
    if (saved) setDrafts((current) => ({ ...current, [draftKey(row.barberId)]: newDraft(draft.method) }));
  }

  async function saveCorrection() {
    if (!correcting) return;
    const amount = Number(correcting.amount);
    if (!(amount > 0) || !correcting.note.trim()) return;
    const saved = await postEntry(correcting.barberId, {
      id: correcting.id, kind: "CORRECTION", correctsId: correcting.entry.id, method: correcting.entry.method, amount, note: correcting.note.trim(),
    });
    if (saved) setCorrecting(null);
  }

  function editDraft(barberId: string, change: Partial<Omit<Draft, "id">>) {
    setDrafts((current) => {
      const draft = current[draftKey(barberId)] ?? newDraft();
      return { ...current, [draftKey(barberId)]: { ...draft, ...change, id: generateUUID() } };
    });
  }

  if (!unlocked) {
    return <OwnerSignInPage title="Owner ledger" what="view and record barber payouts" submitLabel="Unlock ledger" onSignedIn={() => setUnlocked(true)} />;
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
          <label className="flex items-center gap-2 text-sm text-dust">
            Summary for{" "}
            <select value={period} onChange={(event) => setPeriod(event.target.value as Period)} className={`w-auto ${field}`}>
              <option value="day">The day</option>
              <option value="week">The week (Mon to Sun)</option>
              <option value="month">The month</option>
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
        {summaryError && <div role="alert" className="animate-rise rz-notice rz-notice-danger">Summary: {summaryError}</div>}
        {summary && <SummarySection summary={summary} />}

        <div className="space-y-4 rz-stagger">
          {rows.map((row) => {
            const remaining = Number(row.remaining);
            const saving = savingBarberId === row.barberId;
            const saved = savedBarberId === row.barberId;
            const draft = draftFor(row.barberId) ?? { id: "", amount: "", method: "CASH" as Method };
            const draftAmount = Number(draft.amount);
            const cardError = cardErrors[row.barberId];
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
                      <p className="text-xs text-dust tabular-nums">Commission {peso(row.commissionTotal)} · Tips {peso(row.tipTotal)}</p>
                    </div>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 pt-3 border-t border-seam sm:block sm:pt-0 sm:border-0 sm:text-right shrink-0">
                    <div className="rz-label">{date === manilaToday() ? "Total earned today" : `Total earned on ${shortDate(date)}`}</div>
                    <div className="rz-figure text-3xl text-brass-bright">{peso(row.totalOwed)}</div>
                  </div>
                </div>
                {row.additionalOwed && (
                  <div className="rz-notice rz-notice-warn">
                    <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
                    <p>Additional owed: cuts synced or confirmed onto this date after the day was paid in full. The payouts already recorded are unchanged.</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3 text-[0.8125rem] font-medium text-bone-2">
                  <div>
                    Paid so far
                    <div className="mt-1.5 min-h-10 px-3 flex items-center rounded-[10px] bg-black/30 border border-seam rz-figure text-lg text-bone">{peso(row.paidTotal)}</div>
                  </div>
                  <div>
                    Remaining to pay
                    <div className={`mt-1.5 min-h-10 px-3 flex items-center rounded-[10px] bg-black/30 border border-seam rz-figure text-lg transition-colors duration-300 ${remaining > 0 ? "text-warn-ink" : "text-ok-ink"}`}>
                      {peso(row.remaining)}
                    </div>
                  </div>
                </div>
                <form
                  onSubmit={(event) => { event.preventDefault(); void record(row); }}
                  className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 sm:items-end"
                >
                  <label className="block text-[0.8125rem] font-medium text-bone-2">
                    Payout amount
                    <input
                      type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="0.00"
                      value={draft.amount}
                      onChange={(event) => editDraft(row.barberId, { amount: event.target.value, method: draft.method })}
                      className={`mt-1.5 w-full ${field}`}
                    />
                  </label>
                  <div role="radiogroup" aria-label="Paid by" className="grid grid-cols-2 gap-1 p-1 rounded-[10px] bg-black/30 border border-seam">
                    {(["CASH", "GCASH"] as const).map((method) => (
                      <button
                        key={method} type="button" role="radio" aria-checked={draft.method === method}
                        onClick={() => editDraft(row.barberId, { amount: draft.amount, method })}
                        className={`min-h-9 pointer-coarse:min-h-10 px-3 rounded-lg text-sm transition-colors ${draft.method === method ? "bg-panel-2 text-bone ring-1 ring-seam-strong" : "text-dust hover:text-bone"}`}
                      >
                        {method === "CASH" ? "Cash" : "GCash"}
                      </button>
                    ))}
                  </div>
                  <button
                    disabled={saving || !(draftAmount > 0)}
                    className={`rz-btn pointer-coarse:min-h-11 ${saved ? "rz-btn-secondary border-ok/45 text-ok-ink" : "rz-btn-primary"}`}
                  >
                    {saved ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}{saving ? "Saving…" : saved ? "Recorded" : "Record payout"}
                  </button>
                </form>
                {cardError && <p role="alert" className="animate-rise rz-notice rz-notice-danger">{cardError}</p>}
                <EntryList
                  row={row}
                  correcting={correcting?.barberId === row.barberId ? correcting : null}
                  saving={saving}
                  onCorrect={(entry) => setCorrecting({ barberId: row.barberId, entry, id: generateUUID(), amount: entry.correctableLeft, note: "" })}
                  onChange={(change) => setCorrecting((current) => current && { ...current, ...change, id: generateUUID() })}
                  onCancel={() => setCorrecting(null)}
                  onSave={() => void saveCorrection()}
                  field={field}
                />
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
        <p className="text-xs text-dust flex items-start gap-1.5"><Scissors className="w-3.5 h-3.5 mt-px shrink-0" />Each payout is kept as its own entry and is never edited; a mistake is fixed with a correction beside it. Cash payouts come out of expected drawer cash when recorded.</p>
      </div>
    </main>
  );
}

// A negative amount (the discounts line) reads −₱125.00, not ₱-125.00.
const peso = (value: string) => {
  const amount = Number(value);
  return `${amount < 0 ? "−" : ""}₱${Math.abs(amount).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const shortDate = (iso: string) => new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

// One figure on the summary: the label (and a note under it on phones), the amount on the right.
// A total sits under a brass rule, like the table totals.
function Line({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 ${strong ? "mt-1 pt-2.5 border-t border-brass/50 font-semibold text-brass-bright" : "text-bone-2"}`}>
      <span className="min-w-0">
        {label}
        {note && <span className="block sm:inline sm:ml-2 text-[0.6875rem] font-normal text-dust">{note}</span>}
      </span>
      <span className="tabular-nums shrink-0">{value}</span>
    </div>
  );
}

// Slice 10: money in, money out and what is left, for the picked day, week or month.
function SummarySection({ summary }: { summary: Summary }) {
  const range = summary.from === summary.to ? shortDate(summary.from) : `${shortDate(summary.from)} to ${shortDate(summary.to)}`;
  const { sales, shared, payouts } = summary;
  return (
    <section className="animate-rise rz-panel p-4 sm:p-5 space-y-5 text-sm">
      <div className="space-y-1">
        <h2 className="rz-title text-xl">Summary</h2>
        <p className="text-xs text-dust tabular-nums">{range} · {sales.count} paid {sales.count === 1 ? "sale" : "sales"}</p>
      </div>
      <div className="grid gap-5 md:grid-cols-2 md:gap-x-8">
        <div>
          <h3 className="rz-label mb-1">Money in</h3>
          <Line label="Cash" value={peso(sales.cash)} />
          <Line label="GCash" value={peso(sales.gcash)} note="not in the drawer" />
          <Line label="Maya" value={peso(sales.maya)} note="not in the drawer" />
          {Number(sales.qrph) > 0 && <Line label="QR Ph" value={peso(sales.qrph)} note="not in the drawer" />}
          <Line label="Total revenue" value={peso(sales.total)} strong />
        </div>
        <div>
          <h3 className="rz-label mb-1">Shared out</h3>
          <Line label="Barber commissions" value={peso(shared.commissions)} />
          <Line label="Tips (100% to the barber, not in revenue)" value={peso(shared.tips)} />
          <Line
            label="Petty cash"
            value={peso(shared.pettyCash)}
            note={shared.pettyCashRecorded ? undefined : summary.period === "day" ? "Not recorded yet (End-of-Day Cash)" : `${summary.pettyCashMissingDays} ${summary.pettyCashMissingDays === 1 ? "day has" : "days have"} no End-of-Day Cash saved`}
          />
          <Line label="Left for the shop" value={peso(summary.leftForShop)} note="before the owner's own costs" strong />
        </div>
        <div>
          <h3 className="rz-label mb-1">Barber payouts</h3>
          <Line label="Owed (commission + tips)" value={peso(payouts.owed)} />
          <Line label="Recorded as paid" value={peso(payouts.paid)} />
          <Line label="Still to pay" value={peso(payouts.remaining)} strong />
        </div>
        <div>
          <h3 className="rz-label mb-1">By service</h3>
          {summary.services.length === 0 ? (
            <p className="py-1.5 text-dust">No sales in this period.</p>
          ) : (
            <>
              {summary.services.map((row) => <Line key={row.name} label={row.name} note={`${row.count} sold`} value={peso(row.listSales)} />)}
              {Number(summary.serviceGap) !== 0 && <Line label="Discounts" value={peso(summary.serviceGap)} note="services are at list price, so they differ from total revenue" />}
            </>
          )}
        </div>
        {summary.days.length > 0 && (
          <div className="md:col-span-2">
            <h3 className="rz-label mb-1">Day by day</h3>
            <table className="rz-table text-[0.8125rem] [&_td]:py-1.5">
              <thead>
                <tr>
                  <th className="text-left"><span className="sr-only">Day</span></th>
                  <th className="text-right">Revenue</th>
                  <th className="text-right">Commissions</th>
                </tr>
              </thead>
              <tbody>
                {summary.days.map((day) => (
                  <tr key={day.date}>
                    <td className="text-bone-2">{shortDate(day.date)}</td>
                    <td className="text-right text-bone">{peso(day.revenue)}</td>
                    <td className="text-right text-bone-2">{peso(day.commissions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

// Recorded times on the Manila clock, whatever the device's zone.
const manilaTime = (iso: string) => new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(iso));
const methodName = (method: Method) => method === "CASH" ? "Cash" : "GCash";

// Slice 18: the day's payouts under the barber, oldest first. Entries are never edited; a
// payout (or an opening entry) can be corrected by a new entry that stays beside it.
function EntryList({ row, correcting, saving, onCorrect, onChange, onCancel, onSave, field }: {
  row: LedgerRow;
  correcting: Correcting | null;
  saving: boolean;
  onCorrect: (entry: Entry) => void;
  onChange: (change: Partial<Pick<Correcting, "amount" | "note">>) => void;
  onCancel: () => void;
  onSave: () => void;
  field: string;
}) {
  if (row.entries.length === 0) return <p className="text-sm text-dust">No payouts recorded for this day.</p>;
  const byId = new Map(row.entries.map((entry) => [entry.id, entry]));
  return (
    <div>
      <h3 className="rz-label mb-1">Payouts recorded</h3>
      <ul className="divide-y divide-seam text-sm">
        {row.entries.map((entry) => {
          const corrected = entry.kind === "CORRECTION" ? 0 : Number(entry.amount) - Number(entry.correctableLeft);
          const target = entry.correctsId ? byId.get(entry.correctsId) : undefined;
          const open = correcting?.entry.id === entry.id;
          return (
            <li key={entry.id} className="py-2 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-bone-2">
                    <span className="tabular-nums">{manilaTime(entry.recordedAt)}</span> · {methodName(entry.method)}
                    {entry.kind === "OPENING" && <span className="text-dust"> · saved before entries</span>}
                    {entry.kind === "CORRECTION" && <span className="text-dust"> · correction{target ? ` of the ${manilaTime(target.recordedAt)} payout` : ""}</span>}
                  </p>
                  {entry.note && <p className="text-xs text-dust break-words">{entry.note}</p>}
                  {corrected > 0 && <p className="text-xs text-dust tabular-nums">{peso(String(corrected))} corrected</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`tabular-nums ${entry.kind === "CORRECTION" ? "text-dust" : "text-bone"}`}>{peso(entry.amount)}</span>
                  {Number(entry.correctableLeft) > 0 && !open && (
                    <button type="button" onClick={() => onCorrect(entry)} className="rz-btn rz-btn-ghost text-xs px-2 py-1 pointer-coarse:min-h-11" aria-label={`Correct the ${manilaTime(entry.recordedAt)} ${methodName(entry.method)} payout`}>
                      <Undo2 className="w-3.5 h-3.5" />Correct
                    </button>
                  )}
                </div>
              </div>
              {open && correcting && (
                <form onSubmit={(event) => { event.preventDefault(); onSave(); }} className="rz-panel p-3 space-y-3">
                  <p className="text-xs text-dust">Takes back part or all of this payout (up to {peso(entry.correctableLeft)}). Both entries stay on the record.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-3">
                    <label className="block text-[0.8125rem] font-medium text-bone-2">
                      Amount
                      <input type="number" min="0.01" step="0.01" max={entry.correctableLeft} inputMode="decimal" value={correcting.amount} onChange={(event) => onChange({ amount: event.target.value })} className={`mt-1.5 w-full ${field}`} />
                    </label>
                    <label className="block text-[0.8125rem] font-medium text-bone-2">
                      Reason
                      <input type="text" maxLength={200} value={correcting.note} onChange={(event) => onChange({ note: event.target.value })} placeholder="e.g. typed 500 instead of 50" className={`mt-1.5 w-full ${field}`} />
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button disabled={saving || !(Number(correcting.amount) > 0) || !correcting.note.trim()} className="rz-btn rz-btn-primary pointer-coarse:min-h-11">{saving ? "Saving…" : "Save correction"}</button>
                    <button type="button" onClick={onCancel} className="rz-btn rz-btn-ghost pointer-coarse:min-h-11">Cancel</button>
                  </div>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

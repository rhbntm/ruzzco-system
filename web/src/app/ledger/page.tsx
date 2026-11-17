"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Banknote, Check, CheckCircle2, Clock, Plus, RefreshCw, Scissors, Smartphone, TriangleAlert, Undo2 } from "lucide-react";
import { manilaToday } from "@/lib/business-date";
import { generateUUID } from "@/lib/db";
import { createSubmitLock } from "@/lib/submit-lock";
import { DEFAULT_CUSTOM_NOTE } from "@/lib/pricing";
import { peso as pesoText } from "@/lib/peso";
import { BarberPoleIcon } from "@/components/RuzzcoBrand";
import { OwnerSignInPage } from "@/components/OwnerSignIn";
import { DateRangeBar, presetOptions, rangeText, type RangeOption } from "@/components/DateRangeBar";
import { PagedControls } from "@/components/Pager";
import { ShowingLine } from "@/components/ShowingLine";
import { usePagedList } from "@/lib/use-paged-list";
import { clearListSettings, keepRange, readListSettings, resolveKeptRange, showingText, writeListSettings } from "@/lib/list-settings";

// The Barber Ledger (slice 21c layout). Three parts, each with its own dates:
//   1. Payouts for one business date: a card per barber beside one payout form (slice 18's
//      entries and corrections, unchanged), and that date's custom amounts (slice 16).
//   2. The Summary over a range (slice 20's `from`/`to` on the ledger-summary route).
//   3. The read-only Payout history over the same range (GET /api/v1/reports/payout-history).
// Presentation only: no request, rule or message differs from before the redesign, except that
// the Summary asks by `from`/`to` (a one-day range is the legacy day answer, slice 20).

type Base = "LIST_PRICE" | "AMOUNT_PAID";
type Summary = {
  from: string; to: string; period: string;
  sales: { cash: string; gcash: string; maya: string; qrph: string; total: string; count: number };
  shared: { commissions: string; tips: string; pettyCash: string; pettyCashRecorded: boolean };
  leftForShop: string;
  payouts: { owed: string; paid: string; remaining: string };
  services: { name: string; count: number; listSales: string }[];
  serviceGap: string;
  days: { date: string; revenue: string; commissions: string }[];
  pettyCashMissingDays: number;
  heldForReview?: number;
};
type Method = "CASH" | "GCASH";
// Slice 16: one custom-amount sale on the picked date (GET /api/v1/reports/custom-amounts).
type CustomSale = {
  id: string; time: string; barberName: string; serviceName: string | null; amountPaid: string; note: string | null;
  paymentMethod: string; paymentStatus: string; commission: string; menuPriceNow: string | null;
};
// Slice 18: one payout, never edited. A correction is stored negative and names the entry it undoes.
type Entry = { id: string; method: Method; kind: "PAYOUT" | "CORRECTION" | "OPENING"; amount: string; correctsId: string | null; note: string | null; recordedAt: string; correctableLeft: string };
type LedgerRow = {
  barberId: string; barberName: string; commissionTotal: string; tipTotal: string; totalOwed: string;
  cashPaid: string; gcashPaid: string; paidTotal: string; remaining: string; additionalOwed: boolean; entries: Entry[];
};
// Slice 20: the payout history of a range, days newest first.
type HistoryBarber = {
  barberId: string; barberName: string; active: boolean; commission: string; tips: string; owed: string; paid: string; remaining: string;
  additionalOwed: boolean; entries: Entry[];
};
type History = {
  from: string; to: string; heldForReview: number;
  totals: { owed: string; paid: string; remaining: string; additionalOwedDays: number };
  days: { date: string; barbers: HistoryBarber[] }[];
};
// The payout form's amount, method and note for one barber. `id` is the entry's idempotency key:
// kept for a retry of the same entry, replaced when anything in it changes and after a save
// (slice 18, edge case 2).
type Draft = { id: string; amount: string; method: Method; note: string };
type Correcting = { barberId: string; entry: Entry; id: string; amount: string; note: string };

const newDraft = (method: Method = "CASH"): Draft => ({ id: generateUUID(), amount: "", method, note: "" });
// Repeated taps right after a save land on the lock instead of the button.
const SAVE_REPEAT_GUARD_MS = 600;
// The range option that follows the picked business date.
const PICKED = "picked";
// Slice 22, Decision 10: the range is kept in this browser (a preset by name, a Custom range by its dates).
const RANGE_KEY = "ledger-range";

export default function LedgerPage() {
  const today = manilaToday();
  const [date, setDate] = useState(today);
  const [unlocked, setUnlocked] = useState(false);
  const [base, setBase] = useState<Base>("LIST_PRICE");
  const [rangeKey, setRangeKey] = useState<string>("today");
  // Slice 22: a Custom range chosen on the range bar (checked by `customOption`).
  const [customRange, setCustomRange] = useState<RangeOption | null>(null);
  const [rangeRead, setRangeRead] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [rangeBusy, setRangeBusy] = useState(false);
  // Custom amounts load on their own: a failure there never blocks the rest of the page.
  const [customSales, setCustomSales] = useState<CustomSale[] | null>(null);
  const [customError, setCustomError] = useState<string | null>(null);
  const [customBusy, setCustomBusy] = useState(false);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  // Sales stated on this date but held for the owner's date review (L5); not in these totals.
  const [heldForReview, setHeldForReview] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savingBarberId, setSavingBarberId] = useState<string | null>(null);
  const [savedBarberId, setSavedBarberId] = useState<string | null>(null);
  // Which barber the one payout form is for; the first with something to pay until one is picked.
  const [pickedBarberId, setPickedBarberId] = useState<string | null>(null);
  // Keyed by date and barber, so another day starts with an empty form.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [correcting, setCorrecting] = useState<Correcting | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [saveLock] = useState(() => createSubmitLock({ holdAfterSuccessMs: SAVE_REPEAT_GUARD_MS }));
  const formRef = useRef<HTMLFormElement>(null);
  const draftKey = (barberId: string) => `${date}:${barberId}`;
  const draftFor = (barberId: string) => drafts[draftKey(barberId)] ?? null;

  // The presets of slice 20, and the picked business date as a one-day range when it isn't today.
  const rangeOptions = useMemo<RangeOption[]>(() => {
    const presets = presetOptions(today);
    const base = date === today ? presets : [{ key: PICKED, label: shortDate(date), from: date, to: date }, ...presets];
    return customRange ? [...base, customRange] : base;
  }, [date, today, customRange]);
  const range = rangeOptions.find((option) => option.key === rangeKey) ?? rangeOptions[0];

  // The kept range, read once after mount; a kept range that is no longer valid becomes Today.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const kept = readListSettings<{ range: unknown }>(RANGE_KEY, { range: null }, (raw) => ({ range: raw.range }));
      const resolved = resolveKeptRange(kept.range, today);
      if (resolved.key === "custom") setCustomRange({ key: "custom", label: "Custom", from: resolved.from, to: resolved.to });
      setRangeKey(resolved.key);
      setRangeRead(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [today]);
  useEffect(() => {
    if (rangeRead && range.key !== PICKED) writeListSettings(RANGE_KEY, { range: keepRange(range) });
  }, [rangeRead, range]);
  function resetRange() {
    clearListSettings(RANGE_KEY);
    setCustomRange(null);
    setRangeKey("today");
  }

  // Another business date: the Summary and history follow it, as the day view always did.
  function pickDate(next: string) {
    setDate(next);
    setRangeKey(next === today ? "today" : PICKED);
    setCorrecting(null);
  }

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/v1/reports/payouts?date=${date}&commissionBase=${base}`);
      const data = await response.json();
      if (response.status === 401) { setUnlocked(false); throw new Error("Owner sign-in required."); }
      if (!response.ok || !data.success) throw new Error(data.error ?? "Could not load ledger");
      setRows(data.rows);
      setHeldForReview(data.heldForReview ?? 0);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load ledger"); }
    finally { setBusy(false); }
  }, [date, base]);

  // The Summary and the Payout history always ask for the same dates. Each fails on its own.
  const { from, to } = range;
  const loadRange = useCallback(async () => {
    setRangeBusy(true); setSummaryError(null); setHistoryError(null);
    const answer = async (url: string, fallback: string) => {
      const res = await fetch(url);
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error ?? fallback);
      return body;
    };
    await Promise.all([
      answer(`/api/v1/reports/ledger-summary?from=${from}&to=${to}&commissionBase=${base}`, "Could not load the summary")
        .then((body) => setSummary(body))
        .catch((err) => { setSummary(null); setSummaryError(err instanceof Error ? err.message : "Could not load the summary"); }),
      answer(`/api/v1/reports/payout-history?from=${from}&to=${to}`, "Could not load the payout history")
        .then((body) => setHistory(body))
        .catch((err) => { setHistory(null); setHistoryError(err instanceof Error ? err.message : "Could not load the payout history"); }),
    ]);
    setRangeBusy(false);
  }, [from, to, base]);

  // Slice 22, Decision 12: the same dates as the Summary and the Payout history.
  const loadCustom = useCallback(async () => {
    setCustomBusy(true); setCustomError(null);
    try {
      const res = await fetch(`/api/v1/reports/custom-amounts?from=${from}&to=${to}`);
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error ?? "Could not load the custom amounts");
      setCustomSales(body.sales);
    } catch (err) {
      setCustomSales(null);
      setCustomError(err instanceof Error ? err.message : "Could not load the custom amounts");
    } finally { setCustomBusy(false); }
  }, [from, to]);

  useEffect(() => {
    if (!unlocked) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [unlocked, load]);

  useEffect(() => {
    if (!unlocked) return;
    const timer = window.setTimeout(() => void loadRange(), 0);
    return () => window.clearTimeout(timer);
  }, [unlocked, loadRange]);

  useEffect(() => {
    if (!unlocked) return;
    const timer = window.setTimeout(() => void loadCustom(), 0);
    return () => window.clearTimeout(timer);
  }, [unlocked, loadCustom]);

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
    // The Summary's paid figures and the Payout history show the new entry.
    void loadRange();
    return true;
  }

  async function record(row: LedgerRow) {
    const draft = draftFor(row.barberId);
    const amount = Number(draft?.amount);
    if (!draft || !(amount > 0)) return;
    const note = draft.note.trim();
    const saved = await postEntry(row.barberId, { id: draft.id, method: draft.method, amount, ...(note ? { note } : {}) });
    // The form starts empty after each save; the method stays as it was.
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
    return <OwnerSignInPage title="Payouts" what="view and record barber payouts" submitLabel="Unlock payouts" onSignedIn={() => setUnlocked(true)} />;
  }

  // Inputs: 16px text on phones (no iOS zoom on focus), 44px tall on touch screens.
  const field = "rz-field py-1.5 pointer-coarse:min-h-11 sm:text-sm";
  const dayLabel = date === today ? "today" : `on ${shortDate(date)}`;
  const payRow = rows.find((row) => row.barberId === pickedBarberId) ?? rows.find((row) => Number(row.remaining) > 0) ?? rows[0] ?? null;
  const reload = () => { void load(); void loadRange(); void loadCustom(); };
  const rangeIsToday = range.key === "today";
  const loading = busy || rangeBusy;

  return (
    <main className="flex-1">
      <header className="rz-banner">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3 px-4 sm:px-6 py-3">
          <h1 className="flex items-center gap-2 font-display font-semibold text-base sm:text-lg leading-none uppercase tracking-widest text-bone">
            {/* The station light: it turns while the ledger loads. */}
            <BarberPoleIcon className="w-2.5 h-6" spinning={loading} />
            Payouts
          </h1>
          <button onClick={reload} aria-label="Reload the ledger" title="Reload" className="rz-btn rz-btn-ghost rz-btn-icon -my-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <div className="rz-page max-w-6xl mx-auto p-4 sm:p-6 space-y-8">
        {/* ── 1. Payouts for one business date ── */}
        <section aria-labelledby="payouts-title" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-seam pb-3">
            <div className="space-y-1">
              <h2 id="payouts-title" className="rz-title text-2xl">Daily payouts</h2>
              <p className="text-xs text-dust">One business date at a time. What each barber earned {dayLabel}, what was paid, and what is left.</p>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <label className="flex items-center gap-2 text-sm text-dust">
                Business date <input type="date" value={date} max={today} onChange={(event) => { if (event.target.value) pickDate(event.target.value); }} className={`w-auto ${field}`} />
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
          </div>

          {error && <div role="alert" className="animate-rise rz-notice rz-notice-danger">{error}</div>}
          <p aria-live="polite" className="sr-only">{savedBarberId ? "Payout saved." : ""}</p>
          {heldForReview > 0 && (
            <div className="animate-rise rz-notice rz-notice-warn">
              <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <p>
                {heldForReview} {heldForReview === 1 ? "sale stamped on this date is" : "sales stamped on this date are"} held for date review and not in these totals. Confirm {heldForReview === 1 ? "its" : "their"} date on <Link href="/reconciliation" className="underline hover:text-bone">End-of-Day Cash</Link>.
              </p>
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
            {/* The barbers' cards */}
            <div className="space-y-4 rz-stagger">
              {rows.map((row) => {
                const remaining = Number(row.remaining);
                const picked = payRow?.barberId === row.barberId;
                const cardError = cardErrors[row.barberId];
                return (
                  <section key={row.barberId} aria-label={row.barberName} className={`rz-panel p-4 sm:p-5 space-y-4 transition-shadow ${picked ? "ring-2 ring-bone" : ""}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span aria-hidden="true" className="w-11 h-11 rounded-full bg-panel-2 ring-1 ring-seam-strong flex items-center justify-center font-display font-semibold text-lg text-bone shrink-0">
                          {row.barberName.charAt(0)}
                        </span>
                        <div className="min-w-0">
                          <h3 className="rz-title text-xl truncate">{row.barberName}</h3>
                          <p className="text-xs text-dust tabular-nums">Commission {peso(row.commissionTotal)} · Tips {peso(row.tipTotal)}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-pressed={picked}
                        onClick={() => {
                          setPickedBarberId(row.barberId);
                          // Phones: the form is under the cards.
                          formRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
                        }}
                        className={`rz-btn pointer-coarse:min-h-11 ${picked ? "rz-btn-secondary border-bone" : "rz-btn-secondary"}`}
                      >
                        {picked ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                        {picked ? "In the payout form" : "Pay this barber"}
                      </button>
                    </div>
                    <dl className="rz-strip grid-cols-3">
                      <div>
                        <dt className="rz-label">{date === today ? "Total earned today" : `Total earned on ${shortDate(date)}`}</dt>
                        <dd className="rz-figure mt-1 text-xl sm:text-2xl text-bone tabular-nums">{peso(row.totalOwed)}</dd>
                      </div>
                      <div>
                        <dt className="rz-label">Paid so far</dt>
                        <dd className="rz-figure mt-1 text-xl sm:text-2xl text-bone tabular-nums">{peso(row.paidTotal)}</dd>
                      </div>
                      <div>
                        <dt className="rz-label">Remaining to pay</dt>
                        <dd className={`rz-figure mt-1 text-xl sm:text-2xl tabular-nums transition-colors duration-300 ${remaining > 0 ? "text-warn-ink" : "text-ok-ink"}`}>{peso(row.remaining)}</dd>
                        <dd className={`mt-0.5 flex items-center gap-1 text-xs ${remaining > 0 ? "text-warn-ink" : "text-ok-ink"}`}>
                          {remaining > 0 ? <Clock aria-hidden="true" className="w-3 h-3" /> : <CheckCircle2 aria-hidden="true" className="w-3 h-3" />}
                          {remaining > 0 ? "Still to pay" : Number(row.totalOwed) > 0 ? "Paid in full" : "Nothing owed"}
                        </dd>
                      </div>
                    </dl>
                    {row.additionalOwed && (
                      <div className="rz-notice rz-notice-warn">
                        <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
                        <p>Additional owed: cuts synced or confirmed onto this date after the day was paid in full. The payouts already recorded are unchanged.</p>
                      </div>
                    )}
                    {cardError && <p role="alert" className="animate-rise rz-notice rz-notice-danger">{cardError}</p>}
                    <EntryList
                      row={row}
                      correcting={correcting?.barberId === row.barberId ? correcting : null}
                      saving={savingBarberId === row.barberId}
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

            {/* The one payout form */}
            {payRow && (
              <PayoutForm
                formRef={formRef}
                rows={rows}
                row={payRow}
                date={date}
                today={today}
                draft={draftFor(payRow.barberId) ?? { id: "", amount: "", method: "CASH", note: "" }}
                saving={savingBarberId === payRow.barberId}
                saved={savedBarberId === payRow.barberId}
                error={cardErrors[payRow.barberId]}
                field={field}
                onPick={setPickedBarberId}
                onEdit={(change) => editDraft(payRow.barberId, change)}
                onSubmit={() => void record(payRow)}
              />
            )}
          </div>
          <p className="text-xs text-dust flex items-start gap-1.5"><Scissors className="w-3.5 h-3.5 mt-px shrink-0" />Each payout is kept as its own entry and is never edited; a mistake is fixed with a correction beside it. Cash payouts come out of expected drawer cash when recorded.</p>

        </section>

        {/* ── 2 and 3. The Summary and the Payout history, over one range ── */}
        <section aria-labelledby="range-title" className="space-y-4">
          <div className="space-y-3 border-b border-seam pb-3">
            <div className="space-y-1">
              <h2 id="range-title" className="rz-title text-2xl">Summary and payout history</h2>
              <p className="text-xs text-dust">Both show the same dates. A period is the sum of its days; the payout cards above stay on their one business date.</p>
            </div>
            <DateRangeBar options={rangeOptions} selected={range.key} onSelect={setRangeKey} today={today} onCustom={(option) => { setCustomRange(option); setRangeKey(option.key); }} label="Dates for the summary, the payout history and the custom amounts" busy={rangeBusy} />
          </div>

          {summaryError ? (
            <div role="alert" className="animate-rise rz-notice rz-notice-danger">Summary: {summaryError}</div>
          ) : summary ? (
            <SummarySection summary={summary} />
          ) : (
            <SectionSkeleton title="Summary" />
          )}

          {historyError ? (
            <div role="alert" className="animate-rise rz-notice rz-notice-danger">Payout history: {historyError}</div>
          ) : history ? (
            <PayoutHistorySection history={history} rangeIsToday={rangeIsToday} onResetRange={resetRange} />
          ) : (
            <SectionSkeleton title="Payout history" />
          )}

          <CustomAmountsSection range={{ from, to }} sales={customSales} error={customError} busy={customBusy} rangeIsToday={rangeIsToday} onResetRange={resetRange} />
        </section>
      </div>
    </main>
  );
}

// A negative amount (the discounts line) reads -₱125.00, with thousands separators (lib/peso.ts).
const peso = (value: string) => pesoText(Number(value));
const shortDate = (iso: string) => new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

function SectionSkeleton({ title }: { title: string }) {
  return (
    <section className="rz-panel p-4 sm:p-5 space-y-4">
      <h3 className="rz-title text-xl">{title}</h3>
      <div role="status" className="space-y-2.5">
        <span className="sr-only">Loading…</span>
        {[88, 72, 80, 60].map((width) => <div key={width} aria-hidden="true" className="rz-skeleton h-5" style={{ width: `${width}%` }} />)}
      </div>
    </section>
  );
}

// The one payout form, for the barber picked on a card (or in its own list). The amount starts
// empty; "Full balance" fills what is still owed. The rules are the route's: a payout above what
// is owed is refused there, and a repeated tap is one entry (the draft's id, the submit lock).
function PayoutForm({ formRef, rows, row, date, today, draft, saving, saved, error, field, onPick, onEdit, onSubmit }: {
  formRef: React.RefObject<HTMLFormElement | null>;
  rows: LedgerRow[];
  row: LedgerRow;
  date: string;
  today: string;
  draft: Draft;
  saving: boolean;
  saved: boolean;
  error: string | undefined;
  field: string;
  onPick: (barberId: string) => void;
  onEdit: (change: Partial<Omit<Draft, "id">>) => void;
  onSubmit: () => void;
}) {
  const remaining = Number(row.remaining);
  const amount = Number(draft.amount);
  const drawerDay = date === today ? "today's" : `${shortDate(date)}'s`;
  return (
    <form
      ref={formRef}
      onSubmit={(event) => { event.preventDefault(); onSubmit(); }}
      aria-labelledby="payout-form-title"
      className="rz-panel p-4 sm:p-5 space-y-4 scroll-mt-20 lg:sticky lg:top-20"
    >
      <div className="space-y-1">
        <h3 id="payout-form-title" className="rz-title text-xl">Record a payout</h3>
        <p className="text-xs text-dust">For {date === today ? "today" : shortDate(date)}. One entry per payout.</p>
      </div>
      <label className="block text-[0.8125rem] font-medium text-bone-2">
        Barber
        <select value={row.barberId} onChange={(event) => onPick(event.target.value)} className={`mt-1.5 w-full ${field}`}>
          {rows.map((option) => <option key={option.barberId} value={option.barberId}>{option.barberName}</option>)}
        </select>
      </label>
      <div className="rz-well flex items-baseline justify-between gap-3 px-3 py-2.5 text-sm">
        <span className="text-dust">Remaining to pay</span>
        <span className={`rz-figure text-lg tabular-nums ${remaining > 0 ? "text-warn-ink" : "text-ok-ink"}`}>{peso(row.remaining)}</span>
      </div>
      <div>
        <label htmlFor="payout-amount" className="block text-[0.8125rem] font-medium text-bone-2">Payout amount</label>
        <div className="mt-1.5 flex gap-2">
          <input
            id="payout-amount"
            type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="0.00"
            value={draft.amount}
            onChange={(event) => onEdit({ amount: event.target.value })}
            className={`flex-1 min-w-0 ${field}`}
          />
          <button type="button" disabled={!(remaining > 0)} onClick={() => onEdit({ amount: row.remaining })} className="rz-btn rz-btn-secondary shrink-0 pointer-coarse:min-h-11">
            Full balance
          </button>
        </div>
      </div>
      <div>
        <div role="radiogroup" aria-label="Paid by" className="grid grid-cols-2 gap-1 p-1 rounded-[10px] bg-well border border-seam">
          {(["CASH", "GCASH"] as const).map((method) => (
            <button
              key={method} type="button" role="radio" aria-checked={draft.method === method}
              onClick={() => onEdit({ method })}
              className={`min-h-9 pointer-coarse:min-h-11 px-3 inline-flex items-center justify-center gap-1.5 rounded-lg text-sm transition-colors ${draft.method === method ? "bg-seg-on text-bone ring-1 ring-seam-strong rz-shadow-card" : "text-dust hover:text-bone"}`}
            >
              {method === "CASH" ? <Banknote aria-hidden="true" className="w-4 h-4 text-cash" /> : <Smartphone aria-hidden="true" className="w-4 h-4 text-gcash" />}
              {method === "CASH" ? "Cash" : "GCash"}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-dust leading-relaxed">
          {draft.method === "CASH"
            ? `Cash comes out of the drawer: ${drawerDay} expected drawer cash goes down by this amount as soon as it is recorded.`
            : "GCash never comes out of the drawer: expected drawer cash does not change."}
        </p>
      </div>
      <label className="block text-[0.8125rem] font-medium text-bone-2">
        Note <span className="font-normal text-dust">(optional)</span>
        <input type="text" maxLength={200} value={draft.note} onChange={(event) => onEdit({ note: event.target.value })} className={`mt-1.5 w-full ${field}`} />
      </label>
      <button
        disabled={saving || !(amount > 0)}
        className={`rz-btn w-full min-h-11 ${saved ? "rz-btn-secondary border-ok/45 text-ok-ink" : "rz-btn-primary"}`}
      >
        {saved ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}{saving ? "Saving…" : saved ? "Recorded" : "Record payout"}
      </button>
      {error && <p role="alert" className="animate-rise rz-notice rz-notice-danger">{error}</p>}
    </form>
  );
}

// One figure on the summary: the label (and a note under it on phones), the amount on the right.
// A total sits under a stronger rule, like the table totals.
function Line({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 ${strong ? "mt-1 pt-2.5 border-t border-seam-hover font-semibold text-bone" : "text-bone-2"}`}>
      <span className="min-w-0">
        {label}
        {note && <span className="block sm:inline sm:ml-2 text-[0.6875rem] font-normal text-dust">{note}</span>}
      </span>
      <span className="tabular-nums shrink-0">{value}</span>
    </div>
  );
}

// Slices 10 and 20: money in, money out and what is left, for the chosen dates.
function SummarySection({ summary }: { summary: Summary }) {
  const oneDay = summary.from === summary.to;
  const { sales, shared, payouts } = summary;
  return (
    <section className="animate-rise rz-panel p-4 sm:p-5 space-y-5 text-sm">
      <div className="space-y-1">
        <h3 className="rz-title text-xl">Summary</h3>
        <p className="text-xs text-dust tabular-nums">{rangeText(summary.from, summary.to)} · {sales.count} paid {sales.count === 1 ? "sale" : "sales"}</p>
      </div>
      {sales.count === 0 && <p className="rz-notice">No paid sales on these dates.</p>}
      <div className="grid gap-5 md:grid-cols-2 md:gap-x-8">
        <div>
          <h4 className="rz-label mb-1">Money in</h4>
          <Line label="Cash" value={peso(sales.cash)} />
          <Line label="GCash" value={peso(sales.gcash)} note="not in the drawer" />
          <Line label="Maya" value={peso(sales.maya)} note="not in the drawer" />
          {Number(sales.qrph) > 0 && <Line label="QR Ph" value={peso(sales.qrph)} note="not in the drawer" />}
          <Line label="Total revenue" value={peso(sales.total)} strong />
        </div>
        <div>
          <h4 className="rz-label mb-1">Shared out</h4>
          <Line label="Barber commissions" value={peso(shared.commissions)} />
          <Line label="Tips (100% to the barber, not in revenue)" value={peso(shared.tips)} />
          <Line
            label="Petty cash"
            value={peso(shared.pettyCash)}
            note={shared.pettyCashRecorded ? undefined : oneDay ? "Not recorded yet (End-of-Day Cash)" : `${summary.pettyCashMissingDays} ${summary.pettyCashMissingDays === 1 ? "day has" : "days have"} no End-of-Day Cash saved`}
          />
          <Line label="Left for the shop" value={peso(summary.leftForShop)} note="before the owner's own costs" strong />
        </div>
        <div>
          <h4 className="rz-label mb-1">Barber payouts</h4>
          <Line label="Owed (commission + tips)" value={peso(payouts.owed)} />
          <Line label="Recorded as paid" value={peso(payouts.paid)} />
          <Line label="Still to pay" value={peso(payouts.remaining)} strong />
        </div>
        <div>
          <h4 className="rz-label mb-1">By service</h4>
          {summary.services.length === 0 ? (
            <p className="py-1.5 text-dust">No sales in this period.</p>
          ) : (
            <>
              {/* Slice 23: a service's menu-price value, not money collected; a sale with several services adds an item to each. */}
              {summary.services.map((row) => <Line key={row.name} label={row.name} note={`${row.count} ${row.count === 1 ? "item" : "items"}, at menu price`} value={peso(row.listSales)} />)}
              {Number(summary.serviceGap) !== 0 && <Line label="Discounts" value={peso(summary.serviceGap)} note="services are at menu price, so they differ from total revenue" />}
            </>
          )}
        </div>
        {summary.days.length > 0 && (
          <div className="md:col-span-2">
            <h4 className="rz-label mb-1">Day by day</h4>
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

// Slice 20, shown by slice 21c: what each barber was owed and paid on each date of the range,
// days newest first, with every entry. Read-only: payouts and corrections are recorded on the
// cards above, for one business date. Owed is at list price, whatever base the cards show.
function PayoutHistorySection({ history, rangeIsToday, onResetRange }: { history: History; rangeIsToday: boolean; onResetRange: () => void }) {
  const { totals } = history;
  // Slice 22, Decision 9: the days are paged on the screen; the totals above them cover every day.
  const list = usePagedList("ledger-payout-history", history.days);
  const showing = showingText([], { from: history.from, to: history.to });
  return (
    <section className="animate-rise rz-panel p-4 sm:p-5 space-y-4 text-sm">
      <div className="space-y-1">
        <h3 className="rz-title text-xl">Payout history</h3>
        <p className="text-xs text-dust tabular-nums">{rangeText(history.from, history.to)} · read-only · owed at list price, from the sales themselves</p>
      </div>
      <ShowingLine text={showing.text} filtered={false} canReset isDefault={rangeIsToday && list.isDefault} onReset={() => { onResetRange(); list.reset(); }} />
      <dl className="rz-strip grid-cols-3">
        <div>
          <dt className="rz-label">Owed</dt>
          <dd className="rz-figure mt-1 text-lg sm:text-xl text-bone tabular-nums">{peso(totals.owed)}</dd>
        </div>
        <div>
          <dt className="rz-label">Paid</dt>
          <dd className="rz-figure mt-1 text-lg sm:text-xl text-bone tabular-nums">{peso(totals.paid)}</dd>
        </div>
        <div>
          <dt className="rz-label">Remaining</dt>
          <dd className={`rz-figure mt-1 text-lg sm:text-xl tabular-nums ${Number(totals.remaining) > 0 ? "text-warn-ink" : "text-ok-ink"}`}>{peso(totals.remaining)}</dd>
          <dd className="mt-0.5 text-xs text-dust">added up day by day</dd>
        </div>
      </dl>
      {history.heldForReview > 0 && (
        <p className="rz-notice rz-notice-warn">
          <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {history.heldForReview} {history.heldForReview === 1 ? "sale stamped on these dates is" : "sales stamped on these dates are"} held for date review and not in these figures. Confirm {history.heldForReview === 1 ? "its" : "their"} date on <Link href="/reconciliation" className="underline hover:text-bone">End-of-Day Cash</Link>.
          </span>
        </p>
      )}
      {totals.additionalOwedDays > 0 && (
        <p className="rz-notice rz-notice-warn">
          <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Additional owed on {totals.additionalOwedDays} barber-{totals.additionalOwedDays === 1 ? "day" : "days"}: more sales counted after the day was paid in full. They are marked below.</span>
        </p>
      )}
      {history.days.length === 0 ? (
        <p className="rz-notice">No paid sales and no payouts on these dates.</p>
      ) : (
        <div className="space-y-5">
          {list.shown.items.map((day) => (
            <div key={day.date} className="space-y-2">
              <h4 className="rz-heading text-bone">{rangeText(day.date, day.date)}</h4>
              <div className="overflow-x-auto">
                <table className="rz-table min-w-136 text-[0.8125rem]">
                  <thead>
                    <tr>
                      <th className="text-left">Barber</th>
                      <th className="text-right">Commission</th>
                      <th className="text-right">Tips</th>
                      <th className="text-right">Owed</th>
                      <th className="text-right">Paid</th>
                      <th className="text-right">Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.barbers.map((barber) => (
                      <tr key={barber.barberId} className="align-top">
                        <td className="text-bone">
                          <span className="font-semibold">{barber.barberName}</span>
                          {!barber.active && <span className="ml-2 text-xs text-dust">inactive</span>}
                          {barber.additionalOwed && (
                            <span className="ml-2 rz-pill rz-pill-warn"><TriangleAlert aria-hidden="true" className="w-3 h-3" />Additional owed</span>
                          )}
                          <HistoryEntries entries={barber.entries} />
                        </td>
                        <td className="text-right text-bone-2">{peso(barber.commission)}</td>
                        <td className="text-right text-bone-2">{peso(barber.tips)}</td>
                        <td className="text-right text-bone">{peso(barber.owed)}</td>
                        <td className="text-right text-bone">{peso(barber.paid)}</td>
                        <td className={`text-right font-semibold ${Number(barber.remaining) > 0 ? "text-warn-ink" : "text-ok-ink"}`}>{peso(barber.remaining)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <PagedControls list={list} label="Payout history pages" />
        </div>
      )}
    </section>
  );
}

// The entries behind a history row's "Paid": time, method, kind, note and signed amount.
function HistoryEntries({ entries }: { entries: Entry[] }) {
  if (entries.length === 0) return <p className="mt-1 text-xs font-normal text-dust">No payouts recorded.</p>;
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return (
    <ul className="mt-1.5 space-y-1 text-xs font-normal text-dust">
      {entries.map((entry) => {
        const target = entry.correctsId ? byId.get(entry.correctsId) : undefined;
        return (
          <li key={entry.id} className="break-words">
            <span className="tabular-nums">{manilaStamp(entry.recordedAt)}</span> · {methodName(entry.method)}
            {entry.kind === "OPENING" && " · saved before entries"}
            {entry.kind === "CORRECTION" && ` · correction${target ? ` of the ${manilaTime(target.recordedAt)} payout` : ""}`}
            {" · "}<span className="tabular-nums text-bone-2">{peso(entry.amount)}</span>
            {entry.note && <span> · {entry.note}</span>}
          </li>
        );
      })}
    </ul>
  );
}

const PAYMENT_NAMES: Record<string, string> = { CASH: "Cash", GCASH: "GCash", MAYA: "Maya", QRPH: "QR Ph" };
const STATUS_NAMES: Record<string, string> = { PENDING: "Payment pending" };
// DEFAULT_CUSTOM_NOTE is what the POS stores when a custom amount has no note.
const noteText = (note: string | null) => (!note?.trim() || note.trim() === DEFAULT_CUSTOM_NOTE ? "(no note)" : note);

// Slice 16, Decision 4: custom amounts skip the server's price check, so the owner sees each one
// here, over the range under the range bar (slice 22, Decision 12). Text only (the note is typed
// by a barber; React escapes it). The commission is the stored snapshot; the base toggle doesn't change it.
function CustomAmountsSection({ range, sales, error, busy, rangeIsToday, onResetRange }: {
  range: { from: string; to: string }; sales: CustomSale[] | null; error: string | null; busy: boolean; rangeIsToday: boolean; onResetRange: () => void;
}) {
  const list = usePagedList("ledger-custom-amounts", sales ?? []);
  const showing = showingText([], range);
  const oneDay = range.from === range.to;
  return (
    <section className="rz-panel p-4 sm:p-5 space-y-3 text-sm">
      <div className="space-y-1">
        <h3 className="rz-title text-xl">Custom amounts</h3>
        <p className="text-xs text-dust">
          Sales with a typed amount instead of the menu price; each shows the commission recorded when it synced.
        </p>
      </div>
      <ShowingLine text={showing.text} filtered={false} canReset isDefault={rangeIsToday && list.isDefault} onReset={() => { onResetRange(); list.reset(); }} />
      {error ? (
        <p role="alert" className="rz-notice rz-notice-danger">Custom amounts: {error}</p>
      ) : sales === null ? (
        <p className="text-dust">{busy ? "Loading…" : "Not loaded."}</p>
      ) : sales.length === 0 ? (
        <p className="text-dust">No custom amounts on these dates.</p>
      ) : (
        <>
        <ul className="divide-y divide-seam">
          {list.shown.items.map((sale) => (
            <li key={sale.id} className="py-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-bone-2 break-words">
                  <span className="tabular-nums">{oneDay ? manilaTime(sale.time) : manilaStamp(sale.time)}</span> · {sale.barberName} · {sale.serviceName ?? "Unknown service"}
                </p>
                <p className="text-xs text-dust break-words">{noteText(sale.note)}</p>
                <p className="text-xs text-dust tabular-nums break-words">
                  {PAYMENT_NAMES[sale.paymentMethod] ?? sale.paymentMethod}
                  {sale.paymentStatus !== "PAID" && <> · {STATUS_NAMES[sale.paymentStatus] ?? sale.paymentStatus}</>}
                  {" "}· Commission recorded {peso(sale.commission)}
                  {sale.menuPriceNow !== null && <> · Menu price now {peso(sale.menuPriceNow)}</>}
                </p>
              </div>
              <span className="tabular-nums text-bone shrink-0">{peso(sale.amountPaid)}</span>
            </li>
          ))}
        </ul>
        <PagedControls list={list} label="Custom amounts pages" />
        </>
      )}
    </section>
  );
}

// Recorded times on the Manila clock, whatever the device's zone.
const manilaTime = (iso: string) => new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(iso));
// A history entry may be recorded on a later day than the date it pays for, so it shows its day too.
const manilaStamp = (iso: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(iso));
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
      <h4 className="rz-label mb-1">Payouts recorded</h4>
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
                <form onSubmit={(event) => { event.preventDefault(); onSave(); }} className="rz-well p-3 space-y-3">
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

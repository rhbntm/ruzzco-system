"use client";

// Slice 22a: the owner's Sales page. From the top: the range bar, the filters, the Showing line
// with Reset to default, the totals strip, the list (a table on a wide screen, a card per sale on
// a phone) and the pager. Read-only. The range, filters and page size are kept in this browser
// (lib/list-settings.ts); the page number never is.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { manilaToday } from "@/lib/business-date";
import { peso } from "@/lib/peso";
import { SALES_PAGE_SIZE } from "@/lib/paginate";
import {
  clearListSettings, isDefault, keepRange, readListSettings, resolveKeptRange, showingText, validChoice, validPageSize,
  writeListSettings, type ShowingFilter,
} from "@/lib/list-settings";
import { DateRangeBar, presetOptions, type RangeOption } from "@/components/DateRangeBar";
import { OwnerSignInPage } from "@/components/OwnerSignIn";
import { Pager } from "@/components/Pager";
import { ShowingLine } from "@/components/ShowingLine";

type Option = { id: string; name: string };
type Sale = {
  id: string; time: string; countsOn: string | null; listedOn: string; barberName: string; serviceName: string | null;
  amountPaid: string; listPrice: string | null; discount: string; tip: string; paymentMethod: string; paymentStatus: string;
  paymentReference: string | null; customAmount: boolean; customAmountNote: string | null; loyalty: boolean; commission: string;
  commissionRate: string; commissionBase: string; receivedAt: string; account: string | null; timeFlag: string | null;
  timeReview: string | null; counted: boolean;
};
type Answer = {
  page: number; pageCount: number; pageSize: number;
  totals: { count: number; paidCount: number; amountPaid: string; tips: string; commission: string; notCounted: number };
  sales: Sale[];
};

type Settings = { range: ReturnType<typeof keepRange>; barberId: string; method: string; status: string; serviceId: string; kind: string; pageSize: number };
const KEY = "sales";
const METHOD_LABELS: Record<string, string> = { CASH: "Cash", GCASH: "GCash", MAYA: "Maya", QRPH: "QR Ph" };
const STATUS_LABELS: Record<string, string> = { PAID: "Paid", PENDING: "Pending", EXPIRED: "Expired", FAILED: "Failed" };
const KIND_LABELS: Record<string, string> = { all: "All", custom: "Custom amount", loyalty: "Loyalty discount" };
const DEFAULT_FILTERS = { barberId: "all", method: "all", status: "all", serviceId: "all", kind: "all" };

const manilaTime = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const day = (date: string) =>
  new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

export function SalesList({ isOwner, barbers, services }: { isOwner: boolean; barbers: Option[]; services: Option[] }) {
  const router = useRouter();
  if (!isOwner) {
    return <OwnerSignInPage title="Sales" what="see the sales" submitLabel="Unlock" onSignedIn={() => router.refresh()} />;
  }
  return <SalesPanel barbers={barbers} services={services} />;
}

function SalesPanel({ barbers, services }: { barbers: Option[]; services: Option[] }) {
  const today = useMemo(() => manilaToday(), []);
  const presets = useMemo(() => presetOptions(today), [today]);
  const [ready, setReady] = useState(false);
  const [range, setRange] = useState<RangeOption>(presets[0]);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [pageSize, setPageSize] = useState<number>(SALES_PAGE_SIZE);
  const [page, setPage] = useState(1); // never kept: a list opens on page 1
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const latest = useRef(0);

  // Kept settings, read once after mount (never during render: the server has no storage).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const defaults: Settings = { range: { preset: "today" }, ...DEFAULT_FILTERS, pageSize: SALES_PAGE_SIZE };
      const kept = readListSettings<Settings>(KEY, defaults, (raw, d) => {
        const resolved = resolveKeptRange(raw.range, today);
        setRange(resolved.key === "custom" ? { key: "custom", label: "Custom", from: resolved.from, to: resolved.to } : presets.find((p) => p.key === resolved.key) ?? presets[0]);
        return {
          range: d.range,
          barberId: validChoice(raw.barberId, barbers.map((b) => b.id)),
          method: validChoice(raw.method, Object.keys(METHOD_LABELS)),
          status: validChoice(raw.status, Object.keys(STATUS_LABELS)),
          serviceId: validChoice(raw.serviceId, services.map((s) => s.id)),
          kind: validChoice(raw.kind, ["custom", "loyalty"]),
          pageSize: validPageSize(raw.pageSize, SALES_PAGE_SIZE),
        };
      });
      setFilters({ barberId: kept.barberId, method: kept.method, status: kept.status, serviceId: kept.serviceId, kind: kept.kind });
      setPageSize(kept.pageSize);
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [today, presets, barbers, services]);

  const settings = useMemo<Settings>(() => ({ range: keepRange(range), ...filters, pageSize }), [range, filters, pageSize]);
  const atDefault = isDefault(
    { rangeKey: range.key, ...filters, pageSize },
    { rangeKey: "today", ...DEFAULT_FILTERS, pageSize: SALES_PAGE_SIZE }
  );

  useEffect(() => {
    if (ready) writeListSettings(KEY, settings);
  }, [ready, settings]);

  const load = useCallback(async () => {
    const token = ++latest.current;
    setBusy(true); setError(null);
    const query = new URLSearchParams({ from: range.from, to: range.to, page: String(page), pageSize: String(pageSize) });
    if (filters.barberId !== "all") query.set("barberId", filters.barberId);
    if (filters.method !== "all") query.set("method", filters.method);
    if (filters.status !== "all") query.set("status", filters.status);
    if (filters.serviceId !== "all") query.set("serviceId", filters.serviceId);
    if (filters.kind !== "all") query.set("kind", filters.kind);
    try {
      const res = await fetch(`/api/v1/reports/sales?${query}`, { cache: "no-store" });
      const body = await res.json();
      if (token !== latest.current) return;
      if (res.status === 401) { setError("Owner sign-in required."); return; }
      if (!res.ok || !body.success) throw new Error(body.error ?? "Could not load the sales");
      setAnswer(body);
      if (body.page !== page) setPage(body.page); // a list that shrank shows the nearest page
    } catch (err) {
      if (token === latest.current) setError(err instanceof Error ? err.message : "Could not load the sales");
    } finally {
      if (token === latest.current) setBusy(false);
    }
  }, [range, filters, page, pageSize]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [ready, load]);

  const setFilter = (name: keyof typeof DEFAULT_FILTERS, value: string) => { setFilters((f) => ({ ...f, [name]: value })); setPage(1); };
  const options = useMemo(() => {
    const withCustom = range.key === "custom" ? [...presets, range] : presets;
    return withCustom;
  }, [presets, range]);

  function reset() {
    clearListSettings(KEY);
    setRange(presets[0]); setFilters(DEFAULT_FILTERS); setPageSize(SALES_PAGE_SIZE); setPage(1); setOpen(null);
  }

  const nameOf = (list: Option[], id: string) => list.find((o) => o.id === id)?.name ?? id;
  const showing: ShowingFilter[] = [
    { label: "Barber", value: filters.barberId === "all" ? null : nameOf(barbers, filters.barberId), allText: "all barbers" },
    { label: "Method", value: filters.method === "all" ? null : METHOD_LABELS[filters.method], allText: "all methods" },
    { label: "Status", value: filters.status === "all" ? null : STATUS_LABELS[filters.status], allText: "all statuses" },
    { label: "Service", value: filters.serviceId === "all" ? null : nameOf(services, filters.serviceId), allText: "all services" },
    { label: "Kind", value: filters.kind === "all" ? null : KIND_LABELS[filters.kind], allText: "all kinds" },
  ];
  // By default the line names the first three (all barbers · all methods · all statuses); once any
  // filter is set, only those that differ from All are named (showingText).
  const anySet = showing.some((f) => f.value !== null);
  const { text, filtered } = showingText(anySet ? showing : showing.slice(0, 3), { from: range.from, to: range.to });
  const field = "rz-field w-full py-1.5 pointer-coarse:min-h-11 sm:text-sm";
  const totals = answer?.totals;

  return (
    <main className="flex-1">
      <div className="rz-page max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
        <header className="space-y-1">
          <h1 className="rz-title text-3xl">Sales</h1>
          <p className="text-sm text-dust">Every sale on the chosen dates, newest first. Totals count paid sales only.</p>
        </header>

        {/* Dates and filters: one panel, so what narrows the list sits together. */}
        <section aria-label="Dates and filters" className="rz-panel p-4 sm:p-5 space-y-4">
          <div className="space-y-2">
            <h2 className="rz-label">Dates</h2>
            <DateRangeBar
              options={options}
              selected={range.key}
              onSelect={(key) => { const next = options.find((o) => o.key === key); if (next) { setRange(next); setPage(1); } }}
              label="Dates for the sales"
              busy={busy}
              today={today}
              onCustom={(option) => { setRange(option); setPage(1); }}
            />
          </div>
          <div className="space-y-2 border-t border-seam pt-4">
            <h2 className="rz-label">Filters</h2>
            <div className="grid grid-cols-1 min-[30rem]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-x-3 gap-y-4">
              <Select label="Barber" value={filters.barberId} onChange={(v) => setFilter("barberId", v)} className={field}
                options={[["all", "All"], ...barbers.map((b) => [b.id, b.name] as [string, string])]} />
              <Select label="Payment method" value={filters.method} onChange={(v) => setFilter("method", v)} className={field}
                options={[["all", "All"], ...Object.entries(METHOD_LABELS)]} />
              <Select label="Status" value={filters.status} onChange={(v) => setFilter("status", v)} className={field}
                options={[["all", "All"], ...Object.entries(STATUS_LABELS)]} />
              <Select label="Service" value={filters.serviceId} onChange={(v) => setFilter("serviceId", v)} className={field}
                options={[["all", "All"], ...services.map((s) => [s.id, s.name] as [string, string])]} />
              <Select label="Kind" value={filters.kind} onChange={(v) => setFilter("kind", v)} className={field}
                options={Object.entries(KIND_LABELS)} />
            </div>
          </div>
        </section>

        {/* What is applied, then the totals it produces. */}
        <section aria-label="Results" className="space-y-3">
          <ShowingLine text={text} filtered={filtered} canReset isDefault={atDefault} onReset={reset} />
          {error && <p role="alert" className="rz-notice rz-notice-danger">{error}</p>}

          {totals && (
            <div className="space-y-2">
              <h2 className="rz-heading">{filtered ? "Filtered totals" : "Totals"}</h2>
              <div className="rz-strip grid-cols-2 sm:grid-cols-4">
                <div className="col-span-2 sm:col-span-1 space-y-1 p-4 sm:border-r sm:border-seam">
                  <div className="rz-label">Amount paid</div>
                  <div className="rz-figure text-3xl text-bone">{peso(Number(totals.amountPaid))}</div>
                  <div className="text-xs text-dust">{totals.paidCount} paid {totals.paidCount === 1 ? "sale" : "sales"}</div>
                </div>
                <Stat label="Tips" value={peso(Number(totals.tips))} />
                <Stat label="Barber commission" value={peso(Number(totals.commission))} />
                <Stat label="Sales listed" value={String(totals.count)} />
              </div>
              {totals.notCounted > 0 && (
                <p className="text-xs text-dust">{totals.notCounted} of the listed sales {totals.notCounted === 1 ? "is" : "are"} not counted (not paid, or the time is under review).</p>
              )}
            </div>
          )}
        </section>

        {answer && answer.sales.length === 0 && <p className="rz-notice">No sales match these dates and filters.</p>}

        {answer && answer.sales.length > 0 && (
          <section aria-label="Sales" className="space-y-3">
            <div className="hidden md:block rz-panel overflow-x-auto">
              <table className="rz-table [&_th]:px-3 [&_th]:py-3 [&_th]:text-xs [&_th]:font-bold [&_th]:text-bone-2 [&_td]:px-3 [&_td]:py-3.5">
                <thead className="bg-panel-2 border-b border-seam-strong">
                  <tr className="text-left">
                    <th className="!pl-4">Time</th><th>Barber</th><th>Service</th>
                    <th className="text-right">Paid</th><th className="text-right">Tip</th><th>Method</th><th>Status</th><th>Counts on</th><th className="!pr-4"><span className="sr-only">Details</span></th>
                  </tr>
                </thead>
                <tbody>
                  {answer.sales.map((sale) => (
                    <SaleRows key={sale.id} sale={sale} open={open === sale.id} onToggle={() => setOpen(open === sale.id ? null : sale.id)} />
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="md:hidden space-y-2">
              {answer.sales.map((sale) => (
                <li key={sale.id} className="rz-panel overflow-hidden">
                  <button type="button" className="w-full text-left p-3.5 space-y-2 pointer-coarse:min-h-11" aria-expanded={open === sale.id} onClick={() => setOpen(open === sale.id ? null : sale.id)}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-bone truncate">{sale.serviceName ?? "Sale"}</div>
                        <div className="text-xs text-dust truncate">{sale.barberName} · {manilaTime(sale.time)}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="rz-figure text-lg text-bone">{peso(Number(sale.amountPaid))}</div>
                        {Number(sale.tip) > 0 && <div className="text-xs text-dust tabular-nums">+ {peso(Number(sale.tip))} tip</div>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <MethodPill method={sale.paymentMethod} />
                      <StatusPill status={sale.paymentStatus} />
                      <Marks sale={sale} />
                    </div>
                  </button>
                  {open === sale.id && <div className="bg-well border-t border-seam p-3.5"><Details sale={sale} /></div>}
                </li>
              ))}
            </ul>
            <Pager page={answer.page} pageCount={answer.pageCount} pageSize={pageSize} total={answer.totals.count}
              onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} label="Sales pages" />
          </section>
        )}
      </div>
    </main>
  );
}

function Select({ label, value, onChange, options, className }: {
  label: string; value: string; onChange: (value: string) => void; options: [string, string][]; className: string;
}) {
  return (
    <label className="block text-xs text-dust space-y-1 min-w-0">
      <span className="block">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
        {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1 p-4">
      <div className="rz-label">{label}</div>
      <div className="rz-figure text-xl text-bone-2">{value}</div>
    </div>
  );
}

const METHOD_PILL: Record<string, string> = { CASH: "rz-pill-cash", GCASH: "rz-pill-gcash", MAYA: "rz-pill-maya", QRPH: "rz-pill-qrph" };
const STATUS_PILL: Record<string, string> = { PAID: "rz-pill-ok", PENDING: "rz-pill-warn", EXPIRED: "", FAILED: "rz-pill-danger" };

function MethodPill({ method }: { method: string }) {
  return <span className={`rz-pill ${METHOD_PILL[method] ?? ""}`}>{METHOD_LABELS[method] ?? method}</span>;
}
function StatusPill({ status }: { status: string }) {
  return <span className={`rz-pill ${STATUS_PILL[status] ?? ""}`}>{STATUS_LABELS[status] ?? status}</span>;
}

function Marks({ sale }: { sale: Sale }) {
  if (!sale.customAmount && !sale.loyalty && sale.timeReview !== "UNDER_REVIEW") return null;
  return (
    <>
      {sale.customAmount && <span className="rz-pill">Custom amount</span>}
      {sale.loyalty && <span className="rz-pill">Loyalty</span>}
      {sale.timeReview === "UNDER_REVIEW" && <span className="rz-pill rz-pill-warn">Time under review</span>}
    </>
  );
}

function SaleRows({ sale, open, onToggle }: { sale: Sale; open: boolean; onToggle: () => void }) {
  const hasMarks = sale.customAmount || sale.loyalty || sale.timeReview === "UNDER_REVIEW";
  return (
    <>
      <tr className="border-t border-seam hover:bg-hover cursor-pointer align-top" onClick={onToggle}>
        <td className="!pl-4 whitespace-nowrap text-bone-2">{manilaTime(sale.time)}</td>
        <td className="text-bone-2">{sale.barberName}</td>
        <td className="text-bone font-medium">
          {sale.serviceName ?? "—"}
          {hasMarks && <div className="flex flex-wrap gap-1 mt-1 font-normal"><Marks sale={sale} /></div>}
        </td>
        <td className="text-right tabular-nums font-semibold text-bone">{peso(Number(sale.amountPaid))}</td>
        <td className="text-right tabular-nums text-dust">{Number(sale.tip) > 0 ? peso(Number(sale.tip)) : "—"}</td>
        <td><MethodPill method={sale.paymentMethod} /></td>
        <td><StatusPill status={sale.paymentStatus} /></td>
        <td className="whitespace-nowrap text-xs text-dust">{sale.countsOn ? day(sale.countsOn) : "Not counted"}</td>
        <td className="!pr-4 text-right">
          <button type="button" aria-expanded={open} aria-label={`Details of the ${sale.serviceName ?? "sale"} at ${manilaTime(sale.time)}`} onClick={(e) => { e.stopPropagation(); onToggle(); }} className="rz-link text-xs">
            {open ? "Hide" : "Details"}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="bg-well"><td colSpan={9} className="px-4 py-3.5"><Details sale={sale} /></td></tr>
      )}
    </>
  );
}

function Details({ sale }: { sale: Sale }) {
  const flag = sale.timeFlag
    ? `${sale.timeFlag}${sale.timeReview === "UNDER_REVIEW" ? " (not reviewed yet)" : sale.timeReview ? ` (reviewed: ${sale.timeReview === "STATED_DATE" ? "stated date" : "received date"})` : ""}`
    : "None";
  const groups: { title: string; rows: [string, string][] }[] = [
    {
      title: "Money",
      rows: [
        ["List price", sale.listPrice ? peso(Number(sale.listPrice)) : "—"],
        ["Discount", Number(sale.discount) > 0 ? peso(Number(sale.discount)) : "None"],
        ["Commission (snapshot)", `${peso(Number(sale.commission))} (${Number(sale.commissionRate)}% of ${sale.commissionBase === "LIST_PRICE" ? "list price" : "amount paid"})`],
        ["Custom amount note", sale.customAmount ? sale.customAmountNote ?? "—" : "—"],
        ["Payment reference", sale.paymentReference ?? "—"],
      ],
    },
    {
      title: "Timing",
      rows: [
        ["Counts on", sale.countsOn ? day(sale.countsOn) : `No day yet (listed on ${day(sale.listedOn)})`],
        ["Received by the PC", manilaTime(sale.receivedAt)],
        ["Time flag", flag],
      ],
    },
    {
      title: "Record",
      rows: [
        ["Signed in on the phone", sale.account ?? "Unknown"],
        ["Sale id", sale.id],
      ],
    },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {groups.map((group) => (
        <div key={group.title} className="space-y-1.5 min-w-0">
          <h3 className="rz-label">{group.title}</h3>
          <dl className="space-y-1 text-xs">
            {group.rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-dust shrink-0">{label}</dt>
                <dd className="text-bone text-right break-words min-w-0">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

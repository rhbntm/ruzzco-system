import { Suspense, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, CircleDashed, Smartphone, TriangleAlert } from "lucide-react";
import { manilaToday, parseBusinessDate } from "@/lib/business-date";
import { gatewayConfig } from "@/lib/gateway";
import { peso } from "@/lib/peso";
import { addDays, latestForecast, serializeForecast, type SerializedForecast } from "@/lib/forecast";
import { MAX_FORECAST_DAYS } from "@/lib/forecast-chart";
import { rangeFigures } from "@/lib/range-figures";
import {
  DASHBOARD_PERIODS,
  dashboardRange,
  loadPeriodBarbers,
  loadPeriodSummary,
  loadPhones,
  loadTodayDrawer,
  type DashboardPeriod,
  type PeriodBarbers,
  type PeriodSummary,
  type Phones,
  type TodayDrawer,
} from "@/lib/dashboard";
import { BarList, type BarItem } from "@/components/BarList";
import { ColumnChart, type Column } from "@/components/ColumnChart";
import { ForecastPanel } from "@/components/ForecastPanel";

// The owner dashboard on `/` (slice 21a). Read-only: every card shows figures another page already
// computes and links to the page that owns the action. The period switch (Today, This week, This
// month, always ending today) drives the summary cards only; the drawer, date review, phones and
// forecast cards are always today's and say so. Each card loads on its own: a source that fails
// shows that card's error and the others still render.

type Loaded<T> = { ok: true; value: T } | { ok: false };

function settle<T>(what: string, promise: Promise<T>): Promise<Loaded<T>> {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error) => {
      console.error(`[dashboard] ${what} failed:`, error instanceof Error ? error.message : String(error));
      return { ok: false as const };
    }
  );
}

// Business dates are YYYY-MM-DD calendar dates, so they are formatted as dates, not instants.
const formatDate = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-PH", { ...options, timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const longDay = (date: string) => formatDate(date, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const shortDay = (date: string) => formatDate(date, { month: "short", day: "numeric" });
// When a phone last reached the shop PC, on the shop's clock.
const seenAt = (at: Date) =>
  new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(at);

const PERIOD_LABELS: Record<DashboardPeriod, string> = { today: "Today", week: "This week", month: "This month" };

function periodDates(period: DashboardPeriod, from: string, to: string) {
  if (from === to) return longDay(to);
  return `${period === "week" ? formatDate(from, { weekday: "short", month: "short", day: "numeric" }) : shortDay(from)} to ${longDay(to)}`;
}

const pesoOf = (amount: string) => peso(Number(amount));

export function Dashboard({ period }: { period: DashboardPeriod }) {
  const today = manilaToday();
  const { from, to } = dashboardRange(period, today);
  const dates = periodDates(period, from, to);
  const periodCaption = `${PERIOD_LABELS[period]} · ${dates}`;
  const todayCaption = `Today · ${longDay(today)}`;
  const gatewayOn = gatewayConfig() !== null;

  // Started together; each card awaits only what it shows.
  const summary = settle("period summary", loadPeriodSummary(period, today));
  const barbers = settle("barber figures", loadPeriodBarbers(period, today));
  const drawer = settle("today's drawer", loadTodayDrawer(today));
  const phones = settle("phones", loadPhones());
  const forecast = settle(
    "forecast",
    latestForecast(today, MAX_FORECAST_DAYS).then(({ run, days }) => serializeForecast(run, days))
  );

  return (
    <main className="flex-1">
      <div className="rz-page mx-auto max-w-312 space-y-6 px-4 py-5 sm:px-6 sm:py-7">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="space-y-1.5">
            <h1 className="rz-title text-3xl sm:text-4xl">Dashboard</h1>
            <p className="text-sm text-dust">
              Paid sales, what is owed to the barbers and today&apos;s drawer. Figures only: payouts are recorded on Payouts and the drawer is counted on End-of-Day Cash.
            </p>
          </div>
          <nav aria-label="Period for the summary cards" className="rz-seg">
            {DASHBOARD_PERIODS.map((value) => (
              <Link
                key={value}
                href={value === "today" ? "/" : `/?period=${value}`}
                aria-current={value === period ? "true" : undefined}
                scroll={false}
                className="rz-seg-item min-h-11 px-3.5 sm:min-h-9"
              >
                {PERIOD_LABELS[value]}
              </Link>
            ))}
          </nav>
        </header>

        <section aria-labelledby="period-title" className="space-y-4">
          <SectionHead id="period-title" title={PERIOD_LABELS[period]} dates={dates} note="Paid sales only. A sale held for date review counts on no day until it is confirmed." />

          <Suspense key={`kpi-${period}`} fallback={<KpiSkeleton />}>
            <KpiRow summary={summary} />
          </Suspense>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2" title="Sales per day" href="/sales" linkLabel="View sales">
              <Suspense key={`trend-${period}`} fallback={<CardSkeleton rows={6} />}>
                <SalesPerDay summary={summary} today={today} periodCaption={periodCaption} />
              </Suspense>
            </Card>
            <div className="grid gap-4">
              <Card title="Payment mix" caption={periodCaption} href="/reports" linkLabel="Reports">
                <Suspense key={`mix-${period}`} fallback={<CardSkeleton rows={3} />}>
                  <PaymentMix summary={summary} gatewayOn={gatewayOn} />
                </Suspense>
              </Card>
              <Card title="Services sold" caption={periodCaption} href="/reports" linkLabel="Reports">
                <Suspense key={`services-${period}`} fallback={<CardSkeleton rows={3} />}>
                  <ServicesSold summary={summary} />
                </Suspense>
              </Card>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="The shop's share" caption={periodCaption} href="/ledger" linkLabel="Payouts">
              <Suspense key={`share-${period}`} fallback={<CardSkeleton rows={5} />}>
                <ShopShare summary={summary} />
              </Suspense>
            </Card>
            <Card className="lg:col-span-2" title="Owed to barbers" caption={periodCaption} href="/ledger" linkLabel="Payouts">
              <Suspense key={`owed-${period}`} fallback={<CardSkeleton rows={5} />}>
                <OwedToBarbers summary={summary} barbers={barbers} />
              </Suspense>
            </Card>
          </div>
        </section>

        <section aria-labelledby="today-title" className="space-y-4">
          <SectionHead id="today-title" title="Today" dates={longDay(today)} note="These cards are always today's, whichever period is chosen above." />
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2" title="Expected drawer cash" caption={todayCaption} href="/reconciliation" linkLabel="End-of-Day Cash">
              <Suspense fallback={<CardSkeleton rows={5} />}>
                <DrawerCard drawer={drawer} />
              </Suspense>
            </Card>
            <div className="grid gap-4">
              <Card title="Sales held for date review" caption={todayCaption} href="/reconciliation" linkLabel="End-of-Day Cash">
                <Suspense fallback={<CardSkeleton rows={2} />}>
                  <HeldCard drawer={drawer} />
                </Suspense>
              </Card>
              <Card title="Phones" caption="Approved phones, as of now" href="/devices" linkLabel="Phones">
                <Suspense fallback={<CardSkeleton rows={2} />}>
                  <PhonesCard phones={phones} />
                </Suspense>
              </Card>
            </div>
          </div>

          {/* The forecast panel is a card of its own (with its link to the detailed forecast). */}
          <div className="space-y-2">
            <h3 className="rz-heading text-bone">Customer forecast</h3>
            <p className="text-xs text-dust">From today · {longDay(today)}</p>
            <Suspense fallback={<div className="rz-panel p-4 sm:p-5"><CardSkeleton rows={6} /></div>}>
              <ForecastCard forecast={forecast} today={today} />
            </Suspense>
          </div>
        </section>
      </div>
    </main>
  );
}

// ── Building blocks ──────────────────────────────────────────────────────────

function SectionHead({ id, title, dates, note }: { id: string; title: string; dates: string; note: string }) {
  return (
    <div className="border-b border-seam pb-2.5">
      <h2 id={id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="rz-title text-xl">{title}</span>
        <span className="text-sm font-medium text-bone-2">{dates}</span>
      </h2>
      <p className="mt-1 text-xs text-dust">{note}</p>
    </div>
  );
}

function Card({ title, caption, href, linkLabel, className = "", children }: {
  title: string;
  /** The dates the card covers; a card whose body states them itself passes none. */
  caption?: string;
  href: string;
  linkLabel: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`rz-panel flex min-w-0 flex-col p-4 sm:p-5 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="rz-heading text-bone">{title}</h3>
          {caption && <p className="mt-1 text-xs text-dust">{caption}</p>}
        </div>
        <Link
          href={href}
          className="group -my-2 inline-flex shrink-0 items-center gap-1 rounded-sm py-2 text-xs font-semibold text-dust transition-colors hover:text-bone pointer-coarse:-my-3.5 pointer-coarse:py-3.5"
        >
          {linkLabel}
          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 transition-transform duration-200 motion-safe:group-hover:translate-x-0.5" />
        </Link>
      </div>
      <div className="mt-4 flex-1">{children}</div>
    </section>
  );
}

function CardSkeleton({ rows }: { rows: number }) {
  return (
    <div role="status" className="space-y-2.5">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden="true" className="rz-skeleton h-5" style={{ width: `${92 - (i % 3) * 14}%` }} />
      ))}
    </div>
  );
}

function CardError({ what }: { what: string }) {
  return (
    <p role="alert" className="rz-notice rz-notice-danger">
      <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      {what} can&apos;t be loaded right now. The other cards are not affected; reload the page to try again.
    </p>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rz-notice">{children}</p>;
}

function Line({ label, value, note, strong = false, sign }: { label: string; value: string; note?: string; strong?: boolean; sign?: "+" | "−" | "=" }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-2 ${strong ? "border-t border-seam-hover" : ""}`}>
      <dt className="min-w-0 text-sm text-bone-2">
        {sign && <span aria-hidden="true" className="mr-2 inline-block w-3 text-center font-semibold text-dust">{sign}</span>}
        <span className={strong ? "font-semibold text-bone" : ""}>{label}</span>
        {note && <span className="block pl-5 text-xs text-dust">{note}</span>}
      </dt>
      <dd className={`shrink-0 tabular-nums ${strong ? "rz-figure text-xl text-bone" : "text-sm font-semibold text-bone"}`}>{value}</dd>
    </div>
  );
}

const kpiEdge = (color: string) => ({ "--kpi": `var(--color-${color})` }) as CSSProperties;

function Kpi({ label, value, note, edge }: { label: string; value: string; note: string; edge: string }) {
  return (
    <div className="rz-kpi" style={kpiEdge(edge)}>
      <p className="rz-label">{label}</p>
      <p className="rz-figure mt-2 truncate text-[1.75rem] text-bone tabular-nums sm:text-[2rem]">{value}</p>
      <p className="mt-1 text-xs text-dust">{note}</p>
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div role="status" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} aria-hidden="true" className="rz-kpi space-y-2.5">
          <div className="rz-skeleton h-3.5 w-24" />
          <div className="rz-skeleton h-8 w-32" />
          <div className="rz-skeleton h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

// ── Period cards (the ledger summary's figures) ──────────────────────────────

async function KpiRow({ summary }: { summary: Promise<Loaded<PeriodSummary>> }) {
  const loaded = await summary;
  if (!loaded.ok) return <CardError what="The sales summary" />;
  const { sales, leftForShop, payouts } = loaded.value;
  const average = sales.count > 0 ? Number(sales.total) / sales.count : null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <Kpi label="Sales" value={pesoOf(sales.total)} note={`${sales.count} paid ${sales.count === 1 ? "sale" : "sales"}, amount paid, tips not included`} edge="bone" />
      <Kpi label="Average per sale" value={average === null ? "—" : peso(average)} note={average === null ? "No paid sales yet" : "Sales ÷ number of paid sales"} edge="seam-hover" />
      <Kpi label="Left for the shop" value={pesoOf(leftForShop)} note="Sales − commissions − petty cash" edge="ok" />
      <Kpi label="Still owed to barbers" value={pesoOf(payouts.remaining)} note={`${pesoOf(payouts.paid)} paid of ${pesoOf(payouts.owed)} owed`} edge="warn" />
    </div>
  );
}

async function SalesPerDay({ summary, today, periodCaption }: { summary: Promise<Loaded<PeriodSummary>>; today: string; periodCaption: string }) {
  const loaded = await summary;
  if (!loaded.ok) return <CardError what="Sales per day" />;
  let days: { date: string; revenue: number; detail?: string }[] = loaded.value.days.map((day) => ({ date: day.date, revenue: Number(day.revenue) }));
  let caption = periodCaption;
  // A one-day period has no per-day list: show the last 14 days instead, as Insights does.
  if (days.length === 0) {
    try {
      // Slice 27: the same rangeFigures path as Reports and the ledger Summary (trends.ts removed).
      const first = addDays(today, -13);
      const { perDate } = await rangeFigures(parseBusinessDate(first)!, parseBusinessDate(today)!, "LIST_PRICE");
      days = [...perDate.entries()].map(([date, day]) => ({ date, revenue: day.revenue.toNumber(), detail: `${day.count} paid ${day.count === 1 ? "sale" : "sales"}` }));
      caption = `Last 14 days · ${shortDay(first)} to ${longDay(today)}`;
    } catch (error) {
      console.error("[dashboard] sales trend failed:", error instanceof Error ? error.message : String(error));
      return <CardError what="Sales per day" />;
    }
  }
  const columns: Column[] = days.map((day) => ({
    key: day.date,
    axisLabel: days.length > 7 ? formatDate(day.date, { day: "numeric" }) : formatDate(day.date, { weekday: "short" }),
    label: formatDate(day.date, { weekday: "short", month: "short", day: "numeric" }),
    value: day.revenue,
    valueText: peso(day.revenue),
    detail: day.detail,
    emphasis: day.date === today,
  }));
  const total = days.reduce((sum, day) => sum + day.revenue, 0);
  return (
    <div className="space-y-3">
      <p className="text-xs text-dust">{caption}</p>
      {total === 0 ? (
        <Empty>No paid sales on these days yet.</Empty>
      ) : (
        <>
          <ColumnChart
            columns={columns}
            unit="peso"
            summary={`Amount paid per day in pesos, ${caption}. Today is highlighted.`}
            labelHeading="Day"
            valueHeading="Amount paid"
            labelEvery={columns.length > 16 ? 2 : 1}
          />
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-dust">
            <span>Vertical axis: amount paid per day, in pesos (₱). Horizontal axis: the day.</span>
            <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-crimson-bright" /> Today</span>
            <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-dust-2" /> Earlier days</span>
          </p>
        </>
      )}
    </div>
  );
}

async function PaymentMix({ summary, gatewayOn }: { summary: Promise<Loaded<PeriodSummary>>; gatewayOn: boolean }) {
  const loaded = await summary;
  if (!loaded.ok) return <CardError what="The payment mix" />;
  const { sales } = loaded.value;
  const total = Number(sales.total);
  if (sales.count === 0) return <Empty>No paid sales in this period yet.</Empty>;
  const share = (amount: string) => (total > 0 ? (Number(amount) / total) * 100 : null);
  const items: BarItem[] = [
    { key: "cash", label: "Cash", note: "in the drawer", valueText: pesoOf(sales.cash), share: share(sales.cash), barClassName: "bg-cash" },
    { key: "gcash", label: "GCash", note: "digital", valueText: pesoOf(sales.gcash), share: share(sales.gcash), barClassName: "bg-gcash" },
    { key: "maya", label: "Maya", note: "digital", valueText: pesoOf(sales.maya), share: share(sales.maya), barClassName: "bg-maya" },
    // QR Ph only when the gateway is on, or when the period holds QR Ph sales from when it was.
    ...(gatewayOn || Number(sales.qrph) !== 0
      ? [{ key: "qrph", label: "QR Ph", note: "digital", valueText: pesoOf(sales.qrph), share: share(sales.qrph), barClassName: "bg-qrph" }]
      : []),
  ];
  return <BarList items={items} />;
}

async function ServicesSold({ summary }: { summary: Promise<Loaded<PeriodSummary>> }) {
  const loaded = await summary;
  if (!loaded.ok) return <CardError what="Services sold" />;
  const { services, serviceGap } = loaded.value;
  if (services.length === 0) return <Empty>No services sold in this period yet.</Empty>;
  const listTotal = services.reduce((sum, row) => sum + Number(row.listSales), 0);
  const items: BarItem[] = services.map((row) => ({
    key: row.name,
    label: row.name,
    note: `${row.count} ${row.count === 1 ? "item" : "items"}`,
    valueText: pesoOf(row.listSales),
    share: listTotal > 0 ? (Number(row.listSales) / listTotal) * 100 : null,
    barClassName: "bg-bone-2",
  }));
  return (
    <div className="space-y-3">
      <BarList items={items} />
      <p className="text-xs text-dust">
        Each service at its menu price, not money collected; a sale with several services adds an item to each.{Number(serviceGap) !== 0 && ` Discounts given: ${pesoOf(serviceGap)}.`}
      </p>
    </div>
  );
}

async function ShopShare({ summary }: { summary: Promise<Loaded<PeriodSummary>> }) {
  const loaded = await summary;
  if (!loaded.ok) return <CardError what="The shop's share" />;
  const { sales, shared, leftForShop, pettyCashMissingDays } = loaded.value;
  const pettyNote = shared.pettyCashRecorded
    ? undefined
    : `${pettyCashMissingDays} ${pettyCashMissingDays === 1 ? "day has" : "days have"} no End-of-Day Cash saved`;
  return (
    <dl>
      <Line label="Sales" value={pesoOf(sales.total)} />
      <Line sign="−" label="Commissions" value={pesoOf(shared.commissions)} note="at list price, from each sale's saved rate" />
      <Line sign="−" label="Petty cash" value={pesoOf(shared.pettyCash)} note={pettyNote} />
      <Line sign="=" label="Left for the shop" value={pesoOf(leftForShop)} note="before the owner's own costs" strong />
      <Line label="Tips" value={pesoOf(shared.tips)} note="go to the barbers in full; not part of sales" />
    </dl>
  );
}

async function OwedToBarbers({ summary, barbers }: { summary: Promise<Loaded<PeriodSummary>>; barbers: Promise<Loaded<PeriodBarbers>> }) {
  const [loaded, rows] = await Promise.all([summary, barbers]);
  if (!loaded.ok) return <CardError what="What is owed to the barbers" />;
  const { payouts } = loaded.value;
  return (
    <div className="space-y-4">
      <dl className="rz-strip grid-cols-3">
        {[
          { label: "Owed", value: payouts.owed, note: "commissions + tips" },
          { label: "Paid", value: payouts.paid, note: "payouts recorded" },
          { label: "Remaining", value: payouts.remaining, note: "added up day by day" },
        ].map((unit) => (
          <div key={unit.label}>
            <dt className="rz-label">{unit.label}</dt>
            <dd className="rz-figure mt-1 truncate text-lg text-bone tabular-nums sm:text-xl">{pesoOf(unit.value)}</dd>
            <dd className="mt-0.5 hidden text-xs text-dust sm:block">{unit.note}</dd>
          </div>
        ))}
      </dl>
      {!rows.ok ? (
        <CardError what="The figures per barber" />
      ) : rows.value.length === 0 ? (
        <Empty>No barber has a paid sale in this period yet.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="rz-table min-w-104">
            <thead>
              <tr>
                <th className="text-left">Barber</th>
                <th className="text-right">Sales</th>
                <th className="text-right">Amount paid</th>
                <th className="text-right">Commission</th>
                <th className="text-right">Tips</th>
              </tr>
            </thead>
            <tbody>
              {rows.value.map((row) => (
                <tr key={row.id}>
                  <td className="font-semibold text-bone">{row.name}</td>
                  <td className="text-right text-bone-2">{row.sales}</td>
                  <td className="text-right text-bone-2">{pesoOf(row.revenue)}</td>
                  <td className="text-right text-bone">{pesoOf(row.commission)}</td>
                  <td className="text-right text-bone-2">{pesoOf(row.tips)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Today's cards ────────────────────────────────────────────────────────────

async function DrawerCard({ drawer }: { drawer: Promise<Loaded<TodayDrawer>> }) {
  const loaded = await drawer;
  if (!loaded.ok) return <CardError what="Today's drawer" />;
  const { expected, saved, staleness } = loaded.value;
  const variance = saved ? Number(saved.variance) : null;
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <dl>
        <Line sign="+" label="Cash sales" value={pesoOf(expected.cashTotal)} />
        <Line sign="+" label="Cash tips" value={pesoOf(expected.cashTips)} />
        <Line sign="−" label="Cash payouts" value={pesoOf(expected.cashPayouts)} />
        <Line sign="−" label="Petty cash" value={pesoOf(expected.pettyCash)} note={saved ? undefined : "recorded with the cash count"} />
        <Line sign="=" label="Expected in the drawer" value={pesoOf(expected.expectedDrawerCash)} strong />
      </dl>
      <div className="space-y-3">
        <p className="rz-label">Cash count</p>
        {!saved ? (
          <p className="rz-notice">
            <CircleDashed aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span><strong className="font-semibold text-bone">Not counted yet.</strong> Count the drawer on End-of-Day Cash at closing.</span>
          </p>
        ) : staleness?.stale ? (
          <p className="rz-notice rz-notice-warn">
            <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong className="font-semibold">Out of date.</strong> The day changed after {pesoOf(saved.countedCash)} was counted. Count the drawer again on End-of-Day Cash.
            </span>
          </p>
        ) : (
          <p className="rz-notice rz-notice-ok">
            <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong className="font-semibold">Saved.</strong> Counted {pesoOf(saved.countedCash)}
              {variance !== null && (Math.abs(variance) < 0.01 ? ", which matches." : variance < 0 ? `, short by ${peso(Math.abs(variance))}.` : `, over by ${peso(variance)}.`)}
            </span>
          </p>
        )}
        <p className="text-xs leading-relaxed text-dust">
          GCash {pesoOf(expected.gcashTotal)} and Maya {pesoOf(expected.mayaTotal)}
          {Number(expected.qrphTotal) !== 0 && `, QR Ph ${pesoOf(expected.qrphTotal)}`} are digital and never in the drawer.
        </p>
      </div>
    </div>
  );
}

async function HeldCard({ drawer }: { drawer: Promise<Loaded<TodayDrawer>> }) {
  const loaded = await drawer;
  if (!loaded.ok) return <CardError what="The date-review count" />;
  const held = loaded.value.heldForReview;
  if (held === 0) {
    return (
      <p className="flex items-start gap-2.5 text-sm text-bone-2">
        <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
        No sale stamped today is waiting for a date review.
      </p>
    );
  }
  return (
    <p className="rz-notice rz-notice-warn">
      <CalendarClock aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        <strong className="font-semibold">{held} {held === 1 ? "sale" : "sales"} stamped today {held === 1 ? "is" : "are"} held.</strong>{" "}
        {held === 1 ? "It counts" : "They count"} on no day until the date is confirmed on End-of-Day Cash.
      </span>
    </p>
  );
}

async function PhonesCard({ phones }: { phones: Promise<Loaded<Phones>> }) {
  const loaded = await phones;
  if (!loaded.ok) return <CardError what="The phones" />;
  if (loaded.value.length === 0) return <Empty>No phone is approved yet.</Empty>;
  return (
    <ul className="rz-rows">
      {loaded.value.map((phone) => (
        <li key={phone.deviceKey} className="flex items-center justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0">
          <span className="flex min-w-0 items-center gap-2 text-bone">
            <Smartphone aria-hidden="true" className="h-4 w-4 shrink-0 text-dust" />
            <span className="truncate">{phone.label || "Unnamed phone"}</span>
          </span>
          <span className="shrink-0 text-xs text-dust">{phone.lastSeenAt ? `Last seen ${seenAt(phone.lastSeenAt)}` : "Never seen"}</span>
        </li>
      ))}
    </ul>
  );
}

async function ForecastCard({ forecast, today }: { forecast: Promise<Loaded<SerializedForecast>>; today: string }) {
  const loaded = await forecast;
  if (!loaded.ok) return <CardError what="The saved forecast" />;
  return <ForecastPanel initial={loaded.value} today={today} />;
}

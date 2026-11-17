import Link from "next/link";
import { AlertTriangle, ArrowRight, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Prisma, type PaymentMethod } from "@prisma/client";
import { manilaToday } from "@/lib/business-date";
import { PRESETS, parseRange, presetRange, type DateRange, type Preset } from "@/lib/date-range";
import { gatewayConfig } from "@/lib/gateway";
import { ownerPageAccess } from "@/lib/owner-access";
import { loadReport, type Report } from "@/lib/report";
import { chartBuckets } from "@/lib/report-chart";
import { buildReportStory } from "@/lib/insights-story";
// rangeText lives in a client module (DateRangeBar), which a server page can't call; same format here.
const rangeDay = (iso: string) => new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const rangeText = (from: string, to: string) => (from === to ? rangeDay(from) : `${rangeDay(from)} to ${rangeDay(to)}`);
import { ColumnChart } from "@/components/ColumnChart";
import { BarList } from "@/components/BarList";
import { InsightsPresentation } from "@/components/InsightsPresentation";
import { ForecastLocked } from "@/components/ForecastPanel";
import { peso as formatPeso } from "@/lib/peso";
import { ReportsRangeBar } from "./ReportsRangeBar";

// Slice 27: Reports (was Insights). Owner-only and read-only: historical business performance
// over a date range. Every figure comes from `rangeFigures` through `loadReport`, the path the
// ledger Summary and the Dashboard use, so the same figure agrees on every page. The single-day
// drawer and payout figures belong to End-of-Day Cash and Payouts; forecasts to the Dashboard and
// /forecast. Presentation mode tells the range's story from these figures.
export const dynamic = "force-dynamic";

type Decimal = Prisma.Decimal;
const DEFAULT_PRESET: Preset = "last7Days";

/** The range from the URL: ?from&to (Custom), else ?range=<preset>, else Last 7 days. */
function rangeFromParams(params: { [key: string]: string | string[] | undefined }, today: string) {
  const one = (name: string) => (typeof params[name] === "string" ? (params[name] as string) : null);
  const from = one("from");
  const to = one("to");
  if (from !== null || to !== null) {
    const parsed = parseRange(from ?? "", to ?? "", today);
    if (parsed.ok) return { key: "custom", range: parsed, error: null };
    const fallback = presetRange(DEFAULT_PRESET, today);
    return { key: DEFAULT_PRESET, range: parseRange(fallback.from, fallback.to, today) as DateRange, error: parsed.error };
  }
  const name = one("range");
  const preset = name && (PRESETS as readonly string[]).includes(name) ? (name as Preset) : DEFAULT_PRESET;
  const dates = presetRange(preset, today);
  return { key: preset, range: parseRange(dates.from, dates.to, today) as DateRange, error: null };
}

async function loadSafely(range: DateRange): Promise<Report | null> {
  try {
    return await loadReport(range);
  } catch (error) {
    console.error("[reports] query failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const isOwner = await ownerPageAccess();
  if (!isOwner) {
    // No figures are loaded without owner access.
    return (
      <Shell>
        <ForecastLocked title="Reports" description="Sales, revenue and how the shop did over a date range. Owner only." submitLabel="Show reports" />
      </Shell>
    );
  }

  const today = manilaToday();
  const { key, range, error } = rangeFromParams(await searchParams, today);
  const report = await loadSafely(range);
  const showQrph = gatewayConfig() !== null || (report !== null && report.byMethod.some((m) => m.method === "QRPH" && m.revenue.gt(0)));
  const label = rangeText(range.first.date, range.last.date);
  const story = buildReportStory(storyInput(report, today, showQrph), label);

  return (
    <Shell action={<InsightsPresentation story={story} />}>
      <div className="rz-panel p-3 sm:p-4 space-y-2">
        <ReportsRangeBar today={today} selected={key} from={range.first.date} to={range.last.date} />
        <p className="text-xs text-dust">Manila business dates. Every figure on this page covers exactly these dates.</p>
        {error && <p role="alert" className="rz-notice rz-notice-danger">{error} Showing the last 7 days instead.</p>}
      </div>

      {report ? (
        <>
          <Summary report={report} />
          <Charts report={report} showQrph={showQrph} />
          <Calculations report={report} showQrph={showQrph} />
        </>
      ) : (
        <p className="rz-notice rz-notice-danger">The figures can&apos;t be loaded right now because the database is unreachable. Reload the page to try again.</p>
      )}

      <section className="space-y-1.5 text-sm text-dust">
        <p>
          Drawer cash for a day is worked out on <Link href="/reconciliation" className="underline rounded-sm hover:text-bone">End-of-Day Cash</Link>;
          each barber&apos;s earnings and payouts are on <Link href="/ledger" className="underline rounded-sm hover:text-bone">Payouts</Link>.
        </p>
        <p>
          The forecast (expected customers, its estimated revenue and how accurate it is) is on the Dashboard and the{" "}
          <Link href="/forecast" className="underline rounded-sm hover:text-bone">Forecast</Link> page.
        </p>
      </section>

      <footer className="pt-6 border-t border-seam text-xs text-dust">Read-only: this page never changes a sale, a payout or a drawer count.</footer>
    </Shell>
  );
}

// ── Sections ─────────────────────────────────────────────────────────────────

function Summary({ report }: { report: Report }) {
  const { totals, previous, days } = report;
  const average = averageOf(totals.revenue, totals.sales);
  const perOpenDay = averageOf(totals.revenue, totals.openDays);
  const best = report.daily.reduce<Report["daily"][number] | null>((top, d) => (d.sales > 0 && (!top || d.revenue.gte(top.revenue)) ? d : top), null);
  const peak = report.hours.reduce<Report["hours"][number] | null>((top, h) => (h.sales > 0 && (!top || h.sales > top.sales) ? h : top), null);
  const digital = report.byMethod.filter((m) => m.method !== "CASH").reduce((sum, m) => sum.add(m.revenue), new Prisma.Decimal(0));
  const before = `the ${days} ${days === 1 ? "day" : "days"} before`;
  return (
    <section id="summary" className="space-y-4 scroll-mt-6">
      <SectionHeading title="Summary" blurb={`Paid sales only, each counted on its Manila business day, compared with ${before} (${rangeText(previous.first, previous.last)}).`} />
      {report.heldForReview > 0 && (
        <Warning>
          {plural(report.heldForReview, "sale")} in these dates {report.heldForReview === 1 ? "is" : "are"} held for a date review and not in these figures. Confirm{" "}
          {report.heldForReview === 1 ? "its" : "their"} date on <Link href="/reconciliation" className="underline rounded-sm">End-of-Day Cash</Link>.
        </Warning>
      )}
      {totals.sales === 0 && <p className="rz-notice">No paid sales on these dates. Pick other dates above.</p>}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label="Revenue" value={peso(totals.revenue)} note="Amount paid, tips not included" delta={change(totals.revenue, previous.revenue, before)} />
        <Stat label="Paid sales" value={String(totals.sales)} note="One per sale, whatever its services" delta={change(new Prisma.Decimal(totals.sales), new Prisma.Decimal(previous.sales), before)} />
        <Stat label="Average per sale" value={average ? peso(average) : "—"} note="Revenue ÷ paid sales" />
        <Stat label="Average per open day" value={perOpenDay ? peso(perOpenDay) : "—"} note={`${totals.openDays} of ${days} days had sales`} />
        <Stat label="Best day" value={best ? peso(best.revenue) : "—"} note={best ? `${shortDay(best.date)} · ${plural(best.sales, "sale")}` : "No sales yet"} />
        <Stat label="Busiest hour" value={peak ? hourRange(peak.hour) : "—"} note={peak ? `${plural(peak.sales, "paid sale")} in this hour` : "No sales yet"} />
        <Stat label="Tips to barbers" value={peso(totals.tips)} note="Not part of revenue" />
        <Stat label="Paid digitally" value={totals.revenue.gt(0) ? `${Math.round(share(digital, totals.revenue) ?? 0)}%` : "—"} note={`${peso(digital)} by GCash, Maya or QR Ph`} />
      </div>
    </section>
  );
}

function Charts({ report, showQrph }: { report: Report; showQrph: boolean }) {
  if (report.totals.sales === 0) return null;
  const { totals } = report;
  const grouped = chartBuckets(report.daily.map((d) => ({ date: d.date, revenue: d.revenue.toNumber(), sales: d.sales })));
  const weekly = grouped.unit === "week";
  const peak = report.hours.reduce<Report["hours"][number] | null>((top, h) => (h.sales > 0 && (!top || h.sales > top.sales) ? h : top), null);
  const items = report.byService.reduce((sum, s) => sum + s.items, 0);
  return (
    <section id="trends" className="space-y-4 scroll-mt-6">
      <SectionHeading title="Trends" blurb="Where the range's revenue came from. Charts group days by week for ranges longer than 62 days; every total above still uses each day." />
      <Card title={weekly ? "Revenue per week" : "Revenue per day"}>
        <ColumnChart
          columns={grouped.buckets.map((b) => ({
            key: b.key,
            axisLabel: weekly || grouped.buckets.length > 7 ? shortDay(b.from, false) : weekday(b.from),
            label: b.from === b.to ? shortDay(b.from) : `${shortDay(b.from, false)} – ${shortDay(b.to)}`,
            value: b.revenue,
            valueText: peso(b.revenue),
            detail: plural(b.sales, "paid sale"),
          }))}
          unit="peso"
          summary={`Revenue ${weekly ? "per week (Monday to Sunday, trimmed to the range)" : "per day"}, ${rangeText(report.first, report.last)}. Total ${peso(totals.revenue)}.`}
          labelHeading={weekly ? "Week" : "Day"}
          valueHeading="Revenue"
          labelEvery={Math.max(1, Math.ceil(grouped.buckets.length / 14))}
        />
        {weekly && <Note>Each column is one week, Monday to Sunday; the first and last columns cover only the dates in the range.</Note>}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Busy hours">
          <Rule>Paid sales by the hour they were rung up (Manila time), over the whole range.</Rule>
          <ColumnChart
            columns={report.hours.map((h) => ({ key: String(h.hour), axisLabel: shortHour(h.hour), label: hourRange(h.hour), value: h.sales, valueText: plural(h.sales, "paid sale"), emphasis: peak?.hour === h.hour }))}
            unit="count"
            summary={`Paid sales by hour of the day.${peak ? ` Busiest ${hourRange(peak.hour)} with ${plural(peak.sales, "sale")}.` : ""}`}
            labelHeading="Hour"
            valueHeading="Paid sales"
            labelEvery={2}
            height={144}
          />
          {report.hourExcluded > 0 && <Note>{plural(report.hourExcluded, "sale")} with a corrected date {report.hourExcluded === 1 ? "is" : "are"} left out: the phone&apos;s clock was wrong, so the hour is not known.</Note>}
        </Card>

        <Card title="Revenue by barber" link={{ href: "/ledger", label: "Payouts" }}>
          <BarList items={report.byBarber.map((b) => ({ key: b.name, label: b.name, note: plural(b.sales, "sale"), valueText: peso(b.revenue), share: share(b.revenue, totals.revenue) }))} />
          <Note>Bar length is each barber&apos;s share of revenue. Earnings, commissions and payouts are on Payouts.</Note>
        </Card>

        <Card title="Services sold (items)">
          <BarList items={report.byService.map((s) => ({ key: s.name, label: s.name, note: `menu value ${peso(s.listed)}`, valueText: plural(s.items, "item"), share: items > 0 ? (s.items / items) * 100 : null }))} />
          <Note>One item per service in a sale: a haircut and a shave in one sale add one to each. Menu value is the services&apos; menu prices, not money collected; a custom amount counts under its service.</Note>
        </Card>

        <Card title="Payment methods">
          <BarList
            items={report.byMethod
              .filter((m) => m.method !== "QRPH" || showQrph)
              .map((m) => ({ key: m.method, label: METHOD_LABELS[m.method], note: m.method === "CASH" ? "in the drawer" : "digital", valueText: peso(m.revenue), share: share(m.revenue, totals.revenue), barClassName: METHOD_BARS[m.method] }))}
          />
        </Card>
      </div>
    </section>
  );
}

// Kept on purpose (Brent): how Revenue and Average per sale are worked out, over the range.
function Calculations({ report, showQrph }: { report: Report; showQrph: boolean }) {
  const { totals } = report;
  const amount = (method: PaymentMethod) => report.byMethod.find((m) => m.method === method)?.revenue ?? new Prisma.Decimal(0);
  const lines: Line[] = [
    { label: "Cash", value: peso(amount("CASH")) },
    { op: "+", label: "GCash", value: peso(amount("GCASH")) },
    { op: "+", label: "Maya", value: peso(amount("MAYA")) },
  ];
  if (showQrph) lines.push({ op: "+", label: "QR Ph", value: peso(amount("QRPH")) });
  lines.push({ op: "=", label: "Revenue", value: peso(totals.revenue) });
  const average = averageOf(totals.revenue, totals.sales);
  return (
    <section id="calculations" className="space-y-4 scroll-mt-6">
      <SectionHeading title="Calculations" blurb="How the two main figures are worked out, with this range's numbers." />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Revenue">
          <Rule>What customers paid on the range&apos;s paid sales, each sale once whatever its services. Tips are not revenue; they go to the barber.</Rule>
          <Tape lines={lines} />
        </Card>
        <Card title="Average per sale">
          <Rule>Revenue divided by the number of paid sales, rounded to the centavo. A sale with several services is one sale.</Rule>
          {average ? (
            <Tape lines={[{ label: "Revenue", value: peso(totals.revenue) }, { op: "÷", label: "Paid sales", value: String(totals.sales) }, { op: "=", label: "Average per sale", value: peso(average) }]} />
          ) : (
            <Note>No paid sales on these dates, so there is no average yet.</Note>
          )}
        </Card>
      </div>
    </section>
  );
}

// ── Building blocks ──────────────────────────────────────────────────────────

function Shell({ action, children }: { action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative flex-1 overflow-x-hidden">
      <main className="rz-page relative max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-7 space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="space-y-1.5">
            <h1 className="rz-title text-3xl sm:text-4xl">Reports</h1>
            <p className="text-sm text-dust max-w-2xl leading-relaxed">How the shop did over the dates you pick: revenue, paid sales, services, barbers and busy hours.</p>
          </div>
          {action}
        </header>
        {children}
      </main>
    </div>
  );
}

function SectionHeading({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="space-y-1.5">
      <h2 className="rz-heading text-xl text-bone">{title}</h2>
      <p className="text-sm text-dust max-w-prose leading-relaxed">{blurb}</p>
    </div>
  );
}

function Card({ title, link, children }: { title: string; link?: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <section className="rz-panel min-w-0 p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="rz-heading text-bone">{title}</h3>
        {link && (
          <Link href={link.href} className="group -my-2 inline-flex shrink-0 items-center gap-1 rounded-sm py-2 text-xs font-semibold text-dust transition-colors hover:text-bone pointer-coarse:-my-3.5 pointer-coarse:py-3.5">
            {link.label}
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

type Delta = { text: string; trend: "up" | "down" | "flat" };

function Stat({ label, value, note, delta }: { label: string; value: string; note?: string; delta?: Delta }) {
  return (
    <div className="rz-kpi space-y-1.5" style={{ "--kpi": "var(--color-seam-hover)" } as React.CSSProperties}>
      <div className="rz-label">{label}</div>
      <div className="rz-figure truncate text-2xl text-bone tabular-nums sm:text-3xl">{value}</div>
      {note && <p className="text-xs text-dust leading-relaxed">{note}</p>}
      {delta && (
        <p className={`flex items-start gap-1 text-xs ${delta.trend === "up" ? "text-ok-ink" : delta.trend === "down" ? "text-warn-ink" : "text-dust"}`}>
          {delta.trend === "up" ? <TrendingUp className="w-3.5 h-3.5 mt-px shrink-0" /> : delta.trend === "down" ? <TrendingDown className="w-3.5 h-3.5 mt-px shrink-0" /> : <Minus className="w-3.5 h-3.5 mt-px shrink-0" />}
          {delta.text}
        </p>
      )}
    </div>
  );
}

type Line = { op?: "+" | "−" | "×" | "÷" | "="; label: string; value: string };

function Tape({ lines }: { lines: Line[] }) {
  return (
    <dl className="rz-well overflow-hidden divide-y divide-seam text-sm">
      {lines.map((line, i) => {
        const result = line.op === "=";
        return (
          <div key={i} className={`flex items-baseline justify-between gap-3 px-3.5 py-2.5 ${result ? "bg-brass/6" : ""}`}>
            <dt className={result ? "font-semibold text-bone" : "text-bone-2"}>
              <span className={`inline-block w-5 font-mono ${result ? "text-brass" : "text-dust"}`}>{line.op ?? ""}</span>
              {line.label}
            </dt>
            <dd className={`tabular-nums text-right ${result ? "font-bold text-brass-bright" : "text-bone"}`}>{line.value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function Rule({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-dust leading-relaxed max-w-prose">{children}</p>;
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-dust leading-relaxed max-w-prose">{children}</p>;
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="rz-notice rz-notice-warn">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

// ── Formatting and the story's input ─────────────────────────────────────────

const METHOD_LABELS: Record<PaymentMethod, string> = { CASH: "Cash", GCASH: "GCash", MAYA: "Maya", QRPH: "QR Ph" };
const METHOD_BARS: Record<PaymentMethod, string> = { CASH: "bg-cash", GCASH: "bg-gcash", MAYA: "bg-maya", QRPH: "bg-qrph" };
const manilaHourFormat = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", hourCycle: "h23" });

function storyInput(report: Report | null, today: string, showQrph: boolean) {
  return {
    today,
    date: report?.last ?? today,
    days: report?.days ?? 0,
    manilaHour: Number(manilaHourFormat.format(new Date())),
    trends: report && {
      first: report.first,
      daily: report.daily.map((d) => ({ date: d.date, revenue: d.revenue.toNumber(), sales: d.sales })),
      hours: report.hours,
      hourExcluded: report.hourExcluded,
      byBarber: report.byBarber.map((b) => ({ name: b.name, revenue: b.revenue.toNumber(), sales: b.sales })),
      byService: report.byService.map((s) => ({ name: s.name, sales: s.items })),
      byMethod: report.byMethod
        .filter((m) => m.method !== "QRPH" || showQrph)
        .map((m) => ({ label: METHOD_LABELS[m.method], revenue: m.revenue.toNumber(), digital: m.method !== "CASH" })),
      revenue: report.totals.revenue.toNumber(),
      sales: report.totals.sales,
      tips: report.totals.tips.toNumber(),
      openDays: report.totals.openDays,
      perOpenDay: averageOf(report.totals.revenue, report.totals.openDays)?.toNumber() ?? null,
      average: averageOf(report.totals.revenue, report.totals.sales)?.toNumber() ?? null,
      previous: { revenue: report.previous.revenue.toNumber(), sales: report.previous.sales },
      heldForReview: report.heldForReview,
    },
  };
}

function averageOf(total: Decimal, count: number) {
  return count > 0 ? total.div(count).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) : null;
}

function share(part: Decimal, whole: Decimal) {
  return whole.gt(0) ? Number(part.div(whole).mul(100).toFixed(1)) : null;
}

function change(current: Decimal, previous: Decimal, before: string): Delta {
  if (previous.isZero()) return current.isZero() ? { text: `Same as ${before}`, trend: "flat" } : { text: `Up from nothing in ${before}`, trend: "up" };
  const percent = Math.round(current.sub(previous).div(previous).mul(100).toNumber());
  if (percent === 0) return { text: `About the same as ${before}`, trend: "flat" };
  return { text: `${percent > 0 ? "+" : "−"}${Math.abs(percent)}% vs ${before}`, trend: percent > 0 ? "up" : "down" };
}

function peso(value: Prisma.Decimal.Value) {
  return formatPeso(new Prisma.Decimal(value).toNumber());
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function hourRange(hour: number) {
  const name = (h: number) => `${h % 12 || 12}`;
  const half = (h: number) => (h % 24 < 12 ? "AM" : "PM");
  return half(hour) === half(hour + 1) ? `${name(hour)}–${name(hour + 1)} ${half(hour)}` : `${name(hour)} ${half(hour)}–${name(hour + 1)} ${half(hour + 1)}`;
}

function shortHour(hour: number) {
  return `${hour % 12 || 12}${hour < 12 ? "a" : "p"}`;
}

const asDate = (iso: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-PH", { ...options, timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const shortDay = (iso: string, withWeekday = true) => asDate(iso, withWeekday ? { weekday: "short", month: "short", day: "numeric" } : { month: "short", day: "numeric" });
const weekday = (iso: string) => asDate(iso, { weekday: "short" });


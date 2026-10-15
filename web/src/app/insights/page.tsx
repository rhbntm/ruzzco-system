import Link from "next/link";
import { cookies } from "next/headers";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowLeft,
  Calculator,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  LayoutDashboard,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Prisma, type PaymentMethod, type ShiftReconciliation } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { manilaToday, parseBusinessDate, type BusinessDay } from "@/lib/business-date";
import { computeExpected, computeStaleness, latestRevision, type ExpectedTotals, type Staleness } from "@/lib/reconciliation";
import { payoutTotalsForDay } from "@/lib/payouts";
import { countHeldForReview, countsOnDay } from "@/lib/time-review";
import { gatewayConfig } from "@/lib/gateway";
import { OWNER_COOKIE, isOwnerCookie } from "@/lib/owner-access";
import { addDays, latestForecast, serializeForecast, type SerializedForecast } from "@/lib/forecast";
import { METHOD_NAMES, basisLine } from "@/lib/forecast-comparison";
import { DEFAULT_TREND_RANGE, TREND_RANGES, loadTrends, parseTrendRange, type TrendRange, type Trends } from "@/lib/trends";
import { buildStory, type StoryInput } from "@/lib/insights-story";
import { ForecastLocked, MethodComparison } from "@/components/ForecastPanel";
import { ColumnChart } from "@/components/ColumnChart";
import { BarList } from "@/components/BarList";
import { InsightsPresentation } from "@/components/InsightsPresentation";

// Owner-only and read-only. Every money figure comes from the code End-of-Day Cash
// (computeExpected) and the Barber Ledger (payoutTotalsForDay) already use, so the pages agree.
// The forecast parts read the saved run only; this page never calls the ml-service.
// Presentation mode tells the same figures as slides, in words written from them on the server.
export const dynamic = "force-dynamic";

type Decimal = Prisma.Decimal;
const ZERO = new Prisma.Decimal(0);

const SECTIONS: { id: string; title: string; icon: LucideIcon }[] = [
  { id: "dashboards", title: "Dashboards", icon: LayoutDashboard },
  { id: "trends", title: "Trends", icon: TrendingUp },
  { id: "calculations", title: "Calculations", icon: Calculator },
  { id: "evaluations", title: "Evaluations", icon: FlaskConical },
];

type BarberRow = {
  id: string;
  name: string;
  active: boolean;
  sales: number;
  revenue: Decimal;
  commission: Decimal;
  tips: Decimal;
  earned: Decimal;
  cashPaid: Decimal;
  gcashPaid: Decimal;
  paidOut: Decimal;
  remaining: Decimal;
  additionalOwed: boolean;
};

async function loadDay(day: BusinessDay) {
  // Petty cash is only recorded with a saved count, so the live figures use the latest
  // revision's, exactly as End-of-Day Cash does.
  const saved = await latestRevision(day);
  const expected = await computeExpected(day, saved?.pettyCashAmount ?? 0);
  const [staleness, totals, sales, ledgerRows, barbers, heldForReview] = await Promise.all([
    saved ? computeStaleness(day, saved, expected) : Promise.resolve(null),
    payoutTotalsForDay(day, "LIST_PRICE"),
    prisma.transaction.findMany({
      where: { ...countsOnDay(day), paymentStatus: "PAID" },
      select: { barberId: true, totalAmount: true, amountPaid: true },
    }),
    prisma.dailyPayoutLedger.findMany({
      where: { businessDate: day.dateValue },
      select: { barberId: true, cashPaid: true, gcashPaid: true, paidAt: true },
    }),
    prisma.barber.findMany({ select: { id: true, fullName: true, isActive: true }, orderBy: { fullName: "asc" } }),
    countHeldForReview(day),
  ]);

  const salesByBarber = new Map<string, { count: number; revenue: Decimal }>();
  for (const tx of sales) {
    const current = salesByBarber.get(tx.barberId) ?? { count: 0, revenue: ZERO };
    salesByBarber.set(tx.barberId, { count: current.count + 1, revenue: current.revenue.add(tx.amountPaid ?? tx.totalAmount) });
  }
  const ledgerByBarber = new Map(ledgerRows.map((row) => [row.barberId, row]));

  // The ledger's roster rule: every active barber, plus anyone with sales or a payout row on this date.
  const rows: BarberRow[] = barbers
    .filter((barber) => barber.isActive || totals.has(barber.id) || ledgerByBarber.has(barber.id))
    .map((barber) => {
      const total = totals.get(barber.id);
      const ledger = ledgerByBarber.get(barber.id);
      const commission = total?.commission ?? ZERO;
      const tips = total?.tips ?? ZERO;
      const earned = commission.add(tips);
      const cashPaid = ledger?.cashPaid ?? ZERO;
      const gcashPaid = ledger?.gcashPaid ?? ZERO;
      const paidOut = cashPaid.add(gcashPaid);
      return {
        id: barber.id,
        name: barber.fullName,
        active: barber.isActive,
        sales: salesByBarber.get(barber.id)?.count ?? 0,
        revenue: salesByBarber.get(barber.id)?.revenue ?? ZERO,
        commission,
        tips,
        earned,
        cashPaid,
        gcashPaid,
        paidOut,
        // As on the ledger page: left to pay, never below zero.
        remaining: Prisma.Decimal.max(earned.sub(paidOut), ZERO),
        // As on the ledger: marked paid, then more sales counted on this date.
        additionalOwed: Boolean(ledger?.paidAt) && earned.gt(paidOut),
      };
    });

  return {
    saved,
    expected,
    staleness,
    rows,
    tipsTotal: [...totals.values()].reduce((sum, total) => sum.add(total.tips), ZERO),
    heldForReview,
    pendingQrph: expected.gatewaySales.filter((sale) => sale.status !== "PAID").length,
  };
}

type DayData = Awaited<ReturnType<typeof loadDay>>;

async function loadDaySafely(day: BusinessDay): Promise<DayData | null> {
  try {
    return await loadDay(day);
  } catch (error) {
    console.error("[insights] day query failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function loadTrendsSafely(day: BusinessDay, range: TrendRange): Promise<Trends | null> {
  try {
    return await loadTrends(day, range);
  } catch (error) {
    console.error("[insights] trends query failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function loadForecast(): Promise<SerializedForecast | null> {
  try {
    const { run, days } = await latestForecast();
    return serializeForecast(run, days);
  } catch (error) {
    console.error("[insights] forecast query failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const isOwner = isOwnerCookie((await cookies()).get(OWNER_COOKIE)?.value);
  if (!isOwner) {
    // No figures are loaded without the owner cookie.
    return (
      <Shell>
        <ForecastLocked
          title="Insights"
          description="Dashboards, the calculations behind them, and how well the forecast did. Owner only."
          submitLabel="Show insights"
        />
      </Shell>
    );
  }

  const today = manilaToday();
  const params = await searchParams;
  const requested = params.date;
  const day = (typeof requested === "string" ? parseBusinessDate(requested) : null) ?? parseBusinessDate(today)!;
  const range = parseTrendRange(params.days);
  const [data, trends, forecast] = await Promise.all([loadDaySafely(day), loadTrendsSafely(day, range), loadForecast()]);
  const showQrph = gatewayConfig() !== null || (data !== null && data.expected.gatewaySales.length > 0);
  const retryHref = insightsHref(day.date, range);
  const story = buildStory(storyInput({ day, today, range, data, trends, forecast, showQrph }));

  return (
    <Shell action={<InsightsPresentation story={story} />}>
      {/* Phones: two equal columns, icons hidden, so the chips sit in two tidy rows. */}
      <nav aria-label="Sections" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {SECTIONS.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="rz-btn rz-btn-secondary rounded-full px-2 sm:px-4 pointer-coarse:min-h-11"
          >
            <section.icon className="hidden sm:block w-4 h-4 text-crimson-ink" />
            {section.title}
          </a>
        ))}
      </nav>

      <DateBar day={day} today={today} range={range} />

      {data ? (
        <>
          {(data.heldForReview > 0 || data.pendingQrph > 0) && (
            <div className="space-y-2">
              {data.heldForReview > 0 && (
                <Warning>
                  {data.heldForReview} {data.heldForReview === 1 ? "sale stamped on this date is" : "sales stamped on this date are"} held
                  for date review and not in these figures. Confirm {data.heldForReview === 1 ? "its" : "their"} date on{" "}
                  <Link href="/reconciliation" className="underline rounded-sm hover:text-white">End-of-Day Cash</Link>.
                </Warning>
              )}
              {data.pendingQrph > 0 && (
                <Warning>
                  {data.pendingQrph} QR Ph {data.pendingQrph === 1 ? "sale on this date is" : "sales on this date are"} not confirmed
                  paid by the gateway, so {data.pendingQrph === 1 ? "it is" : "they are"} not in these figures.
                </Warning>
              )}
            </div>
          )}
          <Dashboards data={data} showQrph={showQrph} isToday={day.date === today} />
        </>
      ) : (
        <ErrorCard retryHref={retryHref}>
          The server can&apos;t reach the database right now, so this day&apos;s figures can&apos;t be shown.
        </ErrorCard>
      )}

      {trends ? (
        <TrendsSection trends={trends} showQrph={showQrph} forecast={forecast} today={today} />
      ) : (
        <ErrorCard retryHref={retryHref}>The trends can&apos;t be loaded right now because the database is unreachable.</ErrorCard>
      )}
      <Calculations data={data} showQrph={showQrph} forecast={forecast} today={today} />
      <Evaluations forecast={forecast} retryHref={retryHref} />

      <footer className="pt-6 border-t border-seam text-xs text-dust">
        Read-only: this page never changes a sale, a payout or a drawer count.
      </footer>
    </Shell>
  );
}

// ── Sections ─────────────────────────────────────────────────────────────────

function Dashboards({ data, showQrph, isToday }: { data: DayData; showQrph: boolean; isToday: boolean }) {
  const { expected, rows } = data;
  const average = averagePerSale(expected.totalRevenue, expected.transactionCount);
  const totals = rows.reduce(
    (sum, row) => ({
      sales: sum.sales + row.sales,
      revenue: sum.revenue.add(row.revenue),
      earned: sum.earned.add(row.earned),
      paidOut: sum.paidOut.add(row.paidOut),
      remaining: sum.remaining.add(row.remaining),
    }),
    { sales: 0, revenue: ZERO, earned: ZERO, paidOut: ZERO, remaining: ZERO }
  );

  return (
    <section id="dashboards" className="space-y-4 scroll-mt-6">
      <SectionHeading title="Dashboards" blurb="The day at a glance. Paid sales only, counted on the Manila business day." />
      {expected.transactionCount === 0 && (
        <p className="rz-notice">
          {isToday
            ? "No paid sales yet today. Sales rung up offline show here once the phones sync."
            : "No paid sales were recorded on this day. Use the arrows above to look at another day."}
        </p>
      )}
      <div className="rz-strip grid-cols-2 lg:grid-cols-4 rz-stagger">
        <Stat label="Revenue" value={peso(expected.totalRevenue)} note="Tips not included" accent="text-brass-bright" />
        <Stat label="Paid sales" value={String(expected.transactionCount)} />
        <Stat label="Average per sale" value={average ? peso(average) : "—"} />
        <Stat label="Tips to barbers" value={peso(data.tipsTotal)} note="All payment methods" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-4">
        <Card title="Payment mix">
          {expected.totalRevenue.gt(0) ? (
            <>
              <BarList
                items={paymentMethods(expected, showQrph).map((method) => ({
                  key: method.label,
                  label: method.label,
                  note: method.note,
                  valueText: peso(method.amount),
                  share: share(method.amount, expected.totalRevenue),
                }))}
              />
              <Note>Bar length is each method&apos;s share of revenue. Only cash goes in the drawer.</Note>
            </>
          ) : (
            <Note>Nothing to split yet: there is no revenue on this day.</Note>
          )}
        </Card>

        <Card title="Barbers" link={{ href: "/ledger", label: "Barber Ledger" }}>
          {rows.length === 0 ? (
            <p className="text-sm text-dust">No active barbers found.</p>
          ) : (
            <>
              {/* Phones: one block per barber, so nothing scrolls sideways. */}
              <ul className="sm:hidden divide-y divide-seam">
                {rows.map((row) => (
                  <PhoneBarberRow key={row.id} name={row.name} figures={row} inactive={!row.active} />
                ))}
                <PhoneBarberRow name="Total" figures={totals} total />
              </ul>
              {/* Wider screens: the table. */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="rz-table min-w-lg">
                  <thead>
                    <tr>
                      <th className="text-left">Barber</th>
                      <th className="text-right">Sales</th>
                      <th className="text-right">Revenue</th>
                      <th className="text-right">Earned</th>
                      <th className="text-right">Paid out</th>
                      <th className="text-right">Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td className="text-bone">
                          {row.name}
                          {!row.active && <InactiveTag />}
                        </td>
                        <td className="text-right text-bone-2">{row.sales}</td>
                        <td className="text-right text-bone-2">{peso(row.revenue)}</td>
                        <td className="text-right text-bone">{peso(row.earned)}</td>
                        <td className="text-right text-bone-2">{peso(row.paidOut)}</td>
                        <td className="text-right text-bone font-semibold">{peso(row.remaining)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="text-bone uppercase text-xs tracking-wider">Total</td>
                      <td className="text-right text-bone">{totals.sales}</td>
                      <td className="text-right text-bone">{peso(totals.revenue)}</td>
                      <td className="text-right text-bone">{peso(totals.earned)}</td>
                      <td className="text-right text-bone">{peso(totals.paidOut)}</td>
                      <td className="text-right text-brass-bright">{peso(totals.remaining)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
          <Note>Earned = commission + tips. Paid out is what was recorded on the ledger.</Note>
        </Card>
      </div>
    </section>
  );
}

function TrendsSection({
  trends,
  showQrph,
  forecast,
  today,
}: {
  trends: Trends;
  showQrph: boolean;
  forecast: SerializedForecast | null;
  today: string;
}) {
  const { totals, previous, days } = trends;
  const average = averagePerSale(totals.revenue, totals.sales);
  const perOpenDay = totals.openDays > 0 ? totals.revenue.div(totals.openDays).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) : null;
  // Ties: the most recent day, the earliest hour.
  const best = trends.daily.reduce<Trends["daily"][number] | null>((top, d) => (d.sales > 0 && (!top || d.revenue.gte(top.revenue)) ? d : top), null);
  const peak = trends.hours.reduce<Trends["hours"][number] | null>((top, h) => (h.sales > 0 && (!top || h.sales > top.sales) ? h : top), null);
  const digital = trends.byMethod.filter((m) => m.method !== "CASH").reduce((sum, m) => sum.add(m.revenue), ZERO);
  const itemsSold = trends.byService.reduce((sum, s) => sum + s.sales, 0);
  const dayLabel = (date: string) => formatDate(date, { weekday: "short", month: "short", day: "numeric" });
  const period = `${formatDate(trends.first, { month: "short", day: "numeric" })} – ${formatDate(trends.last, { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <section id="trends" className="space-y-4 scroll-mt-6">
      <SectionHeading
        title="Trends"
        blurb={`The ${days} days up to the chosen day (${period}). Paid sales only, each counted on its business day, compared with the ${days} days before.`}
      />
      {trends.heldForReview > 0 && (
        <Warning>
          {plural(trends.heldForReview, "sale")} in these days {trends.heldForReview === 1 ? "is" : "are"} held for date review and not in
          these figures. Confirm {trends.heldForReview === 1 ? "its" : "their"} date on{" "}
          <Link href="/reconciliation" className="underline rounded-sm">End-of-Day Cash</Link>.
        </Warning>
      )}
      {totals.sales === 0 && (
        <p className="rz-notice">
          No paid sales in these {days} days. Pick another day or a longer period above.
        </p>
      )}

      <div className="rz-strip grid-cols-2 lg:grid-cols-4 rz-stagger">
        <Stat label="Revenue" value={peso(totals.revenue)} accent="text-brass-bright" delta={change(totals.revenue, previous.revenue, days)} />
        <Stat
          label="Paid sales"
          value={String(totals.sales)}
          delta={change(new Prisma.Decimal(totals.sales), new Prisma.Decimal(previous.sales), days)}
        />
        <Stat label="Average per open day" value={perOpenDay ? peso(perOpenDay) : "—"} note={`${totals.openDays} of ${days} days had sales`} />
        <Stat label="Average per sale" value={average ? peso(average) : "—"} note="Revenue ÷ paid sales" />
        <Stat
          label="Best day"
          value={best ? peso(best.revenue) : "—"}
          note={best ? `${dayLabel(best.date)} · ${plural(best.sales, "sale")}` : "No sales yet"}
        />
        <Stat
          label="Busiest hour"
          value={peak ? hourRange(peak.hour) : "—"}
          note={peak ? `${plural(peak.sales, "sale")} in this hour over ${days} days` : "No sales yet"}
        />
        <Stat label="Tips to barbers" value={peso(totals.tips)} note="Not part of revenue" />
        <Stat
          label="Paid digitally"
          value={totals.revenue.gt(0) ? `${Math.round(share(digital, totals.revenue) ?? 0)}%` : "—"}
          note={`${peso(digital)} by GCash, Maya or QR Ph`}
        />
      </div>

      {totals.sales > 0 && (
        <>
          <Card title="Revenue per day">
            <ColumnChart
              columns={trends.daily.map((d) => ({
                key: d.date,
                axisLabel: days === 7 ? formatDate(d.date, { weekday: "short" }) : String(Number(d.date.slice(8))),
                label: dayLabel(d.date),
                value: d.revenue.toNumber(),
                valueText: peso(d.revenue),
                detail: plural(d.sales, "paid sale"),
                emphasis: d.date === trends.last,
              }))}
              unit="peso"
              summary={`Revenue per day, ${period}.${best ? ` Highest ${peso(best.revenue)} on ${dayLabel(best.date)}.` : ""} Total ${peso(totals.revenue)}.`}
              labelHeading="Day"
              valueHeading="Revenue"
              labelEvery={days === 7 ? 1 : days === 14 ? 2 : 5}
            />
            <Note>The chosen day is red; tap or hover a column, or use the arrow keys, for its figures.</Note>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Busy hours">
              <Rule>Paid sales by the hour they were rung up (Manila time), over all {days} days. The busiest hour is red.</Rule>
              <ColumnChart
                columns={trends.hours.map((h) => ({
                  key: String(h.hour),
                  axisLabel: shortHour(h.hour),
                  label: hourRange(h.hour),
                  value: h.sales,
                  valueText: plural(h.sales, "paid sale"),
                  emphasis: peak?.hour === h.hour,
                }))}
                unit="count"
                summary={`Paid sales by hour of the day over ${days} days.${peak ? ` Busiest ${hourRange(peak.hour)} with ${plural(peak.sales, "sale")}.` : ""}`}
                labelHeading="Hour"
                valueHeading="Paid sales"
                labelEvery={2}
                height={144}
              />
              {trends.hourExcluded > 0 && (
                <Note>
                  {plural(trends.hourExcluded, "sale")} with a corrected date {trends.hourExcluded === 1 ? "is" : "are"} left out: the
                  phone&apos;s clock was wrong, so the hour is not known.
                </Note>
              )}
            </Card>

            <Card title="Revenue by barber" link={{ href: "/ledger", label: "Barber Ledger" }}>
              <BarList
                items={trends.byBarber.map((b) => ({
                  key: b.name,
                  label: b.name,
                  note: plural(b.sales, "sale"),
                  valueText: peso(b.revenue),
                  share: share(b.revenue, totals.revenue),
                }))}
              />
              <Note>Bar length is each barber&apos;s share of revenue. Earnings and payouts are on the ledger.</Note>
            </Card>

            <Card title="Services sold">
              <BarList
                items={trends.byService.map((s) => ({
                  key: s.name,
                  label: s.name,
                  valueText: plural(s.sales, "sale"),
                  share: itemsSold > 0 ? (s.sales / itemsSold) * 100 : null,
                }))}
              />
              <Note>Custom amounts count under the service that was picked.</Note>
            </Card>

            <Card title="Payment methods">
              <BarList
                items={trendMethods(trends, showQrph)
                  .map((m) => ({
                    key: m.method,
                    label: METHOD_LABELS[m.method],
                    note: m.method === "CASH" ? "in the drawer" : "digital",
                    valueText: peso(m.revenue),
                    share: share(m.revenue, totals.revenue),
                  }))}
              />
            </Card>
          </div>
        </>
      )}

      <ForecastChart forecast={forecast} today={today} />
    </section>
  );
}

// The saved 7-day forecast as columns. Shown only when a forecast covers today; the Evaluations
// section already explains a missing one.
function ForecastChart({ forecast, today }: { forecast: SerializedForecast | null; today: string }) {
  const days = (forecast?.days ?? []).filter((d) => d.date >= today && d.customers !== null);
  if (!forecast?.run || days.length === 0) return null;
  const values = days.map((d) => d.customers ?? 0);
  return (
    <Card title={`Next ${days.length} days (forecast)`} link={{ href: "/", label: "Forecast" }}>
      <Rule>Expected customers per day from the latest saved forecast; the expected revenue is in the tooltip and the table.</Rule>
      <ColumnChart
        columns={days.map((d) => ({
          key: d.date,
          axisLabel: formatDate(d.date, { weekday: "short" }),
          label: formatDate(d.date, { weekday: "short", month: "short", day: "numeric" }),
          value: d.customers ?? 0,
          valueText: `${(d.customers ?? 0).toFixed(1)} customers`,
          detail: `${peso(d.revenue)} expected revenue`,
        }))}
        unit="count"
        summary={`Expected customers for the next ${days.length} days, from ${Math.min(...values).toFixed(1)} to ${Math.max(...values).toFixed(1)} a day.`}
        labelHeading="Day"
        valueHeading="Expected customers"
        height={144}
      />
    </Card>
  );
}

function Calculations({
  data,
  showQrph,
  forecast,
  today,
}: {
  data: DayData | null;
  showQrph: boolean;
  forecast: SerializedForecast | null;
  today: string;
}) {
  return (
    <section id="calculations" className="space-y-4 scroll-mt-6">
      <SectionHeading
        title="Calculations"
        blurb="Each figure worked out with this day's numbers, by the same rules End-of-Day Cash, the ledger and the forecast use."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data && <RevenueCalc data={data} showQrph={showQrph} />}
        {data && <AverageCalc data={data} />}
        {data && <DrawerCalc data={data} />}
        <ForecastRevenueCalc forecast={forecast} today={today} />
      </div>
      {data && <EarningsCalc rows={data.rows} />}
    </section>
  );
}

function Evaluations({ forecast, retryHref }: { forecast: SerializedForecast | null; retryHref: string }) {
  const run = forecast?.run ?? null;
  return (
    <section id="evaluations" className="space-y-4 scroll-mt-6">
      <SectionHeading
        title="Evaluations"
        blurb="How close the 7-day forecast came on past weeks of the paper logbook, from the latest saved forecast."
      />
      {forecast === null ? (
        <ErrorCard retryHref={retryHref}>The saved forecast can&apos;t be loaded right now because the database is unreachable.</ErrorCard>
      ) : run === null ? (
        <Card title="No forecast saved yet">
          <p className="text-sm text-dust">
            Start the forecast service, open the home page and press Refresh forecast. The evaluation is saved with each forecast.
          </p>
        </Card>
      ) : (
        <EvaluationBody run={run} />
      )}
    </section>
  );
}

// ── Calculation cards ────────────────────────────────────────────────────────

function RevenueCalc({ data, showQrph }: { data: DayData; showQrph: boolean }) {
  const { expected } = data;
  const lines: Line[] = [
    { label: "Cash", value: peso(expected.cashSales) },
    { op: "+", label: "GCash", value: peso(expected.gcashTotal) },
    { op: "+", label: "Maya", value: peso(expected.mayaTotal) },
  ];
  if (showQrph) lines.push({ op: "+", label: "QR Ph", value: peso(expected.qrphTotal) });
  lines.push({ op: "=", label: "Revenue", value: peso(expected.totalRevenue) });
  return (
    <Card title="Revenue" link={{ href: "/reconciliation", label: "End-of-Day Cash" }}>
      <Rule>What customers paid on this day&apos;s paid sales. Tips are not revenue; they go to the barber.</Rule>
      <Tape lines={lines} />
    </Card>
  );
}

function AverageCalc({ data }: { data: DayData }) {
  const { expected } = data;
  const average = averagePerSale(expected.totalRevenue, expected.transactionCount);
  return (
    <Card title="Average per sale">
      <Rule>Revenue divided by the number of paid sales, rounded to the centavo.</Rule>
      {average ? (
        <Tape
          lines={[
            { label: "Revenue", value: peso(expected.totalRevenue) },
            { op: "÷", label: "Paid sales", value: String(expected.transactionCount) },
            { op: "=", label: "Average per sale", value: peso(average) },
          ]}
        />
      ) : (
        <Note>No paid sales on this day, so there is no average yet.</Note>
      )}
    </Card>
  );
}

function DrawerCalc({ data }: { data: DayData }) {
  const { expected, saved, staleness } = data;
  return (
    <Card title="Expected drawer cash" link={{ href: "/reconciliation", label: "End-of-Day Cash" }}>
      <Rule>Cash that should be in the drawer at closing. GCash, Maya and QR Ph never enter it.</Rule>
      <Tape
        lines={[
          { label: "Cash sales", value: peso(expected.cashSales) },
          { op: "+", label: "Tips on cash sales", value: peso(expected.cashTips) },
          { op: "−", label: "Cash payouts marked paid", value: peso(expected.cashPayouts) },
          { op: "−", label: "Petty cash", value: peso(expected.pettyCash) },
          { op: "=", label: "Expected drawer cash", value: peso(expected.expectedDrawerCash) },
        ]}
      />
      <Note>
        {saved
          ? `Petty cash is from the count saved ${manilaTime(saved.reconciledAt)} (revision ${saved.revision}).`
          : "No count saved for this day yet, so petty cash is ₱0.00. It is entered when the drawer is counted."}
      </Note>
      {saved && <SavedCount saved={saved} staleness={staleness} expectedNow={expected.expectedDrawerCash} />}
    </Card>
  );
}

function SavedCount({ saved, staleness, expectedNow }: { saved: ShiftReconciliation; staleness: Staleness | null; expectedNow: Decimal }) {
  // Same thresholds and words as End-of-Day Cash.
  const balanced = saved.variance.abs().lt(0.01);
  const status = balanced
    ? { label: "Balanced", icon: CheckCircle2, className: "bg-ok/10 border-ok/30 text-ok-ink" }
    : saved.variance.isNegative()
    ? { label: "Cash short", icon: AlertTriangle, className: "bg-crimson/12 border-crimson-bright/40 text-crimson-ink" }
    : { label: "Cash over", icon: AlertTriangle, className: "bg-over/10 border-over/35 text-over-ink" };
  return (
    <div className="pt-4 border-t border-seam space-y-2.5">
      <p className="text-xs font-semibold text-bone-2">Last saved count · revision {saved.revision}</p>
      {staleness?.stale && <StaleNotice staleness={staleness} expectedNow={expectedNow} />}
      <Tape
        lines={[
          { label: "Counted cash", value: peso(saved.countedCash) },
          { op: "−", label: "Expected cash when saved", value: peso(saved.expectedCash) },
          { op: "=", label: staleness?.stale ? "Variance when saved" : "Variance", value: signedPeso(saved.variance) },
        ]}
      />
      <div className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-bold border ${status.className}`}>
        <status.icon className="w-4 h-4" />
        {status.label}
      </div>
    </div>
  );
}

function StaleNotice({ staleness, expectedNow }: { staleness: Staleness; expectedNow: Decimal }) {
  const was = (count: number) => (count === 1 ? "was" : "were");
  return (
    <div className="rz-notice rz-notice-warn text-xs">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <div className="space-y-0.5">
        <p className="font-bold">Out of date: this count no longer matches the register.</p>
        {staleness.staleReasons.includes("LATE_SYNCED_TRANSACTIONS") && (
          <p>{plural(staleness.lateSyncedCount, "sale")} for this date synced after it was saved.</p>
        )}
        {staleness.staleReasons.includes("LATE_GATEWAY_CONFIRMATIONS") && (
          <p>
            {plural(staleness.lateConfirmedCount, "QR Ph sale")} {was(staleness.lateConfirmedCount)} confirmed paid after it was saved
            (revenue changed; the drawer did not).
          </p>
        )}
        {staleness.staleReasons.includes("TIME_REVIEWED") && (
          <p>
            {plural(staleness.lateReviewedCount, "sale")} {was(staleness.lateReviewedCount)} confirmed onto this date after it was saved.
          </p>
        )}
        {staleness.staleReasons.includes("EXPECTED_CASH_CHANGED") && (
          <p>
            Expected drawer cash is now {peso(expectedNow)} ({signedPeso(staleness.expectedCashDelta)}).
          </p>
        )}
        <p>Count the drawer again on End-of-Day Cash to save a new revision.</p>
      </div>
    </div>
  );
}

function EarningsCalc({ rows }: { rows: BarberRow[] }) {
  return (
    <Card title="Barber earnings" link={{ href: "/ledger", label: "Barber Ledger" }}>
      <Rule>
        Commission is the sum saved with each sale: its list price × the barber&apos;s rate at the time, so a later rate change never
        rewrites a past day. Tips go 100% to the barber. Paid amounts are what the owner recorded on the ledger.
      </Rule>
      {rows.length === 0 ? (
        <p className="text-sm text-dust">No active barbers found.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {rows.map((row) => (
            <div key={row.id} className="space-y-2.5">
              <p className="text-sm font-semibold text-bone">
                {row.name}
                {!row.active && <InactiveTag />}
              </p>
              <Tape
                lines={[
                  { label: `Commission (${plural(row.sales, "paid sale")})`, value: peso(row.commission) },
                  { op: "+", label: "Tips", value: peso(row.tips) },
                  { op: "=", label: "Earned", value: peso(row.earned) },
                  { op: "−", label: "Cash paid", value: peso(row.cashPaid) },
                  { op: "−", label: "GCash paid", value: peso(row.gcashPaid) },
                  { op: "=", label: "Remaining to pay", value: peso(row.remaining) },
                ]}
              />
              {row.paidOut.gt(row.earned) && <Note>Paid more than earned, so remaining to pay stays at ₱0.00.</Note>}
              {row.additionalOwed && (
                <Warning>
                  Additional owed: sales synced or confirmed onto this date after the payout was marked paid. The amount already paid
                  is unchanged.
                </Warning>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ForecastRevenueCalc({ forecast, today }: { forecast: SerializedForecast | null; today: string }) {
  const run = forecast?.run ?? null;
  const first = forecast?.days.find((day) => day.date >= today && day.customers !== null) ?? null;
  const customers = first?.customers ?? null;
  const longDate = (iso: string) => formatDate(iso, { month: "short", day: "numeric", year: "numeric" });
  return (
    <Card title="Forecast revenue" link={{ href: "/", label: "Forecast" }}>
      <Rule>
        Expected customers × the average amount paid per customer in the logbook the model was trained on. It is not today&apos;s list
        price.
      </Rule>
      {run && first && customers !== null ? (
        <>
          <Tape
            lines={[
              { label: `Expected customers, ${formatDate(first.date, { weekday: "short", month: "short", day: "numeric" })}`, value: customers.toFixed(1) },
              { op: "×", label: "Average paid per customer", value: peso(run.avgTicket) },
              { op: "=", label: "Forecast revenue", value: peso(first.revenue) },
            ]}
          />
          <Note>
            Average from the logbook, {longDate(run.dataFrom)} to {longDate(run.dataTo)}. Every day of the 7-day forecast uses the
            same rule.
          </Note>
        </>
      ) : (
        <Note>
          {forecast === null
            ? "The saved forecast can't be loaded right now."
            : "No saved forecast covers today yet. Open the home page and press Refresh forecast once the forecast service is running."}
        </Note>
      )}
    </Card>
  );
}

// ── Evaluation ───────────────────────────────────────────────────────────────

function EvaluationBody({ run }: { run: NonNullable<SerializedForecast["run"]> }) {
  const shortDate = (iso: string) => formatDate(iso, { month: "short", day: "numeric", year: "numeric" });
  const bestName = METHOD_NAMES[run.bestBaseline] ?? run.bestBaseline;
  const typicalError = Number(run.typicalErrorCustomers);
  return (
    <>
      {run.comparison && <p className="text-xs font-semibold text-brass-bright">{basisLine(run.comparison, shortDate)}</p>}
      <div className="rz-strip grid-cols-1 sm:grid-cols-3 rz-stagger">
        <Stat
          label="Forecast off by"
          value={typicalError.toFixed(2)}
          note={`customers a day, about ${wholePeso(new Prisma.Decimal(run.typicalErrorCustomers).mul(run.avgTicket))} of revenue`}
          accent="text-crimson-ink"
        />
        <Stat label="Best simple guess off by" value={Number(run.bestBaselineError).toFixed(2)} note={`customers a day (${bestName})`} />
        <Stat
          label="Weeks the forecast won"
          value={`${run.weeksRfWon} of ${run.weeksTested}`}
          note="weeks Random Forest was closer than the best simple guess"
        />
      </div>

      <Card title="How the forecast is tested">
        <ol className="list-decimal marker:text-brass marker:font-semibold pl-5 space-y-1.5 text-sm text-bone-2 leading-relaxed max-w-prose">
          <li>The forecast is checked on the last {run.weeksTested} weeks of the paper logbook, one week at a time.</li>
          <li>
            For each week, every method learns only from the logbook days before it, then guesses how many customers came on each open
            day of that week.
          </li>
          <li>
            <span className="text-bone font-semibold">Off by</span> is the average gap between the guess and the logbook, in customers
            a day. Lower is better.
          </li>
          <li>
            <span className="text-bone font-semibold">Week-to-week swing</span> is how much that gap changed from one week to the
            next. Smaller is steadier.
          </li>
          <li>
            The forecast (Random Forest) wins a week when it is closer than the best simple guess, which is the simple method with the
            lowest average gap ({bestName.toLowerCase()}).
          </li>
        </ol>
        <MethodComparison run={run} />
      </Card>

      <Card title="The model behind the forecast">
        <dl className="rz-well grid grid-cols-1 sm:grid-cols-2 overflow-hidden text-sm">
          {[
            { label: "Model version", value: run.modelVersion },
            { label: "Logbook used", value: `${shortDate(run.dataFrom)} to ${shortDate(run.dataTo)}` },
            { label: "Open days used", value: String(run.trainingDays) },
            { label: "Average paid per customer", value: peso(run.avgTicket) },
            { label: "Forecast saved", value: shortDate(run.createdOn) },
          ].map((item) => (
            <div key={item.label} className="flex justify-between gap-3 px-3.5 py-2.5 shadow-[0_1px_0_var(--color-seam),1px_0_0_var(--color-seam)]">
              <dt className="text-dust">{item.label}</dt>
              <dd className="text-bone text-right break-all">{item.value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </>
  );
}

// ── Building blocks ──────────────────────────────────────────────────────────

// `action` sits beside the title (under it on phones): presentation mode, for the owner only.
function Shell({ action, children }: { action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative flex-1 overflow-x-hidden">
      <main className="rz-page relative max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-12">
        <header className="space-y-5">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 -my-2 py-2 pointer-coarse:-my-3 pointer-coarse:py-3 rounded-sm text-sm text-dust hover:text-bone transition-colors group"
          >
            <ArrowLeft className="w-4 h-4 transition-transform duration-200 group-hover:-translate-x-0.5" /> Home
          </Link>
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="space-y-2">
              <h1 className="rz-title text-4xl sm:text-5xl">
                Insights
              </h1>
              <p className="text-sm sm:text-base text-dust max-w-2xl leading-relaxed">
                Dashboards, calculations and evaluations, from the same numbers as End-of-Day Cash, the Barber Ledger and the forecast.
              </p>
            </div>
            {action}
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

// The page's one filter row: the business day (dashboards, calculations) and the trend period.
function DateBar({ day, today, range }: { day: BusinessDay; today: string; range: TrendRange }) {
  const previous = addDays(day.date, -1);
  const next = addDays(day.date, 1);
  // 36px controls, 44px on touch screens.
  const control = "min-h-9 pointer-coarse:min-h-11";
  const stepClass = `rz-btn rz-btn-secondary rz-btn-icon ${control} pointer-coarse:min-w-11`;
  return (
    <div className="rz-panel p-3 sm:p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <form method="get" action="/insights" className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="days" value={range} />
          <label htmlFor="insights-date" className="text-sm text-dust">
            Business date
          </label>
          {/* 16px text on phones, so iOS does not zoom in when the field gets focus. */}
          <input
            id="insights-date"
            type="date"
            name="date"
            defaultValue={day.date}
            max={today}
            className={`rz-field w-auto py-1 ${control} sm:text-sm scheme-dark`}
          />
          <button
            type="submit"
            className={`rz-btn rz-btn-primary ${control} px-4`}
          >
            Show
          </button>
        </form>
        <div role="group" aria-label="Trend period" className="rz-seg">
          {TREND_RANGES.map((option) => (
            <Link
              key={option}
              href={insightsHref(day.date, option)}
              scroll={false}
              aria-current={option === range ? "true" : undefined}
              className="rz-seg-item min-h-7 px-3 pointer-coarse:min-h-11"
            >
              {option} days
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <Link href={insightsHref(previous, range)} aria-label="Previous day" className={stepClass}>
            <ChevronLeft className="w-4 h-4" />
          </Link>
          {day.date !== today && (
            <Link href={insightsHref(null, range)} className={`${stepClass} px-3 text-sm font-semibold`}>
              Today
            </Link>
          )}
          {next <= today ? (
            <Link href={insightsHref(next, range)} aria-label="Next day" className={stepClass}>
              <ChevronRight className="w-4 h-4" />
            </Link>
          ) : (
            <span aria-hidden className={`${stepClass} opacity-30 pointer-events-none`}>
              <ChevronRight className="w-4 h-4" />
            </span>
          )}
        </div>
      </div>
      <p className="text-xs text-dust leading-relaxed">
        {formatDate(day.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}, Manila time. Dashboards and
        calculations use this day; trends use the {range} days up to it; the forecast parts use the latest saved forecast.
      </p>
    </div>
  );
}

function SectionHeading({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="space-y-1.5">
      <h2 className="rz-heading text-xl text-bone">
        {title}
      </h2>
      <p className="text-sm text-dust max-w-prose leading-relaxed">{blurb}</p>
    </div>
  );
}

function Card({ title, link, children }: { title: string; link?: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <div className="rz-panel p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display font-semibold uppercase tracking-[0.06em] text-base text-bone">{title}</h3>
        {link && (
          // Padding with matching negative margins: a bigger target (28px, 44px on touch) without moving the layout.
          <Link
            href={link.href}
            className="inline-flex items-center gap-0.5 -my-1.5 py-1.5 -mx-1.5 px-1.5 pointer-coarse:-my-3.5 pointer-coarse:py-3.5 rounded-md text-xs font-semibold text-dust hover:text-crimson-ink shrink-0 transition-colors group"
          >
            {link.label}
            <ChevronRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

type Delta = { text: string; trend: "up" | "down" | "flat" };

function Stat({ label, value, note, delta, accent = "text-bone" }: { label: string; value: string; note?: string; delta?: Delta; accent?: string }) {
  return (
    <div className="space-y-1.5 px-4 py-4">
      <div className="rz-label">{label}</div>
      <div className={`rz-figure text-2xl sm:text-3xl ${accent}`}>{value}</div>
      {note && <p className="text-xs text-dust leading-relaxed">{note}</p>}
      {/* Up is good for every figure that has a delta here: icon and words, not colour alone. */}
      {delta && (
        <p
          className={`flex items-start gap-1 text-xs ${
            delta.trend === "up" ? "text-ok-ink" : delta.trend === "down" ? "text-crimson-ink" : "text-dust"
          }`}
        >
          {delta.trend === "up" ? (
            <TrendingUp className="w-3.5 h-3.5 mt-px shrink-0" />
          ) : delta.trend === "down" ? (
            <TrendingDown className="w-3.5 h-3.5 mt-px shrink-0" />
          ) : (
            <Minus className="w-3.5 h-3.5 mt-px shrink-0" />
          )}
          {delta.text}
        </p>
      )}
    </div>
  );
}

type BarberFigures = Pick<BarberRow, "sales" | "revenue" | "earned" | "paidOut" | "remaining">;

// The Barbers table as stacked rows, for phone widths.
function PhoneBarberRow({ name, figures, inactive = false, total = false }: { name: string; figures: BarberFigures; inactive?: boolean; total?: boolean }) {
  return (
    <li className="py-3 space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className={total ? "font-bold text-bone uppercase text-xs tracking-wider" : "text-bone"}>
          {name}
          {inactive && <InactiveTag />}
        </span>
        <span className="text-xs text-dust">{plural(figures.sales, "sale")}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs tabular-nums">
        {[
          { label: "Revenue", value: peso(figures.revenue) },
          { label: "Earned", value: peso(figures.earned) },
          { label: "Paid out", value: peso(figures.paidOut) },
          { label: "Remaining", value: peso(figures.remaining) },
        ].map((field) => (
          <div key={field.label} className="flex justify-between gap-2">
            <dt className="text-dust">{field.label}</dt>
            <dd className={field.label === "Remaining" ? `font-semibold ${total ? "text-brass-bright" : "text-bone"}` : "text-bone-2"}>{field.value}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

type Line = { op?: "+" | "−" | "×" | "÷" | "="; label: string; value: string };

// A formula as an adding-machine tape: one operand per line, results on the "=" lines in brass.
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

// The rule behind a figure, in words. max-w-prose keeps lines readable in wide cards.
function Rule({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-dust leading-relaxed max-w-prose">{children}</p>;
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-dust leading-relaxed max-w-prose">{children}</p>;
}

function InactiveTag() {
  return <span className="ml-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-dust-2">inactive</span>;
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-rise rz-notice rz-notice-warn">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

function ErrorCard({ children, retryHref }: { children: React.ReactNode; retryHref: string }) {
  return (
    <div className="rz-notice rz-notice-danger flex-wrap items-center justify-between gap-3 p-4">
      <p>{children}</p>
      <Link
        href={retryHref}
        className="rz-btn rz-btn-secondary min-h-9 pointer-coarse:min-h-11 px-3"
      >
        Try again
      </Link>
    </div>
  );
}

// ── Formatting and small figures ─────────────────────────────────────────────

function paymentMethods(expected: ExpectedTotals, showQrph: boolean) {
  const methods = [
    { label: "Cash", amount: expected.cashSales, note: "in the drawer", digital: false },
    { label: "GCash", amount: expected.gcashTotal, note: "digital", digital: true },
    { label: "Maya", amount: expected.mayaTotal, note: "digital", digital: true },
  ];
  if (showQrph) methods.push({ label: "QR Ph", amount: expected.qrphTotal, note: "gateway, test mode", digital: true });
  return methods;
}

// The trend period's payment methods: QR Ph only while the gateway is on or it took money.
function trendMethods(trends: Trends, showQrph: boolean) {
  return trends.byMethod.filter((m) => m.method !== "QRPH" || showQrph || m.revenue.gt(0));
}

const manilaHourFormat = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", hourCycle: "h23" });

// Presentation mode's input: the figures the sections above show, as plain numbers. Every sum
// and rounded average is the page's own (Decimal); the story only compares and words them.
function storyInput({
  day,
  today,
  range,
  data,
  trends,
  forecast,
  showQrph,
}: {
  day: BusinessDay;
  today: string;
  range: TrendRange;
  data: DayData | null;
  trends: Trends | null;
  forecast: SerializedForecast | null;
  showQrph: boolean;
}): StoryInput {
  const run = forecast?.run ?? null;
  return {
    today,
    date: day.date,
    days: range,
    manilaHour: Number(manilaHourFormat.format(new Date())),
    day: data && {
      revenue: data.expected.totalRevenue.toNumber(),
      sales: data.expected.transactionCount,
      average: averagePerSale(data.expected.totalRevenue, data.expected.transactionCount)?.toNumber() ?? null,
      tips: data.tipsTotal.toNumber(),
      methods: paymentMethods(data.expected, showQrph).map((m) => ({ label: m.label, amount: m.amount.toNumber(), digital: m.digital })),
      expectedDrawer: data.expected.expectedDrawerCash.toNumber(),
      // Same thresholds as the saved count on End-of-Day Cash.
      drawer: data.saved && {
        status: data.saved.variance.abs().lt(0.01) ? "balanced" : data.saved.variance.isNegative() ? "short" : "over",
        variance: data.saved.variance.toNumber(),
        stale: data.staleness?.stale ?? false,
        revision: data.saved.revision,
      },
      barbers: data.rows.map((row) => ({
        name: row.name,
        sales: row.sales,
        earned: row.earned.toNumber(),
        remaining: row.remaining.toNumber(),
        additionalOwed: row.additionalOwed,
      })),
      heldForReview: data.heldForReview,
      pendingQrph: data.pendingQrph,
    },
    trends: trends && {
      first: trends.first,
      daily: trends.daily.map((d) => ({ date: d.date, revenue: d.revenue.toNumber(), sales: d.sales })),
      hours: trends.hours,
      hourExcluded: trends.hourExcluded,
      byBarber: trends.byBarber.map((b) => ({ name: b.name, revenue: b.revenue.toNumber(), sales: b.sales })),
      byService: trends.byService,
      byMethod: trendMethods(trends, showQrph).map((m) => ({ label: METHOD_LABELS[m.method], revenue: m.revenue.toNumber(), digital: m.method !== "CASH" })),
      revenue: trends.totals.revenue.toNumber(),
      sales: trends.totals.sales,
      tips: trends.totals.tips.toNumber(),
      openDays: trends.totals.openDays,
      // The same divisions (and rounding) as the Trends figures.
      perOpenDay: averagePerSale(trends.totals.revenue, trends.totals.openDays)?.toNumber() ?? null,
      average: averagePerSale(trends.totals.revenue, trends.totals.sales)?.toNumber() ?? null,
      previous: { revenue: trends.previous.revenue.toNumber(), sales: trends.previous.sales },
      heldForReview: trends.heldForReview,
    },
    forecast: forecast && {
      run: run && {
        createdOn: run.createdOn,
        avgTicket: Number(run.avgTicket),
        typicalError: Number(run.typicalErrorCustomers),
        bestBaseline: METHOD_NAMES[run.bestBaseline] ?? run.bestBaseline,
        weeksWon: run.weeksRfWon,
        weeksTested: run.weeksTested,
      },
      // As the forecast chart: the saved days from today on.
      days: forecast.days
        .filter((d) => d.date >= today && d.customers !== null)
        .map((d) => ({ date: d.date, customers: d.customers ?? 0, revenue: Number(d.revenue) })),
    },
  };
}

const METHOD_LABELS: Record<PaymentMethod, string> = { CASH: "Cash", GCASH: "GCash", MAYA: "Maya", QRPH: "QR Ph" };

// Percent of the whole to one decimal, or null when there is nothing to divide.
function share(part: Decimal, whole: Decimal) {
  return whole.gt(0) ? Number(part.div(whole).mul(100).toFixed(1)) : null;
}

// Change against the same number of days just before, rounded to a whole percent.
function change(current: Decimal, previous: Decimal, days: number): Delta {
  const before = `the ${days} days before`;
  if (previous.isZero()) {
    return current.isZero() ? { text: `Same as ${before}`, trend: "flat" } : { text: `Up from nothing in ${before}`, trend: "up" };
  }
  const percent = Math.round(current.sub(previous).div(previous).mul(100).toNumber());
  if (percent === 0) return { text: `About the same as ${before}`, trend: "flat" };
  return { text: `${percent > 0 ? "+" : "−"}${Math.abs(percent)}% vs ${before}`, trend: percent > 0 ? "up" : "down" };
}

// Hours as "2–3 PM" (tooltips, tables) and "2p" (axis labels).
function hourRange(hour: number) {
  const name = (h: number) => `${h % 12 || 12}`;
  const half = (h: number) => (h % 24 < 12 ? "AM" : "PM");
  return half(hour) === half(hour + 1)
    ? `${name(hour)}–${name(hour + 1)} ${half(hour)}`
    : `${name(hour)} ${half(hour)}–${name(hour + 1)} ${half(hour + 1)}`;
}

function shortHour(hour: number) {
  return `${hour % 12 || 12}${hour < 12 ? "a" : "p"}`;
}

// /insights links keep the chosen day and trend period; the defaults are left out of the URL.
function insightsHref(date: string | null, days: TrendRange) {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (days !== DEFAULT_TREND_RANGE) params.set("days", String(days));
  const query = params.toString();
  return query ? `/insights?${query}` : "/insights";
}

function averagePerSale(revenue: Decimal, sales: number) {
  return sales > 0 ? revenue.div(sales).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) : null;
}

const pesoFormat = new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ₱1,234.50; a negative amount as −₱1,234.50.
function peso(value: Prisma.Decimal.Value) {
  const amount = new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return `${amount.isNegative() && !amount.isZero() ? "−" : ""}₱${pesoFormat.format(amount.abs().toNumber())}`;
}

function signedPeso(value: Prisma.Decimal.Value) {
  const amount = new Prisma.Decimal(value);
  return `${amount.gt(0) ? "+" : ""}${peso(amount)}`;
}

function wholePeso(value: Prisma.Decimal.Value) {
  return `₱${Math.round(new Prisma.Decimal(value).toNumber()).toLocaleString("en-PH")}`;
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// Business dates are YYYY-MM-DD calendar dates: format them as dates, not as instants.
function formatDate(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-PH", { ...options, timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

function manilaTime(instant: Date) {
  return new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(
    instant
  );
}

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { ColumnChart } from "@/components/ColumnChart";
import { ForecastLocked } from "@/components/ForecastPanel";
import { latestForecast, serializeForecast, type SerializedForecast } from "@/lib/forecast";
import { forecastChart } from "@/lib/forecast-chart";
import { COMPARISON_ONLY, buildReportView, type ReportView } from "@/lib/forecast-comparison";
import { forecastPageDays, forecastTakeaways } from "@/lib/forecast-page";
import { ownerPageAccess } from "@/lib/owner-access";
import { manilaToday } from "@/lib/business-date";
import { REVENUE_LABEL, revenueExample, type RevenueExample } from "@/lib/forecast-revenue";
import { peso, pesoWhole } from "@/lib/peso";

// Slice 10 and 28: the Forecast page. Owner only; reads the saved run from the database and never
// calls the forecast service, so it still shows when the service is down.
export const dynamic = "force-dynamic";

type Run = NonNullable<SerializedForecast["run"]>;

// Dates are YYYY-MM-DD business dates; format them as calendar dates, not as instants.
function formatDate(date: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) {
  return new Intl.DateTimeFormat("en-PH", { ...options, timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

async function load(): Promise<SerializedForecast | null> {
  try {
    const { run, days } = await latestForecast();
    return serializeForecast(run, days);
  } catch (error) {
    console.error("[forecast] query failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

const dashboardLink =
  "underline rounded-sm hover:text-bone inline-block pointer-coarse:py-3.5 pointer-coarse:-my-3.5";

export default async function ForecastPage() {
  const isOwner = await ownerPageAccess();
  const forecast = isOwner ? await load() : null;
  const run = forecast?.run ?? null;
  const view = run ? buildReportView(run.comparison, (iso) => formatDate(iso)) : null;
  const today = manilaToday();
  const example = revenueExample(forecast, today);
  const page = forecastPageDays(forecast, today);
  const takeaways = run ? forecastTakeaways(run, view) : null;

  return (
    <main className="flex-1">
      <div className="rz-page max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
        <header className="space-y-1">
          <h1 className="rz-title text-3xl">Forecast</h1>
          <p className="text-sm text-dust max-w-prose">
            Customers the model expects in the next days, how the peso estimate is worked out, and how the forecast was checked.
          </p>
          {isOwner && run && (
            <p className="text-xs text-dust">
              Saved on {formatDate(run.createdOn)} · model {run.modelVersion}
            </p>
          )}
          {isOwner && run && page.stale && (
            <p className="text-xs text-bone-2">
              This forecast was saved on {formatDate(run.createdOn)}. Refresh it on the{" "}
              <Link href="/" className={dashboardLink}>Dashboard</Link>.
            </p>
          )}
        </header>

        {!isOwner ? (
          <ForecastLocked description="How the forecast is checked and how its revenue estimate is worked out. Owner only." />
        ) : !forecast ? (
          <p className="rz-notice rz-notice-danger">
            <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
            The saved forecast can&apos;t be loaded right now because the database is unreachable.
          </p>
        ) : !run ? (
          <p className="text-sm text-dust">
            No forecast has been saved yet. Refresh it on the <Link href="/" className={dashboardLink}>Dashboard</Link>.
          </p>
        ) : (
          <>
            <NextDays run={run} page={page} />
            <RevenueExplained run={run} example={example} />
            <section className="space-y-5" aria-labelledby="checked-heading">
              <h2 id="checked-heading" className="rz-title text-2xl">How the forecast was checked</h2>
              <Verdict run={run} view={view} takeaway={takeaways?.trust ?? null} />
              {view ? (
                <>
                  <RankedBars view={view} takeaway={takeaways?.compare ?? null} />
                  <WeekTable view={view} takeaway={takeaways?.weeks ?? null} />
                  <MethodNotes view={view} />
                </>
              ) : (
                <p className="text-sm text-dust">
                  No comparison was saved with this forecast. Refresh it on the <Link href="/" className={dashboardLink}>Dashboard</Link> once the
                  forecast service has been retrained.
                </p>
              )}
              <ModelBehind run={run} />
            </section>
          </>
        )}
      </div>
    </main>
  );
}

const card = "rz-panel p-5 sm:p-6 space-y-3.5";
const heading = "rz-title text-xl";
const takeawayClass = "text-sm font-semibold text-bone max-w-prose";

type PageDays = ReturnType<typeof forecastPageDays>;

// Slice 28: the saved days from today, read-only. The peso column is the stored estimate.
function NextDays({ run, page }: { run: Run; page: PageDays }) {
  const { days } = page;
  const dayLabel = (iso: string) => formatDate(iso, { weekday: "short", month: "short", day: "numeric" });
  return (
    <section className={card}>
      <h2 className={heading}>{days.length > 0 ? `Next ${days.length} days` : "Next days"}</h2>
      <p className="text-sm text-bone-2 leading-relaxed max-w-prose">
        Predicted customers per day. The forecast predicts customers only; the peso column is an estimate worked out from it.
      </p>
      {days.length > 0 ? (
        <>
          <ColumnChart {...forecastChart(days)} unit="count" labelHeading="Day" valueHeading="Predicted customers" />
          <table className="rz-table">
            <caption className="sr-only">
              Predicted customers and estimated revenue, {dayLabel(days[0].date)} to {dayLabel(days[days.length - 1].date)}
            </caption>
            <thead>
              <tr>
                <th className="text-left">Day</th>
                <th className="text-right">Predicted customers</th>
                <th className="text-right">{REVENUE_LABEL}</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date}>
                  <td className="text-bone">
                    <span className="inline-block w-11 font-semibold">{formatDate(day.date, { weekday: "short" })}</span>
                    <span className="text-dust">{formatDate(day.date, { month: "short", day: "numeric" })}</span>
                  </td>
                  <td className="text-right text-bone font-semibold tabular-nums">{day.customers === null ? "—" : day.customers.toFixed(1)}</td>
                  <td className="text-right text-bone-2 tabular-nums">{pesoWhole(Number(day.revenue))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="text-bone uppercase text-xs tracking-wider">{days.length === 7 ? "Week total" : `${days.length}-day total`}</td>
                <td className="text-right text-brass-bright tabular-nums">{page.totalCustomers.toFixed(1)}</td>
                <td className="text-right text-brass-bright tabular-nums">{pesoWhole(page.totalRevenue)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="text-xs text-dust leading-relaxed max-w-prose">
            On the {run.weeksTested} test weeks, this forecast missed by about {Number(run.typicalErrorCustomers)} customers a day on average. A
            single day can be further off.
          </p>
        </>
      ) : (
        <p className="text-sm text-bone-2">
          No saved forecast covers today. Refresh it on the <Link href="/" className={dashboardLink}>Dashboard</Link>.
        </p>
      )}
      <p className="text-xs text-dust">
        Longer views (14 and 30 days) are on the <Link href="/" className={dashboardLink}>Dashboard</Link>.
      </p>
    </section>
  );
}

function Verdict({ run, view, takeaway }: { run: Run; view: ReportView | null; takeaway: string | null }) {
  return (
    <section className={card}>
      <h3 className={heading}>Can I trust this forecast?</h3>
      {takeaway && <p className={takeawayClass}>{takeaway}</p>}
      <p className="text-sm text-bone-2 leading-relaxed max-w-prose">
        On the last {run.weeksTested} weeks it was tested on, the Random Forest forecast was off by about{" "}
        <span className="font-semibold text-bone">{Number(run.typicalErrorCustomers)} customers a day</span>. The best simple guess was off by{" "}
        {Number(run.bestBaselineError)}. Random Forest did better than that guess in {run.weeksRfWon} of {run.weeksTested} weeks.
      </p>
      {view && <p className="text-xs font-semibold text-brass-bright">{view.basisLine}</p>}
      <p className="text-[0.6875rem] text-dust">Saved with the forecast on {formatDate(run.createdOn)}.</p>
    </section>
  );
}

// Slice 24: what the model predicts and what the system works out from it, in the owner's words.
// Every figure is the saved one (the run's average and the saved day); nothing is recomputed.
function RevenueExplained({ run, example }: { run: Run; example: RevenueExample | null }) {
  const longDate = (iso: string) => formatDate(iso, { weekday: "short", month: "short", day: "numeric" });
  return (
    <section id="revenue" className={`${card} scroll-mt-20`}>
      <h2 className={heading}>What these numbers mean</h2>
      <dl className="grid gap-3 sm:grid-cols-3 text-sm">
        <div className="rz-well p-3.5 space-y-1">
          <dt className="rz-label">What the model predicts</dt>
          <dd className="text-bone font-semibold">Predicted customers</dd>
          <dd className="text-bone-2 leading-relaxed">How many customers the model expects each day. This is the only thing the Random Forest predicts.</dd>
        </div>
        <div className="rz-well p-3.5 space-y-1">
          <dt className="rz-label">What the system works out</dt>
          <dd className="text-bone font-semibold">Estimated revenue</dd>
          <dd className="text-bone-2 leading-relaxed">
            Predicted customers × {peso(Number(run.avgTicket))}, the average paid per customer in the logbook from {formatDate(run.dataFrom)} to{" "}
            {formatDate(run.dataTo)}. Revenue itself is not predicted.
          </dd>
        </div>
        <div className="rz-well p-3.5 space-y-1">
          <dt className="rz-label">Typical error</dt>
          <dd className="text-bone-2 leading-relaxed">
            How far off the customer prediction was on the test weeks, on average: about {Number(run.typicalErrorCustomers)} customers a day. Because
            estimated revenue is worked out from the predicted count, a miss in the count also moves the revenue estimate.
          </dd>
        </div>
      </dl>
      {example && (
        <dl className="rz-well overflow-hidden divide-y divide-seam text-sm max-w-md" aria-label="Worked example">
          {[
            { op: "", label: `Predicted customers, ${longDate(example.date)}`, value: example.customers.toFixed(1) },
            { op: "×", label: "Average paid per customer", value: peso(example.avgTicket) },
            { op: "=", label: "Estimated revenue (rounded)", value: pesoWhole(example.revenue) },
          ].map((line) => (
            <div key={line.label} className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
              <dt className={line.op === "=" ? "font-semibold text-bone" : "text-bone-2"}>
                <span className="inline-block w-5 font-mono text-dust">{line.op}</span>
                {line.label}
              </dt>
              <dd className={`tabular-nums text-right ${line.op === "=" ? "font-bold text-bone" : "text-bone"}`}>{line.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="space-y-1.5 text-xs text-dust leading-relaxed max-w-prose">
        <p className="font-semibold text-bone-2">Why it is an estimate, not a promise</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>The average comes from the logbook from {formatDate(run.dataFrom)} to {formatDate(run.dataTo)}, including days at earlier prices, so it can lag a price change until the model is retrained.</li>
          <li>Each day&apos;s real mix of services, loyalty discounts and custom amounts differs from that average.</li>
          <li>The customer prediction itself has an error (see Typical error), and the revenue estimate moves with it.</li>
        </ul>
      </div>
    </section>
  );
}

function RankedBars({ view, takeaway }: { view: ReportView; takeaway: string | null }) {
  return (
    <section className={card}>
      <h3 className={heading}>How the methods compare</h3>
      {takeaway && <p className={takeawayClass}>{takeaway}</p>}
      <p className="text-xs text-dust leading-relaxed max-w-prose">
        Each method guessed customers per day for weeks it had not seen. The typical miss is how far off it was, on average; the bar shows it,
        and a shorter bar is better. RMSE is larger when a method sometimes misses by a lot.
      </p>
      <div aria-hidden="true" className="hidden sm:grid grid-cols-[1fr_8rem_8rem] gap-3 px-3 text-[0.6875rem] font-semibold text-dust uppercase tracking-[0.08em]">
        <span>Method</span>
        <span className="text-right">Typical miss (MAE)</span>
        <span className="text-right">Penalises big misses (RMSE)</span>
      </div>
      <ol className="space-y-1.5">
        {view.ranked.map((row) => (
          <li
            key={row.method}
            className={`rounded-[10px] px-3 py-2.5 ${row.served ? "bg-panel-3 ring-1 ring-inset ring-seam-strong" : ""}`}
          >
            <div className="sm:grid sm:grid-cols-[1fr_8rem_8rem] sm:gap-3 sm:items-baseline text-sm">
              <span className="text-bone">
                {row.name}
                {row.served && <span className="ml-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-bone">Used for this forecast</span>}
                {COMPARISON_ONLY.has(row.method) && <span className="ml-2 text-[0.6875rem] uppercase tracking-wider text-dust">for comparison only</span>}
              </span>
              <span className="mt-1 sm:mt-0 flex justify-between sm:block sm:text-right font-semibold text-bone tabular-nums">
                <span className="sm:hidden text-xs font-normal text-dust">Typical miss (MAE)</span>
                {row.mean.toFixed(2)}
              </span>
              <span className="flex justify-between sm:block sm:text-right text-bone-2 tabular-nums">
                <span className="sm:hidden text-xs text-dust">Penalises big misses (RMSE)</span>
                {row.rmse === null ? "—" : row.rmse.toFixed(2)}
              </span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-well ring-1 ring-inset ring-seam overflow-hidden">
              <div
                className={`h-2 rounded-full ${row.served ? "bg-bone" : "bg-dust/60"}`}
                style={{ width: `${view.maxMean > 0 ? Math.max((row.mean / view.maxMean) * 100, 2) : 2}%` }}
              />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function WeekTable({ view, takeaway }: { view: ReportView; takeaway: string | null }) {
  const find = (method: string) => view.ranked.find((r) => r.method === method);
  return (
    <section className={card}>
      <h3 className={heading}>Week by week</h3>
      {takeaway && <p className={takeawayClass}>{takeaway}</p>}
      {view.weeks ? (
        <div className="overflow-x-auto">
          <table className="rz-table text-xs">
            <caption className="sr-only">Typical miss per test week and method, in customers a day</caption>
            <thead>
              <tr>
                <th className="text-left sticky left-0 bg-panel">Week</th>
                {view.methodsInTable.map((m) => (
                  <th key={m} className="text-right min-w-24">{find(m)?.name ?? m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.weeks.map((week) => (
                <tr key={week.label}>
                  <td className="text-bone-2 whitespace-nowrap sticky left-0 bg-panel">{week.label}</td>
                  {view.methodsInTable.map((m) => (
                    <td key={m} className="text-right text-bone">{week.mae[m]?.toFixed(2) ?? "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="text-bone">
                <td className="sticky left-0 bg-panel">Mean</td>
                {view.methodsInTable.map((m) => (
                  <td key={m} className="text-right">{find(m)?.mean.toFixed(2) ?? "—"}</td>
                ))}
              </tr>
              {/* The swing sits with the mean, under the same brass rule. */}
              <tr className="text-bone-2 *:border-t-0 *:pt-1 *:font-normal">
                <td className="sticky left-0 bg-panel">Week-to-week swing</td>
                {view.methodsInTable.map((m) => (
                  <td key={m} className="text-right">{view.spread[m]?.toFixed(2) ?? "—"}</td>
                ))}
              </tr>
            </tfoot>
          </table>
          <p className="mt-2 text-[0.6875rem] text-dust">Typical miss (MAE) in customers a day, lower is better. Linear, gradient boosting and the single decision tree are for comparison only.</p>
        </div>
      ) : (
        <p className="text-sm text-dust">Weekly detail was not saved with this forecast.</p>
      )}
    </section>
  );
}

function MethodNotes({ view }: { view: ReportView }) {
  return (
    <section className={card}>
      <h3 className={heading}>About the methods</h3>
      <dl className="space-y-2.5 text-sm">
        {view.groups.flatMap((g) => g.rows).map((row) => (
          <div key={row.method}>
            <dt className="text-bone font-semibold">{row.name}</dt>
            <dd className="text-dust text-xs leading-relaxed">{view.ranked.find((r) => r.method === row.method)?.note}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ModelBehind({ run }: { run: Run }) {
  return (
    <section className={card}>
      <h3 className={heading}>The model behind the forecast</h3>
      <p className="text-xs text-dust leading-relaxed max-w-prose">
        Version {run.modelVersion}. Trained on the paper logbook from {formatDate(run.dataFrom)} to {formatDate(run.dataTo)} ({run.trainingDays} open
        days). The revenue estimate is explained under What these numbers mean.
      </p>
    </section>
  );
}

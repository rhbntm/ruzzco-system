import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { ForecastLocked } from "@/components/ForecastPanel";
import { BarberPoleIcon } from "@/components/RuzzcoBrand";
import { latestForecast, serializeForecast, type SerializedForecast } from "@/lib/forecast";
import { COMPARISON_ONLY, buildReportView, type ReportView } from "@/lib/forecast-comparison";
import { OWNER_COOKIE, isOwnerCookie } from "@/lib/owner-access";

// Slice 10: the detailed forecast. Owner only; reads the saved run from the database and never
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

export default async function ForecastPage() {
  const isOwner = isOwnerCookie((await cookies()).get(OWNER_COOKIE)?.value);
  const forecast = isOwner ? await load() : null;
  const run = forecast?.run ?? null;
  const view = run ? buildReportView(run.comparison, (iso) => formatDate(iso)) : null;

  return (
    <main className="flex-1">
      <header className="rz-banner">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3 px-4 sm:px-6 py-3">
          <Link href="/" className="inline-flex items-center gap-1.5 -my-2 py-2 pointer-coarse:-my-3.5 pointer-coarse:py-3.5 text-sm text-dust hover:text-bone transition-colors group">
            <ArrowLeft className="w-4 h-4 transition-transform duration-200 group-hover:-translate-x-0.5" />Home
          </Link>
          <h1 className="flex items-center gap-2 font-display font-semibold text-base sm:text-lg leading-none uppercase tracking-widest text-bone">
            <BarberPoleIcon className="w-2.5 h-6" />
            Detailed forecast
          </h1>
          {/* Balances the Home link, so the title stays centred. */}
          <span aria-hidden="true" className="w-16 shrink-0" />
        </div>
      </header>

      <div className="rz-page max-w-4xl mx-auto p-4 sm:p-6 space-y-5">
        {!isOwner ? (
          <ForecastLocked description="Expected customers and revenue for the next 7 days, and how the forecast compares with other methods. Owner only." />
        ) : !forecast ? (
          <p className="rz-notice rz-notice-danger">
            <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
            The saved forecast can&apos;t be loaded right now because the database is unreachable.
          </p>
        ) : !run ? (
          <p className="text-sm text-dust">No forecast has been saved yet. Open the home page and press Refresh forecast.</p>
        ) : (
          <>
            <Verdict run={run} view={view} />
            {view ? (
              <>
                <RankedBars view={view} />
                <WeekTable view={view} />
                <MethodNotes view={view} />
              </>
            ) : (
              <p className="text-sm text-dust">
                No comparison was saved with this forecast. Press Refresh forecast on the home page once the forecast service has been retrained.
              </p>
            )}
            <ModelBehind run={run} />
          </>
        )}
      </div>
    </main>
  );
}

const card = "rz-panel p-5 sm:p-6 space-y-3.5";
const heading = "rz-title text-xl";

function Verdict({ run, view }: { run: Run; view: ReportView | null }) {
  return (
    <section className={card}>
      <h2 className={heading}>Can I trust this forecast?</h2>
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

function RankedBars({ view }: { view: ReportView }) {
  return (
    <section className={card}>
      <h2 className={heading}>How the methods compare</h2>
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
            className={`rounded-[10px] px-3 py-2.5 ${row.served ? "bg-crimson/12 shadow-[inset_0_0_0_1px_rgb(218_44_53/0.45)]" : ""}`}
          >
            <div className="sm:grid sm:grid-cols-[1fr_8rem_8rem] sm:gap-3 sm:items-baseline text-sm">
              <span className="text-bone">
                {row.name}
                {row.served && <span className="ml-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-crimson-ink">Used for this forecast</span>}
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
            <div className="mt-1.5 h-2 rounded-full bg-black/30 ring-1 ring-inset ring-seam overflow-hidden">
              <div
                className={`h-2 rounded-full ${row.served ? "bg-crimson" : "bg-dust/60"}`}
                style={{ width: `${view.maxMean > 0 ? Math.max((row.mean / view.maxMean) * 100, 2) : 2}%` }}
              />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function WeekTable({ view }: { view: ReportView }) {
  const find = (method: string) => view.ranked.find((r) => r.method === method);
  return (
    <section className={card}>
      <h2 className={heading}>Week by week</h2>
      {view.weeks ? (
        <div className="overflow-x-auto">
          <table className="rz-table text-xs">
            <thead>
              <tr>
                <th className="text-left">Week</th>
                {view.methodsInTable.map((m) => (
                  <th key={m} className="text-right min-w-24">{find(m)?.name ?? m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.weeks.map((week) => (
                <tr key={week.label}>
                  <td className="text-bone-2 whitespace-nowrap">{week.label}</td>
                  {view.methodsInTable.map((m) => (
                    <td key={m} className="text-right text-bone">{week.mae[m]?.toFixed(2) ?? "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="text-bone">
                <td>Mean</td>
                {view.methodsInTable.map((m) => (
                  <td key={m} className="text-right">{find(m)?.mean.toFixed(2) ?? "—"}</td>
                ))}
              </tr>
              {/* The swing sits with the mean, under the same brass rule. */}
              <tr className="text-bone-2 *:border-t-0 *:pt-1 *:font-normal">
                <td>Week-to-week swing</td>
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
      <h2 className={heading}>About the methods</h2>
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
      <h2 className={heading}>The model behind the forecast</h2>
      <p className="text-xs text-dust leading-relaxed max-w-prose">
        Version {run.modelVersion}. Trained on the paper logbook from {formatDate(run.dataFrom)} to {formatDate(run.dataTo)} ({run.trainingDays} open
        days). Revenue = expected customers × ₱{run.avgTicket}, the average paid per customer in that period.
      </p>
    </section>
  );
}

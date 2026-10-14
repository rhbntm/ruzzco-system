import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft, LineChart } from "lucide-react";
import { ForecastLocked } from "@/components/ForecastPanel";
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
    <div className="min-h-screen bg-[#0b0c10] text-zinc-100 font-sans antialiased">
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <header className="flex items-center justify-between border-b border-zinc-800 pb-4">
          <Link href="/" className="text-zinc-400 hover:text-white text-sm">
            <ArrowLeft className="w-4 h-4 inline mr-1" />Home
          </Link>
          <h1 className="text-xl font-bold uppercase tracking-wide font-[family-name:var(--font-oswald)] inline-flex items-center gap-2">
            <LineChart className="w-5 h-5 text-red-500" /> Detailed forecast
          </h1>
          <span className="w-12" />
        </header>

        {!isOwner ? (
          <ForecastLocked />
        ) : !forecast ? (
          <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-900/50 text-sm text-rose-300">
            The saved forecast can&apos;t be loaded right now because the database is unreachable.
          </div>
        ) : !run ? (
          <p className="text-sm text-zinc-400">No forecast has been saved yet. Open the home page and press Refresh forecast.</p>
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
              <p className="text-sm text-zinc-400">
                No comparison was saved with this forecast. Press Refresh forecast on the home page once the forecast service has been retrained.
              </p>
            )}
            <ModelBehind run={run} />
          </>
        )}
      </main>
    </div>
  );
}

const card = "p-5 rounded-xl bg-[#12141a] border border-[#232734] space-y-3";
const heading = "font-bold text-white uppercase tracking-wide text-sm font-[family-name:var(--font-oswald)]";

function Verdict({ run, view }: { run: Run; view: ReportView | null }) {
  return (
    <section className={card}>
      <h2 className={heading}>Can I trust this forecast?</h2>
      <p className="text-sm text-zinc-300 leading-relaxed">
        On the last {run.weeksTested} weeks it was tested on, the Random Forest forecast was off by about{" "}
        <span className="font-semibold text-white">{Number(run.typicalErrorCustomers)} customers a day</span>. The best simple guess was off by{" "}
        {Number(run.bestBaselineError)}. Random Forest did better than that guess in {run.weeksRfWon} of {run.weeksTested} weeks.
      </p>
      {view && <p className="text-xs font-semibold text-amber-200">{view.basisLine}</p>}
      <p className="text-[11px] text-zinc-500">Saved with the forecast on {formatDate(run.createdOn)}.</p>
    </section>
  );
}

function RankedBars({ view }: { view: ReportView }) {
  return (
    <section className={card}>
      <h2 className={heading}>How the methods compare</h2>
      <p className="text-xs text-zinc-400 leading-relaxed">
        Each method guessed customers per day for weeks it had not seen. The number is how far off it was, on average. A shorter bar is better.
      </p>
      <ol className="space-y-2">
        {view.ranked.map((row) => (
          <li key={row.method} className={`rounded-lg px-3 py-2 ${row.served ? "bg-red-500/10 ring-1 ring-inset ring-red-500/40" : ""}`}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-zinc-200">
                {row.name}
                {row.served && <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-red-300">Used for this forecast</span>}
                {COMPARISON_ONLY.has(row.method) && <span className="ml-2 text-[10px] uppercase tracking-wider text-zinc-500">for comparison only</span>}
              </span>
              <span className="font-semibold text-white tabular-nums">{row.mean.toFixed(2)}</span>
            </div>
            <div className="mt-1 h-2 rounded bg-[#181b24]">
              <div
                className={`h-2 rounded ${row.served ? "bg-red-500" : "bg-zinc-500"}`}
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
          <table className="w-full text-xs">
            <thead>
              <tr className="text-zinc-500 text-left">
                <th className="py-1.5 pr-3 font-normal">Week</th>
                {view.methodsInTable.map((m) => (
                  <th key={m} className="py-1.5 px-2 font-normal text-right min-w-24">{find(m)?.name ?? m}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#232734]">
              {view.weeks.map((week) => (
                <tr key={week.label}>
                  <td className="py-1.5 pr-3 text-zinc-300 whitespace-nowrap">{week.label}</td>
                  {view.methodsInTable.map((m) => (
                    <td key={m} className="py-1.5 px-2 text-right text-zinc-200 tabular-nums">{week.mae[m]?.toFixed(2) ?? "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-zinc-700 font-semibold text-white">
                <td className="pt-2 pr-3">Mean</td>
                {view.methodsInTable.map((m) => (
                  <td key={m} className="pt-2 px-2 text-right tabular-nums">{find(m)?.mean.toFixed(2) ?? "—"}</td>
                ))}
              </tr>
              <tr className="text-zinc-300">
                <td className="pt-1 pr-3">Week-to-week swing</td>
                {view.methodsInTable.map((m) => (
                  <td key={m} className="pt-1 px-2 text-right tabular-nums">{view.spread[m]?.toFixed(2) ?? "—"}</td>
                ))}
              </tr>
            </tfoot>
          </table>
          <p className="mt-2 text-[11px] text-zinc-500">Customers a day, lower is better. Linear and gradient boosting are for comparison only.</p>
        </div>
      ) : (
        <p className="text-sm text-zinc-400">Weekly detail was not saved with this forecast.</p>
      )}
    </section>
  );
}

function MethodNotes({ view }: { view: ReportView }) {
  return (
    <section className={card}>
      <h2 className={heading}>About the methods</h2>
      <dl className="space-y-2 text-sm">
        {view.groups.flatMap((g) => g.rows).map((row) => (
          <div key={row.method}>
            <dt className="text-zinc-200 font-semibold">{row.name}</dt>
            <dd className="text-zinc-400 text-xs leading-relaxed">{view.ranked.find((r) => r.method === row.method)?.note}</dd>
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
      <p className="text-xs text-zinc-400 leading-relaxed">
        Version {run.modelVersion}. Trained on the paper logbook from {formatDate(run.dataFrom)} to {formatDate(run.dataTo)} ({run.trainingDays} open
        days). Revenue = expected customers × ₱{run.avgTicket}, the average paid per customer in that period.
      </p>
    </section>
  );
}

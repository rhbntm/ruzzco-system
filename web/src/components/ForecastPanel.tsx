"use client";

// Owner-only 7-day forecast (slice 7). Rendered only when the home page found the owner cookie;
// starts from the forecast saved in MySQL and tries one refresh when that run is not from today.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LineChart, LockKeyhole, RefreshCw, WifiOff } from "lucide-react";
import type { SerializedForecast } from "@/lib/forecast";
import { buildComparisonView } from "@/lib/forecast-comparison";

const BASELINE_NAMES: Record<string, string> = {
  average: "the plain average",
  weekday: "the average for that weekday",
  last7: "the average of the last 7 open days",
  naive: "the last open day's count",
};

const peso = (value: number) => `₱${Math.round(value).toLocaleString("en-PH")}`;

// Dates are YYYY-MM-DD business dates; format them as calendar dates, not as instants.
function formatDate(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-PH", { ...options, timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

export function ForecastPanel({ initial, today }: { initial: SerializedForecast; today: string }) {
  const [forecast, setForecast] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/forecast/refresh", { method: "POST" });
      const data = await response.json().catch(() => null);
      if (response.status === 502) {
        setOffline(true);
        return;
      }
      if (response.status === 401) throw new Error("Owner PIN required. Reload the page and unlock again.");
      if (!response.ok || !data?.success) throw new Error(data?.error ?? "Could not refresh the forecast");
      setForecast({ run: data.run, days: data.days });
      setOffline(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh the forecast");
    } finally {
      setBusy(false);
    }
  }, []);

  // One automatic refresh when there is no run yet or the latest run is from an earlier day.
  const stale = !initial.run || initial.run.createdOn < today;
  useEffect(() => {
    if (!stale) return;
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [stale, refresh]);

  const { run } = forecast;
  const days = forecast.days.filter((day) => day.date >= today);
  const totalCustomers = days.reduce((sum, day) => sum + (day.customers ?? 0), 0);
  const totalRevenue = days.reduce((sum, day) => sum + Number(day.revenue), 0);

  return (
    <section className="p-5 rounded-xl bg-[#12141a] border border-[#232734] space-y-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-barber-pole opacity-60" />
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <LineChart className="w-5 h-5 text-red-500" />
          <h2 className="font-bold text-white uppercase tracking-wide font-(family-name:--font-oswald)">Next 7 days</h2>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-2 pointer-coarse:min-h-11 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-semibold text-zinc-300 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
          {busy ? "Refreshing…" : "Refresh forecast"}
        </button>
      </div>

      {offline && (
        <p className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-200">
          <WifiOff className="w-4 h-4 mt-0.5 shrink-0" />
          {run
            ? `Forecast service is offline. Showing the forecast saved on ${formatDate(run.createdOn, { month: "short", day: "numeric", year: "numeric" })}.`
            : "Forecast service is offline and no forecast has been saved yet."}
        </p>
      )}
      {error && <p className="p-3 rounded-lg bg-rose-950/30 border border-rose-900/50 text-sm text-rose-300">{error}</p>}

      {run && days.length > 0 ? (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-zinc-400 uppercase tracking-wider">
                <th className="text-left font-semibold pb-2">Day</th>
                <th className="text-right font-semibold pb-2">Customers</th>
                <th className="text-right font-semibold pb-2">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#232734]">
              {days.map((day) => (
                <tr key={day.date}>
                  <td className="py-2 text-zinc-200">
                    <span className="inline-block w-10 font-semibold">{formatDate(day.date, { weekday: "short" })}</span>
                    <span className="text-zinc-400">{formatDate(day.date, { month: "short", day: "numeric" })}</span>
                  </td>
                  <td className="py-2 text-right text-white font-semibold">{day.customers === null ? "—" : day.customers.toFixed(1)}</td>
                  <td className="py-2 text-right text-white">{peso(Number(day.revenue))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-zinc-700">
                <td className="pt-2 font-bold text-white uppercase text-xs tracking-wider">{days.length === 7 ? "Week total" : `${days.length}-day total`}</td>
                <td className="pt-2 text-right font-bold text-red-400">{totalCustomers.toFixed(1)}</td>
                <td className="pt-2 text-right font-bold text-red-400">{peso(totalRevenue)}</td>
              </tr>
            </tfoot>
          </table>

          <div className="space-y-2 text-xs text-zinc-400 leading-relaxed">
            <p>
              On the last {run.weeksTested} weeks of logbook records, this forecast was off by about{" "}
              {Number(run.typicalErrorCustomers)} customers (about {peso(Number(run.typicalErrorCustomers) * Number(run.avgTicket))})
              a day. Guessing {BASELINE_NAMES[run.bestBaseline] ?? run.bestBaseline} was off by {Number(run.bestBaselineError)}.
            </p>
            <p>
              Based on the logbook from {formatDate(run.dataFrom, { month: "short", day: "numeric", year: "numeric" })} to{" "}
              {formatDate(run.dataTo, { month: "short", day: "numeric", year: "numeric" })} ({run.trainingDays} open days).
              Revenue = expected customers × ₱{run.avgTicket}, the average paid per customer in that period.
            </p>
          </div>

          <MethodComparison run={run} />
        </>
      ) : (
        !busy && <p className="text-sm text-zinc-400">No saved forecast covers today yet. Start the forecast service and press Refresh forecast.</p>
      )}
    </section>
  );
}

// Slice 9: how Random Forest did against the other methods, from the comparison saved with the run,
// so it still shows when the forecast service is down. Also shown on the owner's /insights page.
export function MethodComparison({ run }: { run: NonNullable<SerializedForecast["run"]> }) {
  const shortDate = (iso: string) => formatDate(iso, { month: "short", day: "numeric", year: "numeric" });
  const view = buildComparisonView(run.comparison, shortDate);
  return (
    <div className="pt-4 border-t border-[#232734] space-y-3">
      <h3 className="font-bold text-white uppercase tracking-wide text-sm font-(family-name:--font-oswald)">How the methods compare</h3>
      {view ? (
        <>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Each method guessed how many customers came on each day of weeks it had not seen. The number is how far off it was, on
            average, in customers per day. <span className="text-zinc-200 font-semibold">Lower is better.</span> “Week-to-week swing” is
            how much that changed from one week to the next; smaller means steadier.
          </p>
          <p className="text-xs font-semibold text-amber-200">{view.basisLine}</p>
          {view.groups.map((group) => (
            <div key={group.title} className="space-y-1">
              <p className="text-xs text-zinc-400 uppercase tracking-wider font-semibold">{group.title}</p>
              <div className="rounded-lg border border-[#232734] divide-y divide-[#232734]">
                <div className="hidden sm:grid grid-cols-[1fr_9rem_9rem] gap-2 px-3 py-1.5 text-xs text-zinc-400 uppercase tracking-wider">
                  <span>Method</span>
                  <span className="text-right">Off by (customers a day)</span>
                  <span className="text-right">Week-to-week swing</span>
                </div>
                {group.rows.map((row) => (
                  <div
                    key={row.method}
                    className={`px-3 py-2 sm:grid sm:grid-cols-[1fr_9rem_9rem] sm:gap-2 sm:items-center text-sm ${
                      row.served ? "bg-red-500/10 ring-1 ring-inset ring-red-500/40" : ""
                    }`}
                  >
                    <div className="text-zinc-200">
                      {row.name}
                      {row.served && <span className="ml-2 text-xs font-semibold uppercase tracking-wider text-red-300">Used for this forecast</span>}
                    </div>
                    <div className="flex justify-between sm:block sm:text-right text-white font-semibold">
                      <span className="sm:hidden text-xs font-normal text-zinc-400">Off by</span>
                      {row.mean.toFixed(2)}
                    </div>
                    <div className="flex justify-between sm:block sm:text-right text-zinc-300">
                      <span className="sm:hidden text-xs text-zinc-400">Week-to-week swing</span>
                      {row.spread === null ? "—" : row.spread.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="text-xs text-zinc-300">
            Random Forest beat the best simple method ({BASELINE_NAMES[run.bestBaseline] ?? run.bestBaseline}) in {run.weeksRfWon} of{" "}
            {run.weeksTested} weeks.
          </p>
          <p className="text-xs text-zinc-400">Saved with the forecast on {shortDate(run.createdOn)}.</p>
        </>
      ) : (
        <p className="text-sm text-zinc-400">
          No comparison was saved with this forecast. Press Refresh forecast once the forecast service has been retrained.
        </p>
      )}
    </div>
  );
}

// Shown instead of the panel when the owner cookie is missing. No forecast numbers reach this page.
// /insights reuses it with its own wording.
export function ForecastLocked({
  title = "Forecast",
  description = "Expected customers and revenue for the next 7 days. Owner only.",
  submitLabel = "Show forecast",
}: { title?: string; description?: string; submitLabel?: string } = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/owner/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error ?? "Wrong PIN.");
      }
      setPin("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not unlock");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="p-5 rounded-xl bg-[#12141a] border border-[#232734] space-y-3 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-barber-pole opacity-60" />
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <LineChart className="w-5 h-5 text-red-500" />
          <span className="font-bold text-white uppercase tracking-wide font-(family-name:--font-oswald)">{title}</span>
        </div>
        <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full">
          <LockKeyhole className="w-3 h-3" /> Owner PIN
        </span>
      </div>
      <p className="text-sm text-zinc-400">{description}</p>
      {open ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void unlock();
          }}
          className="flex flex-col sm:flex-row gap-2"
        >
          <input
            autoFocus
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            className="flex-1 px-3 py-2.5 pointer-coarse:min-h-11 rounded-lg bg-[#181b24] border border-[#232734] text-white text-base sm:text-sm"
            placeholder="Owner PIN"
            aria-label="Owner PIN"
          />
          <button
            disabled={busy || !pin}
            className="px-4 py-2.5 pointer-coarse:min-h-11 rounded-lg bg-red-600 text-white text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Checking…" : submitLabel}
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="-my-2 py-2 pointer-coarse:-my-3.5 pointer-coarse:py-3.5 rounded-sm text-sm font-semibold text-red-400 hover:text-red-300"
        >
          Enter owner PIN
        </button>
      )}
      {error && <p className="text-sm text-red-300">{error}</p>}
    </section>
  );
}

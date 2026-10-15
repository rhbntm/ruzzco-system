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
    <section className="rz-panel p-5 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="w-9 h-9 rounded-lg bg-brass/10 ring-1 ring-brass/40 text-brass-bright flex items-center justify-center shrink-0">
            <LineChart className="w-4.5 h-4.5" />
          </span>
          <h3 className="rz-title text-xl whitespace-nowrap">Next 7 days</h3>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          className="rz-btn rz-btn-secondary min-h-9 px-3 text-xs whitespace-nowrap pointer-coarse:min-h-11"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
          {busy ? "Refreshing…" : "Refresh forecast"}
        </button>
      </div>

      {offline && (
        <p className="animate-rise rz-notice rz-notice-warn">
          <WifiOff className="w-4 h-4 mt-0.5 shrink-0" />
          {run
            ? `Forecast service is offline. Showing the forecast saved on ${formatDate(run.createdOn, { month: "short", day: "numeric", year: "numeric" })}.`
            : "Forecast service is offline and no forecast has been saved yet."}
        </p>
      )}
      {error && <p className="animate-rise rz-notice rz-notice-danger">{error}</p>}

      {run && days.length > 0 ? (
        <>
          <table className="rz-table">
            <thead>
              <tr>
                <th className="text-left">Day</th>
                <th className="text-right">Customers</th>
                <th className="text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date}>
                  <td className="text-bone">
                    <span className="inline-block w-11 font-semibold">{formatDate(day.date, { weekday: "short" })}</span>
                    <span className="text-dust">{formatDate(day.date, { month: "short", day: "numeric" })}</span>
                  </td>
                  <td className="text-right text-bone font-semibold">{day.customers === null ? "—" : day.customers.toFixed(1)}</td>
                  <td className="text-right text-bone-2">{peso(Number(day.revenue))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="text-bone uppercase text-xs tracking-wider">{days.length === 7 ? "Week total" : `${days.length}-day total`}</td>
                <td className="text-right text-brass-bright">{totalCustomers.toFixed(1)}</td>
                <td className="text-right text-brass-bright">{peso(totalRevenue)}</td>
              </tr>
            </tfoot>
          </table>

          <div className="space-y-2 text-xs text-dust leading-relaxed max-w-prose">
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
      ) : busy ? (
        // The first refresh is running: the table's shape, not an empty card.
        <div aria-hidden="true" className="space-y-2.5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <div className="rz-skeleton h-4 w-28" />
              <div className="rz-skeleton h-4 w-16" />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-dust">No saved forecast covers today yet. Start the forecast service and press Refresh forecast.</p>
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
    <div className="pt-5 border-t border-seam space-y-3.5">
      <h3 className="rz-heading text-bone">How the methods compare</h3>
      {view ? (
        <>
          <p className="text-xs text-dust leading-relaxed max-w-prose">
            Each method guessed how many customers came on each day of weeks it had not seen. The number is how far off it was, on
            average, in customers per day. <span className="text-bone font-semibold">Lower is better.</span> “Week-to-week swing” is
            how much that changed from one week to the next; smaller means steadier.
          </p>
          <p className="text-xs font-semibold text-brass-bright">{view.basisLine}</p>
          {view.groups.map((group) => (
            <div key={group.title} className="space-y-1.5">
              <p className="rz-label">{group.title}</p>
              <div className="rz-well overflow-hidden divide-y divide-seam tabular-nums">
                <div className="hidden sm:grid grid-cols-[1fr_9rem_9rem] gap-2 px-3 py-2 text-[0.6875rem] font-semibold text-dust uppercase tracking-[0.08em]">
                  <span>Method</span>
                  <span className="text-right">Off by (customers a day)</span>
                  <span className="text-right">Week-to-week swing</span>
                </div>
                {group.rows.map((row) => (
                  <div
                    key={row.method}
                    className={`px-3 py-2.5 sm:grid sm:grid-cols-[1fr_9rem_9rem] sm:gap-2 sm:items-center text-sm transition-colors duration-150 ${
                      row.served ? "bg-crimson/12 shadow-[inset_0_0_0_1px_rgb(218_44_53/0.45)]" : "hover:bg-white/2.5"
                    }`}
                  >
                    <div className="text-bone">
                      {row.name}
                      {row.served && <span className="ml-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-crimson-ink">Used for this forecast</span>}
                    </div>
                    <div className="flex justify-between sm:block sm:text-right text-bone font-semibold">
                      <span className="sm:hidden text-xs font-normal text-dust">Off by</span>
                      {row.mean.toFixed(2)}
                    </div>
                    <div className="flex justify-between sm:block sm:text-right text-bone-2">
                      <span className="sm:hidden text-xs text-dust">Week-to-week swing</span>
                      {row.spread === null ? "—" : row.spread.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="text-xs text-bone-2">
            Random Forest beat the best simple method ({BASELINE_NAMES[run.bestBaseline] ?? run.bestBaseline}) in {run.weeksRfWon} of{" "}
            {run.weeksTested} weeks.
          </p>
          <p className="text-xs text-dust">Saved with the forecast on {shortDate(run.createdOn)}.</p>
        </>
      ) : (
        <p className="text-sm text-dust">
          No comparison was saved with this forecast. Press Refresh forecast once the forecast service has been retrained.
        </p>
      )}
    </div>
  );
}

// Sends the owner PIN; on success the server sets the owner cookie and the page re-renders with
// the owner's numbers. Used by the locked forecast card (on /insights and in the home page's
// owner drawer).
function useOwnerUnlock() {
  const router = useRouter();
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

  return { pin, setPin, busy, error, unlock };
}

// Shown instead of the panel when the owner cookie is missing. No forecast numbers reach this page.
// /insights reuses it with its own wording.
export function ForecastLocked({
  title = "Forecast",
  description = "Expected customers and revenue for the next 7 days. Owner only.",
  submitLabel = "Show forecast",
}: { title?: string; description?: string; submitLabel?: string } = {}) {
  const [open, setOpen] = useState(false);
  const { pin, setPin, busy, error, unlock } = useOwnerUnlock();

  return (
    <section className="rz-panel p-5 sm:p-6 space-y-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="w-9 h-9 rounded-lg bg-brass/10 ring-1 ring-brass/40 text-brass-bright flex items-center justify-center shrink-0">
            <LineChart className="w-4.5 h-4.5" />
          </span>
          <span className="rz-title text-xl">{title}</span>
        </div>
        <span className="rz-pill rz-pill-brass uppercase tracking-wider">
          <LockKeyhole className="w-3 h-3" /> Owner PIN
        </span>
      </div>
      <p className="text-sm text-dust leading-relaxed">{description}</p>
      {open ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void unlock();
          }}
          className="animate-rise flex flex-col sm:flex-row gap-2"
        >
          <input
            autoFocus
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            className="rz-field flex-1 sm:text-sm pointer-coarse:min-h-11"
            placeholder="Owner PIN"
            aria-label="Owner PIN"
          />
          <button
            disabled={busy || !pin}
            className="rz-btn rz-btn-primary px-5 pointer-coarse:min-h-11"
          >
            {busy ? "Checking…" : submitLabel}
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="-my-2 py-2 pointer-coarse:-my-3.5 pointer-coarse:py-3.5 rounded-sm text-sm font-semibold text-brass-bright hover:text-bone transition-colors"
        >
          Enter owner PIN
        </button>
      )}
      {error && <p className="animate-rise text-sm text-crimson-ink">{error}</p>}
    </section>
  );
}

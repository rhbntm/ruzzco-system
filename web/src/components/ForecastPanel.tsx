"use client";

// Owner-only 7-day forecast (slice 7). Rendered only when the home page found the owner cookie;
// starts from the forecast saved in MySQL and tries one refresh when that run is not from today.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LineChart, LockKeyhole, RefreshCw, WifiOff } from "lucide-react";
import { ColumnChart } from "@/components/ColumnChart";
import type { SerializedForecast } from "@/lib/forecast";
import { forecastChart } from "@/lib/forecast-chart";

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
          {/* Slice 12: the same saved days as the table below, so it also shows when the service is offline. */}
          <ColumnChart {...forecastChart(days)} unit="count" labelHeading="Day" valueHeading="Customers" />
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
              a day.
            </p>
            <p>
              Based on the logbook from {formatDate(run.dataFrom, { month: "short", day: "numeric", year: "numeric" })} to{" "}
              {formatDate(run.dataTo, { month: "short", day: "numeric", year: "numeric" })} ({run.trainingDays} open days).
              Revenue = expected customers × ₱{run.avgTicket}, the average paid per customer in that period.
            </p>
          </div>

          <Link
            href="/forecast"
            className="group inline-flex items-center gap-1.5 -my-2 py-2 pointer-coarse:-my-3.5 pointer-coarse:py-3.5 rounded-sm text-sm font-semibold text-brass-bright hover:text-bone transition-colors"
          >
            See the detailed forecast
            <ArrowRight className="w-4 h-4 transition-transform duration-200 motion-safe:group-hover:translate-x-1" />
          </Link>
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
          <button disabled={busy || !pin} className="rz-btn rz-btn-primary px-5 pointer-coarse:min-h-11">
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

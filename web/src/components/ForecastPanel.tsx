"use client";

// Owner-only 7-day forecast (slice 7). Rendered only when the home page found the owner cookie;
// starts from the forecast saved in MySQL and tries one refresh when that run is not from today.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LineChart, LockKeyhole, RefreshCw, WifiOff } from "lucide-react";
import type { SerializedForecast } from "@/lib/forecast";

const BASELINE_NAMES: Record<string, string> = {
  average: "the plain average",
  weekday: "the average for that weekday",
  last7: "the average of the last 7 open days",
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
          <h2 className="font-bold text-white uppercase tracking-wide font-[family-name:var(--font-oswald)]">Next 7 days</h2>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-semibold text-zinc-300 disabled:opacity-50"
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
              <tr className="text-[10px] text-zinc-500 uppercase tracking-wider">
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
        </>
      ) : (
        !busy && <p className="text-sm text-zinc-400">No saved forecast covers today yet. Start the forecast service and press Refresh forecast.</p>
      )}
    </section>
  );
}

// Shown instead of the panel when the owner cookie is missing. No forecast numbers reach this page.
export function ForecastLocked() {
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
      if (!response.ok) throw new Error("Wrong PIN.");
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
          <span className="font-bold text-white uppercase tracking-wide font-[family-name:var(--font-oswald)]">Forecast</span>
        </div>
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full">
          <LockKeyhole className="w-3 h-3" /> Owner PIN
        </span>
      </div>
      <p className="text-sm text-zinc-400">Expected customers and revenue for the next 7 days. Owner only.</p>
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
            className="flex-1 px-3 py-2.5 rounded-lg bg-[#181b24] border border-[#232734] text-white text-sm"
            placeholder="Owner PIN"
          />
          <button disabled={busy || !pin} className="px-4 py-2.5 rounded-lg bg-red-600 text-white text-sm font-bold disabled:opacity-50">
            {busy ? "Checking…" : "Show forecast"}
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-red-400 hover:text-red-300">
          Enter owner PIN
        </button>
      )}
      {error && <p className="text-sm text-red-300">{error}</p>}
    </section>
  );
}

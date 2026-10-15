// Slice 9: how Random Forest did against the other methods, from the comparison saved with the run,
// so it still shows when the forecast service is down. Shown on the owner's /insights page only;
// the home panel shows the Random Forest prediction alone and /forecast has the full report (slice 10).
import type { SerializedForecast } from "@/lib/forecast";
import { buildComparisonView } from "@/lib/forecast-comparison";

const BASELINE_NAMES: Record<string, string> = {
  average: "the plain average",
  weekday: "the average for that weekday",
  last7: "the average of the last 7 open days",
  naive: "the last open day's count",
};

// Dates are YYYY-MM-DD business dates; format them as calendar dates, not as instants.
function formatDate(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-PH", { ...options, timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

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

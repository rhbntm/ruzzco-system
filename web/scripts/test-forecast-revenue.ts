/**
 * Slice 24: revenue is worked out from the predicted customers, never presented as predicted.
 * Pure (src/lib/forecast-revenue.ts) plus source checks of the screens that show the forecast's
 * pesos. Invented numbers only; needs nothing.
 *
 *   npm run test:forecast-revenue
 */
import { readFileSync } from "node:fs";
import { REVENUE_LABEL, exampleChecksOut, revenueExample, revenueNote } from "../src/lib/forecast-revenue";
import type { SerializedForecast } from "../src/lib/forecast";
import { peso } from "../src/lib/peso";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const run = {
  id: "run-1", createdAt: "2026-11-10T02:00:00.000Z", createdOn: "2026-11-10", modelVersion: "test", dataFrom: "2026-01-01", dataTo: "2026-10-31",
  trainingDays: 200, avgTicket: "210.50", typicalErrorCustomers: "2.00", bestBaseline: "naive", bestBaselineError: "1.90", weeksRfWon: 1, weeksTested: 4, comparison: null,
} as unknown as NonNullable<SerializedForecast["run"]>;
const forecast: SerializedForecast = {
  run,
  days: [
    { date: "2026-11-15", customers: 9.0, revenue: "1894.50" },
    { date: "2026-11-16", customers: null, revenue: "0.00" },
    { date: "2026-11-17", customers: 12.3, revenue: "2589.15" },
  ],
};

console.log("Worked example");
const ex = revenueExample(forecast, "2026-11-16");
check("the first saved day from today with customers (skips a past day and one without customers)", ex?.date === "2026-11-17", JSON.stringify(ex));
check("customers, the run's average and the stored revenue, as saved", ex?.customers === 12.3 && ex.avgTicket === 210.5 && ex.revenue === 2589.15);
check("the stored revenue is customers × average to the centavo", ex !== null && exampleChecksOut(ex));
check("a stored revenue that isn't customers × average is caught", ex !== null && !exampleChecksOut({ ...ex, revenue: 2600 }));
check("no run: no example", revenueExample({ run: null, days: forecast.days }, "2026-11-16") === null);
check("no saved day from today: no example", revenueExample(forecast, "2026-11-18") === null);
check("no forecast loaded: no example", revenueExample(null, "2026-11-16") === null);

console.log("\nWording");
const note = revenueNote(run.avgTicket, peso);
check("the note says the model predicts customers only", note.includes("predicts customers only"), note);
check("the note says revenue is worked out from the prediction, with the exact average", note.includes("worked out from that prediction") && note.includes("₱210.50"), note);
check("the column label is an estimate", REVENUE_LABEL === "Est. revenue");

console.log("\nScreens");
const PREDICTED = /(expected|predicted|forecast) revenue|revenue forecast/i;
for (const file of ["src/components/ForecastPanel.tsx", "src/app/forecast/page.tsx", "src/app/reports/page.tsx", "src/lib/forecast-chart.ts", "src/lib/insights-story.ts", "src/lib/forecast-revenue.ts"]) {
  const lines = readFileSync(file, "utf8").split("\n").filter((line) => PREDICTED.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*"));
  check(`${file} never calls revenue expected, predicted or forecast`, lines.length === 0, lines.join(" | "));
}
const panel = readFileSync("src/components/ForecastPanel.tsx", "utf8");
check("the Dashboard panel's column uses the estimate label and links to the explanation", panel.includes("{REVENUE_LABEL}") && panel.includes('href="/forecast#revenue"') && panel.includes("revenueNote("));
const page = readFileSync("src/app/forecast/page.tsx", "utf8");
check("the Forecast page has the one explanation (id=revenue) with both sides", page.includes('id="revenue"') && page.includes("What the model predicts") && page.includes("What the system works out"));
check("the Forecast page's locked text no longer promises the next 7 days", !page.includes("for the next 7 days"));
// Slice 28
const visible = page.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
check("no 'Detailed forecast' title and no rz-banner", !visible.includes("Detailed forecast") && !visible.includes("rz-banner"));
check("no user-visible 'home page'", !/home page/i.test(visible));
check("one h1 'Forecast'", /<h1 className="rz-title text-3xl">Forecast<\/h1>/.test(page) && (page.match(/<h1/g) ?? []).length === 1);
check("the Next-days table uses the estimate label and whole pesos", page.includes("{REVENUE_LABEL}") && page.includes("pesoWhole(Number(day.revenue))"));
check("the page links to the Dashboard at /", page.includes('<Link href="/"'));
check("the explanation keeps id=revenue and scroll-mt-20", page.includes('id="revenue"') && page.includes("scroll-mt-20"));
check("Typical error card (A1) is worded as agreed", page.includes("a miss in the count also moves the revenue estimate") && page.includes("How far off the customer prediction was on the test weeks, on average"));
check("the bullet (A2) is worded as agreed", page.includes("The customer prediction itself has an error (see Typical error), and the revenue estimate moves with it."));
check("the old 'carries the same error' and 'the estimate carries it' wording is gone", !page.includes("carries the same error") && !page.includes("the estimate carries it"));
check("the page never calls the forecast service or refreshes", !/fetch\(|refresh\(/.test(visible));
check("the gate title is Forecast", readFileSync("src/app/forecast/layout.tsx", "utf8").includes('title="Forecast"'));
const reports = readFileSync("src/app/reports/page.tsx", "utf8");
check("Reports has no forecast revenue card or forecast chart and links to /forecast instead", !reports.includes("ForecastRevenueCalc") && !reports.includes("ForecastChart") && reports.includes('href="/forecast"'));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}

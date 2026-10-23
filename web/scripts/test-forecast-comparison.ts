/**
 * Tests how a saved forecast comparison becomes the owner's table (src/lib/forecast-comparison.ts,
 * slice 9). Invented numbers only. No server or database needed.
 *
 *   npm run test:forecast-comparison
 */
import { COMPARISON_ONLY, METHOD_NAMES, METHOD_NOTES, buildComparisonView, buildReportView } from "../src/lib/forecast-comparison";
import { forecastChart } from "../src/lib/forecast-chart";
import type { Comparison } from "../src/lib/forecast";

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

const ALL = ["average", "weekday", "last7", "naive", "linear", "gboost", "tree", "random_forest", "random_forest_last7"];

function make(change: Partial<Comparison> = {}, methods = ALL): Comparison {
  return {
    basis: "reference",
    test_from: "2026-09-26",
    served: "random_forest",
    mean: Object.fromEntries(methods.map((m, i) => [m, 1 + i / 10])),
    spread: Object.fromEntries(methods.map((m, i) => [m, 0.5 + i / 10])),
    ...change,
  };
}

const date = (iso: string) => `<${iso}>`;

console.log("Groups and order");
const view = buildComparisonView(make(), date)!;
check("three groups in the agreed order", view.groups.map((g) => g.title).join("|") === "Simple guesses|Other models|Random Forest");
check("simple methods in order", view.groups[0].rows.map((r) => r.method).join() === "average,weekday,last7,naive");
check("other models are linear, gboost and tree", view.groups[1].rows.map((r) => r.method).join() === "linear,gboost,tree");
check("Random Forest group has both variants", view.groups[2].rows.map((r) => r.method).join() === "random_forest,random_forest_last7");
check("rows carry mean and spread", view.groups[0].rows[1].mean === 1.1 && view.groups[0].rows[1].spread === 0.6);
check("every shown method has a plain name", view.groups.every((g) => g.rows.every((r) => r.name === METHOD_NAMES[r.method] && r.name.length > 0)));

console.log("\nOptional and unknown methods");
const noLast7 = buildComparisonView(make({}, ALL.filter((m) => m !== "random_forest_last7")), date)!;
check("random_forest_last7 is hidden when absent", noLast7.groups[2].rows.map((r) => r.method).join() === "random_forest");
const extra = buildComparisonView(make({ mean: { ...make().mean, ridge: 9 }, spread: { ...make().spread, ridge: 9 } }), date)!;
check("an unknown method is ignored", extra.groups.flatMap((g) => g.rows).every((r) => r.method !== "ridge"));
const onlyForest = buildComparisonView(make({}, ["random_forest"]), date)!;
check("empty groups are left out", onlyForest.groups.length === 1 && onlyForest.groups[0].title === "Random Forest");
const noSpread = buildComparisonView(make({ spread: {} }), date)!;
check("a missing spread shows as null, not zero", noSpread.groups[0].rows.every((r) => r.spread === null));

console.log("\nServed row");
const servedRows = view.groups.flatMap((g) => g.rows).filter((r) => r.served);
check("exactly one row is marked served", servedRows.length === 1 && servedRows[0].method === "random_forest");
const servedLast7 = buildComparisonView(make({ served: "random_forest_last7" }), date)!;
check("the served marker follows the saved method", servedLast7.groups.flatMap((g) => g.rows).find((r) => r.served)?.method === "random_forest_last7");

console.log("\nBasis line");
check("test weeks name their start date", buildComparisonView(make({ basis: "test" }), date)!.basisLine === "Test weeks from <2026-09-26>");
check(
  "reference weeks say they are not evidence",
  view.basisLine === "Reference weeks: already seen when the inputs were chosen, so not evidence"
);

console.log("\nNothing saved");
check("null gives no view", buildComparisonView(null, date) === null);
check("undefined gives no view", buildComparisonView(undefined, date) === null);
check("a comparison of only unknown methods gives no view", buildComparisonView(make({ served: "ridge" }, ["ridge"]), date) === null);

console.log("\nDetailed report (slice 10)");
const weeks = [
  { start: "2026-09-26", end: "2026-10-02", mae: Object.fromEntries(ALL.map((m, i) => [m, 2 - i / 10])) },
  { start: "2026-10-03", end: "2026-10-09", mae: Object.fromEntries(ALL.map((m, i) => [m, 3 - i / 10])) },
];
const report = buildReportView(make({ weeks }), date)!;
check("methods are ranked smallest error first", report.ranked.every((r, i) => i === 0 || report.ranked[i - 1].mean <= r.mean));
check("the longest bar belongs to the largest error", report.maxMean === Math.max(...report.ranked.map((r) => r.mean)));
check("the served method is marked once in the ranking", report.ranked.filter((r) => r.served).length === 1);
check("every ranked method has a note", report.ranked.every((r) => r.note === METHOD_NOTES[r.method] && r.note.length > 0));
check("table columns follow the group order", report.methodsInTable.join() === ALL.join());
check("weeks keep their order and name a date range", report.weeks?.length === 2 && report.weeks[0].label === "<2026-09-26> to <2026-10-02>");
check("spread is carried for the swing row", report.spread.average === 0.5);
const old = buildReportView(make(), date)!;
check("a run saved without weeks has no week rows but still ranks", old.weeks === null && old.ranked.length === ALL.length);
check("nothing saved gives no report", buildReportView(null, date) === null);

console.log("\nRMSE and the decision tree (slice 12)");
const oldRun = make({}, ALL.filter((m) => m !== "tree")); // saved before slice 12: no rmse, no tree
const oldView = buildComparisonView(oldRun, date)!;
check("an old run renders without the tree", oldView.groups[1].rows.map((r) => r.method).join() === "linear,gboost");
check("an old run has no RMSE (shown as —)", oldView.groups.every((g) => g.rows.every((r) => r.rmse === null)));
const oldReport = buildReportView(oldRun, date)!;
check("an old run still ranks, with null RMSE", oldReport.ranked.length === ALL.length - 1 && oldReport.ranked.every((r) => r.rmse === null));
const rmse = Object.fromEntries(ALL.map((m, i) => [m, 2 + i / 10]));
const newView = buildComparisonView(make({ rmse }), date)!;
check("rows carry RMSE next to MAE", newView.groups.flatMap((g) => g.rows).every((r) => r.rmse === rmse[r.method]));
check(
  "RMSE does not change the MAE ranking",
  buildReportView(make({ rmse }), date)!.ranked.map((r) => r.method).join() === report.ranked.map((r) => r.method).join()
);
const partial = buildComparisonView(make({ rmse: { random_forest: 4 } }), date)!.groups.flatMap((g) => g.rows);
check(
  "a method missing from rmse shows null",
  partial.find((r) => r.method === "average")?.rmse === null && partial.find((r) => r.method === "random_forest")?.rmse === 4
);
check("the tree has its plain name", METHOD_NAMES.tree === "Single decision tree");
check("the tree is for comparison only", COMPARISON_ONLY.has("tree") && COMPARISON_ONLY.has("linear") && COMPARISON_ONLY.has("gboost"));
check(
  "the tree has its note",
  METHOD_NOTES.tree === "One decision tree on the same calendar features. Random Forest averages many of these. Shown for comparison only."
);

console.log("\nForecast chart (slice 12)");
const week = ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"].map((d, i) => ({
  date: d,
  customers: i === 3 ? null : 10 + i / 2,
  revenue: (2000 + i * 100).toFixed(2),
}));
const chart = forecastChart([...week].reverse());
check("seven columns, oldest first", chart.columns.length === 7 && chart.columns[0].key === "2026-10-27" && chart.columns[6].key === "2026-11-02");
check("axis label is the short weekday", chart.columns[0].axisLabel === "Tue" && chart.columns[4].axisLabel === "Sat");
check("label is weekday, month and day", chart.columns[0].label === "Tue, Oct 27");
check("value is the expected customers", chart.columns[0].value === 10 && chart.columns[1].value === 10.5);
check("valueText has one decimal", chart.columns[1].valueText === "10.5 customers");
check("detail is revenue in pesos with two decimals", chart.columns[0].detail === "₱2,000.00 expected revenue");
check("a null day is a zero-height column with —", chart.columns[3].value === 0 && chart.columns[3].valueText === "—");
check(
  "summary names the range and the busiest day",
  chart.summary === "Expected customers per day, Tue, Oct 27 to Mon, Nov 2. Busiest day: Mon, Nov 2, 13.0 customers.",
  chart.summary
);
check("no emphasised column", chart.columns.every((c) => !("emphasis" in c)));
const allNull = forecastChart(week.map((d) => ({ ...d, customers: null })));
check("all days null: no busiest day, still seven columns", allNull.columns.length === 7 && !allNull.summary.includes("Busiest"));
check("no days gives no columns", forecastChart([]).columns.length === 0);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}

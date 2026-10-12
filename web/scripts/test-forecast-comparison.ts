/**
 * Tests how a saved forecast comparison becomes the owner's table (src/lib/forecast-comparison.ts,
 * slice 9). Invented numbers only. No server or database needed.
 *
 *   npm run test:forecast-comparison
 */
import { METHOD_NAMES, buildComparisonView } from "../src/lib/forecast-comparison";
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

const ALL = ["average", "weekday", "last7", "naive", "linear", "gboost", "random_forest", "random_forest_last7"];

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
check("other models are linear and gboost", view.groups[1].rows.map((r) => r.method).join() === "linear,gboost");
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

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}

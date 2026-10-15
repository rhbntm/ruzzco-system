/**
 * Tests the check on the ml-service forecast response (src/lib/forecast.ts, slice 7).
 * No server or database needed.
 *
 *   npm run test:forecast-parse
 */
import { addDays, parseForecastResponse, parseSavedComparison } from "../src/lib/forecast";

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

const START = "2026-10-12";

function valid() {
  return {
    model_version: "rf-2026-09-25-1a2b3c4d",
    trained_at: "2026-10-08T21:03:00+08:00",
    data_from: "2026-07-13",
    data_to: "2026-09-25",
    training_days: 70,
    avg_ticket: 210.5,
    evaluation: { weeks_tested: 4, rf_mae: 2.9, best_baseline: "average", best_baseline_mae: 2.8, weeks_rf_won: 1 },
    days: Array.from({ length: 7 }, (_, i) => ({ date: addDays(START, i), customers: 6.8, revenue: 1431.4 })),
  };
}

function withDay(index: number, change: Record<string, unknown>) {
  const body = valid();
  return { ...body, days: body.days.map((day, i) => (i === index ? { ...day, ...change } : day)) };
}

function without(field: string) {
  const body: Record<string, unknown> = valid();
  delete body[field];
  return body;
}

function expectRejected(name: string, body: unknown, start = START, days = 7) {
  const result = parseForecastResponse(body, start, days);
  check(name, !result.ok, result.ok ? "was accepted" : "");
}

console.log("Dates");
check("addDays crosses a month end", addDays("2026-10-30", 3) === "2026-11-02");
check("addDays crosses a year end", addDays("2026-12-31", 1) === "2027-01-01");

console.log("\nValid response");
const ok = parseForecastResponse(valid(), START, 7);
check("7 consecutive days pass", ok.ok, ok.ok ? "" : ok.error);
const zero = { ...valid(), days: valid().days.map((day) => ({ ...day, customers: 0, revenue: 0 })) };
check("0 customers is allowed", parseForecastResponse(zero, START, 7).ok);

console.log("\nRejected");
expectRejected("6 days when 7 were asked", { ...valid(), days: valid().days.slice(0, 6) });
expectRejected("8 days when 7 were asked", { ...valid(), days: [...valid().days, { date: addDays(START, 7), customers: 1, revenue: 210.5 }] });
expectRejected("a skipped date", withDay(3, { date: addDays(START, 4) }));
expectRejected("starts on another date", valid(), "2026-10-13");
expectRejected("negative customers", withDay(2, { customers: -0.1 }));
expectRejected("negative revenue", withDay(2, { revenue: -1 }));
expectRejected("not a real date", withDay(0, { date: "2026-02-30" }));
expectRejected("customers as a string", withDay(0, { customers: "6.8" }));
for (const field of ["model_version", "data_to", "avg_ticket", "evaluation", "days"]) {
  expectRejected(`missing ${field}`, without(field));
}
const evaluation: Record<string, unknown> = { ...valid().evaluation };
delete evaluation.rf_mae;
expectRejected("missing evaluation.rf_mae", { ...valid(), evaluation });
expectRejected("null body", null);

// Slice 9: the optional method comparison. Invented numbers only.
function comparison(change: Record<string, unknown> = {}) {
  const methods = ["average", "weekday", "last7", "naive", "linear", "gboost", "random_forest", "random_forest_last7"];
  const numbers = (offset: number) => Object.fromEntries(methods.map((m, i) => [m, 1 + offset + i / 10]));
  return { basis: "reference", test_from: "2026-09-26", served: "random_forest", mean: numbers(0), spread: numbers(0.5), ...change };
}

console.log("\nComparison (optional)");
check("a response with a valid comparison passes", parseForecastResponse({ ...valid(), comparison: comparison() }, START, 7).ok);
check("a response with a null comparison passes", parseForecastResponse({ ...valid(), comparison: null }, START, 7).ok);
check("a response without a comparison still passes", parseForecastResponse(valid(), START, 7).ok);
expectRejected("comparison with a bad basis", { ...valid(), comparison: comparison({ basis: "maybe" }) });
expectRejected("comparison without served", { ...valid(), comparison: comparison({ served: undefined }) });
expectRejected("comparison whose served method has no mean", { ...valid(), comparison: comparison({ served: "ridge" }) });
expectRejected("comparison with a negative error", { ...valid(), comparison: comparison({ mean: { random_forest: -1 } }) });
expectRejected("comparison with a non-numeric mean", { ...valid(), comparison: comparison({ mean: { random_forest: "3.1" } }) });
expectRejected("comparison with a bad test_from date", { ...valid(), comparison: comparison({ test_from: "2026-02-30" }) });
check("a comparison with weekly errors passes (slice 10)", parseForecastResponse({ ...valid(), comparison: comparison({ weeks: [{ start: "2026-09-26", end: "2026-10-02", mae: { random_forest: 2 } }] }) }, START, 7).ok);
expectRejected("a week with a negative error", { ...valid(), comparison: comparison({ weeks: [{ start: "2026-09-26", end: "2026-10-02", mae: { random_forest: -2 } }] }) });
expectRejected("a week with a bad date", { ...valid(), comparison: comparison({ weeks: [{ start: "2026-09-31", end: "2026-10-02", mae: { random_forest: 2 } }] }) });
check("a saved comparison that is malformed reads back as null", parseSavedComparison({ basis: "test" }) === null && parseSavedComparison(null) === null);
check("a saved valid comparison reads back", parseSavedComparison(comparison()) !== null);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}

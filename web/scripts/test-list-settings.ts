/**
 * Slice 22 (Decisions 10 and 11): what a paged list keeps in the browser and the Showing line.
 * Pure, with a fake storage; needs nothing.
 *
 *   npm run test:list-settings
 */
import {
  clearListSettings, isDefault, keepRange, readListSettings, resolveKeptRange, shortRangeText, showingText,
  validChoice, validPageSize, writeListSettings, type StorageLike,
} from "../src/lib/list-settings";

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

function fakeStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}
const throwing: StorageLike = {
  getItem: () => { throw new Error("blocked"); },
  setItem: () => { throw new Error("full"); },
  removeItem: () => { throw new Error("blocked"); },
};

type S = { range: ReturnType<typeof keepRange>; barberId: string; serviceId: string; pageSize: number; page?: number };
const BARBERS = ["b1", "b2"];
const SERVICES = ["s1"];
const TODAY = "2026-11-15"; // a Sunday
const defaults: S = { range: { preset: "today" }, barberId: "all", serviceId: "all", pageSize: 25 };
const validate = (raw: Record<string, unknown>, d: S): S => ({
  // The range is kept as is here; the page resolves it with resolveKeptRange. Never the page number.
  range: raw.range && typeof raw.range === "object" ? (raw.range as S["range"]) : d.range,
  barberId: validChoice(raw.barberId, BARBERS),
  serviceId: validChoice(raw.serviceId, SERVICES),
  pageSize: validPageSize(raw.pageSize, d.pageSize),
});

console.log("Round trip");
const storage = fakeStorage();
const kept: S = { range: { preset: "thisWeek" }, barberId: "b2", serviceId: "s1", pageSize: 50 };
writeListSettings("sales", kept, storage);
check("what was written is read back", JSON.stringify(readListSettings("sales", defaults, validate, storage)) === JSON.stringify(kept));
check("each list has its own key", readListSettings("devices", defaults, validate, storage) === defaults);
writeListSettings("sales", { ...kept, page: 7 }, storage);
check("a stored page number is ignored (always page 1)", readListSettings("sales", defaults, validate, storage).page === undefined);

console.log("\nMissing, unreadable or throwing storage");
check("nothing kept gives the defaults", readListSettings("none", defaults, validate, fakeStorage()) === defaults);
const junk = fakeStorage();
junk.setItem("ruzzco:list:sales", "{not json");
check("unreadable text gives the defaults", readListSettings("sales", defaults, validate, junk) === defaults);
junk.setItem("ruzzco:list:sales", "[1,2]");
check("a non-object gives the defaults", readListSettings("sales", defaults, validate, junk) === defaults);
check("a throwing storage reads as the defaults", readListSettings("sales", defaults, validate, throwing) === defaults);
let threw = false;
try { writeListSettings("sales", kept, throwing); clearListSettings("sales", throwing); } catch { threw = true; }
check("a throwing storage never throws on write or clear", !threw);
check("no storage at all gives the defaults", readListSettings("sales", defaults, validate, null) === defaults);

console.log("\nRanges");
const preset = resolveKeptRange({ preset: "thisWeek" }, "2026-11-15");
check("a preset is kept by name", JSON.stringify(keepRange({ key: "thisWeek", from: "2026-11-09", to: "2026-11-15" })) === JSON.stringify({ preset: "thisWeek" }));
check("a preset resolves against the day it is read", preset.from === "2026-11-09" && preset.to === "2026-11-15");
const tomorrow = resolveKeptRange({ preset: "thisWeek" }, "2026-11-16");
check("so 'This week' is still this week the next day", tomorrow.from === "2026-11-16" && tomorrow.to === "2026-11-16", `${tomorrow.from}..${tomorrow.to}`);
check("a Custom range is kept by its two dates", JSON.stringify(keepRange({ key: "custom", from: "2026-11-01", to: "2026-11-10" })) === JSON.stringify({ from: "2026-11-01", to: "2026-11-10" }));
const custom = resolveKeptRange({ from: "2026-11-01", to: "2026-11-10" }, TODAY);
check("a valid Custom range comes back", custom.key === "custom" && custom.from === "2026-11-01" && custom.to === "2026-11-10");
for (const [name, raw] of [
  ["an unreadable date", { from: "nope", to: "2026-11-10" }],
  ["a range that has become invalid (to after today)", { from: "2026-11-10", to: "2026-11-30" }],
  ["from after to", { from: "2026-11-10", to: "2026-11-01" }],
  ["an unknown preset", { preset: "lastYear" }],
  ["a non-object", "today"],
] as const) {
  const r = resolveKeptRange(raw, TODAY);
  check(`${name} falls back to Today`, r.key === "today" && r.from === TODAY && r.to === TODAY);
}

console.log("\nEach setting falls back on its own");
const mixed = fakeStorage();
mixed.setItem("ruzzco:list:sales", JSON.stringify({ range: { preset: "thisMonth" }, barberId: "gone", serviceId: "s1", pageSize: 7 }));
const got = readListSettings("sales", defaults, validate, mixed);
check("an unknown barber goes to All", got.barberId === "all");
check("a non-preset size gives the list's default", got.pageSize === 25);
check("the valid ones are untouched", got.serviceId === "s1" && JSON.stringify(got.range) === JSON.stringify({ preset: "thisMonth" }));
check("validPageSize accepts presets and refuses the rest", validPageSize(50, 10) === 50 && validPageSize(51, 10) === 10 && validPageSize("50", 10) === 10);
check("validChoice keeps All and an offered id only", validChoice("all", BARBERS) === "all" && validChoice("b1", BARBERS) === "b1" && validChoice("x", BARBERS) === "all" && validChoice(5, BARBERS) === "all");

console.log("\nReset");
check("isDefault is false while a setting differs", !isDefault(kept as unknown as object, defaults as unknown as object));
check("isDefault is true for the defaults", isDefault({ ...defaults, range: defaults.range }, defaults));
clearListSettings("sales", storage);
check("Reset clears the key", !storage.data.has("ruzzco:list:sales"));
check("and the list reads its defaults after it", readListSettings("sales", defaults, validate, storage) === defaults);

console.log("\nThe Showing line");
const filters = (barber: string | null, method: string | null, status: string | null) => [
  { label: "Barber", value: barber, allText: "all barbers" },
  { label: "Method", value: method, allText: "all methods" },
  { label: "Status", value: status, allText: "all statuses" },
];
const range = { from: "2026-11-10", to: "2026-11-16" };
const byDefault = showingText(filters(null, null, null), range);
check("by default it names every filter as All and the dates", byDefault.text === "Showing: all barbers · all methods · all statuses · Nov 10–16, 2026" && !byDefault.filtered, byDefault.text);
const set = showingText(filters("Bayani", "GCash", null), { from: "2026-11-01", to: "2026-11-16" });
check("with filters set it names only those, then the dates", set.text === "Showing: Bayani · GCash · Nov 1–16, 2026" && set.filtered, set.text);
check("a list without a range names only its filters", showingText(filters(null, null, null), null).text === "Showing: all barbers · all methods · all statuses");
check("short dates: one day, across months, across years",
  shortRangeText("2026-11-10", "2026-11-10") === "Nov 10, 2026" && shortRangeText("2026-10-30", "2026-11-02") === "Oct 30–Nov 2, 2026" && shortRangeText("2025-12-30", "2026-01-02") === "Dec 30, 2025–Jan 2, 2026",
  [shortRangeText("2026-10-30", "2026-11-02"), shortRangeText("2025-12-30", "2026-01-02")].join(" | "));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}

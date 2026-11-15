/**
 * Slice 21a: the owner's menu. Pure, reads the list and the source:
 *   npm run test:nav
 *
 * N1 the list: nine pages, no /pos or /shift-log (an owner session records no sale; the shift
 *    log is the phone's own list), every owner page reachable.
 * N2 which item is current.
 * N3 the owner's screens (the shell, the dashboard, every owner page) link to no barber page, and
 *    the shell draws its list from OWNER_NAV only.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { OWNER_NAV, isCurrentNav, navTitle } from "../src/lib/owner-nav";
import { DEVICE_PAGES, OWNER_PAGES, gateKind } from "../src/lib/approval-gate";

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

console.log("N1 the list");
const hrefs = OWNER_NAV.map((item) => item.href);
check("nine items", OWNER_NAV.length === 9, String(OWNER_NAV.length));
check("no href twice, no label twice", new Set(hrefs).size === hrefs.length && new Set(OWNER_NAV.map((i) => i.label)).size === OWNER_NAV.length);
check("Dashboard first, at /", OWNER_NAV[0].href === "/" && OWNER_NAV[0].label === "Dashboard");
for (const page of DEVICE_PAGES) check(`${page} is not in the owner menu`, !hrefs.some((href) => href === page || href.startsWith(`${page}/`)));
check("no item is a barber's page by the gate's own rule", hrefs.every((href) => gateKind(href) !== "device"));
for (const page of OWNER_PAGES) check(`${page} is in the menu`, hrefs.includes(page));
check("/about is in the menu", hrefs.includes("/about"));
check("no 'Shift Log' label", !OWNER_NAV.some((item) => /shift/i.test(item.label)));
check("every href is a path on this site", hrefs.every((href) => /^\/[a-z-]*$/.test(href)));

console.log("\nN2 the current item");
check("/ is current only on /", isCurrentNav("/", "/") && !isCurrentNav("/ledger", "/") && !isCurrentNav("/about", "/"));
check("a page is current on itself, its sub-paths and with a query", isCurrentNav("/ledger", "/ledger") && isCurrentNav("/staff/new", "/staff") && isCurrentNav("/insights?range=7", "/insights"));
check("a lookalike path is not current", !isCurrentNav("/ledgerx", "/ledger"));
check("exactly one item is current on every menu page", hrefs.every((path) => OWNER_NAV.filter((item) => isCurrentNav(path, item.href)).length === 1));
check("the top bar names the page", navTitle("/") === "Dashboard" && navTitle("/reconciliation") === "End-of-Day Cash" && navTitle("/?period=week") === "Dashboard");
check("an unknown page falls back to the shop's name", navTitle("/something") === "Ruzzco Barbers");

console.log("\nN3 the owner's screens link to no barber page");
const SRC = join(process.cwd(), "src");
function sources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}
const ownerFiles = [
  join(SRC, "components", "OwnerShell.tsx"),
  join(SRC, "components", "OwnerPageGate.tsx"),
  join(SRC, "lib", "owner-nav.ts"),
  join(SRC, "lib", "dashboard.ts"),
  join(SRC, "app", "page.tsx"),
  ...sources(join(SRC, "components", "dashboard")),
  ...[...OWNER_PAGES, "/about"].flatMap((page) => sources(join(SRC, "app", page.slice(1)))),
];
check(`found the owner's files (${ownerFiles.length})`, ownerFiles.length >= 20 && ownerFiles.every((file) => existsSync(file)));
const BARBER_LINK = /(?:href|push|replace|assign)\s*[=(]\s*\{?\s*["'`]\/(?:pos|shift-log)\b|BARBER_HOME/;
const linking = ownerFiles.filter((file) => BARBER_LINK.test(readFileSync(file, "utf8")));
check("none links or navigates to /pos or /shift-log", linking.length === 0, linking.map((f) => relative(SRC, f).split(sep).join("/")).join(", "));
const shell = readFileSync(join(SRC, "components", "OwnerShell.tsx"), "utf8");
check("the shell draws its list from OWNER_NAV", /OWNER_NAV\.map\(/.test(shell));
const shellHrefs = [...shell.matchAll(/href=(?:"([^"]+)"|\{([^}]+)\})/g)].map((m) => m[1] ?? m[2]);
check("the shell's only other link is the logo, to /", shellHrefs.every((href) => href === "/" || href === "item.href"), shellHrefs.join(", "));
check("the shell checks no access itself (pages and routes do)", !/ownerPageAccess|hasOwnerAccess/.test(shell));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}

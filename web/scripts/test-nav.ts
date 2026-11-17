/**
 * Slice 21a: the owner's menu. Pure, reads the list and the source:
 *   npm run test:nav
 *
 * N1 the list: ten pages, no /pos or /shift-log (an owner session records no sale; the shift
 *    log is the phone's own list), every owner page reachable.
 * N2 which item is current.
 * N3 the owner's screens (the shell, the dashboard, every owner page) link to no barber page, and
 *    the shell draws its list from OWNER_NAV only.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { OWNER_NAV, OWNER_NAV_GROUPS, OWNER_NAV_SECONDARY, isCurrentNav, navTitle } from "../src/lib/owner-nav";
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
check("ten items (nine in groups, About beside Lock)", OWNER_NAV.length === 10, String(OWNER_NAV.length));
check("no href twice, no label twice", new Set(hrefs).size === hrefs.length && new Set(OWNER_NAV.map((i) => i.label)).size === OWNER_NAV.length);
check("Dashboard first, at /", OWNER_NAV[0].href === "/" && OWNER_NAV[0].label === "Dashboard");
check("Sales second, at /sales (slice 22; first of Business, slice 25)", OWNER_NAV[1].href === "/sales" && OWNER_NAV[1].label === "Sales");

// Slice 25: the groups, in order, and About beside Lock.
const groupShape = OWNER_NAV_GROUPS.map((g) => `${g.label}: ${g.items.map((i) => i.label).join(", ")}`).join(" | ");
check(
  "four groups in order",
  groupShape === "Overview: Dashboard | Business: Sales, Reports, Forecast | Financial operations: Payouts, End-of-Day Cash | Team and administration: Staff accounts, Payment QR, Phones",
  groupShape
);
check("About is the only secondary item, outside every group", OWNER_NAV_SECONDARY.length === 1 && OWNER_NAV_SECONDARY[0].href === "/about" && !OWNER_NAV_GROUPS.some((g) => g.items.some((i) => i.href === "/about")));
check("OWNER_NAV is the groups then the secondary items", JSON.stringify(OWNER_NAV) === JSON.stringify([...OWNER_NAV_GROUPS.flatMap((g) => g.items), ...OWNER_NAV_SECONDARY]));
check("/ledger is labelled Payouts", OWNER_NAV.find((i) => i.href === "/ledger")?.label === "Payouts" && navTitle("/ledger") === "Payouts");
check("Staff, Payment QR and Phones stay three separate routes", ["/staff", "/payment-qr", "/devices"].every((href) => OWNER_NAV.filter((i) => i.href === href).length === 1));
for (const page of DEVICE_PAGES) check(`${page} is not in the owner menu`, !hrefs.some((href) => href === page || href.startsWith(`${page}/`)));
check("no item is a barber's page by the gate's own rule", hrefs.every((href) => gateKind(href) !== "device"));
for (const page of OWNER_PAGES) check(`${page} is in the menu`, hrefs.includes(page));
check("/about is in the menu", hrefs.includes("/about"));
check("no 'Shift Log' label", !OWNER_NAV.some((item) => /shift/i.test(item.label)));
check("every href is a path on this site", hrefs.every((href) => /^\/[a-z-]*$/.test(href)));

console.log("\nN2 the current item");
check("/ is current only on /", isCurrentNav("/", "/") && !isCurrentNav("/ledger", "/") && !isCurrentNav("/about", "/"));
check("a page is current on itself, its sub-paths and with a query", isCurrentNav("/ledger", "/ledger") && isCurrentNav("/staff/new", "/staff") && isCurrentNav("/reports?range=last7Days", "/reports"));
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
check("the shell draws its list from the owner-nav groups and secondary list", /OWNER_NAV_GROUPS\.map\(/.test(shell) && /OWNER_NAV_SECONDARY/.test(shell));
// Slice 25: every menu item has its own icon; Sales no longer falls back to the Dashboard's.
const iconKeys = [...shell.matchAll(/^\s*"(\/[a-z-]*)":\s*\w+,/gm)].map((m) => m[1]);
check("every menu item has its own icon entry", OWNER_NAV.every((i) => iconKeys.includes(i.href)), `missing: ${OWNER_NAV.filter((i) => !iconKeys.includes(i.href)).map((i) => i.href).join(", ")}`);
check("Sales' icon is not the Dashboard's", /"\/sales":\s*Receipt,/.test(shell));
// Slice 25: "Payouts" everywhere the owner reads the page's name.
const visibleOld = ownerFiles.concat([join(SRC, "lib", "insights-story.ts")]).filter((file) => {
  const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  return /Barber Ledger|Owner ledger|Daily payout ledger/.test(code);
});
check("no owner screen shows 'Barber Ledger' or the old ledger titles", visibleOld.length === 0, visibleOld.map((f) => relative(SRC, f).split(sep).join("/")).join(", "));
check("About no longer says the ledger is behind an owner PIN", !/behind an owner PIN/.test(readFileSync(join(SRC, "app", "about", "page.tsx"), "utf8")));
// Slice 27: Reports replaced Insights; the old address redirects and has no page of its own.
const nextConfig = readFileSync(join(SRC, "..", "next.config.ts"), "utf8");
check("/insights redirects to /reports (next.config)", /source:\s*"\/insights",\s*destination:\s*"\/reports"/.test(nextConfig));
check("there is no /insights page any more, and a /reports page", !existsSync(join(SRC, "app", "insights", "page.tsx")) && existsSync(join(SRC, "app", "reports", "page.tsx")));
check("no owner screen links to /insights", ownerFiles.filter((file) => /href=["{`]*\/insights/.test(readFileSync(file, "utf8"))).length === 0);
const shellHrefs = [...shell.matchAll(/href=(?:"([^"]+)"|\{([^}]+)\})/g)].map((m) => m[1] ?? m[2]);
check("the shell's only other link is the logo, to /", shellHrefs.every((href) => href === "/" || href === "item.href"), shellHrefs.join(", "));
check("the shell checks no access itself (pages and routes do)", !/ownerPageAccess|hasOwnerAccess/.test(shell));

console.log("\nN4 the barber's header and pages (slice 21b)");
const headerFile = join(SRC, "components", "BarberHeader.tsx");
const header = readFileSync(headerFile, "utf8");
const headerLinks = [...header.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
check("the switch lists exactly /pos and /shift-log", headerLinks.length === 2 && headerLinks.includes("/pos") && headerLinks.includes("/shift-log"), headerLinks.join(", "));
const headerHrefs = [...header.matchAll(/href=(?:"([^"]+)"|\{([^}]+)\})/g)].map((m) => m[1] ?? m[2]);
check("the header's only links come from that list", headerHrefs.every((href) => href === "page.href"), headerHrefs.join(", "));
check("the header names no owner page", !OWNER_NAV.some((item) => item.href !== "/" && header.includes(`"${item.href}"`)) && !/OWNER_NAV|owner-nav/.test(header));
const barberFiles = [headerFile, join(SRC, "app", "pos", "page.tsx"), join(SRC, "app", "shift-log", "page.tsx")];
for (const file of barberFiles) {
  const name = relative(SRC, file).split(sep).join("/");
  check(`${name} links to no owner page`, !OWNER_NAV.some((item) => item.href !== "/" && new RegExp(`href=["{\`]*${item.href}["}\`]`).test(readFileSync(file, "utf8"))));
}
const SERVER_CHECK = /ownerPageAccess|hasOwnerAccess|@\/lib\/owner-access|@\/lib\/session["']|next\/headers|["']server-only["']/;
for (const file of [...barberFiles, join(SRC, "app", "layout.tsx")]) {
  const name = relative(SRC, file).split(sep).join("/");
  check(`${name} imports no server access check`, !SERVER_CHECK.test(readFileSync(file, "utf8")));
}
const signInGate = readFileSync(join(SRC, "components", "SignInGate.tsx"), "utf8");
check("the barber sign-in links to no page (its Back is history only)", !/href=/.test(signInGate) && /<BackButton\s*\/>/.test(signInGate));
// Code only: the comments name pages while explaining the rule.
const backButton = readFileSync(join(SRC, "components", "BackButton.tsx"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
check("Back names no page itself (history, or the fallback it is given)", !/["'`]\/[a-z-]*["'`]/.test(backButton) && [...backButton.matchAll(/href=\{([^}]+)\}/g)].every((m) => m[1] === "fallbackHref"));
check("both barber pages use the header",barberFiles.slice(1).every((file) => /<BarberHeader\b/.test(readFileSync(file, "utf8"))));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}

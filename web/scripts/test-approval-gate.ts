/**
 * Unit test for the approval gate (slice 19 §7, Decision 2): which screen every page shows for
 * each combination of an approved browser and owner access, and the role rule of the slice 19b
 * correction (a BARBER session opens /pos and /shift-log only). Pure, no server or browser:
 *   npm run test:approval-gate
 *
 * A7 reads the source: every page outside /pos, /shift-log and /login must pass through
 * `ownerPageAccess` on the server (in its page or an owner layout), and /pos and /shift-log must
 * not (a server redirect there would stop their cached copies from opening offline).
 * The approval screen is UI gating only; the routes' own checks and the live redirects are
 * covered by test:authz.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { BARBER_HOME, DEVICE_PAGES, OWNER_PAGES, barberMayOpen, gateKind, gateScreen, normalizePath, ownerSignInHref, type GateScreen } from "../src/lib/approval-gate";

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

const GENERAL_PAGES = ["/", "/about"];
const ALL_PAGES = ["/login", ...DEVICE_PAGES, ...OWNER_PAGES, ...GENERAL_PAGES];

// The expected screen for every route × approved × owner access (Decision 2).
function expected(page: string, approved: boolean, owner: boolean): GateScreen {
  if (page === "/login") return "page";
  if ((DEVICE_PAGES as readonly string[]).includes(page)) return approved ? "barber-sign-in" : "approval";
  if ((OWNER_PAGES as readonly string[]).includes(page)) return owner ? "page" : approved ? "owner-sign-in" : "approval-owner-link";
  // Slice 19b correction: approval alone no longer opens / and /about.
  return owner ? "page" : approved ? "sign-in-choice" : "approval-owner-link";
}

console.log("A1 every page × approved × owner access");
for (const page of ALL_PAGES) {
  for (const approved of [false, true]) {
    for (const owner of [false, true]) {
      const got = gateScreen({ pathname: page, approved, ownerAccess: owner });
      const want = expected(page, approved, owner);
      check(`${page} approved=${approved} owner=${owner} → ${want}`, got === want, `got ${got}`);
    }
  }
}

console.log("\nA2 an unapproved browser sees only the approval screen, except on /login");
for (const page of ALL_PAGES.filter((p) => p !== "/login")) {
  const screen = gateScreen({ pathname: page, approved: false, ownerAccess: false });
  check(`${page}: an approval screen`, screen === "approval" || screen === "approval-owner-link", screen);
}
check("/login: never gated", gateScreen({ pathname: "/login", approved: false, ownerAccess: false }) === "page");
check("/login?next=/ledger: never gated", gateScreen({ pathname: "/login?next=/ledger", approved: false, ownerAccess: false }) === "page");

console.log("\nA3 owner access is ignored on /pos and /shift-log (case 4)");
for (const page of DEVICE_PAGES) {
  check(`${page}: owner, not approved → approval, no owner link`, gateScreen({ pathname: page, approved: false, ownerAccess: true }) === "approval");
  check(`${page}: owner and approved → still the barber's sign-in`, gateScreen({ pathname: page, approved: true, ownerAccess: true }) === "barber-sign-in");
}

console.log("\nA4 owner pages open with owner access, without approval (cases 3 and 5)");
for (const page of OWNER_PAGES) {
  check(`${page}: owner, not approved → the page`, gateScreen({ pathname: page, approved: false, ownerAccess: true }) === "page");
  check(`${page}: approved, no owner access → owner sign-in, never the page`, gateScreen({ pathname: page, approved: true, ownerAccess: false }) === "owner-sign-in");
}

console.log("\nA5 paths");
check("a trailing slash is the same page", gateKind("/ledger/") === "owner" && gateKind("/pos/") === "device");
check("a query or hash is ignored", gateKind("/ledger?date=2026-01-01") === "owner" && gateKind("/pos#x") === "device");
check("sub-paths follow their page", gateKind("/staff/new") === "owner");
check("a lookalike path is not an owner page", gateKind("/ledgerx") === "general" && gateKind("/position") === "general");
check("an unknown page is gated like /", gateScreen({ pathname: "/something", approved: false, ownerAccess: false }) === "approval-owner-link");
check("normalizePath keeps /", normalizePath("/") === "/" && normalizePath("") === "/");
check("Owner sign-in returns to the page", ownerSignInHref("/ledger") === "/login?next=%2Fledger" && ownerSignInHref("/") === "/login?next=%2F");

console.log("\nA6 role rule: a barber session opens /pos and /shift-log only (slice 19b correction)");
check("a barber goes to /pos", BARBER_HOME === "/pos");
for (const page of DEVICE_PAGES) check(`${page}: a barber may open it`, barberMayOpen(page) && barberMayOpen(`${page}/`) && barberMayOpen(`${page}?x=1`));
check("/login stays open (owner sign-in)", barberMayOpen("/login") && barberMayOpen("/login?next=/ledger"));
for (const page of [...GENERAL_PAGES, ...OWNER_PAGES, "/something", "/ledgerx", "/position"]) {
  check(`${page}: a barber is redirected to /pos`, !barberMayOpen(page));
}

console.log("\nA7 every page outside /pos, /shift-log and /login checks the role on the server");
const APP = join(process.cwd(), "src", "app");
function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "api" ? [] : pageFiles(full);
    return name === "page.tsx" ? [full] : [];
  });
}
const SERVER_CHECK = /\bownerPageAccess\(|\brequireOwnerPage\(|<OwnerPageGate\b/;
const read = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : "");
const pages = pageFiles(APP);
check(`found the app's pages (${pages.length})`, pages.length >= 12);
for (const file of pages) {
  const dirs = relative(APP, file).split(sep).slice(0, -1);
  const route = `/${dirs.filter((s) => !/^\(.*\)$/.test(s)).join("/")}`;
  // The page itself and every layout between it and the root layout (the root wraps /pos too).
  const chain = [file, ...dirs.map((_, i) => join(APP, ...dirs.slice(0, i + 1), "layout.tsx"))];
  const gated = chain.some((f) => SERVER_CHECK.test(read(f)));
  if (barberMayOpen(route)) {
    check(`${route}: no server role check (/pos and /shift-log open offline; /login signs the owner in)`, !gated);
  } else {
    check(`${route}: ownerPageAccess or OwnerPageGate on the server`, gated);
  }
}
check("the root layout has no role check (it wraps /pos and /shift-log)", !SERVER_CHECK.test(read(join(APP, "layout.tsx"))));
const gateSource = read(join(process.cwd(), "src", "components", "OwnerPageGate.tsx"));
check("OwnerPageGate calls requireOwnerPage", /\brequireOwnerPage\(/.test(gateSource));
const accessSrc = read(join(process.cwd(), "src", "lib", "owner-access.ts"));
const requireFn = accessSrc.slice(accessSrc.indexOf("export async function requireOwnerPage"), accessSrc.indexOf("export async function requireOwnerPage") + 250);
check("requireOwnerPage redirects a visitor without owner access to the generic sign-in", /ownerPageAccess\(\)\)\) redirect\(ownerSignInHref\(pathname\)\)/.test(requireFn));
const accessSource = read(join(process.cwd(), "src", "lib", "owner-access.ts"));
const helper = accessSource.slice(accessSource.indexOf("export async function ownerPageAccess"), accessSource.indexOf("export async function ownerPageAccess") + 600);
check("ownerPageAccess redirects a non-owner account session to BARBER_HOME", /role !== "OWNER"\) redirect\(BARBER_HOME\)/.test(helper));

console.log("\nA8 `/` without owner access queries nothing (slice 21a, Decision 6)");
const home = read(join(APP, "page.tsx"));
const homeCode = home.replace(/^\s*\/\/.*$/gm, "");
const homeImports = [...home.matchAll(/from "(@\/[^"]+)"/g)].map((m) => m[1]);
const HOME_MAY_IMPORT = ["@/lib/owner-access", "@/lib/dashboard", "@/components/ApprovalScreen", "@/components/OwnerPageGate", "@/components/dashboard/Dashboard"];
check("/ imports only the access check, the gate and the dashboard", homeImports.length > 0 && homeImports.every((name) => HOME_MAY_IMPORT.includes(name)), homeImports.join(", "));
check("/ holds no query of its own (no prisma, no loader call)", !/\bprisma\b|\bload[A-Z]\w*\(|latestForecast\(/.test(homeCode));
const fromDashboardLib = /import \{([^}]*)\} from "@\/lib\/dashboard"/.exec(home)?.[1].split(",").map((name) => name.trim()).filter(Boolean) ?? [];
check("/ takes only the period parser from lib/dashboard (no loader)", fromDashboardLib.join(",") === "parseDashboardPeriod", fromDashboardLib.join(","));
const ownerCheckAt = homeCode.indexOf("await ownerPageAccess()");
const refusalAt = homeCode.indexOf("if (!isOwner)");
const dashboardAt = homeCode.indexOf("<Dashboard");
const searchAt = homeCode.indexOf("await searchParams");
check("/ checks owner access first, and returns before the dashboard without it", ownerCheckAt > 0 && refusalAt > ownerCheckAt && dashboardAt > refusalAt && /if \(!isOwner\) \{\s*return \(/.test(homeCode));
check("/ renders the dashboard once, in the owner branch", homeCode.split("<Dashboard").length === 2);
check("/ reads the period only with owner access", searchAt > refusalAt);
check("/ without owner access renders the gate with no content", /<ApprovalGate pathname="\/" title="Ruzzco Barbers" ownerAccess=\{false\}>\s*\{null\}\s*<\/ApprovalGate>/.test(homeCode));
const dashboardLib = read(join(process.cwd(), "src", "lib", "dashboard.ts"));
check("the dashboard's loaders are read-only (no create, update, upsert or delete)", dashboardLib.length > 0 && !/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/.test(dashboardLib));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}

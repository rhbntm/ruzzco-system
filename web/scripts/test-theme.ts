/**
 * Slice 21a: the colour tokens. Pure, reads the source:
 *   npm run test:theme
 *
 * T1 every token of the light set is defined, and the dark set (kept, not selectable: slice 21d cut
 *    the switch) defines the same names; every --color- or --rz- variable the stylesheet uses exists.
 * T2 no colour literal outside the token blocks of globals.css, and none in any component or page
 *    (hex, rgb(), hsl(), Tailwind's black/white and default palette, scheme-dark, dark:).
 *    Exceptions, which must equal the light canvas: the theme-color in app/layout.tsx and
 *    app/manifest.ts (metadata can't read a CSS variable) and public/offline.html (self-contained).
 * T3 contrast of the light set: text at least 4.5:1 on the surfaces it is used on, control edges
 *    at least 3:1.
 * T4 nothing selects the dark set (the switch was cut in slice 21d; light is the only theme).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

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

const ROOT = process.cwd();
const css = readFileSync(join(ROOT, "src", "app", "globals.css"), "utf8").replace(/\r\n/g, "\n");

/** The body of the first top-level block that starts with `head` (a line of its own), and the css without it. */
function block(source: string, head: string): { body: string; rest: string } {
  const start = source.indexOf(`\n${head} {\n`);
  if (start < 0) return { body: "", rest: source };
  const end = source.indexOf("\n}\n", start);
  return { body: source.slice(start + head.length + 4, end), rest: source.slice(0, start) + source.slice(end + 2) };
}

const theme = block(css, "@theme");
const root = block(theme.rest, ":root");
const dark = block(root.rest, ':root[data-theme="dark"]');
const outside = dark.rest;

function tokens(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of body.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)) map.set(match[1], match[2].trim());
  return map;
}
const isColourToken = (name: string) => name.startsWith("--color-") || name.startsWith("--rz-");
const light = new Map([...tokens(theme.body), ...tokens(root.body)].filter(([name]) => isColourToken(name)));
const darkSet = new Map([...tokens(dark.body)].filter(([name]) => isColourToken(name)));

console.log("T1 tokens");
check("the three token blocks exist (@theme, :root, :root[data-theme=\"dark\"])", Boolean(theme.body && root.body && dark.body));
check(`the light set holds the app's tokens (${light.size})`, light.size >= 50);
const missingDark = [...light.keys()].filter((name) => !darkSet.has(name));
const extraDark = [...darkSet.keys()].filter((name) => !light.has(name));
check("the dark set defines every light token", missingDark.length === 0, missingDark.join(", "));
check("the dark set defines no token the light set lacks", extraDark.length === 0, extraDark.join(", "));
const used = new Set([...css.matchAll(/var\((--(?:color|rz)-[a-z0-9-]+)/g)].map((m) => m[1]));
const undefinedVars = [...used].filter((name) => !light.has(name));
check(`every var() the stylesheet uses is a defined token (${used.size})`, undefinedVars.length === 0, undefinedVars.join(", "));

console.log("\nT2 no colour literal outside the token blocks");
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\boklab\(/;
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");
const cssHits = strip(outside).split("\n").filter((line) => LITERAL.test(line));
check("globals.css: none outside @theme, :root and the dark block", cssHits.length === 0, cssHits.slice(0, 5).map((l) => l.trim()).join(" | "));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(tsx?|css)$/.test(name) ? [full] : [];
  });
}
const PALETTE = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const UTILITY = "bg|text|border|ring|ring-offset|divide|outline|fill|stroke|from|to|via|decoration|accent|caret|shadow|placeholder";
const CLASS_LITERAL = new RegExp(
  `(?<![\\w-])(?:${UTILITY})-(?:black|white|(?:${PALETTE})-\\d{2,3})(?![\\w-])|(?<![\\w-])(?:${UTILITY})-\\[(?:#|rgb|hsl)|\\bscheme-dark\\b|(?<![\\w-])dark:`
);
// Metadata can't read a CSS variable: these two files hold the light canvas as a literal (checked below).
const METADATA = new Set([join("src", "app", "layout.tsx"), join("src", "app", "manifest.ts")]);
const sourceHits: string[] = [];
for (const file of files(join(ROOT, "src"))) {
  const rel = relative(ROOT, file);
  if (rel.endsWith(".css")) continue;
  // Code comments may name a colour; markup may not.
  const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  text.split("\n").forEach((line, index) => {
    if (CLASS_LITERAL.test(line) || (!METADATA.has(rel) && LITERAL.test(line))) sourceHits.push(`${rel.split(sep).join("/")}:${index + 1}`);
  });
}
check("components, pages and libs: no hex, rgb(), black/white or palette class, scheme-dark or dark:", sourceHits.length === 0, sourceHits.slice(0, 8).join(", "));

const wall = light.get("--color-wall") ?? "";
const layout = readFileSync(join(ROOT, "src", "app", "layout.tsx"), "utf8");
const manifest = readFileSync(join(ROOT, "src", "app", "manifest.ts"), "utf8");
const offline = readFileSync(join(ROOT, "public", "offline.html"), "utf8");
const hexIn = (text: string) => [...text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase());
check("layout.tsx: theme-color is the light canvas", hexIn(layout).length === 1 && hexIn(layout)[0] === wall, hexIn(layout).join(","));
check("manifest.ts: background and theme colour are the light canvas", hexIn(manifest).length === 2 && hexIn(manifest).every((hex) => hex === wall), hexIn(manifest).join(","));
const lightValues = new Set([...light.values()].filter((value) => /^#[0-9a-f]{6}$/.test(value)));
const offlineStray = hexIn(offline).filter((hex) => !lightValues.has(hex));
check("offline.html: every colour is a light token's value", hexIn(offline).length > 0 && offlineStray.length === 0, offlineStray.join(","));
check("offline.html: light colour scheme and the light canvas as theme-color", /color-scheme:\s*light/.test(offline) && offline.includes(`name="theme-color" content="${wall}"`));

console.log("\nT3 contrast (light set)");
type RGB = [number, number, number];
function rgb(name: string, set = light): RGB {
  const value = set.get(`--color-${name}`) ?? "";
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(value);
  if (!match) throw new Error(`--color-${name} is not a plain hex colour: "${value}"`);
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}
const channel = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]: RGB) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
function contrast(a: RGB, b: RGB) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** color-mix(in srgb, a p%, b). */
const mix = (a: RGB, percent: number, b: RGB): RGB => [0, 1, 2].map((i) => Math.round((a[i] * percent + b[i] * (100 - percent)) / 100)) as RGB;

function pair(text: string, fg: RGB, on: string, bg: RGB, least: number) {
  const ratio = contrast(fg, bg);
  check(`${text} on ${on}: ${ratio.toFixed(2)} ≥ ${least}`, ratio >= least);
}
const SURFACES = ["wall", "panel", "panel-2", "well"];
for (const text of ["bone", "bone-2", "dust"]) for (const surface of [...SURFACES, "panel-3"]) pair(text, rgb(text), surface, rgb(surface), 4.5);
for (const surface of SURFACES) pair("dust-2", rgb("dust-2"), surface, rgb(surface), 4.5);
// Words and icons in a state or wallet colour, on the canvas and on a card.
for (const text of ["crimson", "crimson-bright", "crimson-ink", "ok", "ok-ink", "warn", "warn-ink", "over", "over-ink", "cash", "cash-ink", "gcash", "gcash-ink", "maya", "maya-ink", "qrph", "qrph-ink", "brass", "brass-bright"]) {
  for (const surface of ["wall", "panel"]) pair(text, rgb(text), surface, rgb(surface), 4.5);
}
// Pills, notices and wallet buttons: the ink on its own tint (at most 18% of the colour on a card).
for (const [ink, base] of [["ok-ink", "ok"], ["warn-ink", "warn"], ["crimson-ink", "crimson"], ["over-ink", "over"], ["cash-ink", "cash"], ["gcash-ink", "gcash"], ["maya-ink", "maya"], ["qrph-ink", "qrph"]] as const) {
  pair(ink, rgb(ink), `its 18% tint`, mix(rgb(base), 18, rgb("panel")), 4.5);
}
for (const fill of ["crimson", "crimson-bright", "crimson-deep", "gcash-solid", "maya-solid", "qrph-solid"]) pair("on-accent", rgb("on-accent"), fill, rgb(fill), 4.5);
pair("on-warn", rgb("on-warn"), "warn", rgb("warn"), 4.5);
pair("chrome (field edge)", rgb("chrome"), "wall-raised", rgb("wall-raised"), 3);
pair("chrome (field edge)", rgb("chrome"), "wall", rgb("wall"), 3);

console.log("\nT4 the dark set is not selectable (the switch was cut in slice 21d)");
const setters = files(join(ROOT, "src")).filter((file) => !file.endsWith(".css") && /data-theme|dataset\.theme/.test(readFileSync(file, "utf8")));
check("nothing in src sets data-theme", setters.length === 0, setters.map((f) => relative(ROOT, f)).join(", "));
check("the stylesheet's default colour scheme is light", /color-scheme:\s*light/.test(root.body));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}

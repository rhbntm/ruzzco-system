---
version: 1
slug: "src-app-pos-page-tsx"
primary_target: "src/app/pos/page.tsx"
related_targets: ["src/app/page.tsx","src/app/shift-log/page.tsx","src/app/reconciliation/page.tsx","src/app/ledger/page.tsx","src/app/payment-qr/page.tsx","src/app/insights/page.tsx","src/app/layout.tsx","src/app/globals.css"]
---

# Surface brief: whole web app (POS station, shift log, End-of-Day Cash, owner pages, home)

Scope: every route in `src/app` plus shared components. Visitor mode: Operate.
Audience and job: barbers ring up cuts on phones at the chair; Mart closes out the drawer, pays barbers, reads insights.
Constraints: no change to functions, flows, copy meaning, aria/live regions or 44px touch targets; fonts self-hosted; CSS-only motion.

## Direction contract

THESIS: The station is the shop after dark: the black logo banner hung on the crimson accent wall. It refuses the category default, a grey dashboard with one red accent and glowing cards.

OWN-WORLD: Matte black-wall ground (warm near-black, fine grain), leather-black panels with a chrome hairline and a cool LED top-light, crimson enamel only for the primary action and selection, barber-pole red/white/navy stripes for state, antique brass only on money totals, owner marks and mustache dividers. Oswald condensed caps for titles, prices and totals; system sans for labels and body.

STORY: A barber sees whose phone this is, whether it is online and what waits to sync, taps a service, then a payment; the sale drops into Recent cuts. Mart reads the day, counts the drawer, settles payouts.

FIRST VIEWPORT: POS. Black banner header: pole mark, RUZZCO wordmark, barber badge, online pill, sync button. Service cards stacked left, the selected one edged by a pole stripe; checkout column with a full-width crimson Cash button as the primary action, GCash and Maya beneath.

FORM: user-pinned "Shop logo + brass" (option 1 of 3, chosen 2026-10-14). Seed key: none (pinned direction; concept-seed not run). Signature move: the barber pole as the station's state light, spinning while it works (startup, sync) and still at rest.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

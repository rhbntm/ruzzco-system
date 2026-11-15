# Slice 21 — Redesign: owner shell and dashboard, light and dark themes, logo, range picker

Repo: `ruzzco-system`. Status: **APPROVED 2026-11-15 (§8 answered, see §8), in progress: 21a built (§5.1 "As built"), 21c, 21b and 21d not started. PRELIMINARY, register items PR-2, PR-3, PR-5 (screen half) and PR-7** (written 2026-11-15), branch `revision/preliminary`. Built on slice 20 (date ranges backend), which is committed (`948efef`). Delivered as four increments, 21a to 21d (§5).
Source design: six screen mock-ups and two design-system documents in the private vault (`../ruzzco-barbers/70_App_Screens/stitch_ruzzco_pos_design_system/`). They are generated mock-ups: layout and visual language are the input; their figures, names, labels and features are not (§2). Requirements: the team's redesign brief of 2026-11-14 (private notes), whose rules this spec follows: a light, plain POS theme; two role-specific experiences; presentation only, with no change to pricing, discounts, tips, commission, payouts, cash reconciliation, sync, offline behaviour or forecasting.
Goal: the owner lands on a dashboard inside one navigation, the app reads as a plain POS in a light theme (dark kept as a choice), the shop's logo is on every screen, and the reports get the from/to picker that slice 20 prepared.

## 1. Scope boundary (read first)

- In: colour tokens for two themes and a theme switch; one owner shell (sidebar, top bar, phone menu) on every owner page; `/` as the owner dashboard with a Today, This week, This month switch; `rangeSummary` moved unchanged to a lib; the logo placements; `DateRangeBar` on the Barber Ledger summary and a new payout history section; the new look applied to `/ledger`, `/reconciliation`, `/insights`, `/forecast`, `/pos`, `/shift-log` and the remaining owner and sign-in screens; removal of the mirror, drawer, ambience and cursor; copy fixes; `public/sw.js` VERSION; `DESIGN.md`, `PRODUCT.md`, CLAUDE.md.
- Unchanged: every API route, request and answer; the schema (no migration); sync, Dexie, attribution, commission, payouts, reconciliation, time review, price check; authentication, the approval screen, role redirects and the authorization matrix; the POS flow of slices 17 and 17b (ticket, Charge, charge sheet with cash received and change, done screen, Back behaviour, one exit per dialog); what `/pos` and `/shift-log` need to open offline; every aria name, live region and touch-target rule the pages have today.
- Out: everything in §2's "not adopted" column; exports and printing; a server-side sales list for the owner; a history of past cash counts; a denomination counter; Insights trends over any range (assumption 7); new figures of any kind. No new business rule: this slice changes how existing figures are shown, never how they are computed.

## 2. What the design shows, and what is adopted

The dark document's tokens are the app's current tokens (same names and values), so "dark" is today's palette in the new layout and "light" is the new palette. Only the dashboard was drawn in both themes; the POS and the ledger only dark; End-of-Day Cash and Insights only light. No mock-up exists for the logo, sign-in, approval, Shift Log, Forecast, Payment QR, Phones, Staff, About, or any owner page at phone or tablet width. Against the brief's handoff list the delivery is partial: no flows or prototype, no component library, no loading, empty, error, offline, pending-sync, failed-sync or authorization states, and no editable design file. Where the design is silent, this slice keeps the current page's content and states and applies the tokens and components of §4.

| Screen | Adopted | Not adopted (and why) |
|---|---|---|
| All | Sidebar and top bar; card and tile shapes; KPI tile with a coloured top edge; tabular figures; Oswald uppercase headings; payment-method colours; status chips with an icon and a word | Branch, station, chair, register, "HQ", shift and reference numbers, version labels, "SQLite" and "cloud" wording (none exist; the phones sync to the shop PC); barber job titles and fixed roster (the roster is data); Export CSV and Print (not built); "Quick POS" (an owner session never records a sale); "Shift Logs" in the owner menu (the shift log is the phone's own list) |
| POS | Service tiles with an icon and the price; the header layout; tip chips; the ticket summary line | Four "instant pay" buttons that record in one tap: they would remove the charge sheet, cash received and change, and the GCash/Maya QR step built for PR-1. Service durations (not data). The "Daily Cash Close" link (the POS links only to `/pos` and `/shift-log`). QR Ph shown always (only when the gateway is on) |
| Dashboard | Four KPI tiles; the Today/Week/Month switch; sales trend; payment mix; services mix; per-barber table; expected-drawer-cash card; forecast strip | "Pay now" as a write on the dashboard (payouts are entered on `/ledger` only); a drawer formula without cash payouts (the rule has four terms); "AI projection" and "auto-trained" wording |
| Barber Ledger | Barber cards beside one payout form; the cash-or-GCash choice with its drawer effect spelled out; "Full balance" fill; the payout list as a table | A printed commission percentage (rates come from each sale's snapshot, never a constant); "Commission only" and "Tips only" amounts (a payout entry is one amount; splitting it would be a new rule); "Authorized by", reference ids, audit status (not stored) |
| End-of-Day Cash | KPI row (expected, counted, variance, digital not in the drawer); the four-term formula strip | "Match expected" (fills the count with the expected amount, which defeats the count); denomination counter, deposit and float, dual sign-off, tolerance policy, past-shift table (not modelled; new rules or new routes) |
| Insights | Header layout; comparison table styling | Staffing and marketing advice, station allocation, capacity, rush percentages, retraining date, model status labels, and any sentence saying the forecast "outperformed" the simple methods. The comparison text stays what `/forecast` says today |

The mock-ups also omit states the pages must keep: sign-in and approval screens, the waiting banner, pending and rejected sales, sales held for date review, the out-of-date cash count, additional owed, corrections, the commission-base toggle, custom amounts, PENDING QR Ph sales, empty and error states.

No figure, name or identifier is copied from the mock-ups into code, fixtures, tests or this spec.

## 3. Decisions (approved 2026-11-15 with the answers in §8)

1. **Two themes from one token set, light by default.** The existing `--color-*` tokens keep their names; `:root` holds the light values and `:root[data-theme="dark"]` today's values. The choice is per browser (`localStorage`), applied by a small inline script in the root layout before first paint, so it works on a cached `/pos` with the shop PC off and needs no server check. The brief asks only for light; dark is kept because its values already exist. If time runs out the switch is dropped and light ships alone.
2. **Colour roles** (the plan's role table): crimson for the logo, the barber-pole strip and the one primary action per screen; red text only for errors and a short drawer; three statuses (done, waiting, needs attention), each with an icon and a word; payment methods keep their colours, with cash neutral (dark ink) so red stops meaning both "cash" and "wrong". Brass stays in dark only; in light, money totals are plain ink. Text contrast at least 4.5:1 in both themes.
3. **Type and icons.** Oswald (self-hosted) for headings and figures; the system sans stack for text; `lucide-react` icons. The mock-ups' Hanken Grotesk, Inter, Material Symbols and Phosphor load from CDNs, which the app must never need. A self-hosted text face can follow later if the designer asks.
4. **Owner shell.** `OwnerPageGate` renders `OwnerShell` around the page when owner access is true, so no page file moves and each page keeps its own `ownerPageAccess()` call. Those per-page calls are not merged into the shell or a layout: a layout does not stop its page from rendering, and `test:approval-gate` A7 requires the call in every page. From 1024px: a fixed sidebar. Below: a top bar with a menu button opening the same list. Items: Dashboard, Barber Ledger, End-of-Day Cash, Insights, Forecast, Payment QR, Phones, Staff accounts, About; at the foot the theme switch and Lock. The top bar shows the page title and today's Manila date. Per-page "Back to home" links go.
5. **Barber screens.** `/pos` is the barber's home: no third barber page is added. `/pos` and `/shift-log` get one shared header (logo, connection, sync, settings) and a two-item switch between them. The header names the barber this phone is assigned to ("Sales on this phone: {barber}", the attribution) and, only when it differs or nobody is signed in, the signed-in account beside it, so the two are never confused. No server check is added to either page or to the root layout.
6. **`/` is the owner dashboard, with a period switch.** Today (the default), This week and This month, from `presetRange`, so a period always ends today. The period drives the summary cards only; the drawer, the cash count, date review, phones and the forecast are always today's and say so. Without owner access `/` queries nothing and renders only the approval or sign-in screen, as slice 19 §7 already shows it; the roster and price list leave its HTML.
7. **The dashboard writes nothing.** Each card links to the page that owns the action (Barber Ledger, End-of-Day Cash, Phones, Forecast).
8. **Logo.** Until a vector logo is delivered: the mustache mark from the shop's logo in a crimson square with "RUZZCO BARBERS" in Oswald, in the sidebar, the barber header and the top of the sign-in and approval screens; the full logo image on `/about`. The scissors glyph in the mock-ups is a placeholder and is not used.
9. **The POS keeps its flow.** Only its look changes (§2).
10. **Ranges.** `DateRangeBar` (the presets of `presetRange`; a custom from and to, `to` never after today, is the optional part and the first cut) drives the Barber Ledger summary through `from`/`to` and a new read-only "Payout history" section on `/ledger` from `GET /api/v1/reports/payout-history`. Payout cards and End-of-Day Cash stay single-day.

## 4. Build

Read the Next.js guides in `node_modules/next/dist/docs/` for layouts, inline scripts and metadata before writing code.

### 4.1 Tokens and theme (`app/globals.css`, `app/layout.tsx`, `app/manifest.ts`, `public/offline.html`)

Light and dark values under the same token names; literal colours in `globals.css` (`rgba(…)`, `color-mix`, hex) and in components (`text-[#…]`, `bg-[#…]`, black shadows, `scheme-dark` on date inputs, `color-scheme`) replaced by tokens. `lib/theme.ts` (read, write, apply) and `components/ThemeSwitch.tsx`; the inline script sets `data-theme` and the `theme-color` meta. The manifest and `offline.html` take the light values.

### 4.2 Shells (`components/OwnerShell.tsx`, `components/AppNav.tsx`, `components/BarberHeader.tsx`, `components/Logo.tsx`)

Decisions 4, 5 and 8. The navigation list is one array. The phone menu closes on navigation, on Escape and on Back, with focus returned to its button.

### 4.3 Dashboard (`app/page.tsx`, `components/dashboard/*`)

Server component; every figure comes from a function another page already uses, so the pages cannot disagree. One calculation path: `rangeFigures` (`src/lib/range-figures.ts`, slice 20) runs the sales query; `rangeSummary`, today a function inside the ledger-summary route, composes it with petty cash and the payout totals. `rangeSummary` moves unchanged to `src/lib/range-summary.ts`, and the route and the dashboard both call it. Nothing is computed a second way.

| Card | Dates | Source | Link |
|---|---|---|---|
| Sales (amount paid, number of sales), average per sale | the period | `rangeSummary` | Insights |
| Payment mix (QR Ph only when the gateway is on); services sold | the period | `rangeSummary`, `BarList` | Insights |
| Commissions, tips, petty cash, left for the shop | the period | `rangeSummary` (`leftForShop`) | Barber Ledger |
| Owed to barbers: owed, paid, remaining; per barber: sales, commission, tips | the period | `rangeSummary` | Barber Ledger |
| Sales per day (the period's days; the last 14 days when the period is Today) | the period | `rangeSummary` days, `loadTrends`, `ColumnChart` | Insights |
| Expected drawer cash with its four terms, and the count's state (not counted, saved, out of date) | today | `computeExpected`, `latestRevision`, `computeStaleness` | End-of-Day Cash |
| Sales held for date review | today | `countHeldForReview` | End-of-Day Cash |
| Phones: label and last seen | now | `devices.lastSeenAt` | Phones |
| Forecast | from today | `latestForecast`, `ForecastPanel` | Forecast |

Every card states its dates. Charts carry axis labels, units and a legend; peso amounts and counts are never on one unlabelled axis. Every card has a loading and an empty state; a failed source shows that card's error state and the others still render.

### 4.4 Pages

- `/ledger`: barber cards beside one payout form (amount empty by default, "Full balance" fills the remaining amount, cash or GCash with its drawer effect, note, Record payout); Correct, additional owed, held-for-review, the commission-base toggle, Summary and Custom amounts kept; `DateRangeBar` on the Summary; the Payout history section (Decision 10).
- `/reconciliation`: KPI row, the formula strip, then the existing count form, petty cash, date review, saved record and out-of-date notice.
- `/insights`, `/forecast`, `/payment-qr`, `/devices`, `/staff`, `/about`, `/login`, the approval and sign-in screens: tokens, cards and the shell only. Wording unchanged except §4.6. The forecast keeps its existing statements: customers are predicted and revenue is derived from them; accuracy was measured on 7-day test weeks only; an offline service shows the saved forecast with its date. Sign-in and approval stay separate screens with their own wording.
- `/pos`, `/shift-log`: Decision 5 and §2; the sheets, dialogs and fixed payment bar keep their behaviour; the shift log stays newest first, 20 a page; saved on the phone, waiting to sync, synced and needs attention stay four distinct states.

### 4.5 Removed

`ShopAmbience`, `ShopRoom`, `ShopCursor`, `StationMirror`, `OwnerDrawer`, `public/cursors/`, and their CSS (`.rz-mirror*`, `.rz-tray*`, `.rz-room*`, `.rz-cursor*`, `.rz-vinyl`, `.rz-plate*`). `HistoryFade` goes only if nothing else depends on it.

### 4.6 Copy and figures

"Two taps" and "7-day" claims removed; the `health` link leaves the footer; every peso amount uses `lib/peso.ts` (thousands separators, two decimals), replacing the per-page helpers on the pages this slice touches.

### 4.7 Housekeeping

`public/sw.js` VERSION 5 (the cached `/pos` and `/shift-log` change). `DESIGN.md` and `PRODUCT.md` rewritten for the new design. CLAUDE.md: the "Public by design" line (the roster and price list are no longer in `/`'s HTML without owner access), the removed components, the theme key.

## 5. Increments

Four increments, each a complete workflow that can be verified, committed and stopped at on its own. Order: 21a, 21c, 21b, 21d. The financial pages come before the barber pages because their backend (slice 20) is waiting for its screen, and the POS is the page with the most to lose (it is the offline copy) and the least to gain (slice 17 already rebuilt it; 21a makes it light).

Rules for every increment:

- It starts only when the §8 assumptions it lists are answered (all were, 2026-11-15).
- It ends with the app working on every page, the checks of §6 passing, its own manual test done, and one commit (when asked). The next increment starts from that commit.
- If time runs out, whole increments are cut from the end; inside an increment, the items marked "cut first".

### 5.1 Slice 21a: owner experience and the light foundation (PR-2; with PR-3's theme and PR-7's logo)

The owner signs in, lands on a dashboard, and reaches every owner page from one menu. Every page of the app is readable in light, redesigned or not.

- Waits on: assumptions 1, 2, 4, 6, 8, 9, 10.
- Deliverables:
  - The light values under the existing token names, for the whole app at once: every page reads the same tokens, so a partial remap would leave unreadable pages. Literal colours in `globals.css` and in every component and page replaced by tokens (§4.1). The dark values stay in the stylesheet, unreachable until 21d.
  - The mirror, drawer, ambience and cursor removed (§4.5).
  - `Logo`, `OwnerShell`, `AppNav` (§4.2); every owner page inside the shell with its current content; the per-page "Back to home" links removed.
  - `rangeSummary` moved to `src/lib/range-summary.ts` (§4.3).
  - The dashboard at `/` with its period switch (§4.3, Decision 6); `/` queries nothing without owner access.
  - Copy fixes on the pages touched (§4.6); `sw.js` VERSION, the manifest and `offline.html` colours (§4.7); `DESIGN.md` and CLAUDE.md for what changed.
- Not in 21a: new layouts for any page other than `/`; the barber header; the theme switch.
- Accepted when:
  - With owner access, `/` shows every card of §4.3; each card names its dates; Today, This week and This month change the period cards and never the today cards.
  - The dashboard's figures for a period equal the ledger-summary answer for the same dates, and its drawer card equals End-of-Day Cash for today.
  - All nine menu items open from any owner page with no second sign-in, at 360, 768 and 1440 px wide; Lock ends the session.
  - Without owner access `/` shows only the approval or sign-in screen and runs no query; a barber session is still redirected to `/pos`.
  - Every page, `/pos` and `/shift-log` included, has no dark surface left and no text below 4.5:1; the POS still records a sale online and with the shop PC off.
- Tests: new `test:theme` (light set only: every token defined; no colour literal outside the token blocks; contrast pairs); new `test:nav` (owner list holds no `/pos` or `/shift-log`); `test:approval-gate` gains the no-query check on `/`; `test:ledger-summary` unchanged after the move, plus the dashboard-equals-summary check for today and for Monday to today.
- Manual test: (1) sign in as the owner, read the dashboard, switch the three periods; (2) compare one period's sales with `/ledger`'s Summary and the drawer card with `/reconciliation`; (3) open the nine menu items, then Lock; (4) on a phone, record one cash sale on the now-light POS, then once more with the shop PC off.

**As built (2026-11-15).** Commits: `c2be7b4`, `c59bc30`, `a1039f5` (the code, pushed mid-increment for a hosted preview, before verification) and the completing commit named in the session log (tests, service worker, `offline.html`, documents, two colour fixes).

- Delivered: every deliverable above. `DESIGN.md` was rewritten whole rather than amended, because most of the old text described the removed station, room and cursor; `PRODUCT.md` stays for 21d.
- Differences from the text above, all presentation:
  - The top bar names the page as a short trail ("Owner / Barber Ledger") beside today's date, and each page keeps its own heading and reload button under it, so the title is not printed twice as a heading.
  - `/about` follows `/` (assumption 8): without owner access it queries nothing and renders only the approval or sign-in screen.
  - End-of-Day Cash lost its links to `/shift-log` and `/pos` with its "Home" link: an owner screen links to no barber page (`test:nav`).
  - The forecast on the dashboard is the existing `ForecastPanel`, which is a card of its own, so it is not wrapped in a second card.
  - The per-barber table reads `rangeFigures` directly (the summary's own sales query); `rangeSummary` moved unchanged and returns no per-barber rows. `test:ledger-summary` checks the rows add up to the summary.
  - Payment mix shows QR Ph when the gateway is on or the period holds QR Ph sales, so the shares always add up to the total.
  - `BarList` takes an optional colour per bar; `ColumnChart` is unchanged.
- Tests: `test:theme` 87 (found GCash and Maya text below 4.5:1 on the canvas; both darkened), `test:nav` 27, `test:approval-gate` 126 (A8, eight checks on `/`), `test:ledger-summary` 143 (22 dashboard checks: each period equals `GET ledger-summary?from&to` field for field, the drawer card equals End-of-Day Cash, `/` without owner access holds no barber or service name and no peso amount, a barber session is redirected), `test:authz` 318 (three checks named the old home page's "Paid sales today" text; they now name the dashboard, and the signed-out check also refuses any peso amount). Every other suite passed unchanged, except three that could not run here: attribution T17 (`TEST_ADMIN_DATABASE_URL` unset), `test:device-approval` (`DEVICE_APPROVAL_PIN` unset), `test:forecast` (ml-service not running). `npm run lint` and `npx tsc --noEmit` clean.
- Checked in a desktop browser (dev server): the dashboard and its three periods; all nine menu items at 1440 px and, in a 360 px frame, `/`, `/ledger`, `/pos` and `/shift-log` (no sideways scroll); the phone menu (a choice navigates, Escape and Back close it, focus returns to its button); Lock; signing in on an owner page brings the menu up without a reload; the approval, sign-in choice, owner sign-in and barber sign-in screens with the logo.
- Not checked, still owed: the POS and Shift Log behind the barber sign-in (the ticket, charge sheet and done screen) were not seen in light by anyone yet, and manual test step 4 (a cash sale on a phone, online and with the shop PC off) needs a real phone. `sw.js` VERSION 5 was not exercised against an installed phone.

### 5.2 Slice 21c: financial management (PR-5, screen half)

The owner reads what each barber is owed over any preset period, sees every payout made, records a payout and counts the drawer, on the redesigned pages.

- Waits on: assumption 7 (and 2, answered for 21a).
- Deliverables:
  - `DateRangeBar` with the presets of `presetRange`, on the Barber Ledger Summary through `from`/`to` (Decision 10).
  - The read-only Payout history section on `/ledger` from `GET /api/v1/reports/payout-history`: days newest first, each barber's owed, paid, remaining, entries, the additional-owed flag, sales held for review.
  - The `/ledger` layout: barber cards beside one payout form (§4.4). Correct, additional owed, held for review, the commission-base toggle, Summary and Custom amounts kept.
  - The `/reconciliation` layout: KPI row, the four-term formula strip, then the existing form and states (§4.4).
  - Cut first: a custom from and to in `DateRangeBar`.
- Not in 21c: any change to a route, to what a payout or a count stores, or to a figure; ranges on the payout cards or on End-of-Day Cash.
- Accepted when:
  - A one-day range shows exactly what the day view showed before; "This week" equals the sum of its days; the Summary and the Payout history always show the same dates.
  - A payout above what is owed is refused with the same message as before; a double tap saves one entry; a correction needs its reason; a cash payout lowers expected drawer cash on `/reconciliation` and the dashboard, a GCash payout does not.
  - `/reconciliation` shows not counted, saved, and out of date as before, and the sales held for date review.
  - Loading, empty (no sales, no payouts) and failed-request states exist for the range views.
- Tests: `test:payout-entries`, `test:payout-history`, `test:ledger-summary`, `test:reconciliation`, `test:commission`, `test:time-review`, `test:date-range` unchanged and green; no new server test, since no server code changes.
- Manual test: (1) on `/ledger` choose Today, then This week, and check the two sections move together; (2) record a cash payout, correct part of it, see both in Payout history; (3) open `/reconciliation`, read the formula strip against the payout just made, save a count; (4) record one more sale and see the count marked out of date.

### 5.3 Slice 21b: barber experience (PR-3; keeps PR-1's flow)

A barber records a sale, takes payment and reviews the shift on the redesigned phone screens, online or not.

- Waits on: assumptions 3 and 5.
- Deliverables:
  - `BarberHeader` on `/pos` and `/shift-log`: logo, the assigned-barber indicator and the signed-in account when it differs (Decision 5), connection, sync with its counts, settings, and the two-item switch.
  - Service tiles and the ticket in the new look (§2); the charge sheet, payment steps, done screen and dialogs restyled with their behaviour unchanged.
  - The shift log's summary and list in the new look: newest first, 20 a page; saved on the phone, waiting to sync, synced and needs attention as four distinct states, each with an icon and a word.
  - `sw.js` VERSION bumped again.
- Not in 21b: one-tap payment (unless assumption 3 is answered otherwise, which would need its own rule and spec); a third barber page; any server check on `/pos`, `/shift-log` or the root layout; any change to Dexie, sync or sign-in.
- Accepted when:
  - A cash sale (cash received, change, done, New sale) and a GCash sale (QR step, then record) complete as before; Back closes the open sheet without recording or losing the ticket.
  - With the shop PC off, `/pos` and `/shift-log` open from the home screen, a sale is saved and shown as waiting; it syncs when the PC returns.
  - A rejected sale still shows as needing attention with Retry; the waiting-for-approval banner still shows on an unapproved phone.
  - The header never shows an owner link, and shows whose sales this phone records before anyone signs in.
  - Every control is at least 44 px on a phone; nothing scrolls sideways at 360 px.
- Tests: `test:sheet-stack`, `test:submit-lock`, `test:local-session`, `test:sync-queue`, `test:shift-log-pages`, `test:pricing`, `test:qr-cache`, `test:approval-gate` unchanged and green; `test:nav` gains: the barber header links only to `/pos` and `/shift-log`, and neither page nor the root layout imports a server access check.
- Manual test, on a real phone: (1) sign in, record a cash sale and a GCash sale; (2) press Back with the charge sheet open; (3) turn the shop PC off, reopen the app from the home screen, record a sale, open Shift Log; (4) turn the PC on and watch the sale sync.

### 5.4 Slice 21d: decision support and administration (PR-3)

Every remaining screen uses the same components, and the app is consistent end to end.

- Waits on: assumption 1 (whether dark is offered at all), 11.
- Deliverables:
  - `/insights` and `/forecast` in the new cards and tables, wording unchanged (§4.4).
  - `/payment-qr`, `/devices`, `/staff`, `/about`, `/login`, the approval and sign-in screens.
  - `PRODUCT.md` and the rest of `DESIGN.md`.
  - Cut first, and only if assumption 1 keeps dark: `ThemeSwitch`, the inline script, and dark verified on every page of 21a to 21d. Until this ships, dark is not selectable anywhere.
- Not in 21d: new Insights content, trends over a free range, any forecast wording beyond today's.
- Accepted when:
  - Insights' figures for a day equal the dashboard's and End-of-Day Cash's for that day; the forecast still says customers are predicted, revenue is derived, and only 7-day accuracy was tested; an offline forecast service shows the saved forecast with its date.
  - Uploading a payment QR, revoking a phone, creating and deactivating a staff account, signing in as each role and approving a phone all work as before.
  - If the switch ships: the choice survives a reload, applies before first paint, and works on `/pos` with the shop PC off; `test:theme` passes for both sets.
- Tests: `test:insights-story`, `test:authz`, `test:auth`, `test:device-approval`, `test:payment-qr`, `test:approval-gate` unchanged and green; `test:theme` extended to the dark set if the switch ships.
- Manual test: (1) open Insights and Forecast and compare one day with the dashboard; (2) reset a barber's password on `/staff` and sign in with it on a phone; (3) open an unapproved browser and see the approval screen; (4) if the switch ships, change the theme and walk every menu item.

## 6. Checks for every increment

- Every existing suite green, not only the ones an increment names; `npm run lint` and `npx tsc --noEmit` clean. Suites that cannot run for the environment are named in the report, not counted as passing.
- No route, schema, Dexie or service-worker caching rule changes other than the `sw.js` VERSION.
- In a browser at 360 × 740 and 1440 × 900: each page the increment touched is hard-reloaded and its figures compared with the same page before the increment.

## 7. After the last increment

One pass over the whole app as each role, in every theme that ships, on a real phone and the shop PC; the app-screens catalog is captured again; the register rows are updated per increment (21a: PR-2, PR-3, PR-7; 21c: PR-5; 21b and 21d: PR-3).

## 8. Assumptions (all answered 2026-11-15)

Answers: 1 light is the default and the only theme offered until 21d has verified dark on every page; the switch is the first cut. 2 cash neutral. 3 the charge-sheet flow stays; no one-tap payment. 4 as written; only the period cards change. 5 `/pos` is the barber's home. 6 the existing mustache mark with the wordmark, on every screen including sign-in and approval. 7 presets and payout history in 21c; custom from/to optional and cut first; Insights keeps 7, 14 and 30 days. 8 as written. 9 Oswald and the system sans; no CDN. 10 no Shift Logs in the owner menu. 11 as written. 12 accepted; verification is not traded for the estimate.

1. Light is the default and dark stays as a switch (Decision 1). The brief asks only for light; alternative: light only.
2. Cash becomes neutral instead of crimson (Decision 2). The two design documents disagree (one crimson, one green).
3. The POS keeps the charge-sheet flow; the mock-up's one-tap payment buttons are not built (Decision 9). The brief asks for a checkout summary, a clear confirmation and protection against repeat taps, which the one-tap buttons drop. To confirm with the designer.
4. The dashboard's period switch is Today, This week and This month ending today, not full calendar weeks or months, and it reuses the ledger summary's figures (Decision 6).
5. `/pos` is the barber's home; the brief's "barber home" becomes the shared header, not a new page (Decision 5). A third barber page would need its own offline copy and role rule.
6. The interim logo is the mustache mark with the wordmark (Decision 8). What "a logo for simplified data presentation" asks for, and where, is still to be confirmed.
7. A custom from and to is optional and cut first; Insights keeps its 7, 14 and 30-day trends. PR-5's wording names Insights, so that is the item to add back if time allows.
8. `/` without owner access stops rendering the roster and price list (Decision 6). This narrows a "public by design" gap and changes no route.
9. No text face is added; the system sans stays (Decision 3).
10. The owner menu has no "Shift Logs": the owner's view of sales stays the dashboard, Insights and the Barber Ledger.
11. Screens and states the design does not cover are built from the current pages with the new tokens, without waiting for more mock-ups.
12. Estimated at 3 to 4 working days in all against the plan's 1.5 to 2. The increments do not shorten it; they make 21a alone a complete answer to the written panel item, and §5 gives the cut order after it.

<!-- END OF SPEC -->

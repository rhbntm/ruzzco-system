---
name: Ruzzco Barbers System
description: The shop's offline-first POS and end-of-day books as a plain, light POS. One token set, light by default; the earlier dark palette is kept under the same names and is not selectable yet.
colors:
  wall: "#f6f7f8"
  wall-raised: "#ffffff"
  panel: "#ffffff"
  panel-2: "#f3f4f6"
  panel-3: "#e5e7eb"
  well: "#f3f4f6"
  seam: "#e5e7eb"
  seam-strong: "#d1d5db"
  seam-hover: "#9ca3af"
  chrome: "#868c96"
  chrome-hover: "#4b5563"
  bone: "#111827"
  bone-2: "#374151"
  dust: "#4b5563"
  dust-2: "#646b78"
  crimson: "#c41f29"
  crimson-bright: "#d0242e"
  crimson-deep: "#8c1a20"
  crimson-ink: "#a3161e"
  on-accent: "#ffffff"
  on-warn: "#ffffff"
  paper: "#ffffff"
  brass: "#4b5563"
  brass-bright: "#111827"
  pole-blue: "#2b4aa6"
  pole-white: "#ffffff"
  cash: "#374151"
  cash-ink: "#1f2937"
  gcash: "#1a64d0"
  gcash-ink: "#1553b7"
  gcash-solid: "#1f66d9"
  maya: "#0a7a48"
  maya-ink: "#0a6b3f"
  maya-solid: "#0d7f4a"
  qrph: "#7c3aed"
  qrph-ink: "#6130c9"
  qrph-solid: "#7c3aed"
  ok: "#15803d"
  ok-ink: "#0a6b43"
  warn: "#b45309"
  warn-ink: "#8a4b08"
  over: "#2563eb"
  over-ink: "#1d4ed8"
typography:
  display:
    fontFamily: "Oswald, 'Arial Narrow', 'Roboto Condensed', sans-serif"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "0.03em"
  figure:
    fontFamily: "Oswald, 'Arial Narrow', 'Roboto Condensed', sans-serif"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "0.01em"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.875rem"
    lineHeight: 1.6
  input:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1rem"
    lineHeight: 1.4
rounded:
  control: "8px"
  well: "8px"
  panel: "10px"
  pay: "12px"
  dialog: "14px"
  pill: "999px"
---

# Design System: Ruzzco Barbers System

## Overview

**A plain, light POS (slice 21).** A cool off-white canvas, white cards with a hairline and a faint shadow, dark ink, Oswald caps for headings and figures, and crimson for three things only: the logo and barber-pole strip, the one primary action on a screen, and errors. It replaced "the shop after dark" (the station mirror, the owner's drawer, the room's light and air, the shears cursor), which was removed in slice 21a; the defended look is tagged `v1.0-defense`.

Every screen is a working tool first: barbers ring up cuts one-handed at the chair, and the owner reads the day and counts the drawer at closing. Controls are the standard ones (buttons, segmented choices, fields, tables, dialogs), 44px tall on touch screens, with 16px inputs so iOS never zooms.

Two experiences share the system. The **owner** works inside one shell (a sidebar from 1024px, a top bar and menu below it) and lands on a dashboard. The **barber** works on `/pos` and `/shift-log` only; those pages are stored on the phone and open with the shop PC off, so nothing on them may need the server to draw.

Slice 21 is delivered in four increments: 21a the light theme, the owner shell and the dashboard; 21c the Barber Ledger and End-of-Day Cash layouts; 21b the barber header, POS tiles and the shift log's sale states. The remaining pages plus the theme switch (21d) still have their earlier layouts in the new colours.

## Colors

Colours are tokens, defined once in `src/app/globals.css`: the light values in `@theme` (colours) and `:root` (shadows and drawn materials), the dark values under `:root[data-theme="dark"]` with the same names. **Nothing outside those three blocks holds a colour literal**, in the stylesheet or in any component (`npm run test:theme`). Three files repeat the light canvas because they cannot read a CSS variable: `app/layout.tsx` (theme-color), `app/manifest.ts` and `public/offline.html`; the test checks they match.

### Roles
- **Canvas and surfaces.** `wall` the page; `panel` a card; `panel-2` and `panel-3` raised or hovered controls; `well` a recessed area inside a card; `wall-raised` a field's fill.
- **Hairlines.** `seam` card borders and dividers; `seam-strong` button borders and table header rules; `seam-hover` on hover and the rule over a total; `chrome` field borders (3:1 on the fill), `chrome-hover` on hover.
- **Text.** `bone` primary text and every plain figure; `bone-2` secondary; `dust` muted text and labels; `dust-2` placeholders, IDs and the chart's context columns. All at least 4.5:1 on the surfaces they sit on.
- **Crimson.** `crimson` the logo mark, the pole stripe, the primary button and the current menu item; `crimson-bright` its hover and a focused field's border; `crimson-deep` pressed; `crimson-ink` red text: an error, a shortfall, a downward trend. Text and icons on a crimson or wallet-solid fill are `on-accent`.
- **Payment methods.** Cash is neutral (`cash`, `cash-ink`), so red never means both "cash" and "wrong". GCash, Maya and QR Ph keep their own colours: the base for icons, bars and words, `-ink` on a tint, `-solid` for a filled button with `on-accent` text. They are used for their payment methods and nothing else.
- **States.** `ok` done (synced, saved, paid, balanced), `warn` waiting or needs attention (held for review, out of date, still owed), `over` cash over. Each has an `-ink` for text on its tint and always comes with an icon and a word, never colour alone. Text on a solid `warn` fill is `on-warn`.
- **Brass** (`brass`, `brass-bright`) belongs to the dark set. In light both are plain ink, so money totals are not coloured.
- **Fixed.** `paper` the white a QR code sits on, in both sets; `pole-white` and `pole-blue` the pole's other stripes.

### Tints
A state or wallet tint is mixed onto the solid panel (`color-mix(in srgb, var(--color-warn) 8%, var(--color-panel))`), never drawn as a translucent colour, so it reads the same on the canvas and on a card. Pills use 11% with a 38% border, notices 8% with a 35% border, wallet pay buttons 10% (18% on hover).

### Dark set
The dark values are the app's colours before slice 21, unchanged, plus dark values for the tokens slice 21 added. Nothing sets `data-theme`; slice 21d adds the switch only once every page and state has been checked in dark. Until then dark is unreachable.

## Typography

**Display:** Oswald (variable 200–700, self-hosted at `src/app/fonts/Oswald-Variable.woff2`, Latin plus ₱, SIL OFL), uppercase, for page and section titles (`.rz-title`, `.rz-heading`), the logo wordmark, standalone figures (`.rz-figure`) and the POS checkout buttons (`.rz-pay`).
**Body:** the platform's system sans, for everything read or typed: labels (`.rz-label`, uppercase micro), field labels (`.rz-field-label`, sentence case), tables and prose.

Columns of money use the system sans with `tabular-nums` so decimals line up; Oswald's digits are proportional, so it is for standalone figures. Every peso amount on the pages slice 21 touches is printed by `lib/peso.ts` (thousands separators, two decimals). No font is loaded from a CDN: the build and the phones work offline.

## Layout

- **Owner shell** (`OwnerShell`, rendered by `OwnerPageGate`, `/` and `/about` only after owner access was found on the server). From 1024px: a fixed 15rem sidebar (logo, the nine pages from `lib/owner-nav.ts`, Lock at its foot). Below: a 56px top bar with a menu button that opens the same list as a dialog; it closes on a choice, on Escape and on the phone's Back, and focus returns to its button. The top bar names the page and today's Manila date. The shell links to no barber page (`npm run test:nav`).
- **Page header** (`.rz-banner`): a page's own title and its reload button, under the top bar. Pages no longer carry a "Home" link.
- **Dashboard** (`/`, 78rem): a header with the Today / This week / This month switch; a row of four KPI tiles (two columns on phones); cards in a 3-column grid from 1024px, stacked below; then the cards that are always today's.
- **Other pages** keep their widths: POS `max-w-6xl`, Shift Log `max-w-3xl`, End-of-Day Cash `max-w-2xl`, Ledger, Payment QR and Forecast `max-w-4xl`, Insights `max-w-5xl`. Side gutters 16px, 24px from `sm`.
- Every control reaches 44px on touch screens (`pointer-coarse:min-h-11`); nothing scrolls sideways at 360px.

## Elevation

Flat by default: a card is a hairline and `--rz-shadow-card`. Three more steps exist and nothing else draws a shadow: `--rz-shadow-float` (tooltips, toasts, a QR image), `--rz-shadow-modal` (dialogs and the phone menu, over the `scrim`), `--rz-shadow-bar` (the POS's fixed payment bar) and `--rz-shadow-btn` (primary and wallet-solid buttons). They are applied through `.rz-shadow-*` or the component classes, never written inline.

## Shapes

8px controls, fields and wells; 10px cards, strips and notices; 12px pay buttons; 14px dialogs; full pills for status. Borders are 1px hairlines. A card never holds another card: inside one, use a well or hairline rows (`.rz-rows`).

## Components

- **Logo** (`Logo`): the mustache mark from the shop's own logo in a crimson square with the RUZZCO BARBERS wordmark in Oswald; the interim logo until a vector one is delivered. Inline in the sidebar and phone menu, the mark alone in the top bar, stacked on the sign-in, approval and POS start screens. `RuzzcoLogoBanner` (the logo image) remains for the Insights presentation.
- **Buttons** (`.rz-btn`): primary crimson (one per screen); secondary white on a hairline; ghost; warn (Retry, "Use date"); danger ("Tap again" to remove); `.rz-btn-gcash`, `.rz-btn-maya`, `.rz-btn-qrph` solid wallet buttons. Disabled is 45% opacity. Keyboard focus is a 2px ink outline at 2px offset on every control.
- **Fields** (`.rz-field`): white, a `chrome` border, 16px text; focus is a crimson border with a soft crimson ring.
- **Segmented choice** (`.rz-seg`): a well of items; the chosen one is a white chip with a hairline. Tips, trend ranges, the dashboard's period.
- **Card** (`.rz-panel`), **strip** (`.rz-strip`: figures in one card split by hairlines), **well** (`.rz-well`).
- **KPI tile** (`.rz-kpi`): a card with a 3px coloured top edge (`--kpi`), an uppercase caption, one Oswald figure and a one-line note.
- **Pills and notices** (`.rz-pill-*`, `.rz-notice-*`): a state or wallet tint with its ink, always with an icon or a word.
- **Tables** (`.rz-table`): micro uppercase headers, hairline rows, a faint row hover, tabular numbers, totals under a stronger rule.
- **Charts**: `ColumnChart` (one value per column, hover, tap or arrow keys, "Show as table") and `BarList` (labelled share bars; `barClassName` gives a payment method its own colour). A chart states its unit and axes in words and carries a legend when it uses two colours.
- **Barber pole** (`BarberPoleIcon`, `.rz-ribbon`): the state light. It turns while a page loads or a sync runs and stands still otherwise; the ribbon across the top of every page is the same stripe.
- **Barber header** (`BarberHeader`, `/pos` and `/shift-log`): the logo (the mark alone below `sm`), "Sales on this phone: {barber}" (the phone's assignment, which decides attribution), a warn pill naming the signed-in account only when it is someone else's or nobody is signed in, connection, sync with its counts, settings (POS only) and a two-item `.rz-seg` switch whose links are the only ones it has. It reads nothing from the server.
- **Sale states** (Shift Log): Synced (ok), Needs attention (warn), Waiting to sync (the PC can be reached), Saved on this phone (it can't); each a pill with an icon and the word.
- **Sign-in cards** (barber sign-in, owner sign-in, approval): a Back at the top (`BackButton`: browser history; hidden on the barber and approval screens when there is no earlier page, a link to `/` on the owner sign-in), and "Approve this phone" (`ApprovePhoneButton`) under the barber sign-in and on `/login`.
- **Service tiles** (POS): an icon chosen from the service's name (scissors, droplets, sparkles, palette; scissors for anything unrecognised), the name and the price; decoration only.

## Dashboard cards

Each card names its dates, links to the page that owns the action, and has a loading (skeleton), empty and error state of its own; one failed source never blanks the page. The dashboard writes nothing.

| Card | Dates | Source |
|---|---|---|
| Sales, average per sale, left for the shop, still owed | the period | `rangeSummary` |
| Sales per day (the last 14 days when the period is one day) | the period | `rangeSummary` days, `loadTrends` |
| Payment mix (QR Ph only when the gateway is on or the period holds QR Ph sales), services sold | the period | `rangeSummary` |
| The shop's share; owed to barbers with a row per barber | the period | `rangeSummary`, `rangeFigures` |
| Expected drawer cash (four terms) and the cash count's state | today | `computeExpected`, `latestRevision`, `computeStaleness` |
| Sales held for date review | today | `countHeldForReview` |
| Phones | now | `devices` |
| Customer forecast | from today | `latestForecast`, `ForecastPanel` |

## Motion

Short and state-driven; easing `cubic-bezier(0.16, 1, 0.3, 1)`. Pages fade through on navigation (`app/template.tsx`, `HistoryFade` for Back and Forward); content fades and rises in; dialogs pop (payment sheets rise from the bottom on phones); the pole turns while something works; skeletons shimmer. There is no ambient animation. With reduced motion, rises and pops become plain fades and the pole, spinners and shimmer stop.

## Do

- Use crimson for the logo, the one primary action and errors; use the state colours with an icon and a word for status.
- Print money with `lib/peso.ts`, in ink; reserve colour in figures for a shortfall (crimson ink) or an overage (`over`).
- Group related figures in one strip, and divide rows with hairlines inside one card.
- Give every card and chart its dates, its unit, and loading, empty and error states.
- Add a colour as a token in both sets, then use the token.

## Don't

- Don't write a colour literal, a Tailwind palette class, `black`/`white` utilities or `dark:` in a component.
- Don't colour cash red, or use a wallet colour outside its payment method.
- Don't nest cards, add decorative animation, or put a barber pole beside a heading as ornament.
- Don't load fonts, icons or scripts from a CDN.
- Don't link from an owner screen to `/pos` or `/shift-log`, or from the POS to an owner page.
- Don't copy a figure, name, label or feature from the design mock-ups: they are layout references only.

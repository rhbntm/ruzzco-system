---
name: Ruzzco Barbers System
description: The shop's offline-first POS and end-of-day books, dressed as the shop after dark.
colors:
  wall: "#0c0b0a"
  wall-raised: "#121110"
  banner: "#080705"
  panel: "#171514"
  panel-2: "#1e1c1a"
  panel-3: "#282522"
  seam: "#2b2c30"
  seam-strong: "#45484e"
  seam-hover: "#5c5f66"
  chrome: "#5f6268"
  chrome-hover: "#7c8089"
  chrome-edge: "#cdd6e4"
  led: "#deeaff"
  led-trim: "#d6e4fa"
  pole-chrome: "#b3b9c1"
  black: "#000000"
  white: "#ffffff"
  bone: "#f5f0e8"
  bone-2: "#d8d0c4"
  dust: "#a69e93"
  dust-2: "#958d83"
  crimson: "#c41f29"
  crimson-bright: "#da2c35"
  crimson-deep: "#8c1a20"
  crimson-ink: "#f27f84"
  accent-wall: "#a3161e"
  brass: "#c9a35a"
  brass-bright: "#e4c584"
  pole-blue: "#2b4aa6"
  gcash: "#2f7cf6"
  gcash-ink: "#8cb8ff"
  gcash-solid: "#1f66d9"
  maya: "#17b26a"
  maya-ink: "#78dfab"
  maya-solid: "#0d7f4a"
  qrph: "#8b5cf6"
  qrph-ink: "#c8b9fd"
  qrph-solid: "#7c3aed"
  ok: "#34c27d"
  ok-ink: "#88e0b3"
  warn: "#ef9f2f"
  warn-ink: "#f7c67d"
  over: "#5f9dfb"
  over-ink: "#a2c6ff"
  bezel-chrome: "#d6dce4"
  nosing-chrome: "#dfe4ea"
  counter: "#0f0e0d"
  glass-ink: "#f3dcd8"
  glass-ink-quiet: "#ecc9c4"
  brass-pull: "#ecd39a"
  brass-escutcheon: "#f3dfae"
  keyhole: "#1b1510"
  felt: "#080706"
  tray-divider: "#24211f"
typography:
  display:
    fontFamily: "Oswald, 'Arial Narrow', 'Roboto Condensed', sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "0.03em"
  hook:
    fontFamily: "Oswald, 'Arial Narrow', 'Roboto Condensed', sans-serif"
    fontSize: "clamp(3rem, 4.4vw, 4rem)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "0.03em"
  section-title:
    fontFamily: "Oswald, 'Arial Narrow', 'Roboto Condensed', sans-serif"
    fontSize: "2.75rem"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "0.03em"
  plate-pos:
    fontFamily: "Oswald, 'Arial Narrow', 'Roboto Condensed', sans-serif"
    fontSize: "2.75rem"
    fontWeight: 600
    lineHeight: 0.95
    letterSpacing: "0.04em"
  plate-title:
    fontFamily: "Oswald, 'Arial Narrow', 'Roboto Condensed', sans-serif"
    fontSize: "1.625rem"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "0.04em"
  vinyl-label:
    fontFamily: "Oswald, 'Arial Narrow', 'Roboto Condensed', sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    letterSpacing: "0.08em"
  vinyl-figure:
    fontFamily: "Oswald, 'Arial Narrow', 'Roboto Condensed', sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.03em"
  headline:
    fontFamily: "Oswald, 'Arial Narrow', 'Roboto Condensed', sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "0.08em"
  figure:
    fontFamily: "Oswald, 'Arial Narrow', 'Roboto Condensed', sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "0.01em"
  pay:
    fontFamily: "Oswald, 'Arial Narrow', 'Roboto Condensed', sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.05em"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
  input:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.06em"
  field-label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.4
  micro:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.08em"
rounded:
  pole-cap: "2px"
  skeleton: "6px"
  segment: "8px"
  drawer-panel: "9px"
  control: "10px"
  led-band: "11px"
  pay: "12px"
  led-band-sm: "13px"
  panel: "14px"
  dialog: "18px"
  glass: "18px"
  glass-sm: "21px"
  mirror: "24px"
  mirror-sm: "30px"
  pill: "999px"
spacing:
  gutter: "16px"
  gutter-wide: "24px"
  panel: "20px"
  stack: "20px"
  section-home: "80px"
components:
  button-primary:
    backgroundColor: "{colors.crimson}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.crimson-bright}"
  button-primary-active:
    backgroundColor: "{colors.crimson-deep}"
  button-secondary:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.bone}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "40px"
  button-secondary-hover:
    backgroundColor: "{colors.panel-3}"
  button-ghost:
    textColor: "{colors.dust}"
    rounded: "{rounded.control}"
  pay-cash:
    backgroundColor: "{colors.crimson}"
    textColor: "{colors.white}"
    typography: "{typography.pay}"
    rounded: "{rounded.pay}"
    height: "60px"
  pay-gcash:
    textColor: "{colors.gcash-ink}"
    typography: "{typography.pay}"
    rounded: "{rounded.pay}"
    height: "60px"
  pay-maya:
    textColor: "{colors.maya-ink}"
    typography: "{typography.pay}"
    rounded: "{rounded.pay}"
    height: "60px"
  field:
    backgroundColor: "{colors.wall-raised}"
    textColor: "{colors.bone}"
    typography: "{typography.input}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "40px"
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
    padding: "{spacing.panel}"
  service-selected:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.bone}"
    rounded: "{rounded.pay}"
    padding: "14px 16px 14px 20px"
  segment-selected:
    backgroundColor: "{colors.panel-3}"
    textColor: "{colors.bone}"
    rounded: "{rounded.segment}"
  pill:
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  mirror-bezel:
    backgroundColor: "{colors.bezel-chrome}"
    rounded: "{rounded.mirror}"
    padding: "6px"
  mirror-glass:
    backgroundColor: "{colors.wall}"
    textColor: "{colors.glass-ink}"
    rounded: "{rounded.glass}"
  counter:
    backgroundColor: "{colors.counter}"
  plate:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.bone}"
    rounded: "{rounded.panel}"
    padding: "18px 20px 20px"
  plate-hover:
    backgroundColor: "{colors.panel-2}"
  plate-primary:
    backgroundColor: "{colors.crimson}"
    textColor: "{colors.white}"
    typography: "{typography.plate-pos}"
    rounded: "{rounded.panel}"
    padding: "18px 20px 20px"
  plate-primary-hover:
    backgroundColor: "{colors.crimson-bright}"
  plate-primary-active:
    backgroundColor: "{colors.crimson-deep}"
  drawer:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.bone}"
    rounded: "{rounded.panel}"
    padding: "28px 24px 20px"
  drawer-nameplate:
    backgroundColor: "{colors.counter}"
    textColor: "{colors.bone}"
    typography: "{typography.display}"
    rounded: "{rounded.drawer-panel}"
    padding: "8px 24px 7px"
  drawer-tray:
    backgroundColor: "{colors.felt}"
    rounded: "{rounded.pay}"
    padding: "16px 16px 24px"
---

# Design System: Ruzzco Barbers System

## Overview

**Creative North Star: "The Shop After Dark"**

The station looks like the shop itself after closing: matte black walls under cool LED tubes, black leather chairs edged in chrome, the crimson accent wall with the black logo banner hung on it, and the barber pole by the door. Every screen is a working tool first (barbers ring up cuts one-handed at the chair; Mart counts the drawer at 10 PM), so the world lends only type, palette, density and one signature move. Controls stay the standard ones: buttons, segmented choices, inputs, tables, dialogs.

Density is phone-first and generous: 44px touch targets on touch screens, 16px inputs so iOS never zooms, large Oswald prices. Owner pages (ledger, detailed forecast) run denser, with tables and figure strips. Brass is rare on purpose; crimson means "act here" or "cash"; the barber pole lights only for state; warnings are a hotter amber that always carries an icon.

The look was pinned by the owner's references (the shop logo, the shop interior, a branded clipper render, a gold signage concept) and confirmed on 2026-10-14 as "shop logo + brass": the logo leads, brass is accent only. The gold-serif vintage sign was deliberately not adopted as the display voice. The home page is the one place the world is shown as a scene rather than lent: a barber's station seen from the chair, the chrome-bezelled mirror reflecting the room over a black counter where the day's tools lie, and the owner's books in the counter's own locked drawer.

Behind every page the room itself is live (asked for on 2026-10-15): its light tilts up the wall as a page scrolls, fine hair clippings and dust drift through it, the shears stir them, and the pages fade through it on navigation while the room carries straight on.

**Key Characteristics:**
- A warm near-black room lit at night: crimson light from the accent wall glowing down from the top of the screen, embers low in the corners, the cool LED tube along the ceiling, a fine grain, and clippings and dust drifting through the light. Seams and control edges are cool chrome against the warm black. No blue-black ground, no neon glow on components.
- Condensed caps (Oswald, self-hosted) for titles, prices, totals and the checkout buttons; the system sans for everything read.
- The barber pole as the station's state light, never a heading ornament.
- Figures grouped on one hairline-split sheet instead of floating cards.
- Short, state-driven motion: pages fade through on navigation, content fades and rises in, dialogs pop, the pole turns. The room's air is the one ambient motion, and it stays behind the pages.

## Colors

A black-wall neutral ramp with cool chrome trim, one crimson accent, a sparing antique brass, and fixed colours for the payment wallets and states.

### Primary
- **Accent-Wall Crimson** (#c41f29): the primary button (Cash, Save, Unlock, Show, Upload), the home page's Open the POS plate, and the cash identity: the cash icon, the cash pill, the banknote badge in recent cuts. Bright (#da2c35) is its hover, the focused field's border and the chart emphasis; Deep (#8c1a20) is its pressed state; Ink (#f27f84) is crimson text on dark: icons in headings, plates and the owner's drawer links, the waiting-to-sync clock, and the few figures that report a shortfall (cash short, a downward trend, the forecast's error).
- **Accent Wall** (#a3161e): the wall itself, seen only in the home page's mirror. A deeper crimson than the enamel, lit from the ceiling (white 15% at the top left), falling to black 50% at its foot, with a fine dark grain, and feathered into the shadowed room on every side (a 10% fade at each side, 3.5rem at the top). It is room, not enamel: nothing interactive takes it.

### Secondary
- **Antique Brass** (#c9a35a) and **Bright Brass** (#e4c584): money totals (revenue, total earned, expected drawer, table totals, the "=" lines of a calculation), owner marks (Owner PIN pills, the lock seal, the owner's drawer with its nameplate, lock plate and bar pull), the mustache ornament, the home day line's paid-sales count and prices, and the price leaders. A changed checkout amount flashes brass for a moment.

### Tertiary
- **Pole Blue** (#2b4aa6): the blue stripe of the barber pole and the top ribbon only.

### Wallets and states
- **GCash** (#2f7cf6 / ink #8cb8ff / solid #1f66d9), **Maya** (#17b26a / ink #78dfab / solid #0d7f4a), **QR Ph** (#8b5cf6 / ink #c8b9fd / solid #7c3aed): their payment buttons, pills and totals. "Solid" is the filled confirm button (white text at 4.5:1 or better).
- **OK** (#34c27d / ink #88e0b3): synced, balanced, paid, saved. **Warn** (#ef9f2f / ink #f7c67d): needs attention, held for review, out of date. **Over** (#5f9dfb / ink #a2c6ff): cash over.

### Neutral
- **Wall** (#0c0b0a) the page ground; **Wall Raised** (#121110) inputs (a focused field darkens to #151312); **Banner** (#080705) the header banner and the logo banner's own black; **Panel** (#171514), **Panel 2** (#1e1c1a), **Panel 3** (#282522) surfaces, raised controls, the chosen service and the selected segment.
- **Chrome trim**, cool against the warm black: **Seam** (#2b2c30) hairlines; **Seam Strong** (#45484e) button borders and table header rules, **Seam Hover** (#5c5f66) on hover (secondary buttons and the home tool plates); **Chrome** (#5f6268) field borders and the chosen service's border (3:1 on the field fill), **Chrome Hover** (#7c8089); **Chrome Edge** (#cdd6e4 at 16%) the banner's bottom edge; **Pole Chrome** (#b3b9c1, a four-stop ramp from #6f757d to #f6f7f9) the barber pole's caps.
- **Light**: **LED** (#deeaff at 6%) the tube along the ceiling, part of the room light; **LED Trim** (#d6e4fa) the 1px top light and the faint wash on every panel; **Black** and **White** only at low alpha, for shadows, wells, overlays and glass shading, plus solid white on crimson and wallet-solid buttons.
- **Text**: **Bone** (#f5f0e8) primary text and every plain figure, including cash; **Bone 2** (#d8d0c4) secondary text; **Dust** (#a69e93) muted text and labels (6.6:1 on panel); **Dust 2** (#958d83) placeholders and IDs, and the chart's context columns.

### Station materials (home page)
The home page's mirror and counter are built from a few real materials. They belong to the station and appear nowhere else.
- **Bezel Chrome** (#d6dce4): the mirror's polished bezel, a 160° gradient through #eef1f5 0%, #8a9098 18%, #d6dce4 40%, #6c727a 62%, #c3c9d1 82% and #7f858d 100%.
- **Nosing Chrome** (#dfe4ea): the counter's 3px front edge, a 90° gradient through #5f646b, #dfe4ea 22%, #8f959d 48%, #f2f4f7 72% and #6a7078.
- **Counter** (#0f0e0d): the counter's black, under a fall from #1b1918 through #121110 (at 1.75rem) to #0d0c0b, with the mirror's light on its top edge (LED at 6%).
- **Brass Pull** (#ecd39a): the lit top of the drawer's bar pull, falling through brass (45%) to #8a6d36; its two round mounts fall from brass escutcheon through brass (50%) to #6f5629. **Brass Escutcheon** (#f3dfae): the lock plate's highlight (at 35% 30%), through brass (48%) to #7d6231; the nameplate's frame (170°, through brass 40% to #7d6231) and the screw heads at its ends. **Keyhole** (#1b1510): the keyhole cut into it, with a white 25% lower lip.
- **Felt** (#080706): the floor of the drawer's tray, lined in the wall's fine grain, under a black 60% fall from the counter's edge over its first 3rem. **Tray Divider** (#24211f): the raised divider standing in the tray, lit along its top (white 7%).
- **Glass Ink** (#f3dcd8): lettering on the glass that is not a figure: the hook's description and the day line's labels (about 6:1 on the plain accent wall). **Glass Ink Quiet** (#ecc9c4): the day line's notes (about 5:1). Bone warmed by the wall's light, so the lettering reads as vinyl on the glass; figures on the glass stay bone or brass-bright.

### Room light
The page background is the shop at night (`ShopRoom`): a room pinned to the screen (`.rz-room`), behind all content, with its light (`.rz-room-light`, four radial gradients over the black wall and its grain) and the air in front of it (see Signature: the shop's air).
- **LED tube** (#deeaff at 6%): a narrow band of cool light along the top edge.
- **Accent wall** (#c41f29 at 42%): crimson light glowing down from the top centre, gone by about 45% of the screen height.
- **Ember** (#8c1a20 at 36%): low in the right corner; **soft ember** (#8c1a20 at 18%) low on the left.

The reddest visible point measures about rgb(67 25 27); dust-2 text keeps 4.6:1 there and dust 5.7:1. The light only ever moves, never brightens: as a page scrolls down, it tilts up the wall at 7% of the scroll, at most 12% of the screen (the layer runs 12vh past the foot, its vertical geometry in vh, so the embers never show a cut edge), and eases back when a navigation returns to the top. With reduced motion it hangs still, as it sits at the top of a page.

**In the mirror.** The home page's mirror shows the same room reflected: the black wall under a deep-crimson glow (#8c1a20 at 34%, centred), the LED at 7% across its top 4.5rem, falling to black 55% toward the counter, with a fine light grain, and the accent wall standing in it. This is the room light, seen in the glass; it is the one place the room appears inside content rather than behind it.

### Named Rules
**The Accent Wall Rule.** Crimson is enamel for the one primary action and the cash identity (its icon and pill), and the light of the room behind the pages. Never a glow on a component, never a selected-state tint, never on a money figure: cash figures are bone, and crimson ink appears in figures only to report a shortfall or an error. On the home page the Open the POS plate is the one crimson enamel, and the Accent Wall colour appears only as the wall reflected in the mirror.

**The Room Light Rule.** Colour in the background comes only from the room light. Anything with a translucent identity tint that can sit straight on it (wallet pay buttons, notices, toasts) mixes that tint onto a solid panel (`color-mix(in srgb, <colour> 10%, var(--color-panel))`), so the crimson behind it never shifts a wallet or state colour. The mirror's reflected room is the room light too: its lettering is glass ink, bone and brass, never a wallet or state colour (the offline notice on the glass keeps its solid panel mix). The air takes no colour of its own: its specks are dust and bone, warmed toward crimson ink only where the room's light falls on them.

**The Brass Ledger Rule.** Brass marks money that matters and the owner. It is never an alert colour (warnings use the hotter amber with an icon) and never the focus ring. On the home page: the day's paid-sales count and the prices on the glass, the mustache between them, and the owner's drawer (nameplate, lock plate, bar pull).

**The Wallet Colours Rule.** GCash blue, Maya green and QR Ph violet belong to their payment methods and nothing else. The POS plate names the accepted methods in plain white caps, not in their colours.

## Typography

**Display Font:** Oswald (variable 200–700, self-hosted at `src/app/fonts/Oswald-Variable.woff2`, Latin plus ₱, SIL OFL), with Arial Narrow and Roboto Condensed as fallbacks.
**Body Font:** the platform's system sans (`ui-sans-serif, system-ui, …`).

**Character:** the logo's condensed caps carry the brand on titles and money; the native sans keeps everything read or typed familiar and fast.

### Hierarchy
- **Display** (600, 1.875rem to 3rem, line-height 1.05, uppercase, +0.03em): page titles (`.rz-title`): the PIN gates, dialog titles, banner titles, section titles on the ledger summary and the detailed forecast, barber names on the ledger and Payment QR.
- **Headline** (500, 0.9375rem to 1.25rem, uppercase, +0.08em): section headings (`.rz-heading`), led by a crimson-ink icon where they have one.
- **Figure** (600, 1rem to 2.25rem, line-height 1.1): prices, totals, counts, amounts in rows (`.rz-figure`). Oswald's digits are proportional, so it is for standalone figures.
- **Pay** (600, 1.125rem, uppercase, +0.05em): the POS checkout buttons (`.rz-pay`).
- **Body** (400, 0.875rem to 1rem, line-height 1.6): prose, rules and notes, kept to 65ch (`max-w-prose`).
- **Input** (400, 1rem, line-height 1.4): typed text in fields, so iOS never zooms; 0.875rem from `sm` where a dense form sets it (the ledger, the drawer's PIN field).
- **Label** (600, 0.75rem, uppercase, +0.06em): stat labels and panel legends (`.rz-label`), and the POS plate's payment methods. **Field label** (500, 0.8125rem, sentence case): form labels (`.rz-field-label`). **Micro** (600, 0.6875rem, uppercase, +0.08em): table headers, small uppercase tags ("inactive", "used for this forecast") and the walkthrough's "Syncs when online" connector.

### Home (the station)
- **Hook** (Display, 2.5rem on phones, 3.75rem from `sm`, `clamp(3rem, 4.4vw, 4rem)` from `lg`, line-height 1.05): the home h1, set in three lines ("Every cut, / counted / once.") so no comma sits over a letter. Its description runs in the system sans at 0.9375rem, 1.125rem from `sm`, 1.0625rem from `lg`, relaxed leading, 36ch (50ch from `lg`), in glass ink.
- **Section titles** (Display, 2rem, 2.75rem from `sm`): "How a sale is recorded" and "Built so far".
- **POS plate title** (600, 2.125rem, 2.5rem from `sm`, 2.75rem from `xl`, line-height 0.95, uppercase, +0.04em): "Open the POS".
- **Plate titles** (600, 1.25rem, 1.5rem from `sm`, 1.625rem from `lg`, line-height 1.05, uppercase, +0.04em): Shift Log, End-of-Day Cash. The drawer's compartments set the same caps smaller (0.9375rem, 1.125rem from `sm`, line-height 1.1).
- **Drawer nameplate** (Display, 1.625rem, 1.875rem from `sm`, bone on its counter-black card): "Owner's drawer", at the head of the front, with its state under it as a Label (dust, a brass lock icon).
- **Pull hint** (Micro, dust, brightening to brass when the front is pointed at): "Pull to open" under the pull, "Push to close" once the drawer is out.
- **Vinyl** (the day line on the glass): the label in Oswald 400 at 1.125rem, uppercase, +0.08em, glass ink; its figure on the same baseline in Oswald 600 at 1.5rem, line-height 1, +0.03em, bone or brass-bright. The notes line under it is system sans 0.75rem in glass ink quiet.
- **Board** (the day under the counter below `lg`): the name in Oswald 500 at 0.9375rem, uppercase, +0.06em, bone-2, led by a dotted leader to its figure (Figure, 1.125rem).
- **Step titles** in the walkthrough: Oswald 500 at 1.125rem, uppercase, +0.06em; step numbers Oswald 600 at 0.875rem.

### Named Rules
**The Condensed Caps Rule.** Oswald for titles, prices, totals and the checkout buttons only. Labels, form fields, tables and prose stay in the system sans. The one exception is signage: the home day line's vinyl labels and the board's names are lettered in Oswald, as the shop's own sign and price board are.

**The Tabular Columns Rule.** Columns of money use the system sans with `tabular-nums`, so decimals line up (tables, the ledger summary, list values, the walkthrough's drawer sum).

## Layout

Single-column on phones, widening per page: POS `max-w-6xl` (1, 2, then 3 columns: services, checkout, recent cuts), Shift Log `max-w-3xl`, End-of-Day Cash `max-w-2xl`, Ledger, Payment QR and the detailed forecast `max-w-4xl`, Home and About 78rem. Side gutters 16px (24px from `sm` where set). Operational pages stack sections 20px apart. The POS and Shift Log headers are sticky black banners; the others scroll. Every control reaches 44px on touch screens (`pointer-coarse:min-h-11`). Figure groups use `.rz-strip`, one panel split by hairlines, with responsive columns (End-of-Day Cash: three methods over two totals on a 6-column grid; two columns on phones). Breakpoints are Tailwind's: `sm` 640px, `md` 768px, `lg` 1024px (and `xl` 1280px for the POS plate title).

**Home: the station.** No header banner; the page opens on the mirror.
- **Mirror** (78rem wide, 12px gutters, 24px from `sm`; 16px above, 28px from `sm`): inside the glass, the sign and the lettering stack on phones (28px apart, 36px from `sm`; the sign up to 36rem) and sit side by side from `lg` (`1.12fr 1fr`, 56px apart). The glass is padded 44px 20px 32px, 56px 48px 40px from `sm`, 48px 64px 36px from `lg`.
- **Day line**: from `lg` one line along the foot of the glass, under a white 15% hairline (day figures, the brass mustache, then the prices, wrapping if it must, with one notes line under it). Below `lg` the day moves under the counter as a board panel, so Open the POS stays in the first screen.
- **Counter**: full-bleed, 24px under the mirror (28px from `sm`); its contents 78rem wide, 24–28px top and 40–48px bottom padding, 12px between plates (16px from `sm`). Three columns from `lg` (`1.7fr 1fr 1fr`: Open the POS widest, then Shift Log and End-of-Day Cash); below `lg` Open the POS across, the other two side by side. Below `lg` the POS plate is at least 10rem tall.
- **The owner's drawer**: the counter's own drawer, its own section under the tools (24px under them, 32px from `sm`; below `lg` under the day board), its front as wide as the counter's contents. It loads shut for everyone, owner included; its front stacks centred: the nameplate, its state 12px under it, the lock plate 16px under that, then the pull and its hint. Open, the tray stands between the tools and the front, its box 6px narrower than the front on each side (14px from `sm`): from `lg` the compartments in a column (`1fr`, sticky 24px from the top while the forecast scrolls past) and the forecast (`2.6fr`) either side of a 3px divider, 20px apart; below `lg` the three compartments in a row over the forecast, the divider a 3px rule between them.
- **Sections** below the counter: 80px above "How a sale is recorded" (112px from `sm`), 64px above "Built so far" (96px from `sm`), 64px above the footer (80px from `sm`). The walkthrough is two zones side by side from `lg` (`1fr 5.5rem 1fr`, the middle column the sync crossing), each zone two steps side by side from `sm`. "Built so far" is an 18rem intro beside the list from `lg`; the list is two columns from `sm`.

## Elevation & Depth

Hybrid: tonal layering does most of the work (wall, panel, panel-2, panel-3; recessed wells at black 28%), and soft offset shadows mark what floats. Every panel is lit by the shop's LED tubes: a 1px cool top light and a faint cool wash over its first 3.5rem. Behind everything, the room (see Colors) is pinned to the screen, its air in depth: far specks move with a tenth of the scroll, the nearest with more than half. On the home page the depth is literal: a mirror on the wall over a counter, with plates lying on the counter that lift when pointed at, and a drawer in the counter that slides out toward the chair.

### Shadow Vocabulary
- **Panel** (`inset 0 1px 0 rgb(214 228 250 / 0.13), 0 18px 36px -26px rgb(0 0 0 / 0.95)`, plus `linear-gradient(180deg, rgb(214 228 250 / 0.04), transparent 3.5rem)`): panels, strips.
- **Banner** (`0 12px 26px -18px rgb(0 0 0 / 0.95)`), on `rgb(8 7 5 / 0.97)` with a `rgb(205 214 228 / 0.16)` bottom edge: the header banner.
- **Primary action** (`inset 0 1px 0 rgb(255 255 255 / 0.2), 0 10px 20px -12px rgb(0 0 0 / 0.95)`): crimson buttons. The shadow is black, so the enamel sits on the panel instead of glowing.
- **Selected service** (`inset 0 1px 0 rgb(214 228 250 / 0.14), 0 14px 26px -18px rgb(0 0 0 / 0.95)`): the chosen POS service, lifted.
- **Selected segment** (`inset 0 1px 0 rgb(255 255 255 / 0.06), 0 2px 6px -2px rgb(0 0 0 / 0.6)`).
- **Dialog** (`inset 0 1px 0 rgb(255 255 255 / 0.06), 0 32px 80px -24px rgb(0 0 0 / 0.95)`), over a 76% black overlay with a 3px backdrop blur.
- **Hung sign** (`0 26px 40px -18px rgb(0 0 0 / 0.9), 0 2px 6px rgb(0 0 0 / 0.5)`): the logo banner, in the home mirror and alone on the POS loading screens.
- **Mirror bezel** (`inset 0 1px 0 rgb(255 255 255 / 0.7), inset 0 -1px 0 rgb(0 0 0 / 0.45), 0 2px 4px rgb(0 0 0 / 0.5), 0 44px 70px -36px rgb(0 0 0 / 0.95)`): the mirror on the wall. The glass is set into it (`inset 0 2px 8px rgb(0 0 0 / 0.65)`).
- **Counter** (`0 30px 50px -30px rgb(0 0 0 / 0.95)`), with its nosing casting onto the top (`0 1px 0 rgb(0 0 0 / 0.75), 0 8px 14px -6px rgb(0 0 0 / 0.85)`).
- **Plate** (`inset 0 1px 0 rgb(214 228 250 / 0.13), 0 1px 0 rgb(0 0 0 / 0.55), 0 18px 26px -18px rgb(0 0 0 / 0.95)`): a tool lying on the counter; lifted on hover (`inset 0 1px 0 rgb(214 228 250 / 0.15), 0 1px 0 rgb(0 0 0 / 0.4), 0 28px 34px -20px rgb(0 0 0 / 0.95)`). The POS plate's top light is white (0.24 at rest, 0.26 lifted) with a -16px / -18px spread.
- **Brass hardware**: the bar pull (`inset 0 1px 0 rgb(255 255 255 / 0.5), 0 5px 8px -2px rgb(0 0 0 / 0.85)`, its mounts `0 2px 3px rgb(0 0 0 / 0.75)`), the lock plate (`inset 0 1px 0 rgb(255 255 255 / 0.45), inset 0 -1px 1px rgb(0 0 0 / 0.35), 0 2px 4px rgb(0 0 0 / 0.7)`) and the nameplate (`inset 0 1px 0 rgb(255 255 255 / 0.45), inset 0 -1px 0 rgb(0 0 0 / 0.3), 0 2px 4px rgb(0 0 0 / 0.65)`), whose black card sits in it (`inset 0 1px 3px rgb(0 0 0 / 0.85)`).
- **Drawer front**: the plate shadow at rest, lifted 2px when pointed at; pulled out, nearer the chair (`inset 0 1px 0 rgb(214 228 250 / 0.13), 0 1px 0 rgb(0 0 0 / 0.6), 0 32px 44px -24px rgb(0 0 0 / 0.95)`, 600ms).
- **Tray**: in shadow under the counter's edge and between its walls (`inset 0 1px 0 rgb(214 228 250 / 0.06), inset 10px 0 14px -12px rgb(0 0 0 / 0.9), inset -10px 0 14px -12px rgb(0 0 0 / 0.9)`); the divider stands in it (`0 1px 2px rgb(0 0 0 / 0.8)`).

### Light sources
Lights are not shadows. The home mirror's frosted LED band (a 3px `rgb(240 245 255 / 0.62)` ring, 1px blur, glowing `0 2px 18px rgb(222 234 255 / 0.32)` out and `inset 0 2px 18px rgb(222 234 255 / 0.22)` in), the band's light falling on the glass (LED at 12% from the top over 3.5rem, 8% from the foot and 9% from each side over 3rem), and the LED tube over the sign (a 3px line of white 90%, 60% wide, glowing `0 6px 22px 4px rgb(255 240 225 / 0.28)`) are the only things in the system that glow. The glass's sheen, a streak and a thinner companion at 106°, stays under 15% white so lettering crossing it keeps its contrast.

### Named Rules
**The Offset Shadow Rule.** Shadows always fall (positive Y offset, soft blur). No zero-offset coloured halos, no hard offset block shadows. A light source in the scene (the mirror's LED band and the LED tube) glows because it is a light; no component does.

## Shapes

Rounded but firm, like leather chairs and chrome trim: 10px controls and wells, 12px pay buttons, notices, service cards and segment troughs, 14px panels and home tool plates, 18px dialogs, 8px segment items, 6px skeletons and the logo banner, full pills for status; the pole caps are pill-ended with 2px inner corners. Borders are 1px seams; empty QR slots use a dashed seam. Lists inside a panel are divided by seams (`.rz-rows`), never boxed again: a panel never holds another card, only recessed wells.

The home station nests its radii so each ring stays concentric: the mirror bezel 24px (30px from `sm`) with 6px of chrome (9px from `sm`), the glass 18px (21px from `sm`), the LED band and its glow 11px, set 9px into the glass (13px, 15px in, from `sm`). The drawer's routed inner panel is 9px, 7px inside its 14px front. The bar pull, its mounts and the lock plate are full-round; the nameplate is 12px around its 9px card, 3px of brass between them; the tray box is 12px at its top corners and open at its foot, where it runs into the front.

## Components

### Buttons
- **Shape:** 10px radius, 40px tall (44px on touch), 600 weight, 0.875rem.
- **Primary:** crimson with white text and the black primary-action shadow; hover crimson-bright; pressed crimson-deep and scale 0.98 (motion allowed only).
- **Secondary / Ghost / Warn / Danger:** panel-2 on seam-strong (hover panel-3 on seam-hover); transparent dust; amber outline (Retry, "Use date"); crimson outline ("Tap again" to remove).
- **Icon:** 36px square (44px on touch), secondary or ghost.
- **Disabled:** 45% opacity, not-allowed cursor.
- **Focus:** every control shows the same 2px bone outline at 2px offset on keyboard focus.

### Pay buttons (POS)
Full-width, 60px, 12px radius, Oswald caps with the amount ("CASH — ₱200.00"). Cash is solid crimson; GCash, Maya and QR Ph are wallet tints mixed onto a solid panel (10%, 18% on hover) with a 1.5px wallet border.

### Service cards (POS)
A row per service: icon tile, name, Oswald price. The chosen service lifts to panel-2 on a chrome border with the selected-service shadow, a 6px barber-pole edge runs down its left side, and its icon tile becomes a lit pole; edge and pole turn once when it is chosen. No crimson tint.

### Segmented choices
A dark trough (black 30%, seam border, 12px) of 8px items. The chosen item rises to panel-3 on a seam-strong border with the selected-segment shadow, in bone. Used for tips.

### Inputs / Fields
- **Style:** wall-raised fill, 1px chrome border (hover chrome-hover), 10px radius, 16px text (14px from `sm` where set), placeholder dust-2.
- **Focus:** crimson-bright border, a darker fill and a 3px crimson ring (GCash/Maya reference fields use their wallet colour). Autofilled values keep the field's colours.
- **Select:** native, with a drawn chevron. Checkboxes use crimson as their accent colour.

### Pills and notices
Pills are 24px full-rounded status chips per state or wallet. Notices are 12px boxes with their state tint (warn, danger, ok, over) mixed onto a solid panel, or plain panel-2 when neutral, always with an icon; a success message shows a check icon rather than a ✓ glyph.

### Cards / Containers
- **Panel** (`.rz-panel`): panel fill with the LED wash, seam border, 14px radius, panel shadow, 14–20px padding.
- **Strip** (`.rz-strip`): one panel of figures split by hairlines.
- **Well** (`.rz-well`): recessed (black 28%) area inside a panel: QR slots, the saved-count receipt, the walkthrough's illustrations on About.

### Navigation
A black banner (`.rz-banner`) under the barber-pole ribbon: back link on the left (arrow nudges on hover), the pole and the Oswald title in the middle, status and actions on the right. The home page has no banner; its counter is the navigation, and a small "About" link in its footer leads to the walkthrough.

### Tables
`.rz-table`: micro uppercase headers over a seam-strong rule, seam row dividers, a faint row hover, tabular numbers, and totals under a brass rule.

### Signature: the barber pole
`BarberPoleIcon`: pole-chrome caps on a shaded glass tube with crimson, bone and pole-blue stripes on a seamless 20px tile. It is the station's state light: it turns (`spinning`) while the POS or Shift Log starts, a sync runs, or an owner page loads its data; it turns once (`turnOnce`) on the chosen service; otherwise it stands still in the banner beside the title. The top ribbon (`.rz-ribbon`) is the same stripe at twice the size. Section headings and footers carry no pole.

### Signature: the logo banner
`RuzzcoLogoBanner`: the logo file cropped to its artwork (1.9:1) on its own black (banner black, 6px radius, a white 10% ring, the hung-sign shadow), with an optional `sizes` hint for its image. On the home page it hangs on the accent wall inside the mirror, under an LED tube; on the POS loading and setup screens it stands alone.

### Signature: the station (home page)
The home page is a barber's station seen from the chair.
- **Mirror** (`.rz-mirror`, `MirrorGlass`): a chrome bezel holding the glass. Inside the glass, from back to front: the reflected room (`.rz-mirror-room`, oversized by 1.75rem so it can move without showing an edge) with the accent wall standing in it (`.rz-mirror-accent`); the sheen; the band's glow; the frosted LED band. On the glass, above all of it: the logo banner under its LED tube (reflected, so it moves a little), and the lettering (the hook, its description from `sm`, and from `lg` the day line), which never moves. On phones the sign is at most 16rem wide, the hook is set at 2.125rem and the description is left out, so Open the POS sits near the top of the first screen.
- **Day line** (`.rz-vinyl`, lettering with a `0 1px 0 rgb(0 0 0 / 0.4)` shadow): opening hours, today's paid sales (brass) and the barber count; the brass mustache; each service and its price (brass, without centavos when there are none); then one notes line (city, date, roster). Below `lg` the same day is a board panel under the counter: each name led by a brass dotted leader (2px dotted, brass at 35%) to its figure, prices under a seam. When the database is unreachable an offline notice takes the figures' place.
- **Counter** (`.rz-counter`): full-bleed black with the chrome nosing on its front edge and the mirror's light on its top.
- **Tool plates** (`.rz-plate`): leather-black plates on the counter, each a link to a page: a 24px icon (crimson ink), the Oswald title, a dust description, an arrow in the corner that turns crimson ink and nudges on hover. Hover lifts the plate to panel-2 on seam-hover. **Open the POS** (`.rz-plate-primary`) is the one crimson enamel plate (white text, a white 10% top wash, hover crimson-bright, pressed crimson-deep), the widest, with the accepted payment methods at its foot as a white label; its scissors tilt on hover.
- **Owner's drawer** (`OwnerDrawer`): the counter's own drawer, a section of its own under the tools. Its front (`.rz-drawer-front`) is panel-2 on seam-strong with a routed 9px inner panel (black 50% line). It loads shut for everyone, owner included, and shows nothing of what is inside. Centred on the front: the title on a brass nameplate (`.rz-nameplate`: a brass frame screwed on at both ends around a counter-black card); its state ("Locked · owner PIN" or "Unlocked on this device", each with a brass lock icon); the brass lock plate (`.rz-escutcheon-lg`, 2.75rem) whose keyhole (`.rz-keyhole`, drawn 1.75 times larger) stands upright until the owner PIN has been entered on this device and then turns a quarter; at the foot the brass bar pull (`.rz-bar-pull`, 9px on two 15px round mounts, up to 16rem wide) over its hint. The whole front is one handle (`.rz-drawer-handle`, a button whose hit area and focus ring cover the front; `aria-expanded`, named by its hint): taken anywhere, it slides the drawer out or shut. Open, the tray (`.rz-tray`) stands above the front: a felt-black box with a raised divider holding the owner's four tools: a compartment per owner page (Barber Ledger, Detailed Forecast, Payment QR as tool plates: crimson-ink icon, Oswald title, from `sm` a dust line from the page's own description and an arrow; each page still asks for the PIN itself) and the 7-day forecast (`#forecast`) in the widest: the locked forecast card ("Forecast", Owner PIN pill, "Enter owner PIN", then a PIN field and a crimson "Show forecast" button) until the PIN is entered, then `ForecastPanel` (the Random Forest prediction and its own error, ending in a brass "See the detailed forecast" link to `/forecast`). No figure reaches the page before the PIN. A shut tray is inert, so nothing in it takes focus; opening moves the reader to the first tool, since the tray comes before the front, and a PIN accepted in the tray moves the reader to the forecast.
- **How a sale is recorded** (on `/about`, linked from the home footer): two unboxed zones (on the phone, on the server), each under a seam-strong header rule with a bone headline and a crimson-ink icon, its steps divided by seam column rules. Each step has a ringed Oswald number, a title, a sentence, and a well illustrating the app's own UI (a chosen service, the cash button, pills, a recent-cuts row, the drawer sum); the illustrations are hidden from assistive tech and the lead names the example as not a real sale. Between the zones, the sync crossing: a ringed icon and a micro label on a fading seam-strong line.
- **Built so far** (on `/about`): a hairline grid list, panel cells 1px apart on a seam ground, 14px radius, an ok-green check per item.

### Signature: the shop cursor
With a mouse, the pointer on every page is a pair of barber's shears (`ShopCursor`, `public/cursors/`): chrome blades (the pole-chrome ramp), crimson finger rings and a brass pivot screw, tips up and left as the hotspot. Closed at rest; open (blades ±14°) over anything clickable; snipped shut on a press, dropping three dust and bone hairs that fall 20px and fade (700ms). Text fields keep the text cursor and the shears hide there; disabled controls dim them to 45%. Without JavaScript, with reduced motion, or before hydration, two still SVG cursors (`scissors.svg`, `scissors-open.svg`, hotspot 3 3) stand in. Touch screens show no cursor at all. The shears and their clippings ride on one layer over everything (`.rz-cursor-layer`), which a page transition captures on its own and never animates, so the shears stay on top, live, while one page fades into the next.

### Signature: the shop's air
In front of the room's light, behind every page, fine hair clippings and dust drift down through the air (`ShopRoom`, a canvas, `.rz-room-air`), the clippings the shears drop on a snip carried on into the room.
- **What's in it:** dust specks (a bright core in a soft halo), fine clippings (a slightly curled hair, 6–20px, turning as it falls and flashing as it turns broadside to the light) at middle and near depths, and a few out-of-focus specks nearest the glass. Depth sets size, fall (2–18px/s) and how far the room's slow draft carries them.
- **Lit by the room:** each speck takes its light from the room light where it is, so the air shows under the accent wall and by the embers and all but vanishes in the dark between; warm toward crimson ink in the crimson light. Colours are dust and bone only.
- **The shears:** with a mouse, specks within 160px catch the light off the chrome (brighter and whiter as the shears come near). A moving blade drags the air along its path and pushes it gently aside (a stroke counts at most 24px per step, so a fast hand stirs the air rather than sweeping it away); a snip sends a puff out from the blades, and a little up, and sets the nearby clippings tumbling.
- **The scroll:** specks move with 10% (far) to 55% (near) of the scroll, so the room has depth; a scroll stirs the near air, which carries on a little after the page stops, and fast scrolling streaks the nearest specks along their way. A navigation's jump to the top is a cut, not a scroll: the air doesn't fly with it.
- **Budget:** up to 220 specks at 60fps with a mouse; on a phone 30–60 specks at 30fps on a lower-resolution canvas (1.25×), and no cursor. Drawn from sprites made once per colour. It holds still under a dialog (whose frosted backdrop would otherwise redraw every frame), and stops when the tab is hidden.
- **Arrival and fallbacks:** on a first load the air comes up over 1.4s. Without JavaScript, or with reduced motion, it isn't drawn and the room is the still light alone.

### Motion

State and arrival, and the room's air: the one ambient motion, always behind the pages (see Signature: the shop's air). Easing `cubic-bezier(0.16, 1, 0.3, 1)` (`ease-out-expo`).
- Pages fade through on every navigation (`app/template.tsx`, a React view transition): the page being left goes in 180ms (ease-in), then the new one comes up 120ms later over 360ms (ease-out-expo), so two pages never read over each other. With a mouse the old page also goes soft (2px blur) and the new one comes into focus (from 4px). The room, the ribbon and the shears are not in the transition, so the light and the air carry straight on behind it. Back and forward fade the same way (`HistoryFade`): React applies them at once inside the popstate event so the browser can restore the scroll position, so a still copy of the page being left (`.rz-ghost`, scrolled as it was) lies over the swap and fades out while the whole new page comes up under it. The browser's own swipe-back animation is left alone. A first load fades the page in (320ms); list children rise 10px in turn (380ms, 35ms steps, capped at 245ms, none after the 12th).
- Dialogs: overlay fade 200ms, panel pop 320ms; on phones the payment dialog rises from the bottom.
- Toasts drop in (280ms); notices rise (380ms); a changed checkout amount flashes brass (700ms).
- Home, the station switches on: the mirror's LED band fades up (700ms after 120ms), then the reflected room and the sign come up from dim (`rz-lights-up`, brightness 0.45 and saturation 0.85 to full, 1100ms after 160ms). The tool plates rise in turn with the list stagger.
- Home, the mirror follows the pointer: for a mouse only, the reflected room shifts against it by up to ±16px across and ±8px down, the sign by half that, and the sheen slides toward it (all 900ms); the lettering stays still, and everything returns to rest when the pointer leaves. Touch never moves it.
- Home, the plates: a tool lifts 3px off the counter when pointed at (240ms) and presses back down (1px, scale 0.99).
- Home, the drawer: it loads shut. Taken anywhere on its front, it slides out from under the counter (the tray's rows from 0fr to 1fr, 650ms) while the front moves down toward the chair, its shadow lengthening (600ms); the page holds its scroll still while it opens. Taken again, it slides shut, and the page brings the front back into view if it ended above the screen. The front lifts 2px when pointed at (240ms) and its pull gives 1px when pressed. The keyhole turns a quarter (500ms) when the owner PIN is accepted in the drawer.
- Cursor: the shears open over a control (220ms), snip shut on a press (70ms) and the clippings fall (700ms); mouse only, and under reduced motion the still cursor images replace them.
- Barber pole: 1.1s per turn while working; one 900ms turn on selection. Skeletons shimmer (1.4s) while loading.
- Reduced motion: rises, pops, drops and sheets become plain fades; the pole, spinners, pulses and shimmer stop; buttons don't scale on press. On the home page the mirror stays at rest (no pointer depth, no sheen travel) and the plates don't lift or press; the drawer opens and shuts without sliding, its front doesn't lift, and the keyhole shows its state without turning; the station's switch-on, a brightness change rather than movement, still plays. The room is still: no air, and the light doesn't tilt. Page transitions keep their fades, which are opacity only (no blur).

## Do's and Don'ts

### Do:
- **Do** use `.rz-btn-primary` crimson for the one primary action per area, and secondary for the rest (Payment QR: Upload is crimson, Replace is secondary).
- **Do** put money totals in brass Oswald (`.rz-figure text-brass-bright`), other figures in bone (or their wallet ink), and status in its state colour with an icon.
- **Do** group related figures in one `.rz-strip`, and divide list rows with `.rz-rows` inside a single panel.
- **Do** turn the pole only for real work (`spinning={isSyncing}` and the like), and mark a chosen service with its pole edge, not a tint.
- **Do** keep 44px touch targets (`pointer-coarse:min-h-11`) and 16px inputs on phones.
- **Do** show a skeleton in the shape of the coming content while it loads.
- **Do** mix a translucent identity tint onto a solid panel when the element can sit straight on the room light.
- **Do** keep lettering on the home mirror's glass still while the reflection moves, and keep the station's materials (bezel and nosing chrome, brass hardware, glass ink, the accent wall) on the station.

### Don't:
- **Don't** use crimson or brass as decoration on components: no glows, no tinted selected or inactive states, no crimson on money figures. Crimson light belongs to the room behind the pages.
- **Don't** put a barber pole beside section headings, dates or footers; it is a state light.
- **Don't** use Oswald for labels, form fields, tables or prose.
- **Don't** nest cards: inside a panel use a well or hairline rows.
- **Don't** put a kicker or eyebrow above a heading; taglines go under the sign or title.
- **Don't** load fonts from Google or any CDN: the build and the phones work offline (commit 14be0e1).
- **Don't** add a second ambient animation, or draw the air over content: the room's air is the one, behind the pages. Anything that persists across pages (the room, the ribbon, the shears) stays out of the page transition.
- **Don't** reuse the wallet colours outside their payment methods, or use the gold-serif vintage-sign look as the display voice.

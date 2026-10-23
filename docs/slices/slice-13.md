# Slice 13 — New price list, loyalty discount, and POS usability fixes

Repo: `ruzzco-system`. Status: **BUILT 2026-10-23.** Items tagged [AI proposal] are not confirmed by Brent; everything marked (Brent) is. Runs after the H4 upgrade (Next 16.4.2).
Goal: the POS charges what the shop charges today, offers the services on the shop's price list, lets a barber apply the loyalty card, and is safer and easier to use on a barber's phone during a busy shift.
Origin: Ruzzco's "New Price List", photographed at the shop by Brent on 2026-10-16 (the day the October logbook was photographed); the logbook (₱250 on every haircut from 2026-10-06); Brent's /pos requests of 2026-10-23. The shop will try the POS in parallel with the logbook from 2026-10-24, and the plan's shop-phone test is 2026-10-28.

## 1. Scope boundary (read first)

- Part A (prices and loyalty): seed data plus one pricing input. No schema change, no migration. Past sales keep their snapshotted prices and commissions (invariant).
- Part B (POS usability): `/pos` and `/shift-log` only. No schema change: the sale note reuses the existing `customAmountNote` column, and the confirmation setting is stored on the phone.
- Commission rules do not change (§2.4).
- Not in this slice [AI proposal]: a navigation bar across the app, a note on every sale (a new column), the Request barber and VIP add-ons, more than one service per sale, a screen for managing services, counting loyalty visits per customer (the paper card does that), the server-side commission price check (H2), the forecast's average ticket. The navigation bar and the general note are slice 14 candidates (§7).
- No client sales figures in this spec, tests, fixtures, commit messages or committed screenshots. Tests use invented amounts.

## 2. Decisions ([AI proposal] unless marked Brent)

### Part A — prices and loyalty

1. **Prices (Brent, price list photo 2026-10-16):**

   | Service | Price |
   | --- | --- |
   | Men's haircut | ₱250 |
   | Haircut + Shampoo | ₱300 |
   | Shave / Facial / Massage | ₱250 |
   | Hair coloring | ₱500, varies with color and hair length |

   The effective date is not confirmed by Mart; the logbook shows ₱250 on every haircut from 2026-10-06.
2. **Catalog through the seed.** `prisma/seed.ts` upserts four services, in the order above, which is also the POS order:
   - id `...0001` stays the haircut: name becomes "Men's haircut", price ₱250. The `update` branch must set the name as well as the price (today it sets only the price).
   - id `...0002` becomes "Shave / Facial / Massage", ₱250 (renamed in place, so past sales still point at the same service).
   - Two new fixed ids for "Haircut + Shampoo" (₱300) and "Hair coloring" (₱500). [AI proposal] `...0003` and `...0004`.
   - Hair coloring uses the existing custom amount when the price differs; no new pricing rule.
   - The offline fallback list `DEFAULT_SERVICES` (`src/lib/db.ts`) must match the seed: same ids, names, prices and order.
   - Re-seeding an existing database updates names and prices; running the seed twice gives the same four active services.
3. **Loyalty card (Brent):** the paper card has 5 circles, and Mart signs one per visit; a regular men's haircut is then 50% off (₱250 to ₱125). Which visit gets the discount, and whether the card resets, is still to confirm with Mart; the POS does not need it, because the barber checks the paper card.
   - On `/pos`, a toggle "Loyalty card: 50% off", shown only when Men's haircut is selected. On: the sale records `discountType` PERCENT with 50% (use the existing meaning of `discountAmount` for PERCENT; audit it, §3), `listPrice` stays ₱250, amount paid ₱125.
   - [AI proposal] The toggle is disabled while a custom amount is entered (a custom amount already forces the discount to NONE), and it switches off when another service is picked.
   - Tips work as before and are not discounted.
   - [AI proposal] The shift log and the sale confirmation show "Loyalty 50%" on such sales. No discount-reason field: the shop gives no other discounts (CLAUDE.md Client rules), so a discounted sale is a loyalty sale.
4. **Commission (Brent: keep the current default).** Commission base LIST_PRICE: on a loyalty haircut the barber's 50% is of ₱250 (₱125) and the shop absorbs the discount. The ledger's AMOUNT_PAID toggle already gives the other reading (₱62.50 each). No change to commission code.
5. **Add-ons left out (Brent).** Request barber (+₱100) and VIP no waiting (+₱100) are not modelled. A barber rings them up as a custom amount with a note (§2.10). Who receives the ₱100 is unknown. Recorded as a known gap.
6. **Demo seed.** `prisma/seed-demo.ts` uses the new prices, and its `demo-senior-pwd` row (PERCENT 30, contradicting the no-PWD rule) is replaced by a loyalty demo row on a men's haircut. Placeholder data only, as now.

### Part B — POS usability (Brent's requests, 2026-10-23)

7. **The payment buttons fit on a phone.** On a 360 × 740 screen (a common Android size), after a service is picked, the Cash, GCash and Maya buttons (and QR Ph when the gateway is on) are all visible without scrolling sideways, with their labels and amounts uncut. [AI proposal] A two-column grid on narrow screens; each button still at least 44 px tall. Check it in the browser at 360 px and 412 px wide.
8. **"Ask before recording a sale" setting.** A setting on the phone that, when on, shows a confirmation before any sale is recorded: the service, the amount (with "Loyalty 50%" or the custom amount when used), the tip, the payment method, and two buttons, "Record sale" and "Cancel".
   - Cash records on one tap today, so this is where the confirmation matters most. GCash and Maya already open a step for the reference; with the setting on, that step shows the same summary and its confirm button records the sale, so there is one confirmation per sale, not two. QR Ph keeps its own checkout flow.
   - [AI proposal] Off by default. A settings button in the `/pos` header opens a small sheet with this one switch. Stored per phone in `localStorage`, read and written inside try/catch; if storage is unavailable the setting is treated as off. Not synced to the server.
   - Cancel records nothing and keeps the chosen service, amount and tip.
9. **Pagination of the sales list.** `/pos` keeps its "Recent Cuts" (last 5). [AI proposal] `/shift-log`, which lists all of the phone's sales, shows 20 per page, newest first, with Previous and Next and "Page N of M"; it works offline from the phone's store. Confirm in the audit which list Brent means; if it is a different list, apply the same rule there.
10. **A note on custom-amount sales (Brent asked about a sale note; no schema change).** When a custom amount is entered, an optional "Note" field appears (for example "Request barber", "VIP", "long hair color"). It is saved in the existing `customAmountNote` column (VarChar 255; limit the input to 100 characters). Empty → keep today's "POS custom amount". The note shows on the shift log. A note on every sale needs a new column and is left for slice 14.

### Both parts

11. **CLAUDE.md:**
    - Client rules: the prices line becomes the §2.1 prices in one line; the loyalty line becomes "Loyalty card: Mart signs 5 visits on a paper card; regular men's haircut 50% off (₱250 to ₱125). Which visit gets it: to confirm with Mart."
    - Known gaps: remove "Loyalty-card discounts are not built"; add "Request barber and VIP add-ons are not modelled (custom amount with a note); one service per sale."
    - Do not write to `../ruzzco-barbers`; the decision record is written from the Claude project.

## 3. What exists today (audit to repeat before building)

- `prisma/schema.prisma`: `Service` (id, name, standardPrice, isActive); `Transaction` has `listPrice`, `discountType` (NONE, PERCENT, FIXED), `discountAmount`, `customAmount`, `customAmountNote` (VarChar 255), `commissionBase` (LIST_PRICE default).
- `prisma/seed.ts`: upserts Haircut (`10000000-0000-0000-0000-000000000001`, ₱200; `update` sets only the price) and Shave & Massage (`...0002`, ₱150).
- `src/lib/pricing.ts` `priceSale`: one service, optional custom amount (which becomes the list price), tips; always returns `discountType: "NONE"`.
- `src/lib/schemas.ts`: the sync schema already accepts `discountType` NONE, PERCENT, FIXED and `discountAmount`; `src/lib/sync.ts` stores them.
- `src/app/pos/page.tsx`: one selected service per sale; custom amount and tip inputs; `handleCashCheckout` records a cash sale on one tap; GCash and Maya open a reference step (`handleDigitalConfirm`); QR Ph has its own checkout; `customAmountNote` is set to the fixed text "POS custom amount"; "Recent Cuts" shows the last 5 (`db.transactions ... limit(5)`) with a "View all cuts" link to `/shift-log`.
- `prisma/seed-demo.ts`: the `demo-senior-pwd` row with PERCENT 30. Check whether `discountAmount` holds the percent or the peso amount for PERCENT, and how `amountPaid` is computed from it, before writing the loyalty logic.
- Tests to extend: `test:pricing`, `test:commission`, `test:payload-compat`, `test:submit-lock`.

## 4. Build

1. Part A: seed and `DEFAULT_SERVICES` (§2.2); `priceSale` loyalty input and the `/pos` toggle (§2.3); demo seed (§2.6).
2. Part B: payment button layout (§2.7); the confirmation setting (§2.8); `/shift-log` pagination (§2.9); the custom-amount note (§2.10).
3. CLAUDE.md (§2.11).

## 5. Tests

- Pricing: Men's haircut with loyalty → list price 250, discount PERCENT 50, amount paid 125; without loyalty → 250. Loyalty is ignored or refused for any other service and when a custom amount is set. A tip on a loyalty sale is added in full.
- Commission: a loyalty haircut gives the barber 125 under LIST_PRICE and 62.50 under AMOUNT_PAID.
- Seed: running it twice gives four active services with the §2.1 names and prices; a sale stored at ₱200 before the re-seed keeps its ₱200 list price and commission.
- Payload compatibility: queued sales from before this slice (no loyalty input, the fixed note) still validate and sync unchanged; a note longer than allowed is refused with a clear message, not silently cut.
- Confirmation: with the setting off, Cash records on one tap (today's behaviour); with it on, nothing is recorded until "Record sale", Cancel records nothing, and a double tap on "Record sale" records one sale (the existing submit lock).
- Pagination: 45 sales → 3 pages (20, 20, 5), newest first; works with the PC off.

## 6. Done when

- All web test suites, `npm run lint`, `npx tsc --noEmit` and `npm run build` pass.
- In the browser at 360 px wide: the four services at the new prices; the loyalty toggle only on Men's haircut, ringing up ₱125; all payment buttons visible; the confirmation appears with the setting on and not with it off; a custom amount with a note shows the note on the shift log; `/shift-log` pages through sales.
- `/ledger` shows the barber's ₱125 commission for a loyalty haircut under List price, ₱62.50 under Amount paid.
- CLAUDE.md is updated; nothing committed (Brent reads `git diff`, then commits and pushes).

## 7. Slice 14 candidates (not built here)

- A navigation bar across the app: which links a barber's phone sees versus the owner, how it works on the stored offline pages (`/pos`, `/shift-log`), and the Ch3 screenshots and operation steps it changes.
- A note on every sale: a new nullable column, the sync schema, the phone's store and the shift log.

<!-- END OF SPEC -->

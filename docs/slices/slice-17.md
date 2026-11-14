# Slice 17 — POS checkout: ticket, charge sheet, done screen

Repo: `ruzzco-system`. Status: **SPEC (written 2026-11-13).** Branch `revision/pos-checkout`. Section 6 (slice 17b, written 2026-11-14) is PRELIMINARY, register item PR-1, on branch `revision/preliminary`. Items tagged [AI proposal] are not confirmed by Brent; everything marked (Brent) is.
Goal: `/pos` follows the usual point-of-sale checkout: pick a service, see a ticket with its total, tap Charge, choose how the customer pays (with cash received and change due), see a done screen, start the next sale from a blank ticket.
Number: slice 16 stays reserved for the server-side price check (slice 15, §1).

## 1. Scope boundary (read first)

- In: the `/pos` page only (UI and its client-side state), the ambient animation on `/pos`, and the test for the checkout flow.
- Out until the formal revision list arrives (Brent, 2026-11-13): sequential sale numbers, void, more than one service per sale, storing cash received or change, a required GCash/Maya reference, a light theme, persistent navigation, receipts or slips. Most of these need a migration or a change to the sync payload, and void needs its own business-rule OK.
- Unchanged: what a sale records (`LocalTransaction` fields, `priceSale`), the Dexie-first write, the checkout lock (one sale per Record tap, `lib/submit-lock.ts`), attribution, sync, the GCash/Maya QR dialog and the QR Ph checkout. No schema change, no migration, no payload change.

## 2. Decisions

1. **UI only on this branch** until the formal list arrives (Brent, 2026-11-13).
2. **Review before recording is the default.** No payment tap records a sale by itself any more; the slice-13 "Ask before recording a sale" setting is retired. [AI proposal]
3. **Change due is worked out on the phone and not stored.** [AI proposal]
4. **The total is the amount paid plus the tip**, everywhere a total is shown (ticket, Charge button, charge sheet, GCash/Maya dialog, done screen). The sale still records `amountPaid` and `tipAmount` separately. [AI proposal]

## 3. Build

1. **The form clears after every sale.** Tip choice, custom tip, custom amount, note and loyalty reset once the sale is written. Picking a different service also clears the custom amount and its note. The service stays selected.
2. **No motion on `/pos`.** The drifting-clippings room, the room light, the grain and the shears cursor (animated and still) are off on `/pos`; the page sits on the plain wall colour. Other pages keep them.
3. **Service tiles.** 2 × 2 tiles, each with the name and price.
4. **Ticket.** One panel lists the service, the loyalty discount or custom amount (with its note), the tip and the total. The tip chips and a "Custom amount / loyalty" expander sit with it. On phones a bar fixed to the bottom shows the total and **Charge ₱X**; from tablet width the Charge button is the foot of the ticket.
5. **Charge sheet.** Charge opens a sheet: the ticket lines and total, then the payment choice.
   - Cash: cash received (Exact pre-selected, then the next bills above the total, plus a field), change due in large type, and **Record ₱X cash**. Less than the total shows the shortfall and disables Record.
   - GCash / Maya: opens the existing QR dialog; its Confirm records.
   - QR Ph (only when the gateway is on): the existing QR Ph checkout.
   - Back returns to the ticket and records nothing.
6. **Done screen.** After a cash, GCash or Maya sale: a check mark, the total, the payment method, cash received and change due (cash), the barber, and "saved on this phone" while the shop PC can't be reached. **New sale** closes it onto the cleared ticket. QR Ph keeps its own checkout screen.
7. **Recent Cuts** says "No cuts on this phone yet." when empty (it lists the last five from any day).

## 4. Tests

- `npm run test:submit-lock`: the slice-13 setting checks are replaced by charge-flow checks. Charge records nothing, Back records nothing, Record records one sale, and a double tap on Record records one.
- `npm run test:pricing`: cash quick amounts and change due (exact, more, less, blank, not a number, centavos).

## 5. Manual test

1. At 360 × 740: the tiles, ticket and Charge bar fit without scrolling.
2. Hair coloring, custom ₱800 with a note, +₱50 tip: the ticket total and Charge show ₱850. Charge, then type ₱1,000 received: change due ₱150. Record: the done screen shows ₱850 cash, change ₱150.
3. New sale: no tip, no custom amount; a men's haircut shows ₱250.
4. GCash with a ₱20 tip: Charge ₱270, and the QR dialog shows ₱270.
5. Double-tap Record: the shift log shows one sale.
6. Offline: the sale saves, and the done screen says it is on this phone.

## 6. Slice 17b: finish the checkout

Status: **PRELIMINARY, register item PR-1** (written 2026-11-14). Branch `revision/preliminary`. Sections 1 to 5 stand; this section adds to them. Items tagged [AI proposal] are not confirmed by Brent.

### 6.1 Scope boundary

- In: `/pos` and `/shift-log` (display and client-side state only), the "needs attention" list both pages share, one line of copy on `/about` and three on `/`, and the tests below.
- Unchanged: what a sale records, the Dexie-first write, the checkout lock, attribution, sync, rejected-sale handling, the QR Ph checkout. No schema change, no migration, no payload change, no new Dexie version.
- Not covered: the owner-PIN dialogs, the "Change the barber" screen and the QR Ph checkout keep their own buttons, and the phone's Back there behaves as before. The home page's layout waits for slice 19.

### 6.2 Decisions

5. **One meaning of "total" on the phone.** Every row that shows a saved sale (Recent Cuts, the shift log's list, the "needs attention" list) shows what was collected, the amount paid plus the tip, with the tip noted beside it ("incl. ₱20.00 tip"), like the done screen. This extends Decision 4 to saved sales. The sale's stored fields do not change, and a sale saved before tips were recorded shows its amount paid. [AI proposal]
6. **The shift log's summary cards stay revenue** (amount paid, tips left out) and the line above them says so. Revenue excludes tips everywhere else in the system, and the cards are the phone's provisional copy of that figure. [AI proposal]
7. **The phone's Back closes the sheet on top**, one sheet per press, and records nothing: settings, the charge sheet, the GCash/Maya dialog. On the done screen it does what New sale does. With no sheet open it leaves the POS as before. [AI proposal]
8. **One exit per sheet.** The GCash/Maya dialog sits on top of the charge sheet. Its close (X) button is removed; its Back moves to the top left, where the charge sheet's Back is, and returns to the charge sheet with the ticket, the tip and the cash received as they were. Escape and the phone's Back go to the same place. [AI proposal]

### 6.3 Build

1. **`lib/peso.ts`**: `peso(value)` writes pesos with two decimals and thousands separators ("₱1,000.00"), the same on every phone (no locale lookup). Used for every peso amount on `/pos`, `/shift-log` and the "needs attention" list.
2. **`lib/charge.ts`**: `collectedTotal(sale)` returns the amount paid, the tip and their sum for a saved sale (Decision 5).
3. **`lib/sheet-stack.ts`** (pure): the open sheets from bottom to top (settings, charge, GCash/Maya, done), and the two rules that keep one browser-history entry per open sheet:
   - when the open sheets change: push an entry for each new sheet, or step back over the entries of sheets closed on screen;
   - when the browser goes back or forward on this page: close the sheets above the entry it landed on; step back out of an entry whose sheet is already closed.
   A sheet that replaces another at the same depth (the charge sheet becoming the done screen) changes no history.
4. **`lib/use-sheet-back.ts`**: the hook that applies those rules with `history.pushState`, `history.go` and a `popstate` listener. Entries keep the page's address; each carries its depth in `history.state`. The listener handles only this page's sheet entries and keeps them from the router, which has nothing to change for them (same address, same page), so no request is made and the ticket's inputs stay. `components/HistoryFade.tsx` already ignores a same-page `popstate`.
5. **`/pos`**: uses the hook; the charge sheet stays open underneath the GCash/Maya dialog; the dialog's header and exits follow Decision 8; Escape closes the sheet on top only.
6. **Shift log row at phone width**: the barber's name gives way before the service name, which was cut to nothing at 360 px; the tip note sits under the amount.
7. **Copy**: `/about` no longer says "7-day forecast" (the forecast is 7, 14 or 30 days since slice 14); on `/` the hero and the POS card no longer say "7-day" or "two taps", and the owner drawer's Detailed Forecast line drops "7-day".

### 6.4 Known limits

- Reloading the page while a sheet is open leaves that sheet's history entry behind: the first Back after the reload stays on the POS and does nothing visible.
- On a desktop browser, Forward after a sheet was closed lands on that sheet's old entry and is stepped back at once; the sheet does not reopen.

### 6.5 Tests

- `npm run test:sheet-stack` (new, no server): the order of the sheets; Back closes one sheet at a time; a sheet closed on screen closes nothing more when the browser steps back; Charge then Record then Back ends on a clean ticket with one history entry used; a sheet opened while the browser is still stepping back is kept; Forward into a closed sheet's entry; Back with nothing open is left to the browser.
- `npm run test:pricing`: existing checks unchanged; added checks for `peso` and `collectedTotal`.
- `npm run test:submit-lock`: unchanged.

### 6.6 Manual test

1. At 360 × 740: Charge, then the browser's Back: the ticket is back with its tip and custom amount; the shift log has no new sale.
2. Charge, GCash: the dialog has Back at the top left and no X. Back, Escape and the browser's Back each return to the charge sheet; the cash received typed earlier is still there.
3. Record a cash sale, then the browser's Back on the done screen: a blank ticket, still on `/pos`. Back once more leaves the POS.
4. GCash with a ₱20 tip on a men's haircut: the done screen, Recent Cuts and the shift log row all show ₱270.00 with the tip noted; the shift log's revenue card counts ₱250.00. At 360 px wide the shift log row still shows the service name.
5. Hair coloring, custom ₱1,000: the ticket, Charge button, charge sheet and done screen show ₱1,000.00.
6. Shop PC off (installed POS): steps 1 to 3 behave the same.

<!-- END OF SPEC -->

# Slice 17 — POS checkout: ticket, charge sheet, done screen

Repo: `ruzzco-system`. Status: **SPEC (written 2026-11-13).** Branch `revision/pos-checkout`. Items tagged [AI proposal] are not confirmed by Brent; everything marked (Brent) is.
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

<!-- END OF SPEC -->

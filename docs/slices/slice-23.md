# Slice 23 — Several services in one POS sale

Status: **BUILT AND FUNCTIONALLY VERIFIED (2026-11-16)**: automated suites green, real-phone offline test passed (§12). Uncommitted until approved. Branch `revision/preliminary`.
Provenance: **direct system revision requirement** from verbal feedback after the defense (register V-1, recalled; not on the formal written list; no exact quotation).
Deadline class: primary system work before Nov 20. R4, R6 and R7 confirmed (the owner, 2026-11-16); no business rule is open.

## 1. Verified starting point

- **Database: already one-to-many.** `transaction_items(transactionId, serviceId, priceAtSale)`, with no unique constraint on `(transactionId, serviceId)`. Today one item per sale, `priceAtSale = totalAmount`, which is the amount *paid* (`record-sale.ts:93`). For a loyalty haircut that is ₱125, not the menu price. Nothing reads `priceAtSale` today (grep).
- **Single service in**: the POS state (`pos/page.tsx:138` `selectedServiceId`); `priceSale` (`pricing.ts:56`: one `standardPrice`, loyalty = 50% of the whole list price); `LocalTransaction.serviceId`/`serviceName` (`db.ts`, `serviceId` indexed); the payload (`schemas.ts:24`); `checkSalePrice` (`price-check.ts`: one service price, loyalty = 50% of the sale's list price); `recordSale` (one item); `discountLabel` (`pricing.ts:99`: loyalty if discount = 50% of the sale's list price).
- **Money is per sale and stays so**:
  - commission = `commissionFor(listPrice, rate)` (sync route), snapshotted;
  - payouts (`totalsForDate`), expected drawer cash (`computeExpected`), the QR Ph charge (`totalAmount`) and Sales totals read only sale fields.
- **Overcounting today if a sale had several items**:
  - `range-figures.ts:73` and `ledger-summary/route.ts:124` add the **sale's** list price once **per item**.
  - `ledger-summary.ts:55` documents the one-item assumption.
- **First item only**: `sales-list.ts:145` and `custom-amounts/route.ts:65` (`take: 1`); the shift log and the POS lists show `serviceName`.

## 2. Scope

- In:
  - selecting, adding and removing several services before Charge;
  - one ticket listing every service, with the combined price;
  - the optional service list in the payload, falling back to `serviceId`;
  - the server checking the combined price and storing one item per service atomically;
  - Sales, Custom amounts, the shift log and the POS lists showing every service;
  - the per-service figures fixed (§3).
- Unchanged (existing rules, no confirmation needed):
  - one barber per sale, by its device assignment;
  - commission = rate × the sale's list price, snapshotted (the combined list price simply feeds it);
  - no discount spread across services;
  - tips, payouts, expected drawer cash, the QR Ph charge, reconciliation;
  - the sale id as the idempotency key;
  - rejected-sale handling; no Dexie version bump.
- Out: several barbers or customers in one sale; quantities; appointments, inventory, refunds, voids; editing a recorded sale; the forecast comparison.

## 3. Reporting definitions (final)

- **A. Sale revenue**: the sale's own fields (`amountPaid`, else `totalAmount`), counted once per sale. Discounts, custom amounts, tips and collected amounts are never multiplied by items. Sale counts count the sale once. Revenue, commission, payouts and the drawer read only these fields.
- **B. Service items**: one per service in a sale (Haircut + Shave = 2). Shown as "services sold (items)". Never presented as a sale count or a customer count.
- **C. Service listed value**: the menu-price value recorded for each service in a sale:
  - a sale with **two or more** items: each item's `priceAtSale` (its menu price when sold);
  - a sale with **one** item: the sale's list price (`listPriceOf`), exactly as today.
  - Why the one-item rule: old rows hold the amount paid in `priceAtSale` (₱125 for a loyalty haircut), so reading `priceAtSale` alone would rewrite every historical figure. The rule keeps history unchanged without a migration or a data rewrite.
  - Invariant (follows from R4, confirmed): **the listed values of a sale add up to its list price**. A multi-service sale is never custom, so its list price is the sum of its items' menu prices; a one-service sale uses its list price. The existing "discounts" line (revenue − listed value, `serviceGap`) therefore keeps its meaning.
  - **Never sum raw `priceAtSale`.** Every reader goes through the shared helper below, which applies the one-item rule. Revenue, commissions, payouts, tips and expected drawer cash stay sale-level figures, counted once; the helper is used only for per-service figures.
  - Labelled "listed value (menu price), not money collected" on the Dashboard's Services card and the ledger's By service.
  - Example: Haircut ₱200 + Shave ₱100 → transactions 1, service items 2, Haircut listed ₱200, Shave listed ₱100, sale list price ₱300.
- One shared pure helper, `serviceLines(sale)` in `ledger-summary.ts`, returns `{ name, listed }` per item by rule C. Both `rangeFigures` and the ledger-summary route's day loop use it, so the Dashboard and the ledger agree by construction.

## 4. Business rules

### R4 — Custom amount: CONFIRMED (the owner, 2026-11-16)

Ruzzco offers no special combined price for several services. Therefore:
- A custom amount is allowed **only on a one-service sale** (as today).
- A multi-service sale's list price is the **sum of its services' menu prices**; it has no custom total.
- Each service keeps its menu-price snapshot (`priceAtSale`).
- No logic to split a combined price across services.

Enforced on both sides:
- The phone hides or disables the custom-amount field while more than one service is selected, and clears an entered custom amount when a second service is added.
- The server answers `PRICE_MISMATCH` for `customAmount: true` with more than one service.
- The Custom amounts list (`custom-amounts/route.ts`, one service per custom sale) is unchanged.

### R6 — Same service twice: CONFIRMED (the owner, 2026-11-16)

A barber never charges the same service twice for one person in one visit. Therefore:
- A service appears at most once in a sale: no quantity field, no duplicate item rows.
- POS: tapping a selected service removes it.
- Server: a payload whose `serviceIds` repeats an id is `INVALID` for that sale.

### R7 — Loyalty discount: CONFIRMED (the owner, 2026-11-16)

- The 50% applies **only to the men's haircut's** menu price, once per sale, even when other services are in the sale.
- Other services get no loyalty discount; never 50% of the combined sale.
- No loyalty on a custom sale (unchanged; a custom sale is one service by R4).
- Commission is unchanged: rate × the full list price; the shop absorbs the discount.
- Example, Haircut ₱250 + Shave ₱250 with the card: list ₱500, discount ₱125, paid ₱375, commission ₱250 at 50%.

R7 needs these **coordinated changes**, all in one build step and tested together:
1. **Phone pricing** (`pricing.ts` `priceSale`): discount = `loyaltyDiscount(the haircut's standardPrice)`, not of the whole list price. `loyaltyApplies` = the haircut is among the selected services and the sale isn't custom.
2. **Server check** (`price-check.ts`): a discount > 0 requires the haircut among the sale's services, type PERCENT, and amount = `loyaltyDiscount(the haircut's price)`, using the same function as the phone.
3. **Label** (`pricing.ts` `discountLabel`): PERCENT with an amount > 0 reads "Loyalty 50%". Today it compares with 50% of the whole list price and would mislabel a multi-service loyalty sale.
4. **Commission**: unchanged. `commissionFor(listPrice, rate)` on the checked list price (the full sum). No new formula, and no discount spread across services.

For a one-service haircut all four give exactly today's results.

All acceptance criteria below rest on confirmed rules.

## 5. Technical design

1. **POS** (`pos/page.tsx`):
   - Each service tile toggles in and out of a `selectedServiceIds` list, in tap order. At least one service is needed to Charge.
   - The ticket and charge sheet (`TicketLines`) show one line per service with its menu price, then the discount, tip and total.
   - The custom-amount field is offered only while exactly one service is selected (R4); adding a second service clears it. The loyalty switch follows R7.
   - The selection can't change between Charge and Record (existing lock).
2. **Pricing** (`pricing.ts`): `priceSale` takes `services: { id, standardPrice }[]`. List price = the custom amount when there is one service and a custom amount (R4), else the sum of menu prices, summed in centavos. A custom input with more than one service is ignored. Loyalty and `discountLabel` per §4 R7. A one-service call gives exactly today's result.
3. **Phone record** (`db.ts`): optional `serviceIds?: string[]`, `serviceNames?: string[]`. `serviceId`/`serviceName` keep the first service, so the index and older code paths still work. No new index, so no Dexie version bump.
4. **Payload** (`schemas.ts`, `sync.ts:531`):
   - `serviceIds` optional: an array of 1 to 10 ids, no repeated id (R6; a repeat is `INVALID`).
   - `serviceId` stays required and must equal `serviceIds[0]` (else `INVALID`).
   - Absent `serviceIds` means `[serviceId]`, so old queued sales validate unchanged.
5. **Server check** (`price-check.ts`, sync route):
   - Load every listed service's price (active or not); an unknown one is `INVALID`.
   - A non-custom sale: list price = sum of the services' prices (centavos), else `PRICE_MISMATCH`.
   - `customAmount: true` with more than one service: `PRICE_MISMATCH` (R4). A one-service custom sale is checked exactly as today.
   - Discount per §4 R7.
   - Then list − discount = paid = total, as now.
   - The commission is computed from the checked list price, unchanged.
6. **Insert** (`record-sale.ts`): `items.create` becomes a list, one per service. `priceAtSale` = the service's menu price for a multi-service sale; for a one-service sale it is the sale's list price (equal to the menu price unless custom). All of it, with the commission log and any mismatch log, stays in the existing single `prisma.$transaction`. A retry hits the sale id's primary key and is "already recorded" (existing path), so no item is added twice or alone.
7. **Reads**:
   - `sales-list.ts`: all items, not `take: 1`; `serviceNames[]`; the row shows "Haircut + Shave". The Service filter keeps `items: { some }`, so a sale appears once, counted once in totals and pages.
   - `SalesList.tsx`: shows the list.
   - `custom-amounts/route.ts`: unchanged (R4: a custom sale has one service).
   - Shift log and POS recent list: `serviceNames ?? [serviceName]`, display only.
   - `range-figures.ts` and `ledger-summary/route.ts` use `serviceLines` (§3).
   - Dashboard Services card and ledger By service: labels per §3.
8. **No schema migration**: `transaction_items` and `priceAtSale` meet every requirement with the §3 one-item rule.

## 6. Edge cases (confirmed rules only unless marked)

1. One service, cash: identical to today (payload, stored values, figures).
2. Haircut ₱250 + Shave ₱250, cash: one sale, list ₱500, paid ₱500, commission ₱250, two items (₱250 and ₱250).
3. Recorded offline, synced after a timeout and retried: one sale, two items.
4. A legacy queued sale (`serviceId` only) syncs as one item, as today.
5. A queued two-service sale whose shave price changed before sync: `PRICE_MISMATCH`, stays on the phone needing review.
6. A bundle ("Haircut + Shampoo") with another service: priced as two menu services; the bundle is one item.
7. (R7) Haircut + Shave with the card: list ₱500, discount ₱125, paid ₱375, commission ₱250; labelled "Loyalty 50%". Shave + Massage with the switch on: no discount (no haircut), and the phone hides the switch.
8. (R4, confirmed) A custom amount entered, then a second service added: the custom amount is cleared and the sale is priced from the menu. A modified client sending `customAmount: true` with two services: `PRICE_MISMATCH`, stays on the phone needing review.
9. (R6) A modified client sending the same service twice: `INVALID`, stays on the phone needing review; the POS itself can't produce it.
10. A historical loyalty haircut (one item, `priceAtSale` ₱125, list price ₱250): Haircut's listed value is still ₱250, as before the change.

## 7. Acceptance tests

| # | Requirement | Suite |
|---|---|---|
| 1 | One service: stored values, commission and figures unchanged | `test:pricing`, `test:price-check`, `test:sync-rejections`, existing cases unchanged |
| 2 | Two services: list price = sum; commission = rate × sum | `test:pricing`, `test:price-check`, `test:commission` |
| 3 | Multi-service offline sale is queued, survives a reload and syncs complete (all items) | `test:sync-queue`, `test:sync-rejections` (MySQL) |
| 4 | Retried sync adds no item; a forced item failure leaves no sale, item or log | `test:sync-rejections` |
| 5 | Legacy payload (`serviceId` only) validates and syncs as one item; `serviceIds[0] ≠ serviceId`, 0 or 11 ids are `INVALID` | `test:payload-compat` |
| 6 | Service filter matching a multi-service sale lists it once; totals and page count once | `test:sales-list` |
| 7 | Dashboard service figures: items counted per service, listed value per item, no whole-sale duplication; listed values add up to the sale's list price | `test:report-parity` or `test:ledger-summary` (`serviceLines` pure cases plus MySQL) |
| 8 | Ledger By service equals the Dashboard's for the same dates | `test:ledger-summary` |
| 9 | Revenue, sale count, commission, payouts and expected drawer cash count a multi-service sale once, the same as a one-service sale of the same list price | `test:ledger-summary`, `test:reconciliation`, `test:payout-entries`, `test:commission` |
| 10 | Bundles priced as one menu service. R4: custom only on one service (the phone ignores custom input with two services; the server answers `PRICE_MISMATCH`); a one-service custom sale is unchanged. R6: a repeated id is `INVALID`; tapping a selected tile removes it. R7: haircut + shave with the card gives a ₱125 discount and ₱375 paid; a discount without a haircut, or ≠ 50% of the haircut's price, or 50% of the whole sale, is `PRICE_MISMATCH`; phone and server give the same centavos through `loyaltyDiscount`; the label reads "Loyalty 50%" on a multi-service sale; commission = rate × full list price | `test:price-check`, `test:pricing`, `test:commission` |
| 11 | Historical compatibility: a stored one-item loyalty sale (`priceAtSale` = amount paid ₱125, list ₱250) reports a listed value of ₱250; a stored one-item custom sale reports its list price; a new two-item sale reports each item's `priceAtSale`; Dashboard and ledger figures for a date range of historical sales are identical before and after the change | `test:ledger-summary` (MySQL, synthetic rows) and pure `serviceLines` cases |
| 12 | No reader sums raw `priceAtSale`: a source check that `range-figures.ts` and `ledger-summary/route.ts` get per-service values only from `serviceLines` | `test:ledger-summary` (source check) |

Then `test:qrph-charge` (charge = `totalAmount`, unchanged), `test:authz`, `test:approval-gate`, lint, `tsc --noEmit`; every other suite green.

## 8. Manual test (real phone)

1. On an approved phone signed in as a barber, add Haircut and Shave, remove Shave, add it again: the ticket shows both lines and ₱500.
2. **Turn the shop PC off** (or stop the server). Record that sale in cash, then one single-service sale: both show as pending on the shift log, with "Haircut + Shave" listed.
3. Reload the POS with the PC still off: both sales are still queued.
4. Turn the PC on: both sync once (no "needs attention").
5. As the owner:
   - Sales shows the two-service sale once with both services, paid ₱500, commission ₱250. The Service = Shave filter lists it once.
   - Dashboard Services: Haircut +1 and Shave +1 items, listed values ₱250 each; paid sales +2.
   - Payouts: commission for the day includes ₱250 for that sale.
   - End-of-Day Cash: expected cash includes ₱500 for it.
6. With the PC off, record Haircut + Shave with the loyalty card: the ticket shows ₱125 off and ₱375. Then turn the PC on: it syncs once; Sales shows paid ₱375, commission ₱250, "Loyalty 50%".
7. Add a custom amount on one service, then add a second service: the custom amount is cleared and the total is the menu sum.

## 9. Implementation sequence

1. Pure core: `pricing.ts` (`priceSale` multi, `discountLabel`), `price-check.ts` (combined check), `ledger-summary.ts` (`serviceLines`), with their pure tests.
2. Payload and server: `schemas.ts`, sync route (load every service price), `record-sale.ts` (items list), with `test:payload-compat` and `test:sync-rejections`.
3. Reports: `range-figures.ts`, `ledger-summary/route.ts`, `sales-list.ts`, labels on the Dashboard and ledger.
4. Phone: `db.ts` types, `sync.ts` payload, `pos/page.tsx` selection and ticket, shift log display.
5. Every suite, lint, tsc, the real-phone manual test.

## 10. Risks

- `pos/page.tsx` (~1,600 lines) holds the checkout; a regression there blocks sales. Steps 1–3 are done and tested before touching it.
- Phone and server must compute the loyalty discount from the same haircut price with `loyaltyDiscount`, or every loyalty combo is refused.
- A phone still running the old cached POS sends single-service sales; that keeps working, but it can't record combos until it updates (service worker).
- Before Nov 20 there may be no real-phone time with the PC off; without step 5 of §9 the manuscript can't call it tested.
- Rules are confirmed; the remaining risk is technical (checkout regressions, phone-server consistency) and time for the real-phone test.

## 11. Manuscript Impact

Baseline: the panel-reviewed manuscript (PDF pages).
- Outdated after the build:
  - Table 1 "Barber POS: Let the barber select the service…" (p. 32);
  - the POS walkthrough (p. 60);
  - Figure 5, if it shows one service;
  - Table 2 `transaction_items` (p. 42): one item per service in the sale.
- Update: Scope and Limitations (one barber and one customer per sale, several services); Table 7 (one row: several services per sale, from verbal feedback after the defense); Tables 8 and 9 (the tests in §7, the offline multi-service case).
- Evidence needed first: committed; §7 suites green; the §8 real-phone test done.
- Limitations to keep explicit: one barber per sale; no quantities; a custom amount only on a one-service sale (no combined prices, confirmed by the owner); service listed value is a menu-price figure, not collected revenue; a sale is not proof of one customer visit (the forecast comparison stays blocked); a price change still needs every phone synced first.

## 12. Implementation record (2026-11-16)

As built, against §5:
- No schema migration, no Dexie version bump. A one-service sale is stored as before (no `serviceIds` sent, one item at the sale's list price); `serviceIds`/`servicePrices` are stored and sent only for several services.
- Deviation 1: the phone's `serviceName` holds every name ("Haircut + Shave"), not only the first, so the shift log, recent list and done screen need no other change. `serviceId` stays the first service (indexed).
- Deviation 2: Sales lists a sale's services by name (items have no recording order); the row's `serviceName` joins them with " + ".
- `discountLabel` recognises loyalty on a multi-service sale from the haircut's stored price (`servicePrices`); without stored prices it says "Discount" (old Senior/PWD sales still never read as loyalty).
- Accepted behaviour: the selected services stay selected after a sale, as one service did before.

Automated tests (all green unless noted): `test:pricing` 81, `test:price-check` 105, `test:payload-compat` 31, `test:sync-rejections` 108 (M1–M7), `test:ledger-summary` 164 (`serviceLines`, old loyalty haircut, two-service day, source check), `test:sales-list` 49, `test:sync-queue` 36, `test:commission` 42, `test:reconciliation` 66, `test:payout-entries` 46, `test:payout-history` 55, `test:time-review` 37, `test:qrph-charge` 19, `test:authz` 326, `test:approval-gate` 135, and every other "needs nothing" suite; `npm run lint` and `tsc --noEmit` clean. `test:attribution` 148/149: **T17 skipped** (`TEST_ADMIN_DATABASE_URL` not set; environment, unchanged by this slice).

Browser check (desktop, no sale recorded): toggling tiles, R7 (−₱125 on Haircut + Coloring, ₱625), removing the haircut turns loyalty off, the last service can't be removed, R4 (a custom ₱600 is cleared when a second service is added).

Real-phone test (§8): run by the developer on 2026-11-16 and reported as passed (offline recording with the shop PC off, reload while offline, sync on reconnect, the sale and its services once, Dashboard, Sales, Payouts and End-of-Day Cash, a loyalty multi-service sale). Individual figures were not recorded separately.

Known limitations:
- A phone still running a cached POS from before this slice records one service per sale until it updates (its sales still sync).
- One barber per sale; no quantities; no repeated service; a custom amount only on a one-service sale.
- Service listed value is a menu-price figure, not money collected.
- A sale is not proof of one customer visit; the forecast comparison stays blocked (slice plan, gate 1).
- A price change still needs every phone synced first (no price history).
- Selected services carry over to the next ticket (accepted).

<!-- END OF SPEC -->

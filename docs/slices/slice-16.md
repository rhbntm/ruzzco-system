# Slice 16 — Server price check on sync

Repo: `ruzzco-system`. Status: **PRELIMINARY** (written 2026-11-15, revised 2026-11-15 after the readiness review), branch `revision/preliminary`. Not a recalled panel comment: it closes a gap found in the post-defense review of panel Q3 (vault register, Open question 23). The rule and edge cases in §2 are OK'd by Brent (2026-11-15). Decisions 2–4 in §3 are OK'd by Brent (2026-11-15) with the clarifications written into them; the other decisions were proposed with the rule. The revised spec is approved for implementation (Brent, 2026-11-15).
Goal: the server records a sale's list price, discount and amount paid only when they match the shop's price list, so an approved phone (or someone holding its secret) can't raise a barber's commission by sending a higher price.

## 1. Scope boundary (read first)

- In: a price check in `POST /api/v1/transactions/sync`, a new reject reason `PRICE_MISMATCH` (server type, client label and hint), a pure checker in `src/lib/price-check.ts`, a shared `loyaltyDiscount()` in `src/lib/pricing.ts` (Decision 3), the sale insert moved into `src/lib/record-sale.ts` so its rollback can be tested (§5), a read-only owner route `GET /api/v1/reports/custom-amounts` with its row in the authorization matrix, a "Custom amounts" list on `/ledger` (Decision 4), the 7 test suites that send amounts off the price list (§5), and CLAUDE.md (invariants and Known gaps).
- Unchanged: how the POS prices a sale (`lib/pricing.ts` gains the shared helper; its results stay the same, `test:pricing` proves it), the payload shape (no new field, no Dexie bump), attribution, commission rate snapshots, commission base `LIST_PRICE`, tips, payouts, reconciliation, QR Ph, time review, the registration of unknown assignments as revoked. Sales already in the database are never re-checked or changed. No schema change and no migration.
- Out: a screen for editing prices or a price history (the Scope section of the paper says prices are set up by the researchers and have no edit screen), a limit on custom amounts, an owner approval step for custom amounts, automatic fraud detection, voiding or correcting a sale (register H-3).

## 2. Rule (OK'd by Brent, 2026-11-15)

For a sale **without** a custom amount, the server looks up the sale's service and requires the list price to equal that service's `standardPrice`. If it doesn't, the sale is rejected as `PRICE_MISMATCH`: nothing is inserted, and the sale stays on the phone as "needs attention" like every rejected sale. The server never replaces the price with its own, because commission is snapshotted from the list price. A discount must be the loyalty discount: exactly 50% of the list price, on the men's haircut only. A sale **with** a custom amount (`customAmount: true`) skips the list-price check; its list price is the amount typed, as today.

"Nothing is inserted" means no transaction, line item, commission log or mismatch log, so a rejected sale reaches no revenue, commission, payout, ledger or reconciliation figure. Registering an unknown `assignmentId` as an already-revoked assignment happens before the per-sale checks and stays as it is: it can happen for a sale that is then rejected (as it already can for any rejected sale), and such a row attributes nothing.

| # | Edge case | Behaviour |
|---|---|---|
| 1 | A phone sends a men's haircut with list price ₱500 | Rejected `PRICE_MISMATCH`; no transaction, line item or commission log |
| 2 | Loyalty sale: list price ₱250, discount ₱125, paid ₱125 | Recorded; commission from ₱250 as today |
| 3 | Loyalty discount on Hair coloring, or a ₱100 discount on a ₱250 haircut | Rejected `PRICE_MISMATCH` |
| 4 | A ₱250 haircut sent as a custom ₱500 | Recorded (custom amounts skip the check), and listed under Custom amounts on `/ledger` with its note (Decision 4) |
| 5 | A sale made before the price list changed reaches the server after it changed | Can't happen in this version: prices change only when a developer edits the seed. Recorded in Known gaps: sync every phone before changing a price; a future price editor needs a price history |
| 6 | A sale queued by an older POS, before this slice | Checked like any other, with no exception for its age. Every POS version since slice 4 sends the menu price of the time it was queued, so it passes only while that is still the price: a sale queued at the ₱200 haircut (POS before slice 13) is `PRICE_MISMATCH`. A payload with no `listPrice` (older than slice 4) is checked on the list price the server already stores for it: `totalAmount` |
| 7 | The same sale id synced again after it was recorded | Idempotent skip as today; a recorded sale is never re-checked |

**Security limit (accepted for this slice).** Custom amounts are not limited. A modified approved phone (or someone holding its secret) can still send a ₱250 haircut as a custom ₱5,000 sale: a ₱2,500 commission at a 50% rate. This slice keeps legitimate custom pricing (Hair coloring varies, add-ons are typed as custom amounts) and makes every custom sale visible to the owner (Decision 4). Visibility is not prevention: the list detects nothing automatically, and an owner approval step or a limit on custom amounts is out of scope. The `customAmount` flag itself comes from the phone: the server can't tell whether the barber really used the custom-amount field, so a modified approved client can mark any sale custom and skip the menu-price check. That is the same limit, recorded in Known gaps, not fixed here.

## 3. Decisions

1. **Checked against the service row, active or not.** The price comes from `services.standard_price` for the sale's `serviceId`, read once per request, inactive services included: a sale made just before a service was switched off is still valid. An unknown `serviceId` stays `INVALID`, as today (it used to fail on the foreign key), custom amount or not. (Proposed with the rule.)
2. **Amounts must add up.** (OK'd by Brent, 2026-11-15.) For every sale, custom or not: `amountPaid = listPrice − discountAmount`, and `totalAmount = amountPaid` (both to the centavo); otherwise `PRICE_MISMATCH`. The POS always sends them this way (`lib/pricing.ts`). Without it, a sale with the right list price could still store a wrong amount paid (the shop's revenue and part of expected drawer cash), or a `totalAmount` (what QR Ph charges, `lib/gateway.ts`) different from the amount paid.
   - **Checked on the stored values.** The checker first works out, once, the values the server stores, exactly as the route does today: `amountPaid` = the sent `amountPaid`, else `totalAmount`; `listPrice` = `amountPaid` for a custom sale (the sent `listPrice` of a custom sale is ignored, as today; a POS before 2026-09-24 sent the service price there), else the sent `listPrice`, else `totalAmount`. The rule is checked on those values, and the route stores the values the checker returns, so what is checked is what is stored.
   - **No check against itself.** A fallback makes some comparisons true by construction; they are not the check. What each payload shape really checks:

     | Payload | What is really checked |
     |---|---|
     | Not custom, `listPrice` and `amountPaid` sent | `listPrice` = service price; `listPrice − discountAmount = amountPaid`; `totalAmount = amountPaid` |
     | Not custom, no `amountPaid` | `listPrice` = service price; `listPrice − discountAmount = totalAmount` |
     | Not custom, no `listPrice` | `totalAmount` = service price (it is the stored list price); the discount must be 0, since `amountPaid` must equal both `totalAmount − discount` and `totalAmount` |
     | Custom | the discount must be 0 (Decision 3); `totalAmount = amountPaid` when `amountPaid` is sent |

     Each row has a test whose values would pass if the check compared a value with itself (for example a custom sale with `amountPaid` 400 and `totalAmount` 300: rejected).
3. **Discount shape.** (OK'd by Brent, 2026-11-15.) `discountAmount = 0` is allowed with any `discountType` (old payloads default to `NONE`). `discountAmount > 0` requires all of: `discountType: PERCENT`, the men's haircut (`LOYALTY_SERVICE_ID`), `customAmount: false`, and `discountAmount = loyaltyDiscount(listPrice)` to the centavo. Any other non-zero discount (`FIXED`, `NONE` with an amount, another percentage, another service, a custom sale) is `PRICE_MISMATCH`.
   - `loyaltyDiscount(listPrice)` = `listPrice × LOYALTY_PERCENT / 100` rounded to the centavo, the formula `priceSale` uses today, moved into one exported helper in `lib/pricing.ts`. `priceSale`, `discountLabel` and the checker all call it, so the POS and the server can't round differently.
   - History: the removed Senior/PWD button sent `PERCENT` at 20% (until 2026-10-02). No POS version ever sent `FIXED`: it exists only in the enum and the types. A sale still queued with either is `PRICE_MISMATCH`.
4. **Custom amounts become visible to the owner.** (OK'd by Brent, 2026-11-15, with these conditions.) Today no owner page shows them (only the phone's shift log), so edge case 4 would otherwise be invisible.
   - Route: `GET /api/v1/reports/custom-amounts?date=YYYY-MM-DD`. Owner access through `hasOwnerAccess` (401 otherwise), a missing or impossible date 400. Strictly read-only: it only reads (no create, update or upsert, unlike the payouts GET) and the page has no actions.
   - One Manila business date at a time: the `/ledger` date picker's date. The Day/Week/Month toggle doesn't change it.
   - Sales listed: `customAmount: true`, `paymentStatus` PAID or PENDING (EXPIRED and FAILED are left out), and only those that count on the day (`countsOnDay`). A flagged sale waiting for date review counts on no day, so it isn't listed until the owner confirms its date; until then it stays visible on End-of-Day Cash, as today. Newest first. Inactive barbers and services included.
   - Shown for each sale: time (Manila), barber, service, amount paid, note ("(no note)" when blank or the default "POS custom amount"), payment method, status (shown when not PAID), and the recorded commission: the sale's stored `barber_commission_amount` snapshot (every sale has one). It is never recomputed from a current rate, and the ledger's List price/Amount paid toggle doesn't change it. If the service's menu price is shown, it is labelled "Menu price now" (today's price, a reference), never presented as the sale's price.
   - Text only (React escaping, the note is typed by a barber); plain styling, slice 21 restyles it; fits 360 px without sideways scroll.
5. **One reason, `PRICE_MISMATCH`, not several.** The phone shows "Price doesn't match the price list" and the hint "Needs review. Retrying will not fix this by itself." (`needsReview` returns true, like `DEVICE_MISMATCH`). Retry stays available and may be rejected again; the sale is never rewritten.
6. **Order of checks.** After the device, gateway, barber and assignment checks, before the insert: a sale that fails several checks keeps the reason it gets today, and `PRICE_MISMATCH` never hides `DEVICE_MISMATCH` or `ASSIGNMENT_UNAVAILABLE`. An unknown service is `INVALID` at the same point, so its precedence doesn't change (it used to fail at the insert, also after these checks).
7. **Compared in centavos.** Both sides are turned into whole centavos (`Math.round(x * 100)`, and `Prisma.Decimal` for the stored price) before comparing, so ₱250 and ₱250.00 match and floating-point noise never rejects a sale. The expected loyalty discount is `loyaltyDiscount(listPrice)` turned into centavos the same way.

## 4. Build

### 4.1 Checker (`src/lib/price-check.ts`, pure)

`checkSalePrice(sale, servicePrice)` with `sale` = `{ serviceId, customAmount, listPrice?, totalAmount, amountPaid?, discountType, discountAmount }` and `servicePrice` = the row's price in centavos, or `null` for an unknown service. Returns `{ ok: true, amounts: { listPrice, amountPaid, totalAmount } }` (the values to store, Decision 2) or `{ ok: false, reason: "INVALID" | "PRICE_MISMATCH", why: string }`; `INVALID` only for an unknown service, custom or not. `why` is for the server log only (`[sync] rejected <id>: PRICE_MISMATCH (<why>)`), never sent to the phone. Implements §2 and Decisions 2, 3 and 7. Imports `loyaltyDiscount` and `LOYALTY_SERVICE_ID`; no Prisma client, no I/O.

### 4.2 Server

- `src/lib/schemas.ts`: add `PRICE_MISMATCH` to `SyncRejectReason`.
- `src/lib/pricing.ts`: export `loyaltyDiscount()`; `priceSale` and `discountLabel` use it. No result changes.
- `src/lib/record-sale.ts`: the existing insert (mismatch log, transaction, line item and commission log in one `$transaction`) and `isSaleDataError`, moved out of the route unchanged. Narrow: only these two move; the rows written, their order, the error handling (sale-data error → `INVALID`, unique violation → duplicate, anything else rethrown) and the route's checks stay as they are.
- `src/app/api/v1/transactions/sync/route.ts`: load `{ id, standardPrice }` for the request's distinct `serviceId`s in one query; call the checker at the point in Decision 6; reject with its reason; store the `amounts` it returns (the same values the route computes today). The insert-error handling stays: after the check an unknown service no longer reaches the insert, but a database refusal (`isSaleDataError`) still rejects that sale as `INVALID` and rolls back its mismatch log.
- `src/app/api/v1/reports/custom-amounts/route.ts`: Decision 4. Answers `{ success, date, sales: [{ id, time, barberName, serviceName, amountPaid, note, paymentMethod, paymentStatus, commission, menuPriceNow }] }`, money as strings with 2 decimals.
- `scripts/lib/authz-matrix.ts`: a row for `GET v1/reports/custom-amounts`, access `owner` (`test:authz` M1 fails without it).

### 4.3 Phone

`src/lib/sync.ts`: the `PRICE_MISMATCH` label and hint, and `needsReview`. Nothing else on the phone changes.

### 4.4 `/ledger`

A "Custom amounts" section for the selected date, from the route in 4.2, with the fields of Decision 4. Its own loading and error state; a failure there never blocks the rest of the page.

### 4.5 CLAUDE.md

- Invariants, sync results: add `PRICE_MISMATCH` to the reason list ("a non-custom sale whose list price isn't the service's price, a discount other than the loyalty discount, or amounts that don't add up").
- Invariants, owner-only: add `GET /api/v1/reports/custom-amounts`.
- Known gaps: replace the line in §2 edge case 5 (price changes need every phone synced first; a sale queued at an older price is `PRICE_MISMATCH` and can't be fixed by Retry; a price editor needs a price history); the security limit in §2 (custom amounts are not limited, only listed for the owner; visibility is not prevention or fraud detection; `customAmount` is supplied by the phone, so a modified approved client can mark a sale custom to skip the menu-price check).

## 5. Tests

- New `npm run test:price-check` (pure, needs nothing): every edge case in §2 that the checker decides (1 to 4, 6, including a ₱200 haircut in the oldest payload shape), every row of the Decision 2 table with values that would pass a check against itself, Decision 3 (`FIXED` and `NONE` with an amount, 20% `PERCENT`, loyalty on another service and on a custom sale, zero discounts with every type), Decision 7 (₱250 vs 250.00, 0.1 + 0.2 style values), an unknown service (`INVALID`, custom or not), and that `amounts` equals what the route stored before this slice. A cross-check: for every service in `SERVICE_CATALOG`, loyalty on and off, custom amount on and off, the sale `priceSale()` builds passes the checker against that service's price.
- `test:sync-rejections` (dev server): a `PRICE_MISMATCH` sale in a batch with valid ones is the only one refused; nothing inserted for it, no orphan mismatch log (a price-mismatched sale with a mismatched `barberId`); a price-mismatched sale with another phone's assignment is `DEVICE_MISMATCH` (Decision 6); an unknown service on a custom sale is `INVALID`; edge case 7; the phone's label, hint and `needsReview`.
  - **T12 replaced.** Its insert-failure trigger (an unknown service) is now refused before the insert. The new check calls `recordSale` from `src/lib/record-sale.ts` directly against MySQL, with a mismatch log and a service id that doesn't exist, so the refusal is real: MySQL rejects the line item's foreign key (P2003), no mock. It throws an error `isSaleDataError` accepts, and the whole `$transaction` is rolled back: no transaction, line item, commission log or mismatch log for that id (no partial write). T11's unknown-service sale stays, now expected `INVALID` with no mismatch log because it never reaches the insert.
- `test:authz`: the matrix row and a request case for the custom-amounts route (owner 200; signed out, a barber session or a phone 401).
- `test:ledger-summary` (dev server): the custom-amounts route, reusing the suite's owner sign-in and dated fixtures. Each of these is its own check, so one passing can't hide another failing:
  - Authorization: 401 without owner access; 200 with it.
  - Date filtering: a custom sale on the date is listed; one on the day before or after is not; a flagged sale waiting for review is not listed, and after review it is listed on its confirmed date only.
  - Status filtering: custom PAID and PENDING listed; EXPIRED and FAILED not; a non-custom sale on the date not.
  - Values: the commission shown is the stored snapshot after the barber's rate changed; "Menu price now" is the service's current price.
  - Read-only: a GET writes nothing (transaction, payout ledger and payout entry counts unchanged); a bad date answers 400.
  - Fixtures for the payment statuses may be inserted with Prisma.
- Existing suites: 16 suites send sales through sync, and 7 need changes. Each change keeps the suite's purpose; a figure that has to change is reported in the build summary, never edited silently:

  | Suite | Change | Figures |
  |---|---|---|
  | `test-commission` | The C1 sale (list 150, paid 120, `PERCENT` 30, a 20% discount) can't be valid in any form: it becomes the loyalty sale (list 250, `PERCENT` 125, paid 125), which keeps its purpose (commission from the list price, not the amount paid). The other ₱150 sales get `customAmount: true` | Change: C2/C3 60.00 → 100.00, C4 paid 120.00 → 125.00, C6 150.00 → 190.00, AMOUNT_PAID view 138.00 → 140.00, C7 owed 150.00 → 190.00, C11 list 150 → 250 and commission 60.00 → 100.00 |
  | `test-sync-rejections` | `sale()` and `local()` get `customAmount: true`; the cash sale beside the gateway-off QRPH sale moves to 250 or custom; new price cases set `customAmount: false`. T12 as above | T9's 45 unchanged |
  | `test-assignment-attribution` | `sale()` gets `customAmount: true` (keeps the commission table). T14 keeps the oldest payload shape exactly and moves to `totalAmount: 250`, which also tests edge case 6 through the route | Change: T14 commission for B 60 → 100 |
  | `test-gateway` | The sale helper gets `customAmount: true` | Unchanged |
  | `test-payment-qr` | Q7's GCash sale gets `customAmount: true` | Unchanged |
  | `test-time-review` | The sale helper gets `customAmount: true` | Unchanged |
  | `test-sync-clock` | The sale helper's amounts move to 250, oldest payload shape kept | No figures asserted |

  No change: `test-ledger-summary`, `test-payout-entries`, `test-reconciliation` (custom amounts already; `test-ledger-summary`'s loyalty fixture is valid), `test-auth`, `test-authz`, `test-device-approval` (₱250), `test-api-errors` (its oversized batch is refused before any sale is checked); `test-sync-queue` uses a fake server. `test-qrph-charge` and `test-seed` insert with Prisma and `test-pricing` is pure, so none of them goes through sync.
- `test:payload-compat`: no new fixture. "Original cash sale (no paymentMethod field)" is already edge case 6's shape (schema only; the price check is server-side); its label says so.
- All suites, `npm run lint`, `npx tsc --noEmit`.

## 6. Manual test

1. On an approved phone, record a ₱250 haircut. It syncs.
2. In the phone's DevTools, edit one queued sale in IndexedDB to `listPrice: 500` (only on a test phone), then sync. It shows under "needs attention" as "Price doesn't match the price list". The other sales sync.
3. Record a loyalty haircut (₱125 paid). It syncs; `/ledger` shows commission from ₱250.
4. Record a haircut with a custom ₱400 and the note "test". It syncs and appears under Custom amounts on `/ledger` for today, with the note, the payment method and a recorded commission of ₱200 (at 50%).
5. On `/ledger`, switch to Week: the Custom amounts list still shows only the selected date.
6. In a signed-out browser, open `/api/v1/reports/custom-amounts?date=<today>`: 401.
7. `/ledger` at 360 × 740: the Custom amounts list fits with no sideways scroll.

<!-- END OF SPEC -->

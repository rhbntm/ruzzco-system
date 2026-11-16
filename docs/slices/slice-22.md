# Slice 22 — Owner Sales page, custom ranges, and pages on every list of records

Repo: `ruzzco-system`. Status: **DRAFT (2026-11-16), approved in conversation; confirm §7 at the start of the run.** Branch `revision/preliminary`. Built on slice 20 (date ranges, `948efef`) and slice 21 (`DateRangeBar`, `OwnerShell`; last increment `124bcf0`).
Request (Brent, 2026-11-16): a dedicated owner page with more detail about sales, including historical sales, with filtering and pagination; 10 records a page by default, and a choice of how many a page on the Sales page, the shift log and every other list of records; each list keeps its settings until they are changed or reset to the defaults, with a Reset to default button. Revised the same day after a design critique (Brent agreed): the applied filters are always named above the totals, a list always opens on page 1, presets only (no typed size), Sales defaults to 25 a page. Export follows in a later slice. The owner-portal IA audit is set aside.
History: this replaces the earlier slice 22 draft of the same day (custom ranges on the Barber Ledger and pages for long owner lists, put on hold and never built or committed). Everything in that draft is kept here: its Custom range (Decision 2), its pages (Decisions 6 and 9, now with a page-size choice) and its Custom amounts over a range (Decision 12). For a few minutes this spec was numbered 23; there is no slice 23.

Two vertical increments, each committed and tested on its own:
- **22a**: the shared pager with its page-size choice, the kept settings and the Showing line, the Custom range, the `/sales` page and its route.
- **22b**: the same pager on the other lists of records (Decision 9), and the ledger's Custom amounts over the range (Decision 12).

## 1. Scope boundary (read first)

- In: a new owner page `/sales` and a menu item "Sales"; one new read-only route `GET /api/v1/reports/sales`; the Custom from/to choice in the shared `DateRangeBar`, so it also appears on `/ledger`; a shared `components/Pager.tsx` with a page-size choice, used by every list of records (Decision 9); the ledger's Custom amounts list following the range, with one route change (`GET /api/v1/reports/custom-amounts` accepting `from`/`to`, Decision 12).
- Unchanged: every figure and how it is computed; the payout, reconciliation, summary and payout-history routes; the payout cards and the payout form (one business date: a payout entry belongs to one day); the schema (no migration); sync, Dexie, what the POS records; End-of-Day Cash's figures; the time review (still done only on End-of-Day Cash); authorization of every existing route (each keeps its owner check and its row in the authz matrix).
- Out: export (Excel/CSV, next slice); editing, voiding or refunding a sale (the page writes nothing); payouts over a range (it would be a new payout rule); ranges on Insights (slice 21 assumption 7 stands); search by customer (no customer is recorded); filters or page in the URL (§7, item 2; the settings are kept in the browser instead, Decision 10); paging inside charts and Insights' slides (they are summaries, not lists of records).

## 2. Rule

No business rule changes. A sale is in the range when it counts on one of the range's days (`countsInRange`, slice 20). A range is slice 20's: `from`..`to`, Manila business dates, both included, at most 366 dates, `to` never after today; a custom range is checked by the same `parseRange` the routes use, so the screen and the server refuse the same ranges.

One addition, for display only on the Sales page: a sale flagged by its time (`timeFlag` set) and not yet reviewed counts on no day; the list shows it on the Manila date the PC received it (`syncedAt`), marked "Time under review", and leaves it out of every total. Once reviewed it is listed on the day the owner confirmed, as any other sale.

Every status is listed (PAID, PENDING, EXPIRED, FAILED). Totals count PAID sales only, so with no filters the page's totals equal the ledger Summary for the same range.

Edge cases:
1. A sale made at 11:58 PM on Nov 10 that synced on Nov 12 (offline phone, clock fine): listed on Nov 10, counted on Nov 10.
2. A sale flagged DEVICE_CLOCK_SKEW, received Nov 12, stated Nov 3, not reviewed: listed on Nov 12 with the mark, not in totals; a range of Nov 1–5 doesn't list it. After the owner picks "stated date", it's listed and counted on Nov 3 only.
3. A QR Ph sale that EXPIRED: listed with its status, filterable by status, never in the totals.

## 3. Decisions

1. **The page.** `/sales`, owner only (`OwnerPageGate pathname="/sales"` in `layout.tsx`, like `/ledger`), inside `OwnerShell`, second in `OWNER_NAV` after Dashboard ("Sales"). From top: the range bar, the filters, the "Showing" line (Decision 11) with Reset to default (Decision 10), a totals strip, the list, the pager with "Show per page" (Decision 6). Read-only: no button changes a sale.
2. **Custom range.** A sixth choice in `DateRangeBar`, "Custom", opens two date fields (From, To; `max` today) and an Apply button. Apply is refused on the screen, with the route's own wording, when `parseRange` refuses it (from after to, more than 366 dates, a date after today, not a date). Until Apply succeeds the figures keep the range they show. The text under the bar (`rangeText`) names the applied range. The presets stay as they are; on a phone the fields stack under the presets. The bar is shared, so `/ledger`'s Summary, Payout history and Custom amounts (Decision 12) get it too; the ledger's payout cards and form keep their business date.
3. **Filters**, all combined (AND), each "All" by default: Barber (every barber, inactive included, so old sales stay findable); Payment method (Cash, GCash, Maya, QR Ph); Status (Paid, Pending, Expired, Failed); Service (every service, inactive included); Kind (All, Custom amount, Loyalty discount). A loyalty sale is one with a discount (`discountAmount > 0`): slice 16 allows no other discount. Changing a filter or the range goes back to page 1.
4. **Pages on the server for Sales.** History can reach 366 days of sales, too many to send at once, so the sales route pages: `pageSize` sales a page (Decision 6), newest first (`transactionTime` desc, then `id`). Totals always cover every sale matching the range and filters, never only the page shown. A page past the last answers the last page (`page` in the answer says which).
5. **Totals strip** (over the filtered set): sales listed; paid sales; amount paid (PAID only); tips (PAID only); barber commission (PAID only, the stored snapshots, never recomputed); and, when any, "N not counted" (not PAID or time under review).
6. **Pager and page size.** One component for every list: Previous, "Page 2 of 5", Next; 44px targets on touch; the page announced (`aria-live="polite"`). Beside it "Show per page": 10, 25, 50 or 100, presets only (no typed size). The default is 25 on Sales (a busy day fits on one or two pages on the PC) and 10 on every other list. Changing the size goes back to page 1; a list that shrank shows the nearest page that exists (`paginate` already clamps). The pager's page buttons hide when there is one page; the size choice shows only while the list has more than 10 records. The size is kept with the list's other settings (Decision 10); nothing is sent to the server except the Sales route's `pageSize`. Pure helpers in `lib/paginate.ts`: `PAGE_SIZE_PRESETS = [10, 25, 50, 100]`, `DEFAULT_PAGE_SIZE = 10`, `SALES_PAGE_SIZE = 25`, `isPageSize(value)` (true only for a preset).
7. **Each sale.** Row: time (Manila), the day it counts on, barber, service, amount paid, tip, payment method, status; marks for Custom amount, Loyalty and Time under review. On a wide screen a table; on a phone a card per sale (`web/DESIGN.md`). Tapping a row opens its details in place: list price, discount, commission (snapshot) and its rate and base, custom amount note, payment reference, when the PC received it, the account signed in on the phone (username, or "Unknown"), the time flag and review choice, and the sale id. No device key or assignment id is shown.
8. **The route.** `GET /api/v1/reports/sales?from&to[&barberId][&method][&status][&serviceId][&kind][&page][&pageSize]`. Owner access first (401 before any query), then `parseRange` (400/422 with its wording), then the filters (an unknown enum value, a non-number page, or a `pageSize` that isn't a preset is 400; `pageSize` defaults to 25; an id that matches nothing just finds no sales). Answers `{ success, from, to, page, pageCount, pageSize, totals: { count, paidCount, amountPaid, tips, commission, notCounted }, sales: [...] }`, amounts as two-decimal strings like the other report routes. Strictly read-only. Its row goes in `scripts/lib/authz-matrix.ts`.
9. **Other lists of records (22b).** The same pager and page-size choice, paged on the screen (`paginate`: these lists are small for one shop and their routes already send the whole list with its totals, so no other route gains a `page` parameter, and totals keep covering the whole list): the shift log (replaces its fixed 20, slice 13; its needs-attention list stays above the pages, unpaged, as now), the ledger's Payout history (its totals row stays above the pages) and Custom amounts, the approved and the revoked phones on `/devices` (each its own pager), the accounts on `/staff`. The 22b audit lists every other screen that shows records (rows of sales, entries, phones or accounts, not figures) and adds it here before building; anything with at most a handful of rows by design (the payout cards, one per barber) is not paged. Revoke, Reset password and Deactivate keep working on any page; after one the list reloads and stays on its page when it still exists. Each of these lists keeps its settings (Decision 10); the shift log's are kept on the phone, so they work offline.
10. **Kept settings and Reset to default.** Every paged list keeps its settings in this browser until the user changes them or presses "Reset to default": the range (a preset is kept by name, so "This week" is still this week tomorrow; a Custom range by its two dates), the filters and the page size. The page number is never kept: a list always opens on page 1, because the lists are newest first and new records move every page (a barber reopening the shift log on page 3 would think today's sales were missing). Settings survive a reload and closing the browser; they are per list and per browser (`localStorage`, one key per list, every read and write in try/catch), never sent to the server or shared between devices. The "Reset to default" button sits on the Showing line (Decision 11), or beside the pager on a list without filters or a range; it appears only on lists that have filters or a range, or more than 10 records (a list that can never reach a second page gets none), and is disabled while every setting is already the default. It sets the range to Today (where the list has a range), every filter to All, the list's default size and page 1, and clears the kept settings. A kept setting that is no longer valid falls back to its default on its own, never an error: a Custom range now refused by `parseRange` (an unreadable date, or a range that has become invalid) goes to Today, a barber or service filter whose id is no longer offered goes to All, a size that isn't a preset gives the list's default. Pure helpers in `lib/list-settings.ts`: `readListSettings(key, defaults, validate)`, `writeListSettings`, `clearListSettings`, `isDefault`. The ledger's business date for the payout cards and form is not a list setting: it still opens on today.
11. **The Showing line.** Kept filters must never be mistaken for the whole shop. Every list with filters or a range shows one line directly above its totals (or above the list where there are no totals) naming what is applied, always, defaults included: "Showing: all barbers · all methods · all statuses · Nov 10–16, 2026" by default; once any filter is set, only the filters that differ from All are named, as in "Showing: Bayani · GCash · Nov 1–16, 2026". When any filter differs from All, the line uses the attention style (a `web/DESIGN.md` token, not crimson: crimson is the one primary action and errors) and the totals strip is titled "Filtered totals" instead of "Totals". Reset to default sits at the end of the line. Pure text in `lib/list-settings.ts` (`showingText`).
12. **Custom amounts follow the range (22b).** The ledger's Custom amounts list moves under the range bar with the Summary and the Payout history, so all three always show the same dates. `GET /api/v1/reports/custom-amounts` gains `from`/`to` (owner access first, then `parseRange`, 400/422 as the ledger-summary route answers them) and keeps `?date=` working unchanged (a one-day range, the same answer as today). Either `date` or `from`+`to`, never both (400). Sales are `countsInRange`, newest first, as before. Its authz-matrix note names the range.

## 4. Build

Read the Next.js guides in `node_modules/next/dist/docs/` for route handlers and client components before writing code.

22a:
- `src/lib/list-settings.ts`: Decisions 10 and 11 (`showingText`).
- `src/lib/paginate.ts`: Decision 6's constants and `isPageSize`; `paginate` keeps its signature, its default becomes `DEFAULT_PAGE_SIZE`.
- `src/components/Pager.tsx`: Decision 6 (props: page, pageCount, pageSize, defaultSize, onPage, onPageSize). `src/components/ShowingLine.tsx`: Decision 11, with the Reset button.
- `src/lib/sales-list.ts`: the Prisma `where` (range plus unreviewed flagged sales by received date, plus the filters), the totals and the row mapping; pure helpers separate from Prisma where they can be (filter parsing, page clamping).
- `src/app/api/v1/reports/sales/route.ts`: Decision 8.
- `src/app/sales/layout.tsx`, `src/app/sales/page.tsx`: Decisions 1, 3, 5, 7, 11.
- `src/components/DateRangeBar.tsx`: Decision 2 (`customOption(from, to, today)` returns a `RangeOption` or the `parseRange` error).
- `src/lib/owner-nav.ts`: the Sales item. `scripts/lib/authz-matrix.ts`: the route's row.

22b:
- `src/app/shift-log/page.tsx`, `src/app/devices/page.tsx`, `src/app/staff/StaffAccounts.tsx`, and whatever else the 22b audit lists: Decision 9.
- `src/app/ledger/page.tsx`: Decisions 9 and 12 (Custom amounts requested by `from`/`to`, under the range bar, paged; Payout history paged).
- `src/app/api/v1/reports/custom-amounts/route.ts`: Decision 12. `scripts/lib/authz-matrix.ts`: its note.

Both: CLAUDE.md (`/sales` and its route in the owner-only list, the `/ledger` line for Custom amounts over the range, the plan line); `web/DESIGN.md` (the custom range fields, the pager and its size choice, the Showing line, the sales table and cards).

## 5. Tests

22a:
- New `npm run test:sales-list` (needs the dev server and MySQL; creates and removes its own sales): signed out is 401 before any query; a bad range is 400/422 with `parseRange`'s wording; a bad filter value, `pageSize=0`, `pageSize=7` and `pageSize=101` are 400; no `pageSize` means 25; with no filters, `totals.amountPaid` equals the ledger-summary total for the same range; each filter narrows correctly; PENDING/EXPIRED sales are listed but not totalled; an unreviewed flagged sale is listed on its received date and not totalled, and after review appears on the confirmed date only; inactive barbers' sales are listed; 21 matching sales at `pageSize=10` give 3 pages, page 3 holds 1, page 9 answers page 3; with no `pageSize` one page; totals are the same on every page and every size.
- `test:shift-log-pages` (kept as the paging suite): 10 by default; `isPageSize` accepts only 10, 25, 50 and 100 and refuses 7, 0, 101, 2.5, empty and text; each preset pages correctly; the existing clamping cases at the new default.
- New `npm run test:list-settings` (needs nothing; a fake storage): settings round-trip; a missing, unreadable or throwing storage gives the defaults; a preset range is kept by name and resolves against the day it is read; an unreadable Custom range, an unknown barber or service id and a non-preset size each fall back to their own default without touching the others; a stored page number is ignored (always page 1); Reset clears the key and `isDefault` is true after it; `showingText` for the defaults and for a filtered set.
- `test:date-range` gains `customOption`'s cases (each `parseRange` error with the route's wording; a one-day custom range equals Today).
- `test:nav` gains the Sales item; `test:approval-gate` A7 covers `/sales` (the page calls `ownerPageAccess`); `test:authz` green with the new row.

22b:
- `test:shift-log-pages` covers a list that shrank on a larger size.
- `test:ledger-summary` gains (it already covers custom amounts): `custom-amounts?from&to` for one day equals `?date=`; a week equals the sum of its days' lists; `date` with `from` is 400; a future `to` is 422; signed out is 401 before any query.
- `test:authz` unchanged in shape and green.

Every other suite green and unchanged; lint and `tsc --noEmit` clean after each increment.

## 6. Manual test

22a:
1. As the owner, open Sales from the menu: today's sales are listed, 25 a page, the Showing line names all barbers, methods and statuses, and the totals match the Dashboard's Today card.
2. Choose Custom, Nov 1 to Nov 16, 2026, Apply: the list and the totals cover those dates; a To after today, and a From after the To, are each refused with a message and the figures shown don't change.
3. Filter Barber = Bayani, Method = GCash: only his GCash sales; the Showing line names "Bayani · GCash" in the attention style and the strip reads "Filtered totals"; Next and Previous move through the pages and the totals stay put.
4. Show per page 10: the pages change, the totals don't. Go to page 2 and reload, then close and reopen the browser: the range, filters and size are as you left them, on page 1. Press Reset to default: Today, every filter All, 25 a page, page 1; the button turns disabled; reload keeps the defaults.
5. Tap a sale: its details open, with the commission snapshot and the signed-in account.
6. On a phone-width window the list shows as cards; signed in as a barber, `/sales` sends you to `/pos`.

22b:
7. On a phone's shift log with more than 10 sales: 10 a page; choose 25 and go to page 2; with the PC off, reload: still 25, back on page 1; Reset to default: 10. With 10 or fewer sales there is no size choice and no Reset.
8. On `/ledger`, choose Custom Nov 10 to Nov 16, 2026: the Summary, the Payout history and the Custom amounts all name those dates; the payout cards keep their business date. Choose This month: the Payout history pages, its totals row the same on every page.
9. On `/devices` and `/staff`: page through, change the size, and revoke or reset one on page 2.

## 7. Assumptions for final approval

1. 25 a page on Sales, 10 on every other list; presets 10, 25, 50, 100 only, no typed size (Brent, 2026-11-16, after the critique).
2. Every list keeps its range, filters and size in that browser until changed or reset, and always opens on page 1 (Brent, 2026-11-16); per browser, not per account: an owner signing in on another PC starts from the defaults, and two people on the same browser share them. The Showing line (Decision 11) keeps kept filters from being misread. Alternative not taken: the URL (a shared link would carry the settings).
3. Newest first by sale time. A reviewed sale is listed where its time puts it, though it counts on the confirmed day (shown in the row).
4. The Custom range appears on `/ledger` too, since the range bar is shared, and the ledger's Custom amounts follow the range (Brent, 2026-11-16).
5. Listing every status, totals from PAID only; flagged sales shown and marked (Brent, 2026-11-16).
6. The shift log goes from 20 a page to 10 by default (Brent, 2026-11-16, "applies to other records like in shift-log"). Phones and Staff get pagers though today's lists fit on one page.
7. The loyalty filter means "any discount", true only while loyalty is the one discount (slice 16). A future discount type must give the filter its own value.

<!-- END OF SPEC -->

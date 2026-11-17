# Slice 26 — End-of-Day Cash: saved counts, per date and recent dates

Repo: `ruzzco-system`. Status: **BUILT (2026-11-16)**, automated suites green, desktop browser check done (§6). Uncommitted until approved. Branch `revision/preliminary`.
Provenance: **supporting improvement** (team interpretation: saved revisions were stored but only the latest was visible). Not a panel item.
History: from the planning draft "slice 26 (draft)". The recent list follows Brent's instruction of 2026-11-16 ("the latest 30 business dates that have reconciliation records"), not the draft's "last 30 calendar dates including uncounted days" (§7).

## 1. Scope

- In, all on `/reconciliation`: (a) every saved revision of the selected date; (b) the latest revision of each of the latest 30 dates that have a saved count. The route's answers gain them.
- Unchanged: how a count is saved (always a new revision; append-only); expected drawer cash; petty cash; staleness (still for the selected date's latest revision only); the date review; payouts; the schema (no migration); the page and route paths.
- Out: editing or deleting a revision; export; a range picker for the recent list; Reports; Sales URL filters.

## 2. Rule

No business rule changes. Revisions are append-only (`shift_reconciliations`, unique `(reconciliationDate, revision)`); each shows what was counted and expected when it was saved and is never recomputed. A date "has a saved count" when it has at least one revision; a date without one shows the existing "Not counted yet". Dates are Manila business dates (`reconciliationDate`), never the save time's UTC date.

## 3. Decisions (as built)

1. `lib/reconciliation.ts`: `listRevisions(day)` (every revision of a date, newest first) and `recentCounts(upTo, limit = 30)` (a `groupBy` on `reconciliationDate` up to `upTo`, newest first, `take: limit`, then each date's latest revision). `RECENT_COUNTS_MAX = 60`. Read-only.
2. `GET /api/v1/reports/reconciliation?date=` and the `POST` answer gain `revisions` (serialized with the existing `serializeSaved`, newest first; `saved` unchanged and equal to the first). `GET ?recent=N` (1–60) answers `{ success, recent: [{ date, latest }] }` up to today (Manila). `date` with `recent` is 400; a bad `recent` is 400; owner access first (401), as before.
3. Screen, under the Saved Audit Record:
   - "Saved counts for {date}" when the date has two or more revisions: revision, "Current" or "Replaced by revision N", saved time (Manila), expected, counted, variance with Balanced / Cash short / Cash over, petty cash, and the petty cash note and audit note when present.
   - "Recent counts": the latest 30 dates with a saved count, each with its latest revision, counted amount and variance in words; tapping a date selects it in the date picker. The line above it says a date with no saved count is not listed and shows "Not counted yet" when picked. An empty list says "No drawer count has been saved yet."
   - Both read-only; no pager (at most 30 rows; a date has a handful of revisions).
4. `scripts/lib/authz-matrix.ts`: the GET note names both modes.

## 4. Slice 25 closeout (same session)

- `/ledger` showed "Payouts" twice: the first section heading is now "Daily payouts" (the banner keeps the page title "Payouts").
- Narrow viewport: the owner menu at 360 × 740 (same-origin frame in Chrome, owner session) shows all four group headings; About (630–674px) and Lock (682–726px) are fully visible; Phones (576–620px) ends 3px past the list's visible edge, which scrolls by 15px. Reachable; no change made.

## 5. Tests

- New `npm run test:reconciliation-history` (dev server and MySQL; synthetic counts on 1999-02-28..1999-03-31, refuses to run if any exist; deleted after): **24/24**. Three revisions newest first with their own values; empty history; `GET ?date` revisions with `saved` equal to the first; an uncounted date; 31 dated counts give 30, newest first, the oldest left out; each date once with its latest revision; a count saved at 20:00 UTC stays on its Manila business date; a limit of 5; a date before any count gives none; `?recent=30` at most 30, newest first; `recent=0`, `61`, `abc`, `2.5` and `date`+`recent` are 400; signed out 401 in both modes; two POSTs give revisions 1 then 2, the POST answer carries the history, revision 1 unchanged after revision 2, expected cash the same in both.
- `test:reconciliation` 66/66 (unchanged), `test:authz` 326/326, `test:approval-gate` 135/135, `test:nav` 51/51, `test:theme` 87/87; `npm run lint` and `tsc --noEmit` clean.

## 6. Browser check (desktop Chrome, owner session; no count saved, nothing changed)

- Today (Nov 16) shows "Not counted yet"; "Recent counts" lists 2026-11-12 (revision 2, ₱1,400.00, Cash over), 2026-11-10 (revision 2, ₱250.00, Balanced), 2026-10-01 (revision 5, ₱400.00, Cash over) from the development database.
- Tapping 2026-10-01 selects it: the Saved Audit Record shows revision 5 (out of date) and "Saved counts for 2026-10-01" lists revisions 5 (Current) to 1, each with its own counted amount (revision 4: ₱200.00) and variance in words.

## 7. Deviations and limitations

- The recent list holds the latest 30 dates **with** a saved count (as instructed), so uncounted days do not appear in it; the selected date still shows "Not counted yet". The draft's alternative (every calendar date, uncounted ones marked) is not built.
- The recent list shows no out-of-date marker (it would need 30 days of expected cash recomputed); staleness shows when a date is opened.
- The selected date in the recent list is marked for screen readers only (`aria-current`), not visually.
- One date's full history at a time.

## 8. Manuscript impact

- Stays true: Project Design (PDF p. 40) "A saved cash count is never edited. Each new count for the same date is stored as a new revision"; Table 1 End-of-Day Cash row (p. 32) and the closing procedure (p. 62).
- Can be added: the owner sees every saved revision of a date and the latest count of the last 30 counted dates (Table 1 row; Operation and Testing, closing the day; Figure 8 "Closing the Day" only if it shows the screen).
- Table 7: one row (stored revisions made visible; team decision). Table 8: `test:reconciliation-history`.
- Screenshots to retake if the paper shows End-of-Day Cash. Evidence: this record; commit hash once committed.

<!-- END OF SPEC -->

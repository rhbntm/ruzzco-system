# Slice 25 — Owner menu groups, "Payouts", About beside Lock

Repo: `ruzzco-system`. Status: **BUILT (2026-11-16)**, automated suites green, desktop browser check done (§7). Uncommitted until approved. Branch `revision/preliminary`.
Provenance: **supporting improvement** (team interpretation of the owner-portal IA audit), loosely related to recalled demo feedback PR-2 ("too much in one place"). Not a formal written panel item. Two items are defect fixes: Sales showed the Dashboard's icon, and `/about` said payouts were "behind an owner PIN" (out of date since slice 19).
History: taken from the planning draft "slice 23 (draft)", items menu, Payouts naming and About only. The Sales URL filters and the ledger Custom amounts cleanup from that draft are **not** in this slice.

## 1. Scope

- In: the owner menu in four groups; About at the foot of the menu beside Lock; "Payouts" as the visible name of `/ledger`; a Sales icon of its own; the About sentence on payouts; `test:nav` for all of it.
- Unchanged: every route and URL (`/ledger` stays), every page's data, API and owner check; Staff accounts, Payment QR and Phones stay three separate routes; the Dashboard layout; the barber header and pages; POS, sync, pricing and forecast code; the light theme.
- Out: Reports (Insights keeps its name and place until the Reports slice); Sales filters in the URL; reconciliation history.

## 2. Decisions (as built)

1. `lib/owner-nav.ts`: `OWNER_NAV_GROUPS` and `OWNER_NAV_SECONDARY`; `OWNER_NAV` is now derived (groups, then secondary), so `navTitle` and `isCurrentNav` are unchanged.
   - Overview: Dashboard.
   - Business: Sales, Insights, Forecast.
   - Financial operations: Payouts (`/ledger`), End-of-Day Cash.
   - Team and administration: Staff accounts, Payment QR, Phones.
   - Secondary, beside Lock: About.
2. `components/OwnerShell.tsx`: each group is a list under a small `rz-label` heading (`role="group"`, `aria-labelledby`), in both the sidebar (from 1024px) and the phone drawer; About sits above Lock in the footer of both. The phone drawer keeps its Back-closes-menu behaviour. `ICONS` gains `/sales` (lucide `Receipt`).
3. "Payouts" wherever the owner reads the page's name: the menu and top bar (from `OWNER_NAV`), the page banner (was "Daily payout ledger"), the owner sign-in title and button on the page and in its layout gate (was "Owner ledger" / "Unlock ledger"), the Dashboard's two card links and subtitle, Insights' three card links and subtitle, Presentation mode's link, and End-of-Day Cash's note on cash payouts. Code comments are unchanged.
4. `/about` "Built so far": "Daily barber payouts, recorded by the owner account" (was "Daily payout ledger behind an owner PIN").

Deviation from the proposed groups: Business lists **Insights**, not "Reports", because Reports is not built; the item is renamed when the Reports slice ships.

## 3. Tests

- `test:nav` 51/51 (was 42): new checks for the four groups in order, About as the only secondary item, `OWNER_NAV` = groups then secondary, `/ledger` labelled Payouts (menu and top bar), Staff, Payment QR and Phones as three routes, every menu item has its own icon entry, Sales' icon is `Receipt`, no owner screen (or Presentation mode) shows "Barber Ledger", "Owner ledger" or "Daily payout ledger", About no longer says "behind an owner PIN". The source check "the shell draws its list from" now names `OWNER_NAV_GROUPS` and `OWNER_NAV_SECONDARY`.
- `test:authz` 326/326. Its two page-markup markers for the ledger moved from the old title "Owner ledger" to "view and record barber payouts" (text only the ledger page renders), so the barber-redirect checks stay meaningful.
- `test:approval-gate` 135/135, `test:theme` 87/87, `test:insights-story` 121/121, `test:forecast-revenue` 20/20; `npm run lint` and `tsc --noEmit` clean.

## 4. Manual check (desktop Chrome, owner session, read only)

- `/ledger`: the sidebar shows Overview, Business, Financial operations, Team and administration with their items, Payouts highlighted; the top bar "Owner / Payouts"; the banner and sign-in title "Payouts"; Sales has the receipt icon; About sits above Lock.
- `/`: both ledger card links read "Payouts".
- `/about`: "Daily barber payouts, recorded by the owner account".
- Not checked in a browser: the phone drawer (same component and lists; covered by `test:nav`), and every route clicked one by one (all hrefs unchanged; `test:nav` and `test:approval-gate` cover reachability and gating).

## 5. Known issues

- At a 716px-tall window the group headings make the sidebar list scroll (Phones below the fold); the list scrolls within the sidebar, Lock and About stay visible.
- Closed in the slice 26 session: `/ledger` showed "Payouts" twice; the first section heading is now "Daily payouts". The phone menu at 360 × 740 was checked: every group, About and Lock visible, Phones reachable by a 15px scroll (slice 26 §4).

## 6. Manuscript impact

Table 1 and the Operation and Testing walkthrough (PDF pp. 32–33, 61, 64) name the "Barber Ledger" and list the owner pages; update them to "Payouts" and the grouped menu. Table 7 gets one row (menu groups and Payouts naming; reason: usability, a team decision; Sales icon and About wording fixed). Table 8: `test:nav`. Evidence: this record; commit hash once committed.

<!-- END OF SPEC -->

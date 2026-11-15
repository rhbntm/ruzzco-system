# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Barbers** (the roster is data, never hardcoded; today two are active) each ring up their cuts on their own phone, between customers, standing at the chair. They sign in with their own account and see two pages only: the POS and the Shift Log.
- **Mart, the owner**, signs in with the owner account on the shop PC. He lands on a dashboard and, from one menu, records each barber's daily payout, counts the drawer at closing, reads Insights and the forecast, manages the barbers' GCash/Maya QR codes, approves or revokes phones, and manages staff accounts. Mart doesn't cut hair.

## Product Purpose

Ruzzco Barbers System is the shop's offline-first point of sale and end-of-day books, with a customer and revenue forecast for the owner over 7, 14 or 30 days (SPCC BSIT capstone). Success: every sale is recorded exactly once even when the Wi-Fi drops, the drawer reconciles at closing, and barbers are paid daily from the commission saved at sale time.

## Positioning

Built for one real shop in Caloocan City: sales are saved on the phone first and synced idempotently, commission is snapshotted at sale time and never recomputed, and the forecast is trained on the shop's own paper logbook.

## Operating Context

- Open 10 AM to 10 PM daily, holidays included. Business dates are Asia/Manila.
- The app runs on the shop PC; phones reach it over the shop Wi-Fi through an HTTPS gateway. A service worker stores `/pos` and `/shift-log`, so a phone opens them and records sales with the shop PC off; owner pages are never stored.
- Each phone is approved once (on the phone, with a PIN) before it can send sales.
- Payments: cash (into the drawer), GCash and Maya (to the barber's personal account), and an optional QR Ph test gateway that is off by default.

## Capabilities and Constraints

- Owner routes, inside one shell: `/` (dashboard), `/ledger` (Barber Ledger: payouts, summary over a date range, payout history), `/reconciliation` (End-of-Day Cash), `/insights`, `/forecast`, `/payment-qr`, `/devices` (Phones), `/staff` (Staff accounts), `/about`. Barber routes: `/pos`, `/shift-log`. `/login` for the owner.
- Visual work is presentation only: it never changes how a figure is computed, and it preserves every function, flow and accessibility affordance (aria names, live regions, touch targets).
- Nothing is loaded from a CDN at build or run time; fonts are self-hosted.
- Stack: Next.js 16 App Router, React 19, Tailwind 4, lucide-react icons; no UI component library.

## Brand Commitments

- Name: Ruzzco Barbers. Logo: `public/ruzzco-logo.jpg`, white condensed caps "RUZZCO BARBERS" with "PREMIUM CUT & SHAVE" and "BARBERSHOP", a red mustache and two barber poles on black. Until a vector logo is delivered, the app shows the mustache mark in a crimson square with the wordmark in Oswald (slice 21).
- A plain, light POS (slice 21, the team's redesign brief of 2026-11-14): crimson for the logo, the one primary action and errors; cash neutral; status by an icon and a word. Light is the only theme offered; the earlier dark palette stays in the stylesheet, unselectable. See `DESIGN.md`.
- Never present a founding year ("EST. 1995" in a reference image is a concept, and the logo's "2026" is not a claim to repeat).

## Evidence on Hand

- `public/ruzzco-logo.jpg`. Reference photos shared in chat on 2026-10-14 (not in the repo). The redesign's mock-ups (private vault) are layout references only: no figure, name or label is copied from them.
- Prices come from the database. No testimonials, reviews, customer counts, or prices may be invented in the UI.

## Product Principles

1. A sale is never lost or doubled: sync state is readable at a glance on every barber screen.
2. Fast at the chair: one hand, large targets, and a charge sheet that confirms the amount and the change before anything is recorded.
3. Money is exact and explained: figures match across pages, and the rule behind each figure is shown. Estimates (the forecast) are labelled as estimates.
4. Owner-only means owner-only: locked states never leak a number.
5. The shop's identity lives in the details and never costs the task.

## Accessibility & Inclusion

- Touch targets at least 44px on coarse pointers; 16px inputs on phones so iOS does not zoom; nothing scrolls sideways at 360px.
- Text at least 4.5:1 against its surface (`npm run test:theme`).
- A visible focus ring on every control; `prefers-reduced-motion` respected.
- Sale and sync results announced through live regions; status is never shown by colour or fading alone.

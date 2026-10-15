# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Barbers** (the roster is data, never hardcoded; today two are active) ring up each cut on their own phone or a shared device, between customers, standing at the chair.
- **Mart, the owner**, closes out the drawer at night, records each barber's daily payout, manages the barbers' GCash/Maya QR codes, and reads the forecast and insights behind an owner PIN. Mart doesn't cut hair.

## Product Purpose

Ruzzco Barbers System is the shop's offline-first point of sale and end-of-day books, with a 7-day customer and revenue forecast for the owner (SPCC BSIT capstone). Success: every sale is recorded exactly once even when the Wi-Fi drops, the drawer reconciles at closing, and barbers are paid daily from the commission saved at sale time.

## Positioning

Built for one real shop in Caloocan City: sales are saved on the phone first and synced idempotently, commission is snapshotted at sale time and never recomputed, and the forecast is trained on the shop's own paper logbook.

## Operating Context

- Open 10 AM to 10 PM daily, holidays included. Business dates are Asia/Manila.
- Phones reach the server over shop LAN HTTP (not a secure context). No service worker: the page must stay open for the offline queue.
- The shop interior: black walls, a crimson accent wall with the logo banner, bright LED tubes, black leather chairs with chrome.
- Payments: cash (into the drawer), GCash and Maya (to the barber's personal account), and an optional QR Ph test gateway that is off by default.

## Capabilities and Constraints

- Routes: `/` home, `/pos`, `/shift-log`, `/reconciliation` (End-of-Day Cash), and owner-only `/ledger`, `/payment-qr`, `/insights`.
- Visual work preserves every function, flow, and accessibility affordance (aria names, live regions, touch targets).
- The build must not depend on Google Fonts at build or run time (commit 14be0e1); fonts are self-hosted.
- Stack: Next.js 16 App Router, React 19, Tailwind 4, lucide-react icons; no UI component library.

## Brand Commitments

- Name: Ruzzco Barbers. Logo: `public/ruzzco-logo.jpg`, white condensed caps "RUZZCO BARBERS" with "PREMIUM CUT & SHAVE" and "BARBERSHOP", a red mustache and two barber poles on black.
- Direction confirmed by the user on 2026-10-14: the shop logo leads (black, white condensed caps, crimson, barber-pole stripes); antique brass appears only for premium moments (totals, dividers, owner pages). Display face: Oswald, self-hosted.
- Never present a founding year ("EST. 1995" in a reference image is a concept, and the logo's "2026" is not a claim to repeat).

## Evidence on Hand

- `public/ruzzco-logo.jpg`. Four reference photos shared in chat on 2026-10-14 (not in the repo): a branded clipper render, a vintage gold signage concept, the logo, and the shop interior.
- Real catalog prices come from the database (Haircut ₱200, Shave & Massage ₱150). No testimonials, reviews, customer counts, or prices may be invented in the UI.

## Product Principles

1. A sale is never lost or doubled: sync state is readable at a glance on every phone screen.
2. Fast at the chair: one hand, two taps to ring up a cut, large targets.
3. Money is exact and explained: figures match across pages, and the rule behind each figure is shown.
4. Owner-only means owner-only: locked states never leak a number.
5. The shop's identity lives in the details and never costs the task.

## Accessibility & Inclusion

- Touch targets at least 44px on coarse pointers; 16px inputs on phones so iOS does not zoom.
- A visible focus ring on every control; `prefers-reduced-motion` respected.
- Sale and sync results announced through live regions; status is never shown by colour alone.

# Slice 6 — Per-barber GCash/Maya QR in the payment modal

Repo: `ruzzco-system`, branch `main`. Approved 2026-10-07.
Goal: when a barber taps GCash or Maya on `/pos`, the modal shows the QR uploaded for the barber the sale is attributed to, with the correct amount, and it still shows with no internet once the POS has loaded. The sale is recorded exactly as today (record-only: the barber confirms, the POS saves a GCASH or MAYA sale).

## 1. Scope boundary (read first)

- Display only. The sale and sync payload do not change. GCASH and MAYA sales stay PAID on sync, as today.
- The only confirmed rule used here: GCash/Maya payments go to the barber's personal account (CLAUDE.md Business facts). No rule about who owes whom for digital payments is encoded anywhere.
- Unknown, not designed around: whose account actually receives the money, how the owner's share is settled, which barbers have their own account. A QR is just an image attached to a barber record; the modal says "QR on file for {barber}", never whose account it is.
- The PayMongo QR Ph flow behind `PAYMENT_GATEWAY` is untouched.
- Out of scope: ledger netting or any payout ledger change (blocked on the client and the advisor's "remove the ledger"); reconciliation or drawer formula changes; QR Ph tip recorded but not charged (own slice); loyalty discount, roster fallback, ML gate drift, combos, shift-log QRPH.

## 2. Decisions (confirmed 2026-10-07)

1. Only the owner (owner PIN cookie) can upload, replace or remove a QR. Barbers cannot.
2. The reference number stays optional in the UI. A sale is never blocked on it.
3. The modal amount is `previewAmount` plus the tip entered before payment (`previewTip`), shown as a breakdown when a tip is set.
4. QRs are stored per barber record. No barber names in code.
5. No real account QR in the repo, seed or tests. Tests and dev use a sample QR that encodes the plain text `DEMO ONLY - NOT A PAYMENT QR` (not an EMV/QR Ph payload). Real QRs are uploaded through the owner page only.

## 3. Data model (additive migration)

```prisma
model BarberPaymentQr {
  id          String        @id @default(uuid())
  barberId    String        @map("barber_id")
  barber      Barber        @relation(fields: [barberId], references: [id])
  method      PaymentMethod // GCASH or MAYA only, enforced by the route
  contentType String        @map("content_type")
  image       Bytes         @db.MediumBlob
  sha256      String        @db.Char(64)
  updatedAt   DateTime      @updatedAt @map("updated_at")
  @@unique([barberId, method])
  @@map("barber_payment_qrs")
}
```

`Barber` gains the Prisma relation field `paymentQrs BarberPaymentQr[]` (no column change). Images live in the database, never on the server's disk, so they cannot reach git. SQL generated with `prisma migrate diff` from Git Bash, reviewed, applied with `npx prisma migrate deploy`.

## 4. Routes and validation

- `GET /api/v1/payment-qrs`: metadata for active barbers `{ barberId, method, sha256, contentType }`. No image bytes. Public, like the catalog.
- `GET /api/v1/payment-qrs/[barberId]/[method]`: the image bytes with their content type. Public (POS phones have no login). Same exposure as a printed QR on the counter.
- `PUT` and `DELETE` on the same path: owner PIN cookie required (401 otherwise).
- Validation on `PUT`: method is `GCASH` or `MAYA` (400 otherwise); barber exists and is active (404); body is 1 MB or less (413); file signature is PNG, JPEG or WebP, checked on the bytes, not the client's header (415). SVG is refused (it can carry scripts).
- Never log image bytes or request bodies.

## 5. Owner page `/payment-qr`

PIN unlock using the `/ledger` pattern. One row per active barber, a GCash and a Maya slot each: preview, upload or replace, remove. Linked from the home page with the Owner PIN badge.

## 6. POS modal

- Shows the cached QR for `binding.barberId` and the tapped method, labelled "GCash QR on file for {barber}" (or Maya).
- Missing QR: "No GCash QR set up for {barber}. Ask the owner to add one." The sale can still be confirmed.
- Amount: `previewAmount`, plus `previewTip` when set (for example ₱200 + ₱20 tip = ₱220). Replaces `selectedService.standardPrice`, which ignored custom amounts.
- Text matches the screen. The reference number field stays optional.

## 7. Device cache

- Dexie version 3 adds a `paymentQrs` table keyed `"barberId:method"` with `{ sha256, contentType, dataUrl }`. The new table brings a new primary index, which is what justifies the version bump under CLAUDE.md.
- Holds QRs for all active barbers, so an offline rebind on a shared phone still shows the right QR.
- Refreshed on POS load while online, after a bind, and on reconnect. Only images whose sha256 changed are downloaded; removed ones are deleted locally.
- Why IndexedDB: the Cache API needs a secure context, and the phones use LAN HTTP. localStorage is about 5 MB and strings only. IndexedDB already works over HTTP and holds the catalog. Limit: with no service worker, offline still means the page was loaded online and kept open.

## 8. Invariants still in force

All CLAUDE.md invariants, in particular: old queued payloads still validate (`test:payload-compat`), attribution is fixed at sale time, `generateUUID()` only. New rule for CLAUDE.md: payment QR images live only in the database and in IndexedDB; they are never committed, seeded, logged or sent in a sale payload.

## 9. Steps (one per session, each ends reviewable; run all suites after each)

1. Modal: `previewAmount` plus tip, and corrected text. No QR yet.
2. Schema and migration.
3. Routes, `src/lib/payment-qr.ts`, sample QR test fixture, `test:payment-qr`.
4. Owner page `/payment-qr` and the home card.
5. Dexie v3 table, `src/lib/payment-qr-cache.ts`, POS refresh hooks, modal shows the cached QR, `test:qr-cache`.

## 10. Tests

- `test:payment-qr` (needs the server; throwaway barber, sample QR fixture): 401 on `PUT` and `DELETE` without the cookie; 400 for `CASH` or `QRPH`; 404 for an unknown or inactive barber; 415 for non-image bytes sent as `image/png` and for SVG; 413 above 1 MB; after `PUT` the list has the sha, `GET` returns identical bytes, a replace changes the sha, `DELETE` removes it; an inactive barber is not listed; a GCash sale synced after an upload is stored as before.
- `test:qr-cache` (no server): the comparison function downloads when nothing is cached, skips the same sha, replaces a changed sha, deletes what the server removed or what belongs to a barber no longer active.
- All existing suites unchanged, plus `npm run lint` and `npx tsc --noEmit`.

## 11. Manual check, including offline

1. `/payment-qr`: unlock, upload the sample QR as one barber's GCash QR.
2. Phone: open `/pos` online, bind to that barber, enter a custom amount of 300 and a ₱20 tip, tap GCash. The sample QR and ₱300 + ₱20 tip = ₱320 show.
3. Tap Maya: the missing-QR state shows, and the sale can still be confirmed.
4. Airplane mode with the page open: GCash still shows the QR. Rebind to another barber offline: their QR or the missing state shows.
5. Back online, remove the QR on the owner page, reload `/pos`: the missing state shows.

## 12. Wrap-up

- `CLAUDE.md`: add `test:payment-qr` and `test:qr-cache` to the commands and the QR storage rule from §8.
- `docs/sessions/` log per CLAUDE.md.

<!-- END OF SPEC -->

# Slice 5 — PayMongo QR Ph demo (test mode)

Repo: `ruzzco-system`. The gateway sits behind `PAYMENT_GATEWAY` (default `off`). With `off`, the current Ruzzco process is unchanged.
Goal: at the 2026-10-05 consult, show one POS sale paid by QR Ph in PayMongo **test mode**. The server marks it paid through a webhook (or a server-side status check), and it appears in that day's reconciliation.

## 1. Scope boundary (read first)

- This is an advisor-requested demo of a gateway capability. It does **not** change Ruzzco's current process. The locked Business facts stay true: GCash/Maya go to the barber's personal account, and the drawer formula is unchanged.
- Test mode only. Live keys are out of scope, and the app must refuse to start the gateway with a live key (§3).
- Out of scope: refunds, retries of a failed intent on the same sale, live payouts, other gateway methods (card, GCash via gateway), offline QR, removing the ledger, and changes to commission rates.

## 2. Prerequisites (Brent, before "run slice 5")

- A PayMongo account with test keys (`sk_test_...`, `pk_test_...`) from Dashboard → Developers → API Keys. ✅ Verified 2026-10-01 on Brent's unverified Individual account: intent → `qrph` method → attach returned `awaiting_next_action`, and `next_action.code` has `amount`, `expires_at`, `id`, `image_url`, `label`, `test_url`. (The dashboard's "In-store QR PH" static codes are not available in test mode. This slice doesn't use them.)
- A tunnel for webhooks (`cloudflared tunnel --url http://localhost:3000` or ngrok). Register its URL as a test-mode webhook in the dashboard, then copy the webhook secret.
- `web/.env`: `PAYMENT_GATEWAY=paymongo_test`, `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`. Never print, log or commit them. Add the names (no values) to `web/.env.example`.

## 3. Configuration

- `PAYMENT_GATEWAY` = `off` (default) | `paymongo_test`. With `off`, the app behaves exactly like v1: no QR button, and the routes return 404.
- If `PAYMENT_GATEWAY=paymongo_test` and the secret key doesn't start with `sk_test_`, the gateway disables itself and logs one warning without the key's value.
- All PayMongo calls are server-side. The secret key never reaches the client bundle.

## 4. Data model (additive migration, defaults keep old rows valid)

- Payment method enum: add `QRPH`. CASH/GCASH/MAYA are unchanged.
- `Transaction.paymentStatus`: `PAID | PENDING | EXPIRED | FAILED`, default `PAID`. Existing rows and all non-QRPH sales stay `PAID`.
- New `GatewayPayment`: `id`, `transactionId` (the client UUID, unique), `provider` (`PAYMONGO_TEST`), `intentId` (unique), `amount Decimal(10,2)`, `status`, `createdAt`, `paidAt?`, `lastEventId?`.
- New `GatewayWebhookEvent`: `eventId` (unique), `type`, `receivedAt`. Used for idempotency.
- Follow the CLAUDE.md migration procedure (`migrate diff` → review → `migrate deploy`).

## 5. Flow

1. On `/pos`, the cashier picks **QR Ph (test)**. The button only shows when the gateway is on **and** the device is online. Offline, it's disabled with the text "Needs internet. Use cash, GCash or Maya."
2. The sale is written to Dexie as usual (`paymentMethod: QRPH`), then synced immediately through the existing sync route. The server stores every QRPH sale as `PENDING` whatever the client sends. The client never sets `PAID` for QRPH.
3. After sync, the client calls `POST /api/v1/payments/qrph` with the transaction id. The server creates a Payment Intent (`payment_method_allowed: ["qrph"]`), creates a `qrph` Payment Method, and attaches it. Amount = the sale's `totalAmount`, in centavos. Tip is not charged through the gateway in this slice. The server stores `GatewayPayment` and returns the QR image (`next_action.code.image_url`, base64) plus `next_action.code.expires_at`. In test mode it also returns `next_action.code.test_url`. Idempotent: a second call for the same transaction returns the existing open intent.
4. The POS shows the QR, a countdown, and a **Check status** button. In test mode it shows a link to `test_url` for simulating payment.
   - **Never scan a test-mode QR with a real banking app. PayMongo warns that this processes a real transaction.** Put this warning on screen next to the QR.
5. `POST /api/v1/webhooks/paymongo`: verify the `Paymongo-Signature` header against `PAYMONGO_WEBHOOK_SECRET` (HMAC-SHA256, test-mode signature part). Reject anything that fails with 401. Ignore duplicate `eventId`s. On the paid event, set `GatewayPayment.status = PAID`, `paidAt`, and `Transaction.paymentStatus = PAID` in one DB transaction. Claude Code: confirm the exact event names (payment paid / failed / intent expired) in PayMongo's current docs before coding, and list them in the audit.
6. **Check status** (demo fallback if the tunnel fails): the server retrieves the intent from PayMongo and applies the same update as the webhook. The client still never decides payment status.
7. Expiry or failure → `EXPIRED`/`FAILED`. The sale stays as it was (never rewrite its payment). The cashier rings a new sale as cash or GCash if the customer pays another way.

## 6. Business rules (state in plain language and wait for Brent's OK before coding — CLAUDE.md rule)

- Only `PAID` sales count toward revenue, commission, payouts and reconciliation. `PENDING`, `EXPIRED` and `FAILED` count nowhere and are listed separately.
- QRPH commission is the same 50/50 and is snapshotted at sale time like every other sale. The commission base follows the existing `commissionBase` setting.
- Reconciliation: gateway money is **not** in the drawer. Add a separate line, "QR Ph (PayMongo test) collected", next to the GCash/Maya lines. The expected-drawer formula is unchanged.
- Edge cases to confirm: (a) a sale is paid after the business day closes: it counts on its sale's business date (Asia/Manila), and the reconciliation shows it as a late confirmation; (b) the webhook arrives before the sale has synced: the event is stored and applied on sync, or rejected and left to Check status (Claude Code proposes one approach in the audit, and Brent picks); (c) a payout is already saved when a pending sale later becomes PAID: the payout isn't recomputed; the difference shows on the next payout view.

## 7. Invariants still in force

All CLAUDE.md invariants hold, including per-sale sync results, attribution by `assignmentId`, never rewriting rejected sales, `generateUUID()`, and owner-only routes. The new client fields are optional, so old queued payloads still validate.

## 8. Tests and verification

- New `npm run test:gateway` (dev server running, test keys set): signature rejects a bad signature; a duplicate event is a no-op; the paid event flips PENDING→PAID once; the client can't sync a QRPH sale as PAID; a PENDING sale is excluded from commission and reconciliation totals.
- All existing suites, `npm run lint`, `npx tsc --noEmit`.
- With `PAYMENT_GATEWAY=off`: the existing suites pass unchanged and no QR UI appears.

## 9. Two-minute demo script (for the consult)

1. Gateway on, tunnel up. Ring a ₱200 haircut → QR Ph (test) → the QR appears.
2. Open `test_url` → simulate success → within seconds the POS shows Paid (or press Check status).
3. Open the reconciliation for today: the ₱200 sits on the QR Ph line, not in the drawer.
4. Set `PAYMENT_GATEWAY=off` → the QR button is gone; the shop's current cash/GCash/Maya flow is unchanged.

## 10. Wrap-up

- `CLAUDE.md`: add QRPH under Payment methods as gateway-only (switch on), plus the `paymentStatus` rule and the env var names. Business facts stay unchanged.
- `docs/sessions/` log per CLAUDE.md.

<!-- END OF SPEC -->

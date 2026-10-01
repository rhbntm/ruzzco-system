# Ruzzco Barbers System

SPCC BSIT capstone: offline-first mobile POS plus revenue forecasting for Ruzzco Barbers (Caloocan).
Users: Mart (owner) and barbers Bayani (full-time) and Vince (flexible shift). The ML service (`ml-service/`) is not in this repo yet.

@web/AGENTS.md

## Layout and commands

- Repo root: `docker-compose.yml` (MySQL 8, host port 3307, db `ruzzco_db`) and `web/`.
- `web/`: Next.js 16.3.5 (App Router, Turbopack), React 19, Tailwind 4, Prisma 6 (MySQL), Dexie 4, Zod 4.
- Run from `web/`: `npm run dev`, `npm run lint`, `npm run build`, `npm run start`, `npx prisma migrate deploy`, `npx prisma db seed`, `npm run test:attribution`, `npm run test:sync-rejections`, `npm run test:commission`, `npm run test:reconciliation` and `npm run test:gateway` (need the dev server; gateway: started with the gateway env vars), `npm run test:submit-lock`.
- `web/.env` needs `DATABASE_URL` and `OWNER_PIN`; the optional QR Ph demo uses `PAYMENT_GATEWAY` (`off` default | `paymongo_test`), `PAYMONGO_SECRET_KEY` (must be `sk_test_`) and `PAYMONGO_WEBHOOK_SECRET`. Never print, log, or commit their values.
- Next.js 16 differs from older versions. Read `node_modules/next/dist/docs/` before using an API you are unsure about.

## Business facts (locked)
Code must respect these. Don't build features from this list unless a slice spec asks for them. Reasoning lives in `../ruzzco-barbers` (`20_Decisions/`, `30_Meetings/`); link there, don't copy it here.
- Haircut: fixed ₱200. Shave & Massage: ₱150. Other services vary in price.
- Commission: 50/50 between barber and owner. Commissions and payouts are snapshotted at transaction time, never recomputed from current rates.
- No PWD or student discounts. Loyalty card: 50% off the 6th and 7th haircuts, then it resets.
- Digital payments (GCash/Maya) go to the barber's personal account.
- Forecasting target: customers per day. Revenue is derived from it.
- Business dates use Asia/Manila (UTC+8). Never derive them from UTC defaults.
- The shop has 2 active barbers (2026-09-25 interview). Never hardcode the roster or its size.
- Open 10 AM-10 PM daily, including holidays.

## Environment (Windows)
- Shell is Windows PowerShell. Claude settings live in `.claude/settings.json`; never create `.claudesettings.json` or other variants.
- MySQL runs in Docker (host port 3307). Before seeding, migrating or querying, run `docker ps`; if the container is down, tell me instead of failing midway.
- Before `prisma generate` or `prisma migrate`, check whether the dev server is running (it locks the Prisma engine, EPERM). Ask me to stop it; don't retry.
- When writing files from Python or PowerShell, set UTF-8 explicitly (`encoding='utf-8'`, `-Encoding utf8`).
- Never run `prisma db push`, `prisma migrate dev`, or `prisma migrate reset`. Never kill node processes, never delete `.next` wholesale.
- Schema changes are additive with defaults and committed as migrations in `web/prisma/migrations/` (baseline `0_init`). Write the SQL with `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` (from Git Bash, to avoid a BOM), review it, apply with `npx prisma migrate deploy`. See README.

## Git
- Never add `Co-Authored-By: Claude` trailers or other Claude attribution to commits.
- Commit on `main` unless told otherwise. Check the current branch before committing.
- Commit only when I ask. Never push, force-push or rewrite history without explicit confirmation.
- One tool commits at a time. If `.git/index.lock` exists, check `Get-Process git` before removing it.

## How to work
- One task per session. When done: show a diff summary and a 2-minute manual test, then stop.
- Verify with `npm run lint`. Run `npm run build` only when I ask.
- Don't read `packed.md` (repo root), `.env`, or `tsconfig.tsbuildinfo`. Outside slice audits, grep and open only the files you edit.
- **Slices:** specs live in `docs/slices/slice-N.md`. On "run slice N": read the file in full, tell me the last section number and confirm the `<!-- END OF SPEC -->` marker, do a read-only audit before any edits, then implement, verify (all test suites, `npm run lint`, `npx tsc --noEmit`) and report. If the slice is already implemented, say so instead of redoing it.
- **Business rules before code:** before attribution, commission, payout or reconciliation logic, state the rule in plain language with 3 edge cases and wait for my OK.
- **Where things go:** how to build it (specs, conventions, environment) → this repo. What was decided and why → `../ruzzco-barbers`, following its folder and naming (`20_Decisions/YYYY-MM-DD-kebab-title.md`).
- **"Wrap up":** record the session's decisions in `../ruzzco-barbers` with reasoning, update Business facts if one changed, show me the changes in both repos, and commit each repo only after I OK it.

## Invariants (do not break)

- Offline-first: the POS writes to Dexie first and syncs through `POST /api/v1/transactions/sync`. The client UUID is the idempotency key. New client fields must be optional or defaulted so old queued payloads still validate. Bump the Dexie version only when adding an index.
- Attribution is fixed at sale time. Each binding is a `DeviceAssignment` whose id the phone generates; every new sale stores that `assignmentId` and the device key. The server attributes a sale to its assignment's barber, never to the device's current binding, so a rebind can never move historical sales. Revoked assignments stay valid for their sales. A claimed `barberId` that differs from the assignment's is overridden and logged to `SyncMismatchLog`. Never default a commission rate.
- Sync results are per sale. The request shape is validated once; each item is validated and processed on its own, so one bad sale never blocks the valid ones in the batch. The server never inserts a rejected sale (nor an orphan mismatch log) and answers `{ syncedIds, rejected: [{ id, reason }] }` with reason `INVALID` (malformed data, or the database refuses it: unknown service, value too long or out of range), `UNKNOWN_BARBER` (replaces the old batch-wide 400), `DEVICE_MISMATCH` or `ASSIGNMENT_UNAVAILABLE`. Only a bad outer shape returns 400.
- Rejected sales stay in Dexie unchanged (`syncError` = the reason; pending = unsynced without it, rejected = unsynced with it). They are excluded from automatic sync and shown as "needs attention" on `/pos` and `/shift-log`. Only an explicit Retry (`clearRejection`, then a normal sync) re-queues one, and it may be rejected again. Never rewrite a rejected sale's id, barber, assignment, amount or payment as a fix.
- Only `POST /api/v1/devices/bind` creates an active assignment (revoke-and-create in one transaction, idempotent by id, never reactivates). Sync may only register an unknown assignment from its sales, and only as already revoked; it never touches the active binding. The client syncs the pending current assignment's sales only after its bind succeeds (`web/src/lib/sync.ts`).
- `cashierId` = the assignment's barber for assignment-backed sales. Legacy sales without `assignmentId` keep their stamped `barberId`, get `cashierId = null`, and are never overridden by the current binding.
- Use `generateUUID()` from `src/lib/db.ts`, not `crypto.randomUUID()` (LAN HTTP is not a secure context).
- Owner-only: `/ledger` and the payout and reconciliation write routes need the `OWNER_PIN` cookie (`ruzzco_owner_access`, HttpOnly). The Secure flag follows the request protocol.
- Money is `Decimal(10,2)`. `totalAmount` is the amount paid, excluding tip. Tips are separate, go 100% to the barber, and are excluded from revenue and the commission base. Revenue is `amountPaid`. `commissionBase` defaults to `LIST_PRICE` (the shop absorbs discounts). The ledger recomputes with a LIST_PRICE/AMOUNT_PAID toggle.
- Expected drawer cash = cash sales + cash tips - cash payouts - petty cash. GCash and Maya are digital and are not in the drawer.
- Payment methods: CASH, GCASH, MAYA. QRPH is gateway-only (PayMongo test mode, `PAYMENT_GATEWAY=paymongo_test`); with the switch off it never appears.
- `Transaction.paymentStatus`: PAID | PENDING | EXPIRED | FAILED. Non-gateway sales are always PAID. A QRPH sale is stored PENDING whatever the client sends; only the server (signed webhook or Check status against PayMongo) changes it. Only PAID sales count toward revenue, commission, payouts and reconciliation; the rest are listed separately. Gateway money is never in the drawer.

## Session log (required)

Before a session ends, or when I say "log", append to docs/sessions/YYYY-MM-DD.md:

- What changed (features/files), commit hashes if committed
- Decisions made and why; tag [AI proposal] anything I didn't confirm
- Open questions and blockers
  Under ~20 lines. Never rewrite earlier entries.

## Client rules
Confirmed (one self-filled form, 2026-09-23): daily payout before the barber goes home; the shop absorbs discounts; tips 100% to the barber; petty cash is logged as expenses; payments via cash, GCash, Maya; bundles and custom amounts exist; barbers use both personal phones and a shared device.

Unconfirmed. Keep as settings, do not hardcode: the discount base (list vs paid), whether petty cash is shared or shop-only, retail commission, tip channel, and whether Mart also cuts hair (he is still seeded as an active barber).

Conflicts to resolve: the POS "Senior/PWD −20%" button and the `demo-senior-pwd` demo row contradict the no-PWD, loyalty-only discount rule. The advisor (2026-09-28) asked to add a payment gateway and remove the ledger. Keep cash reconciliation either way.

## Data caveats (ML)
In the Dec-Feb dataset, dates and cuts per day are real. The ₱100 per row is the owner's 50% share of the cut, not the price. The haircut price was ₱180 until 2025-09-20 and ₱200 from 2025-09-21. Haircut type, payment method, and customer names are generated or randomized. Never use `haircut_type` or `payment_method` as features or present them as real. Forecast customer counts, then multiply by the current price.

## Known gaps

- No service worker or manifest: offline means the queue only, and the page must stay open.
- Counter-station mode, attendance and roster, and inventory are not built.
- The "Save payout" UX is unclear. The demo seed is placeholder data only.
- Loyalty-card discounts are not built.

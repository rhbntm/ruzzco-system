# Ruzzco Barbers System

SPCC BSIT capstone: offline-first mobile POS plus revenue forecasting for Ruzzco Barbers (Caloocan).
Users: Bayani (owner and barber) and Mart (co-owner). The ML service (`ml-service/`) is not in this repo yet.

@web/AGENTS.md

## Layout and commands
- Repo root: `docker-compose.yml` (MySQL 8, host port 3307, db `ruzzco_db`) and `web/`.
- `web/`: Next.js 16.3.5 (App Router, Turbopack), React 19, Tailwind 4, Prisma 6 (MySQL), Dexie 4, Zod 4.
- Run from `web/`: `npm run dev`, `npm run lint`, `npm run build`, `npm run start`, `npx prisma db push`, `npx prisma db seed`.
- `web/.env` needs `DATABASE_URL` and `OWNER_PIN`. Never print, log, or commit their values.
- Next.js 16 differs from older versions. Read `node_modules/next/dist/docs/` before using an API you are unsure about.
- Shell is Windows PowerShell.

## How to work
- One task per session. When done: show a diff summary and a 2-minute manual test, then stop. Commit only when I say so. Never push unless I ask.
- Verify with `npm run lint`. Run `npm run build` only when I ask.
- Grep and open only the files you edit. Do not read `packed.md` (repo root), `.env`, or `tsconfig.tsbuildinfo`.
- Never run `prisma db push --accept-data-loss` or `prisma migrate reset`. Never kill node processes, never delete `.next` wholesale.
- `prisma generate` can fail with EPERM on Windows while the dev server runs. Ask me to stop it.
- Schema changes are additive with defaults, applied with plain `npx prisma db push`.

## Invariants (do not break)
- Offline-first: the POS writes to Dexie first and syncs through `POST /api/v1/transactions/sync`. The client UUID is the idempotency key. New client fields must be optional or defaulted so old queued payloads still validate. Bump the Dexie version only when adding an index.
- Device binding: the server-side binding overrides the client `barberId`, and mismatches go to `SyncMismatchLog`. An unknown `barberId` returns 400. Never default a commission rate.
- Use `generateUUID()` from `src/lib/db.ts`, not `crypto.randomUUID()` (LAN HTTP is not a secure context).
- Owner-only: `/ledger` and the payout and reconciliation write routes need the `OWNER_PIN` cookie (`ruzzco_owner_access`, HttpOnly). The Secure flag follows the request protocol.
- Business date is Asia/Manila (UTC+8). Never use UTC day boundaries.
- Money is `Decimal(10,2)`. `totalAmount` is the amount paid, excluding tip. Tips are separate, go 100% to the barber, and are excluded from revenue and the commission base. Revenue is `amountPaid`. Commission is snapshotted per transaction (`commissionBase` defaults to `LIST_PRICE`; the shop absorbs discounts). The ledger recomputes with a LIST_PRICE/AMOUNT_PAID toggle.
- Expected drawer cash = cash sales + cash tips - cash payouts - petty cash. GCash and Maya are digital and are not in the drawer.
- Payment methods: CASH, GCASH, MAYA.

## Client rules
Confirmed (one self-filled form, 2026-09-23): 50/50 commission; daily payout before the barber goes home; the shop absorbs discounts; tips 100% to the barber; petty cash is logged as expenses; payments via cash, GCash, Maya; bundles and custom amounts exist; barbers use both personal phones and a shared device.

Unconfirmed. Keep as settings, do not hardcode: the discount base (list vs paid), whether petty cash is shared or shop-only, retail commission, tip channel, current haircut price (the app uses 150, the client may charge 200), and the roster (only Mart and Bayani are seeded; the shop has 5 barbers).

## Data caveats (ML)
In the Dec-Feb dataset, dates, cuts per day, and the 100-peso price are real. Haircut type, payment method, and customer names are generated or randomized. Never use `haircut_type` or `payment_method` as features or present them as real. Forecast cut counts, then multiply by the current price, because the price changed after this data.

## Known gaps
- No service worker or manifest: offline means the queue only, and the page must stay open.
- Counter-station mode, attendance and roster, and inventory are not built.
- The "Save payout" UX is unclear. The demo seed is placeholder data only.

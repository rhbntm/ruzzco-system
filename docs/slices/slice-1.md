# Slice 1 — The Core Cut: offline POS, one haircut, idempotent batch sync

Repo: `ruzzco-system`, branch `main`. Shipped 2026-09-20 (`736449d`, fix `5cbca2a`); builds on slice 0, the walking skeleton (2026-09-19, `c9afa80`: Next.js, Prisma, MySQL in Docker, `/api/v1/health`).
**Documentation of shipped work, not a build instruction.** Written on 2026-10-11 from the commit history, `prisma/schema.prisma` and the current code. It records what was built and what has changed since. Nothing was re-run for it beyond reading the code.
What it delivers: a barber on a phone records a haircut with no signal, sees it at once, and the sale reaches MySQL exactly once when the phone is back online.

## 1. Scope boundary

- Built: the `/pos` page, a Dexie (IndexedDB) store, `POST /api/v1/transactions/sync`, a catalog read route, atomic commission snapshots.
- Not in this slice: device binding, cashier attribution, other payment methods, reconciliation, tips, discounts, owner pages, the forecast.
- The stack decision (Next.js + Prisma + MySQL instead of Laravel, 2026-09-19) is recorded in `../ruzzco-barbers/20_Decisions/2026-09-19-pivot-from-laravel-to-nextjs-prisma.md`.

## 2. Decisions

1. **Offline first, client UUID as the idempotency key.** The phone writes to Dexie before anything else; the sale id is generated on the phone. The server inserts a sale once however often it is sent (`../ruzzco-barbers/20_Decisions/2026-09-14-offline-first-pos-architecture.md`).
2. **Commission is snapshotted at sale time** in the same database transaction as the sale: 50/50, stored on the sale and in `CommissionLog`, never recomputed from current rates.
3. **Zero-friction mobile use.** No login on the POS: barbers record cuts between clients on personal phones. Credentials are isolated to the owner portal (later slice 3).
4. **Fail loudly on an unknown barber** (added in `5cbca2a`, 2026-09-20): the sync route answered 400 for an unrecognised `barberId` instead of defaulting a commission rate. *Replaced later by a per-sale `UNKNOWN_BARBER` rejection (see §4).*

## 3. What shipped

- **Client:** `web/src/lib/db.ts` (`RuzzcoPOSDatabase`: `transactions`, `barbers`, `services`, Dexie version 1), an offline-start fallback catalog, `/pos` (touch targets, one-tap barber switcher, online badge, auto-sync on reconnect, today's cuts with sync status). The home page got a launch button and live counts.
- **API:** `POST /api/v1/transactions/sync` (Zod-validated in `src/lib/schemas.ts`; duplicate ids acknowledged without a second row; sale, `TransactionItem` and `CommissionLog` written together) and `GET /api/v1/catalog` (barbers and services for the phone's cache).
- **Verification at the time:** `scripts/test-sync-idempotency.ts` (one insert, correct commission, no duplicate on resend); lint clean; Turbopack production build.

## 4. Changed since

- The barber switcher was replaced by device binding (slice 2); the sync route attributes sales by assignment (slice 4, step 4.5).
- Sync results became per sale with `rejected` reasons and a 500-sale batch cap, and phones send 50 per request (`cbd3cda`, `834ab56`); see CLAUDE.md Invariants.
- The fallback catalog (₱150 haircut, a beard trim) no longer matches the shop; the seed uses Haircut ₱200 and Shave & Massage ₱150 (`3b75ad8`). The first catalog still listed the owner as a barber; new databases now seed the owner inactive (`e10d3e6`).
- `test-sync-idempotency.ts` was deleted (`61b6973`): it copied this slice's logic instead of calling the route. Idempotency is covered by `test:commission` and `test:sync-rejections`.
- Money fields beyond `totalAmount` came with slice 4; the Dexie store is now at version 3 (v2 device bindings, v3 payment-QR cache).

## 5. Tests that cover this slice today

`npm run test:commission`, `test:sync-rejections`, `test:payload-compat` (queued shapes from every era still validate), `test:sync-queue` and `test:api-errors`. Plus `npm run lint` and `npx tsc --noEmit`.

## 6. How to verify

1. Start the dev server and open `/pos` on a phone on the LAN. Turn on airplane mode, record a cash haircut: it appears in today's cuts as unsynced.
2. Reconnect: it syncs once; send it again from the browser console or reload: still one row in MySQL.
3. The stored sale has its commission amount and a `CommissionLog` row.

## 7. Sources

- Decision records in `../ruzzco-barbers/20_Decisions/`: 2026-09-14 offline-first architecture, 2026-09-19 stack pivot.
- Commits `c9afa80`, `736449d`, `5cbca2a`.

<!-- END OF SPEC -->

# Production handover checklist

Required (slice 19 §7.7, gap S6). The shop does not run this version until every item below is done and signed off. Until item 1 is done, the owner PIN opens the owner pages (the PIN cookie counts as owner access only while no active owner account exists).

Fill in each line with the date and who did it. Keep the passwords themselves out of this file.

## 1. Create Mart's owner account

On `/staff` (opened with the owner PIN while no owner account exists), create Mart's `OWNER` account with a username and a password he chooses.

- Done on: ____________ by: ____________

## 2. Verify on the shop PC (each item checked)

- [ ] The old PIN can't unlock owner pages: press Lock, then the PIN unlock answers "Sign in with your owner account" (409 `OWNER_ACCOUNT_EXISTS`).
- [ ] A PIN cookie issued before item 1 can't bypass it: a browser that unlocked with the PIN before item 1 gets the sign-in screen on `/ledger` and 401 on an owner route.
- [ ] The owner account works: signing in with Mart's account opens `/ledger`, `/staff`, `/devices` and the forecast.
- [ ] A barber account can't: signed in as a barber, `/`, `/about` and every owner page land on `/pos` (slice 19 §7.13), and owner routes answer 401.
- [ ] `DEVICE_APPROVAL_PIN` in `web/.env` is set and differs from `OWNER_PIN`. When they are equal the app ignores the approval PIN (only the owner PIN approves phones), and whoever is given "the approval PIN" holds the owner PIN. Check without showing either value, from `web/`: `node -e "require('@next/env').loadEnvConfig(process.cwd()); const a = process.env.DEVICE_APPROVAL_PIN, o = process.env.OWNER_PIN; console.log(a && a !== o ? 'OK: set and different' : 'NOT OK: unset or equal to OWNER_PIN')"`. `npm run test:device-approval` also refuses to start when they are equal.

- Verified on: ____________ by: ____________

## 3. Barber accounts

Create one account per barber on `/staff`.

- Done on: ____________ by: ____________

## 4. Phones provisioned under the owner's supervision

A newly approved phone with no assignment is assigned to whoever signs in on it first while online (slice 19 §2 case 7). So the owner (or the person he names) approves each phone, watches its barber do that first sign-in, and checks the barber's name on the POS before handing it over. A phone approved with the approval PIN and left unassigned could otherwise be claimed by another barber.

| Phone | Barber | Approved and first sign-in watched on | By |
|---|---|---|---|
| | | | |
| | | | |

## 4b. Installed phones take the new version

The POS on each phone is a stored copy (service worker `VERSION` 4). On each barber's installed phone that ran the previous version: open the app once on the shop Wi-Fi (production server and `npm run https` running), then turn Wi-Fi off and reopen it. `/pos` and `/shift-log` open, the barber is still signed in, and the POS shows no link to the home page or End-of-Day Cash. Checked on desktop Chrome only so far (slice 19 §7.13); do it on at least one Android phone and one iPhone if both are used.

| Phone | Barber | Updated and opened offline on | By |
|---|---|---|---|
| | | | |

## 5. Recovery

Tell Mart about `npm run owner:reset-password` on the shop PC for a forgotten owner password (it asks on the terminal, never as an argument).

- Told on: ____________ by: ____________

## Also covered automatically

- `npm run test:owner-unlock`: the 409 once an owner account exists, and no cookie.
- `npm run test:authz`: a PIN cookie gets 401 on every owner route once an owner account exists.

## Sign-off

- All items done. Signed off on: ____________ by: ____________

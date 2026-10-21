# Ruzzco Barbers System (`ruzzco-system`)

> **Sales Management and Revenue Forecasting Decision Support System for Ruzzco Barbers Using Random Forest Regression**  
> _Systems Plus Computer College (SPCC) — BSIT Capstone Project_

---

## 🛠️ Tech Stack & Architecture

- **Full-Stack Application (`web/`):** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, Prisma ORM, Dexie.js (IndexedDB).
- **Database (`ruzzco-mysql`):** MySQL 8.0 running containerized on Docker (mapped to host port `3307`).
- **ML Engine (`ml-service/`):** Python, FastAPI, Scikit-Learn (Random Forest Regression).

---

## 🚀 Quick Start Guide

### One-click start (Windows)

Double-click `start-ruzzco.cmd` in the repo root (or run `scripts\start-ruzzco.ps1`). It does steps 1 to 5 below for you:

- **Installs what's missing:** offers to install Node.js, Docker Desktop and Git for Windows with winget, and asks first.
- **Starts the services:** starts Docker Desktop and MySQL.
- **Creates settings:** fills in missing `.env` files (new database passwords; it asks for the owner PIN and never prints either).
- **Prepares the code:** runs `npm ci` when `package-lock.json` changed, applies new migrations and seeds an empty database.
- **Starts the app:** starts the forecast service when a model is trained, builds the app when the code changed, then starts it with the HTTPS gateway for phones.
- **Prints the addresses** for this PC and the phones.

Leave the window open. Ctrl+C or closing the window stops the app; MySQL keeps running in Docker.

Options:

- `-Dev`: `next dev` instead of a production build.
- `-Rebuild`: build even when nothing changed.
- `-NoHttps`: skip the HTTPS gateway for phones.
- `-NoForecast`: skip the forecast service.
- `-NoBrowser`: don't open the app on this PC.
- `-Yes`: install without asking.
- `-Stop`: stop the app, the gateway and the containers.

Pass options on the command line, for example `start-ruzzco.cmd -Dev`. Logs are in `%TEMP%\ruzzco\`.

The steps below do the same by hand.

### 1. Start the MySQL Database

Ensure Docker Desktop is running, then run:

```bash
cp .env.example .env         # Set the MySQL passwords (repo root, not committed)
docker compose up -d mysql
```

MySQL reads these passwords only when its volume is first created; changing `.env` later does not change an existing database.

_Note: MySQL runs on port `3307` locally to prevent conflicts with default port `3306`._

### 2. Configure Environment & Database

```bash
cd web
cp .env.example .env         # DATABASE_URL: the user and password from the root .env, port 3307
npx prisma migrate deploy    # Apply the migrations in prisma/migrations
npx prisma db seed           # Seed barbers (Bayani, Vince; Mart inactive) and services
```

**Schema changes** are committed as migrations. Do not use `prisma db push` or `prisma migrate dev` (it can offer to reset the database on drift). Edit `prisma/schema.prisma`, then generate the SQL from the live database, review it, and apply it (run the redirect in Git Bash; Windows PowerShell 5.1 redirection writes a BOM or UTF-16):

```bash
mkdir prisma/migrations/<YYYYMMDDHHMMSS>_<name>
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql
npx prisma migrate deploy
npx prisma generate          # stop the dev server first on Windows (EPERM)
```

_Existing databases created with `db push` before migrations existed: run `npx prisma migrate resolve --applied 0_init` once (after checking `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma` shows only the changes in later migrations), then `npx prisma migrate deploy`._

**Attribution tests** (dev server running): `npm run test:attribution`. The fresh-database migration check also needs `TEST_ADMIN_DATABASE_URL` set to a MySQL user that can create databases, such as the local Docker root user.

### 3. Run the Development Server

```bash
cd web
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the POS, or test the API health route at [http://localhost:3000/api/v1/health](http://localhost:3000/api/v1/health).

### 4. Forecasting service (optional)

From the repo root, with the logbook workbook in `ml-service/data/` (not committed):

```bash
docker compose run --rm ml-service python train.py   # train and write ml-service/artifacts/
docker compose up -d ml-service                       # serve on http://localhost:8001
```

Commands, tests and the rules around the forecast are in `CLAUDE.md`.

### 5. Install on phones as an app (optional, HTTPS)

Phones normally open the POS at `http://<PC address>:3000`. Installed as an app (a PWA), the POS and the shift log also open when the shop PC can't be reached: opened while the PC doesn't answer, the app goes straight to the POS within about 5 seconds. Installing needs HTTPS, so run the app in production and put the HTTPS gateway in front of it:

```bash
cd web
npm run build && npm run start   # production; under npm run dev, pages only start while the dev server answers
npm run https                    # second terminal: https://ruzzco.local:3443, phone setup at http://ruzzco.local:3080
```

On each phone, once, on the same Wi-Fi as the PC: open `http://ruzzco.local:3080` (or the number address `npm run https` prints, `http://<PC address>:3080`), install the shop certificate as the page explains, then tap the app address the page offers and install the app (Android Chrome: menu, Install app; iPhone Safari: Share, Add to Home Screen).

- **Any Wi-Fi.** `ruzzco.local` is the PC's name on whatever network it is on: `npm run https` answers for it (multicast DNS, `web/scripts/mdns-responder.mjs`, nothing to install). An app installed from `https://ruzzco.local:3443` finds the PC on any Wi-Fi the phone and the PC share, whenever both servers run, even after the PC's address changes. The setup page checks whether the phone can find the name and only offers the number address when it can't. An app installed by number stops reaching the PC when its address changes (another Wi-Fi), and needs installing again from there.
- **When the name doesn't work:** older phones can't look up `.local` names, and Android can't while it is the hotspot itself or on mobile data; use another phone's hotspot or a router. If the PC's Wi-Fi has IPv6 switched off, Android takes about 2 seconds longer to find the name. With two PCs running Ruzzco on one network, give one its own name: `RUZZCO_LOCAL_NAME=ruzzco-2.local` (the proxy warns when another device answers to its name). `npm run test:local-name` checks the name answers; add `-- --live` to ask the network the way an Android phone does while `npm run https` runs.
- **On the PC itself** use `http://localhost:3000`. The name is for other devices: Windows ignores the answers coming from its own address. Antivirus HTTPS scanning (Avast's Web Shield, for one) also re-signs HTTPS opened on the PC, so the HTTPS addresses show a certificate warning there; phones aren't affected.
- **Windows Firewall:** Windows treats a Wi-Fi it hasn't seen before as public and blocks phones there. Run `scripts\phone-firewall.ps1` once (it asks for administrator rights): it lets Node.js take the Ruzzco ports (TCP 3000, 3443, 3080 and UDP 5353) from devices on the same local network, on any Wi-Fi. `-Remove` takes the rules out. Without it, set each new network to Private. On public Wi-Fi (a cafe), guests on that network can then reach the app while it runs; owner pages still need the owner PIN. An antivirus firewall (Avast's, for one) filters on its own: if phones still can't connect, allow Node.js there or mark the network as private or trusted in it.
- `npm run https` creates a certificate authority for this PC in `web/certs/` (git-ignored). Never commit or share it. It can only sign private network addresses and `.local` names, and a new name or PC address only needs a new certificate from the same authority (made automatically, also when the PC joins another network while it runs), not a new install on the phones.
- Each address (`http://<PC address>:3000`, `https://<PC address>:3443`, `https://ruzzco.local:3443`) is its own device for the POS, with its own sales queue. Sync everything on the old address before switching a phone; the barber then picks their name again.
- The service worker (`web/public/sw.js`) keeps copies of `/pos`, `/shift-log` and their files only: never owner pages, the home page or `/api` data, and it never touches the sync POST. Set `NEXT_PUBLIC_SERVICE_WORKER=off` to remove it from phones.
- On any phone, installed or not, the POS and the shift log say when the shop PC can't record sales and how many sales are on the phone only (`web/src/components/ShopPcStatus.tsx`, which asks `/api/v1/health` every 15 seconds while the page is open). When the PC answers again, they send the waiting sales at once.

Want to contribute? Fork the repo and follow [CONTRIBUTING.md](CONTRIBUTING.md).

---

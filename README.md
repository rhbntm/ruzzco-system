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

### 1. Start the MySQL Database

Ensure Docker Desktop is running, then run:

```bash
docker compose up -d mysql
```

_Note: MySQL runs on port `3307` locally to prevent conflicts with default port `3306`._

### 2. Configure Environment & Database

```bash
cd web
cp .env.example .env         # Verify DATABASE_URL matches port 3307
npx prisma migrate deploy    # Apply the migrations in prisma/migrations
npx prisma db seed           # Seed initial barbers (Mart, Bayani) and services
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

Open [http://localhost:3000](http://localhost:3000) to view the Slice 0 Walking Skeleton, or test the API health route at [http://localhost:3000/api/v1/health](http://localhost:3000/api/v1/health).

---

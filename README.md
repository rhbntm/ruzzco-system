# Ruzzco Barbers System (`ruzzco-system`)

> **Offline-First Mobile POS & Revenue Forecasting Decision Support System**  
> _Systems Plus Computer College (SPCC) — BSIT Capstone Project_

---

## 🛠️ Tech Stack & Architecture

- **Full-Stack Application (`web/`):** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, Prisma ORM, Dexie.js (IndexedDB).
- **Database (`ruzzco-mysql`):** MySQL 8.0 running containerized on Docker (mapped to host port `3307`).
- **ML Engine (`ml-service/`):** Python, FastAPI, Scikit-Learn (Random Forest time-series forecasting).

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
cp .env.example .env    # Verify DATABASE_URL matches port 3307
npx prisma db push      # Sync schema to MySQL
npx prisma db seed      # Seed initial barbers (Mart, Bayani) and services
```

### 3. Run the Development Server

```bash
cd web
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the Slice 0 Walking Skeleton, or test the API health route at [http://localhost:3000/api/v1/health](http://localhost:3000/api/v1/health).

---

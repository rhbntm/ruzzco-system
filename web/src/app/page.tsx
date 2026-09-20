import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Scissors, ArrowRight, Database, Users, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let dbStatus = "Checking...";
  let dbConnected = false;
  let barbers: Array<{ id: string; fullName: string; commissionRate: unknown }> = [];
  let services: Array<{ id: string; name: string; standardPrice: unknown }> = [];
  let transactionCount = 0;
  let errorMessage = "";

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbConnected = true;
    dbStatus = "Connected (MySQL 8.0 @ localhost:3307)";
    barbers = await prisma.barber.findMany({ where: { isActive: true } });
    services = await prisma.service.findMany({ where: { isActive: true } });
    transactionCount = await prisma.transaction.count();
  } catch (err) {
    dbConnected = false;
    dbStatus = "Database Connection Failed";
    errorMessage = err instanceof Error ? err.message : "Unknown error connecting to MySQL";
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans antialiased selection:bg-amber-500 selection:text-black">
      {/* Glow highlight */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-96 bg-gradient-to-b from-amber-500/10 via-transparent to-transparent blur-3xl pointer-events-none" />

      <main className="relative max-w-5xl mx-auto px-6 py-12 sm:py-16 space-y-12">
        {/* Header */}
        <header className="space-y-4 border-b border-zinc-800/80 pb-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium tracking-wide uppercase">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Slice 1 Active: The Core Cut
            </div>
            <div className="flex items-center gap-4 text-xs font-mono">
              <Link
                href="/api/v1/health"
                target="_blank"
                className="text-zinc-400 hover:text-amber-400 transition-colors flex items-center gap-1"
              >
                <span>GET /api/v1/health</span>
                <span className="text-zinc-600">↗</span>
              </Link>
              <Link
                href="/api/v1/catalog"
                target="_blank"
                className="text-zinc-400 hover:text-amber-400 transition-colors flex items-center gap-1"
              >
                <span>GET /api/v1/catalog</span>
                <span className="text-zinc-600">↗</span>
              </Link>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <div className="space-y-2">
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
                Ruzzco Barbers System
              </h1>
              <p className="text-zinc-400 text-sm sm:text-base max-w-2xl leading-relaxed">
                Offline-First Mobile POS &amp; Revenue Forecasting Decision Support System.
                Unified monorepo powered by Next.js App Router, Prisma ORM, MySQL 8.0, and FastAPI.
              </p>
            </div>

            {/* Direct Mobile POS Action Button */}
            <Link
              href="/pos"
              className="inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-bold text-sm shadow-lg shadow-amber-500/20 transition-all shrink-0 cursor-pointer"
            >
              <Scissors className="w-4 h-4 stroke-[2.5]" />
              <span>Launch Mobile POS</span>
              <ArrowRight className="w-4 h-4 stroke-[2.5]" />
            </Link>
          </div>
        </header>

        {/* Database & Environment Status Card */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-5 rounded-xl bg-zinc-900/70 border border-zinc-800 backdrop-blur-sm space-y-2">
            <div className="flex items-center justify-between text-xs font-medium text-zinc-400 uppercase tracking-wider">
              <span>Database Engine</span>
              <Database className="w-4 h-4 text-zinc-500" />
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  dbConnected
                    ? "bg-emerald-400 shadow-sm shadow-emerald-400/50"
                    : "bg-rose-500"
                }`}
              />
              <span className="font-semibold text-white text-sm">MySQL 8.0 (Docker)</span>
            </div>
            <p className="text-xs text-zinc-400 font-mono truncate">{dbStatus}</p>
            {errorMessage && (
              <p className="text-xs text-rose-400 font-mono mt-2 bg-rose-950/40 p-2 rounded border border-rose-900/50">
                {errorMessage}
              </p>
            )}
          </div>

          <div className="p-5 rounded-xl bg-zinc-900/70 border border-zinc-800 backdrop-blur-sm space-y-2">
            <div className="flex items-center justify-between text-xs font-medium text-zinc-400 uppercase tracking-wider">
              <span>Active Staff &amp; Catalog</span>
              <Users className="w-4 h-4 text-zinc-500" />
            </div>
            <div className="text-2xl font-bold text-white">
              {barbers.length} Barbers <span className="text-sm font-normal text-zinc-400">/ {services.length} Services</span>
            </div>
            <p className="text-xs text-zinc-400 truncate">
              {barbers.map((b) => b.fullName).join(", ") || "None seeded"}
            </p>
          </div>

          <div className="p-5 rounded-xl bg-zinc-900/70 border border-zinc-800 backdrop-blur-sm space-y-2">
            <div className="flex items-center justify-between text-xs font-medium text-zinc-400 uppercase tracking-wider">
              <span>Cloud Synced Cuts</span>
              <Sparkles className="w-4 h-4 text-amber-500" />
            </div>
            <div className="text-2xl font-bold text-amber-400">
              {transactionCount} Records
            </div>
            <p className="text-xs text-zinc-400">
              Idempotent batch sync active via Dexie + MySQL
            </p>
          </div>
        </section>

        {/* Vertical Slice Roadmap */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-white tracking-tight">
            Vertical Slice Implementation Roadmap
          </h2>
          <div className="grid grid-cols-1 gap-3">
            {/* Slice 0 */}
            <div className="p-4 rounded-lg bg-emerald-950/20 border border-emerald-500/30 flex items-start gap-3.5">
              <div className="mt-0.5 w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs font-bold shrink-0">
                ✓
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-emerald-300">
                    Slice 0: Walking Skeleton &amp; Environment Foundation
                  </span>
                  <span className="text-[10px] font-medium bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded uppercase">
                    Completed
                  </span>
                </div>
                <p className="text-xs text-zinc-400">
                  Containerized MySQL 8.0 on Docker, Next.js App Router scaffolded with Prisma ORM, verified health check route, and initial seed execution.
                </p>
              </div>
            </div>

            {/* Slice 1 */}
            <div className="p-4 rounded-lg bg-emerald-950/20 border border-emerald-500/30 flex items-start gap-3.5">
              <div className="mt-0.5 w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs font-bold shrink-0">
                ✓
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-emerald-300">
                    Slice 1: The Core Cut — Single Cash Haircut &amp; Offline Sync
                  </span>
                  <span className="text-[10px] font-medium bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded uppercase">
                    Completed
                  </span>
                </div>
                <p className="text-xs text-zinc-400">
                  2-tap mobile POS checkout flow (`/pos`), Dexie.js IndexedDB client queue, client-side UUID generation, and idempotent batch sync endpoint (`POST /api/v1/transactions/sync`).
                </p>
              </div>
            </div>

            {/* Slice 2 */}
            <div className="p-4 rounded-lg bg-zinc-900/60 border border-zinc-800 flex items-start gap-3.5">
              <div className="mt-0.5 w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-xs font-bold shrink-0">
                2
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">
                    Slice 2: GCash &amp; Daily Cash Reconciliation (&quot;Abono&quot;)
                  </span>
                  <span className="text-[10px] font-medium bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded uppercase">
                    Up Next
                  </span>
                </div>
                <p className="text-xs text-zinc-400">
                  Payment method selection (Cash vs GCash) and End-of-Day reconciliation report for Bayani&apos;s cash-on-hand tracking.
                </p>
              </div>
            </div>

            {/* Slice 3 */}
            <div className="p-4 rounded-lg bg-zinc-900/40 border border-zinc-800/60 flex items-start gap-3.5 opacity-75">
              <div className="mt-0.5 w-5 h-5 rounded-full bg-zinc-800 text-zinc-400 flex items-center justify-center text-xs font-bold shrink-0">
                3
              </div>
              <div className="space-y-1">
                <span className="text-sm font-semibold text-zinc-200">
                  Slice 3: Barber 50/50 Commission &amp; Daily Shift Settlement
                </span>
                <p className="text-xs text-zinc-400">
                  Automatic immutable 50% commission snapshot per sale, commission ledger, and daily barber earnings close-out.
                </p>
              </div>
            </div>

            {/* Slice 4 */}
            <div className="p-4 rounded-lg bg-zinc-900/40 border border-zinc-800/60 flex items-start gap-3.5 opacity-75">
              <div className="mt-0.5 w-5 h-5 rounded-full bg-zinc-800 text-zinc-400 flex items-center justify-center text-xs font-bold shrink-0">
                4
              </div>
              <div className="space-y-1">
                <span className="text-sm font-semibold text-zinc-200">
                  Slice 4: Dynamic Catalog &amp; Staff Synchronization
                </span>
                <p className="text-xs text-zinc-400">
                  Backend catalog updates seamlessly propagating to offline client IndexedDB caches.
                </p>
              </div>
            </div>

            {/* Slice 5 */}
            <div className="p-4 rounded-lg bg-zinc-900/40 border border-zinc-800/60 flex items-start gap-3.5 opacity-75">
              <div className="mt-0.5 w-5 h-5 rounded-full bg-zinc-800 text-zinc-400 flex items-center justify-center text-xs font-bold shrink-0">
                5
              </div>
              <div className="space-y-1">
                <span className="text-sm font-semibold text-zinc-200">
                  Slice 5: ML Revenue Forecasting Microservice &amp; Dashboard
                </span>
                <p className="text-xs text-zinc-400">
                  FastAPI microservice running Random Forest regression, 7-day walk-forward prediction, and owner dashboard charts.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="pt-6 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-4 text-xs text-zinc-500">
          <div>Systems Plus Computer College — BSIT Capstone Project</div>
          <div className="font-mono">Ruzzco Barbers System v0.2.0 (Slice 1)</div>
        </footer>
      </main>
    </div>
  );
}

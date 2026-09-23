import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Scissors, ArrowRight, Database, Users, Sparkles, ClipboardCheck, History } from "lucide-react";
import { RuzzcoLogoBadge, MustacheIcon, BarberPoleIcon } from "@/components/RuzzcoBrand";

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
    <div className="min-h-screen bg-[#0b0c10] text-zinc-100 font-sans antialiased selection:bg-red-600 selection:text-white">
      {/* Vintage Barbershop Ambient Crimson Glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-96 bg-gradient-to-b from-red-600/15 via-red-950/5 to-transparent blur-3xl pointer-events-none" />

      <main className="relative max-w-5xl mx-auto px-6 py-10 sm:py-14 space-y-12">
        {/* Header with Client Logo & Identity */}
        <header className="space-y-6 border-b border-zinc-800/80 pb-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-600/10 border border-red-500/25 text-red-400 text-xs font-medium tracking-wider uppercase">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span>Slice 1 &amp; 2 Active: Offline POS &amp; Reconciliation</span>
            </div>

            <div className="flex items-center gap-4 text-xs font-mono">
              <Link
                href="/api/v1/health"
                target="_blank"
                className="text-zinc-400 hover:text-red-400 transition-colors flex items-center gap-1"
              >
                <span>GET /api/v1/health</span>
                <span className="text-zinc-600">↗</span>
              </Link>
              <Link
                href="/api/v1/catalog"
                target="_blank"
                className="text-zinc-400 hover:text-red-400 transition-colors flex items-center gap-1"
              >
                <span>GET /api/v1/catalog</span>
                <span className="text-zinc-600">↗</span>
              </Link>
            </div>
          </div>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pt-2">
            <div className="flex items-start gap-4 sm:gap-5">
              {/* Client Official Crest */}
              <RuzzcoLogoBadge size={84} />

              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold tracking-[0.25em] text-red-500 uppercase">
                    Premium Cut &amp; Shave
                  </span>
                  <span className="text-zinc-600">•</span>
                  <span className="text-[11px] font-semibold tracking-[0.2em] text-zinc-400 uppercase">
                    Est. 2026
                  </span>
                </div>

                <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white uppercase font-[family-name:var(--font-oswald)] flex items-center gap-3">
                  Ruzzco Barbers
                  <MustacheIcon className="w-7 h-4 text-red-600 inline-block shrink-0" />
                </h1>

                <p className="text-zinc-400 text-xs sm:text-sm max-w-xl leading-relaxed">
                  Offline-First Mobile POS &amp; Revenue Forecasting Decision Support System for Bayani Delo Santos.
                  Engineered with Next.js, IndexedDB, Prisma, MySQL 8.0, and FastAPI.
                </p>
              </div>
            </div>

            {/* Quick Action Navigation Buttons */}
            <div className="flex flex-wrap sm:flex-nowrap gap-3 shrink-0">
              <Link
                href="/pos"
                className="inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-bold text-sm shadow-xl shadow-red-950/60 ring-1 ring-red-400/40 transition-all cursor-pointer group"
              >
                <Scissors className="w-4 h-4 group-hover:rotate-45 transition-transform" />
                <span>Launch Mobile POS</span>
                <ArrowRight className="w-4 h-4 stroke-[2.5]" />
              </Link>

              <Link
                href="/shift-log"
                className="inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white font-medium text-xs transition-colors"
                title="View shift cuts log"
              >
                <History className="w-4 h-4 text-zinc-400" />
                <span>Shift Log</span>
              </Link>

              <Link
                href="/reconciliation"
                className="inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white font-medium text-xs transition-colors"
                title="End of Day Cash Reconciliation"
              >
                <ClipboardCheck className="w-4 h-4 text-zinc-400" />
                <span>EOD Cash</span>
              </Link>
            </div>
          </div>
        </header>

        {/* Database & Environment Status Card */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-5 rounded-xl bg-[#12141a] border border-[#232734] backdrop-blur-sm space-y-2 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-barber-pole opacity-60" />
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

          <div className="p-5 rounded-xl bg-[#12141a] border border-[#232734] backdrop-blur-sm space-y-2 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-barber-pole opacity-60" />
            <div className="flex items-center justify-between text-xs font-medium text-zinc-400 uppercase tracking-wider">
              <span>Active Staff &amp; Catalog</span>
              <Users className="w-4 h-4 text-zinc-500" />
            </div>
            <div className="text-2xl font-bold text-white font-[family-name:var(--font-oswald)]">
              {barbers.length} Barbers <span className="text-sm font-normal text-zinc-400">/ {services.length} Services</span>
            </div>
            <p className="text-xs text-zinc-400 truncate">
              {barbers.map((b) => b.fullName).join(", ") || "None seeded"}
            </p>
          </div>

          <div className="p-5 rounded-xl bg-[#12141a] border border-[#232734] backdrop-blur-sm space-y-2 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-barber-pole opacity-60" />
            <div className="flex items-center justify-between text-xs font-medium text-zinc-400 uppercase tracking-wider">
              <span>Cloud Synced Cuts</span>
              <Sparkles className="w-4 h-4 text-red-500" />
            </div>
            <div className="text-2xl font-bold text-red-400 font-[family-name:var(--font-oswald)]">
              {transactionCount} Records
            </div>
            <p className="text-xs text-zinc-400">
              Idempotent batch sync active via Dexie + MySQL
            </p>
          </div>
        </section>

        {/* Vertical Slice Roadmap */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <BarberPoleIcon className="w-3 h-5" />
            <h2 className="text-lg font-bold text-white tracking-wide uppercase font-[family-name:var(--font-oswald)]">
              Vertical Slice Implementation Roadmap
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {/* Slice 0 */}
            <div className="p-4 rounded-xl bg-[#12141a]/90 border border-emerald-500/30 flex items-start gap-3.5">
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
            <div className="p-4 rounded-xl bg-[#12141a]/90 border border-emerald-500/30 flex items-start gap-3.5">
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
            <div className="p-4 rounded-xl bg-[#12141a]/90 border border-red-500/30 flex items-start gap-3.5">
              <div className="mt-0.5 w-5 h-5 rounded-full bg-red-600/20 text-red-400 flex items-center justify-center text-xs font-bold shrink-0">
                2
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">
                    Slice 2: GCash &amp; Daily Cash Reconciliation (&quot;Abono&quot;)
                  </span>
                  <span className="text-[10px] font-medium bg-red-500/20 text-red-300 px-2 py-0.5 rounded uppercase">
                    Active
                  </span>
                </div>
                <p className="text-xs text-zinc-400">
                  Payment method selection (Cash vs GCash), GCash reference tracking, and End-of-Day cash variance reconciliation report.
                </p>
              </div>
            </div>

            {/* Slice 3 */}
            <div className="p-4 rounded-xl bg-[#12141a]/40 border border-[#232734]/60 flex items-start gap-3.5 opacity-75">
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
            <div className="p-4 rounded-xl bg-[#12141a]/40 border border-[#232734]/60 flex items-start gap-3.5 opacity-75">
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
            <div className="p-4 rounded-xl bg-[#12141a]/40 border border-[#232734]/60 flex items-start gap-3.5 opacity-75">
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
          <div className="flex items-center gap-2">
            <MustacheIcon className="w-5 h-2.5 text-red-600/70" />
            <span>Ruzzco Barbers • Caloocan City</span>
          </div>
          <div className="font-mono">BSIT Capstone System v0.2.1</div>
        </footer>
      </main>
    </div>
  );
}

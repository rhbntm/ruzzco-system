import Link from "next/link";
import { cookies } from "next/headers";
import type { LucideIcon } from "lucide-react";
import {
  Scissors,
  ArrowRight,
  History,
  ClipboardCheck,
  Wallet,
  Lock,
  Smartphone,
  WifiOff,
  RefreshCw,
  Banknote,
  Clock,
  MapPin,
  CheckCircle2,
  QrCode,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { manilaToday, parseBusinessDate } from "@/lib/business-date";
import { countsOnDay } from "@/lib/time-review";
import { gatewayConfig } from "@/lib/gateway";
import { OWNER_COOKIE, isOwnerCookie } from "@/lib/owner-access";
import { latestForecast, serializeForecast, type SerializedForecast } from "@/lib/forecast";
import { ForecastLocked, ForecastPanel } from "@/components/ForecastPanel";
import { RuzzcoLogoBadge, MustacheIcon, BarberPoleIcon } from "@/components/RuzzcoBrand";

export const dynamic = "force-dynamic";

type Destination = { href: string; title: string; body: string; icon: LucideIcon; ownerOnly?: boolean };

const destinations: Destination[] = [
  { href: "/pos", title: "Point of Sale", body: "Ring up a cut in two taps. Works even when the shop Wi-Fi drops.", icon: Scissors },
  { href: "/shift-log", title: "Shift Log", body: "Every sale on this phone, its sync status, and anything that needs attention.", icon: History },
  { href: "/reconciliation", title: "End-of-Day Cash", body: "Count the drawer against expected cash after tips, payouts and petty cash.", icon: ClipboardCheck },
  { href: "/ledger", title: "Barber Ledger", body: "Daily 50/50 commission and payouts, from the rates saved at each sale.", icon: Wallet, ownerOnly: true },
  { href: "/payment-qr", title: "Payment QR", body: "Add each barber's GCash and Maya QR, shown when a customer pays by phone.", icon: QrCode, ownerOnly: true },
];

const flow: { title: string; body: string; icon: LucideIcon }[] = [
  { title: "Tap", body: "The barber picks the service and payment method on their phone.", icon: Smartphone },
  { title: "Saved on the phone", body: "The sale is stored on the device first, so no connection is needed.", icon: WifiOff },
  { title: "Synced once", body: "When online, sales upload. Each one is recorded exactly once, even if sent twice.", icon: RefreshCw },
  { title: "Closed out", body: "At closing the owner reconciles the drawer and settles barber payouts.", icon: Banknote },
];

async function loadSnapshot() {
  try {
    const today = parseBusinessDate(manilaToday());
    const [barbers, services, salesToday] = await Promise.all([
      prisma.barber.findMany({ where: { isActive: true }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
      prisma.service.findMany({ where: { isActive: true }, select: { id: true, name: true, standardPrice: true }, orderBy: { standardPrice: "desc" } }),
      today
        ? prisma.transaction.count({ where: { paymentStatus: "PAID", ...countsOnDay(today) } })
        : Promise.resolve(0),
    ]);
    return { ok: true as const, barbers, services, salesToday };
  } catch (error) {
    console.error("[home] snapshot query failed:", error);
    return { ok: false as const };
  }
}

// Forecast numbers are loaded only for the owner; everyone else gets the locked card.
async function loadForecast(): Promise<SerializedForecast | null> {
  try {
    const { run, days } = await latestForecast();
    return serializeForecast(run, days);
  } catch (error) {
    console.error("[home] forecast query failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

export default async function HomePage() {
  const isOwner = isOwnerCookie((await cookies()).get(OWNER_COOKIE)?.value);
  const [snapshot, forecast] = await Promise.all([loadSnapshot(), isOwner ? loadForecast() : Promise.resolve(null)]);
  const gatewayOn = gatewayConfig() !== null;

  const built = [
    "Offline-first POS with a queued, idempotent sync",
    gatewayOn ? "Cash, GCash, Maya and QR Ph (PayMongo test mode)" : "Cash, GCash and Maya payments",
    "Custom amounts count as revenue; tips are kept separate",
    "Sales locked to the barber's device assignment at sale time",
    "50/50 commission saved with each sale, never recomputed",
    "Daily payout ledger behind an owner PIN",
    "End-of-day drawer reconciliation with petty cash",
    "7-day customer and revenue forecast for the owner, from the paper logbook",
  ];

  return (
    <div className="relative min-h-screen bg-[#0b0c10] text-zinc-100 font-sans antialiased selection:bg-red-600 selection:text-white overflow-x-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-96 bg-gradient-to-b from-red-600/15 via-red-950/5 to-transparent blur-3xl pointer-events-none" />

      <main className="relative max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-16 space-y-14">
        {/* Hero */}
        <header className="flex flex-col items-center text-center gap-5">
          <RuzzcoLogoBadge size={96} />
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2 text-[11px] font-semibold tracking-[0.25em] text-red-500 uppercase">
              <span>Cut &amp; Shave</span>
              <span className="text-zinc-600">•</span>
              <span className="text-zinc-400 tracking-[0.2em]">Caloocan City</span>
            </div>
            <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-white uppercase font-[family-name:var(--font-oswald)] flex items-center justify-center gap-3">
              Ruzzco Barbers
              <MustacheIcon className="w-8 h-4 text-red-600 shrink-0" />
            </h1>
            <p className="text-zinc-400 text-sm sm:text-base max-w-xl mx-auto leading-relaxed">
              The shop&apos;s point of sale and end-of-day books, built to keep working offline, with a 7-day
              customer forecast for the owner.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <Link
              href="/pos"
              className="inline-flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-xl bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-bold text-sm shadow-xl shadow-red-950/60 ring-1 ring-red-400/40 transition-all group"
            >
              <Scissors className="w-4 h-4 group-hover:rotate-45 transition-transform" />
              Open the POS
              <ArrowRight className="w-4 h-4 stroke-[2.5]" />
            </Link>
            <Link
              href="/reconciliation"
              className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white font-medium text-sm transition-colors"
            >
              <ClipboardCheck className="w-4 h-4 text-zinc-400" />
              Close out today
            </Link>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Usually open daily, 10 AM – 10 PM</span>
            <span className="inline-flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Caloocan City</span>
          </div>
        </header>

        {/* Forecast (owner only) */}
        {isOwner ? (
          forecast ? (
            <ForecastPanel initial={forecast} today={manilaToday()} />
          ) : (
            <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-900/50 text-sm text-rose-300">
              The saved forecast can&apos;t be loaded right now because the database is unreachable.
            </div>
          )
        ) : (
          <ForecastLocked />
        )}

        {/* Today */}
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {snapshot.ok ? (
            <>
              <Stat label={`Paid sales today (${manilaToday()})`} value={String(snapshot.salesToday)} accent="text-red-400" />
              <Stat
                label="Barbers on the roster"
                value={String(snapshot.barbers.length)}
                note={snapshot.barbers.map((b) => b.fullName).join(", ") || "None set up yet"}
              />
              <Stat label="Services on the menu" value={String(snapshot.services.length)} note="Prices below" />
            </>
          ) : (
            <div className="sm:col-span-3 p-4 rounded-xl bg-rose-950/30 border border-rose-900/50 text-sm text-rose-300">
              The server can&apos;t reach the database right now. The POS still records sales on the phone and syncs
              them once it&apos;s back.
            </div>
          )}
        </section>

        {/* Where to go */}
        <section className="space-y-4">
          <SectionTitle>Where to go</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {destinations.map((d) => (
              <Link
                key={d.href}
                href={d.href}
                className="group p-5 rounded-xl bg-[#12141a] border border-[#232734] hover:border-red-500/40 transition-colors relative overflow-hidden"
              >
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-barber-pole opacity-60" />
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <d.icon className="w-5 h-5 text-red-500" />
                    <span className="font-bold text-white uppercase tracking-wide font-[family-name:var(--font-oswald)]">{d.title}</span>
                  </div>
                  {d.ownerOnly ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full">
                      <Lock className="w-3 h-3" /> Owner PIN
                    </span>
                  ) : (
                    <ArrowRight className="w-4 h-4 text-zinc-600 group-hover:text-red-400 transition-colors" />
                  )}
                </div>
                <p className="mt-2 text-sm text-zinc-400 leading-relaxed">{d.body}</p>
              </Link>
            ))}
          </div>
        </section>

        {/* How a sale flows */}
        <section className="space-y-4">
          <SectionTitle>How a sale is recorded</SectionTitle>
          <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {flow.map((step, i) => (
              <li key={step.title} className="p-4 rounded-xl bg-[#12141a]/80 border border-[#232734] space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-red-600/20 text-red-400 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                  <step.icon className="w-4 h-4 text-zinc-400" />
                </div>
                <div className="font-semibold text-white text-sm">{step.title}</div>
                <p className="text-xs text-zinc-400 leading-relaxed">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Services */}
        {snapshot.ok && snapshot.services.length > 0 && (
          <section className="space-y-4">
            <SectionTitle>Services</SectionTitle>
            <ul className="divide-y divide-[#232734] rounded-xl bg-[#12141a] border border-[#232734]">
              {snapshot.services.map((s) => (
                <li key={s.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span className="text-zinc-200">{s.name}</span>
                  <span className="font-bold text-white font-[family-name:var(--font-oswald)]">₱{Number(s.standardPrice).toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Built */}
        <section>
          <div className="p-5 rounded-xl bg-[#12141a] border border-emerald-500/25 space-y-3">
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-300 font-[family-name:var(--font-oswald)]">Built so far</div>
            <ul className="space-y-2">
              {built.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-zinc-300">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <footer className="pt-6 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-4 text-xs text-zinc-500">
          <div className="flex items-center gap-2">
            <BarberPoleIcon className="w-2 h-3.5" />
            <span>Ruzzco Barbers • Caloocan City</span>
          </div>
          <div className="flex items-center gap-4 font-mono">
            <Link href="/api/v1/health" className="hover:text-red-400 transition-colors">health</Link>
            <span>SPCC BSIT Capstone</span>
          </div>
        </footer>
      </main>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-lg font-bold text-white tracking-wide uppercase font-[family-name:var(--font-oswald)]">
      <BarberPoleIcon className="w-3 h-5" />
      {children}
    </h2>
  );
}

function Stat({ label, value, note, accent = "text-white" }: { label: string; value: string; note?: string; accent?: string }) {
  return (
    <div className="p-4 rounded-xl bg-[#12141a] border border-[#232734] space-y-1 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-0.5 bg-barber-pole opacity-60" />
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">{label}</div>
      <div className={`text-2xl font-extrabold font-[family-name:var(--font-oswald)] ${accent}`}>{value}</div>
      {note && <p className="text-xs text-zinc-400 truncate">{note}</p>}
    </div>
  );
}

import Link from "next/link";
import { cookies } from "next/headers";
import type { LucideIcon } from "lucide-react";
import {
  Scissors,
  ArrowRight,
  History,
  ClipboardCheck,
  TriangleAlert,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { manilaToday, parseBusinessDate } from "@/lib/business-date";
import { countsOnDay } from "@/lib/time-review";
import { gatewayConfig } from "@/lib/gateway";
import { OWNER_COOKIE, isOwnerCookie } from "@/lib/owner-access";
import { latestForecast, serializeForecast, type SerializedForecast } from "@/lib/forecast";
import { OwnerDrawer } from "@/components/OwnerDrawer";
import { RuzzcoLogoBanner, MustacheIcon } from "@/components/RuzzcoBrand";
import { MirrorGlass } from "@/components/StationMirror";

export const dynamic = "force-dynamic";

type Tool = { href: string; title: string; icon: LucideIcon; body: string };

// The tools on the counter beside the POS. The owner's pages live in the drawer under them.
const counterTools: Tool[] = [
  { href: "/shift-log", title: "Shift Log", body: "Every sale on this phone, its sync status, and anything that needs attention.", icon: History },
  { href: "/reconciliation", title: "End-of-Day Cash", body: "Close out today: count the drawer against expected cash after tips, payouts and petty cash.", icon: ClipboardCheck },
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

type Snapshot = Awaited<ReturnType<typeof loadSnapshot>>;

// Forecast numbers are loaded only for the owner; everyone else sees the locked drawer.
async function loadForecast(): Promise<SerializedForecast | null> {
  try {
    const { run, days } = await latestForecast();
    return serializeForecast(run, days);
  } catch (error) {
    console.error("[home] forecast query failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

const peso = (value: number) => `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Prices lettered on the mirror drop the centavos when there are none: ₱200, but ₱150.50.
const pesoShort = (value: number) => (Number.isInteger(value) ? `₱${value.toLocaleString("en-PH")}` : peso(value));

// Business dates are YYYY-MM-DD calendar dates, so they are formatted as dates, not instants.
const formatDay = (date: string) =>
  new Intl.DateTimeFormat("en-PH", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`)
  );

export default async function HomePage() {
  const isOwner = isOwnerCookie((await cookies()).get(OWNER_COOKIE)?.value);
  const [snapshot, forecast] = await Promise.all([loadSnapshot(), isOwner ? loadForecast() : Promise.resolve(null)]);
  const gatewayOn = gatewayConfig() !== null;
  const today = manilaToday();

  return (
    <div className="relative flex-1 overflow-x-clip">
      <main className="rz-page pb-10">
        {/* The station, seen from the chair: the mirror over the counter */}
        <div className="mx-auto max-w-312 px-3 sm:px-6 pt-4 sm:pt-7">
          <div className="rz-mirror">
            <MirrorGlass>
              {/* The room behind the chair, reflected: black walls, the crimson accent wall, the ceiling */}
              <span aria-hidden="true" className="rz-mirror-room rz-reflect-far rz-lights-up">
                <span className="rz-mirror-accent" />
              </span>
              <span aria-hidden="true" className="rz-mirror-sheen" />
              <span aria-hidden="true" className="rz-mirror-glow" />
              <span aria-hidden="true" className="rz-mirror-led" />

              {/* Phones: a smaller sign and title and no intro, so Open the POS sits near the top of the first screen. */}
              <div className="relative z-2 grid items-center gap-5 sm:gap-9 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)] lg:gap-14 px-5 pt-11 pb-6 sm:px-12 sm:pt-14 sm:pb-10 lg:px-16 lg:pt-12 lg:pb-9">
                {/* The sign on the accent wall, in the mirror. It hangs in front of the wall, so it moves less. */}
                <div className="rz-reflect-near rz-lights-up relative w-full max-w-[16rem] sm:max-w-xl lg:max-w-none">
                  {/* The LED tube above the sign, as in the shop */}
                  <span
                    aria-hidden="true"
                    className="absolute -top-5 sm:-top-7 left-1/2 -translate-x-1/2 h-0.75 w-3/5 rounded-full bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.9)_15%,rgb(255_255_255/0.9)_85%,transparent)] shadow-[0_6px_22px_4px_rgb(255_240_225/0.28)]"
                  />
                  <RuzzcoLogoBanner className="w-full" alt="" sizes="(min-width: 1024px) 35rem, (min-width: 640px) 36rem, 16rem" />
                </div>

                {/* Lettered on the glass, so it stays put while the reflection moves */}
                <div className="rz-vinyl sm:space-y-5">
                  {/* Three set lines, so the comma of the first never sits over a letter of the second */}
                  <h1 className="rz-title text-[2.125rem] sm:text-6xl lg:text-[clamp(3rem,4.4vw,4rem)] leading-[1.05]">
                    <span className="sr-only">Ruzzco Barbers: </span>
                    {/* The spaces keep the words apart for copy, search and screen readers. */}
                    <span className="block">Every cut,</span>{" "}
                    <span className="block">counted</span>{" "}
                    <span className="block">once.</span>
                  </h1>
                  <p className="hidden sm:block max-w-[36ch] lg:max-w-[50ch] sm:text-lg lg:text-[1.0625rem] leading-relaxed text-[#f3dcd8]">
                    The shop&apos;s point of sale and end-of-day books. Every sale is saved on the phone first and synced when
                    the Wi-Fi is back, and the owner gets a 7-day customer forecast.
                  </p>
                </div>
              </div>

              {/* The day, lettered along the foot of the glass. Narrower screens read it under the counter. */}
              <div className="relative z-2 hidden lg:block px-16 pb-8">
                <DayLine variant="glass" snapshot={snapshot} today={today} />
              </div>
            </MirrorGlass>
          </div>
        </div>

        {/* The counter: the day's tools on top, the owner's drawer under them */}
        <div className="rz-counter mt-6 sm:mt-7">
          <div className="mx-auto max-w-312 px-3 sm:px-6 pt-6 sm:pt-7 pb-10 sm:pb-12 space-y-6 sm:space-y-8">
            <section aria-labelledby="tools-title" className="space-y-4 sm:space-y-6">
              <h2 id="tools-title" className="sr-only">Where to go</h2>
              <ul className="grid grid-cols-2 lg:grid-cols-[1.7fr_1fr_1fr] gap-3 sm:gap-4 rz-stagger">
                <li className="col-span-2 lg:col-span-1">
                  <Link href="/pos" className="rz-plate rz-plate-primary group gap-3 min-h-40 lg:min-h-0">
                    <Scissors className="w-6 h-6 transition-transform duration-300 motion-safe:group-hover:-rotate-12" />
                    <span className="mt-2 font-display font-semibold uppercase tracking-[0.04em] text-[2.125rem] sm:text-[2.5rem] xl:text-[2.75rem] leading-[0.95]">
                      Open the POS
                    </span>
                    <span className="block text-sm font-medium leading-relaxed max-w-[34ch]">
                      Ring up a cut in two taps. Works even when the shop Wi-Fi drops.
                    </span>
                    <span className="mt-auto pt-2 flex items-end justify-between gap-4">
                      <span className="text-xs font-semibold uppercase tracking-[0.08em]">
                        {gatewayOn ? "Cash · GCash · Maya · QR Ph" : "Cash · GCash · Maya"}
                      </span>
                      <ArrowRight className="w-6 h-6 shrink-0 stroke-[2.5] transition-transform duration-200 motion-safe:group-hover:translate-x-1" />
                    </span>
                  </Link>
                </li>

                {counterTools.map((tool) => (
                  <li key={tool.href}>
                    <Link href={tool.href} className="rz-plate group gap-3">
                      <tool.icon className="w-6 h-6 text-crimson-ink" />
                      <span className="mt-2 font-display font-semibold uppercase tracking-[0.04em] text-xl sm:text-2xl lg:text-[1.625rem] leading-[1.05]">
                        {tool.title}
                      </span>
                      <span className="block text-[0.8125rem] sm:text-sm text-dust leading-relaxed">{tool.body}</span>
                      <ArrowRight className="mt-auto self-end w-5 h-5 text-dust transition-[color,transform] duration-200 group-hover:text-crimson-ink motion-safe:group-hover:translate-x-1" />
                    </Link>
                  </li>
                ))}
              </ul>

              {/* Narrower screens: the day sits under the tools, so Open the POS stays in the first screen */}
              <div className="lg:hidden">
                <DayLine variant="board" snapshot={snapshot} today={today} />
              </div>
            </section>

            {/* The counter's own drawer, under the tools: the owner's pages and the forecast */}
            <OwnerDrawer isOwner={isOwner} forecast={forecast} today={today} />
          </div>
        </div>

        <footer className="mx-auto max-w-312 px-4 sm:px-6 pt-10 sm:pt-12">
          <div className="pt-6 border-t border-seam flex flex-wrap items-center justify-between gap-4 text-xs text-dust">
            <span>Ruzzco Barbers • Caloocan City</span>
            <div className="flex items-center gap-4">
              {/* How a sale is recorded, and what the system does so far */}
              <Link href="/about" className="inline-flex items-center min-h-6 px-1 -mx-1 pointer-coarse:min-h-11 hover:text-crimson-ink transition-colors">About</Link>
              <Link href="/api/v1/health" className="inline-flex items-center min-h-6 px-1 -mx-1 pointer-coarse:min-h-11 hover:text-crimson-ink transition-colors">health</Link>
              <span>SPCC BSIT Capstone</span>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}

type DayUnit = { label: string; value: string; brass?: boolean };

// The day at a glance: hours, today's paid sales, the roster, and the price list. Lettered in one
// line along the mirror's glass on wide screens; a board of leader lines under the counter on
// narrower ones. The supporting details (city, date, names) share one quiet line.
function DayLine({ variant, snapshot, today }: { variant: "glass" | "board"; snapshot: Snapshot; today: string }) {
  const hours: DayUnit = { label: "Open daily", value: "10 AM – 10 PM" };
  const day: DayUnit[] = snapshot.ok
    ? [
        hours,
        { label: "Paid sales today", value: String(snapshot.salesToday), brass: true },
        { label: "Barbers", value: String(snapshot.barbers.length) },
      ]
    : [hours];
  const prices: DayUnit[] = snapshot.ok
    ? snapshot.services.map((s) => ({ label: s.name, value: pesoShort(Number(s.standardPrice)), brass: true }))
    : [];
  const roster = snapshot.ok ? snapshot.barbers.map((b) => b.fullName).join(", ") : "";
  const notes = snapshot.ok
    ? [
        "Caloocan City",
        formatDay(today),
        roster ? `On the roster: ${roster}` : "No barbers set up yet",
        ...(prices.length === 0 ? ["No services on the menu yet"] : []),
      ]
    : ["Caloocan City"];
  const offline = !snapshot.ok && (
    <p className="rz-notice rz-notice-danger">
      <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
      The server can&apos;t reach the database right now. The POS still records sales on the phone and syncs them once
      it&apos;s back.
    </p>
  );

  if (variant === "glass") {
    return (
      <div className="rz-vinyl border-t border-white/15 pt-5">
        <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
          <dl className="flex flex-wrap items-baseline gap-x-7 gap-y-3">
            {day.map((unit) => (
              <VinylUnit key={unit.label} unit={unit} />
            ))}
          </dl>
          {prices.length > 0 && (
            <>
              <MustacheIcon className="w-7 h-2.5 shrink-0 text-brass" />
              <dl className="flex flex-wrap items-baseline gap-x-7 gap-y-3">
                {prices.map((unit) => (
                  <VinylUnit key={unit.label} unit={unit} />
                ))}
              </dl>
            </>
          )}
        </div>
        <p className="mt-2 text-xs text-[#ecc9c4]">{notes.join(" · ")}</p>
        {offline && <div className="mt-4">{offline}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rz-panel px-4 py-4 sm:px-6 sm:py-5 space-y-3.5">
        <dl className="space-y-2.5">
          {day.map((unit) => (
            <LeaderUnit key={unit.label} unit={unit} />
          ))}
        </dl>
        {prices.length > 0 && (
          <dl className="space-y-2.5 pt-3.5 border-t border-seam">
            {prices.map((unit) => (
              <LeaderUnit key={unit.label} unit={unit} />
            ))}
          </dl>
        )}
        <p className="text-xs text-dust leading-relaxed">{notes.join(" · ")}</p>
      </div>
      {offline}
    </div>
  );
}

// Vinyl lettering: the label and its figure on one Oswald baseline.
function VinylUnit({ unit }: { unit: DayUnit }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <dt className="font-display uppercase tracking-[0.08em] text-lg text-[#f3dcd8]">{unit.label}</dt>
      <dd className={`font-display font-semibold uppercase tracking-[0.03em] text-2xl leading-none ${unit.brass ? "text-brass-bright" : "text-bone"}`}>
        {unit.value}
      </dd>
    </div>
  );
}

// The board's grammar: the label led out by a dotted leader to its figure.
function LeaderUnit({ unit }: { unit: DayUnit }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="flex flex-1 min-w-0 items-baseline gap-3 font-display font-medium uppercase tracking-[0.06em] text-[0.9375rem] text-bone-2">
        <span className="truncate">{unit.label}</span>
        <span aria-hidden="true" className="rz-leader" />
      </dt>
      <dd className={`rz-figure text-lg shrink-0 ${unit.brass ? "text-brass-bright" : "text-bone"}`}>{unit.value}</dd>
    </div>
  );
}

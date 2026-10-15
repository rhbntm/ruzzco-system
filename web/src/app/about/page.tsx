import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, Banknote, CheckCircle2, Clock, RefreshCw, Server, Smartphone, Wifi, WifiOff } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { gatewayConfig } from "@/lib/gateway";
import { BarberPoleIcon } from "@/components/RuzzcoBrand";

// How one sale is recorded, and what the system does so far. Both sat under the counter on the
// home page; they live here so Open the POS stays near the top of the home screen on phones.
export const dynamic = "force-dynamic";

// The walkthrough follows the top service on the menu at its real price. Without the database it
// still tells the story, just without an amount.
async function loadExample() {
  try {
    return await prisma.service.findFirst({
      where: { isActive: true },
      select: { name: true, standardPrice: true },
      orderBy: { standardPrice: "desc" },
    });
  } catch (error) {
    console.error("[about] example query failed:", error);
    return null;
  }
}

const peso = (value: number) => `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function AboutPage() {
  const example = await loadExample();
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

  const exampleName = example?.name ?? "Cut";
  const exampleAmount = example ? peso(Number(example.standardPrice)) : null;

  return (
    <main className="flex-1">
      <header className="rz-banner">
        <div className="max-w-312 mx-auto flex items-center justify-between gap-3 px-4 sm:px-6 py-3">
          <Link href="/" className="inline-flex items-center gap-1.5 -my-2 py-2 pointer-coarse:-my-3.5 pointer-coarse:py-3.5 text-sm text-dust hover:text-bone transition-colors group">
            <ArrowLeft className="w-4 h-4 transition-transform duration-200 group-hover:-translate-x-0.5" />Home
          </Link>
          <h1 className="flex items-center gap-2 font-display font-semibold text-base sm:text-lg leading-none uppercase tracking-widest text-bone">
            <BarberPoleIcon className="w-2.5 h-6" />
            About
          </h1>
          {/* Balances the Home link, so the title stays centred. */}
          <span aria-hidden="true" className="w-16 shrink-0" />
        </div>
      </header>

      <div className="rz-page pb-10">
        {/* One sale, from the chair to the drawer */}
        <section aria-labelledby="flow-title" className="mx-auto max-w-312 px-4 sm:px-6 pt-10 sm:pt-14">
          <div className="max-w-2xl space-y-3">
            <h2 id="flow-title" className="rz-title text-[2rem] sm:text-[2.75rem]">How a sale is recorded</h2>
            <p className="text-base sm:text-lg text-dust leading-relaxed">
              One {exampleName.toLowerCase()} paid in cash, followed from the chair to the drawer. An example, not a real sale.
            </p>
          </div>

          <div className="mt-10 sm:mt-12 grid gap-6 lg:grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,1fr)] lg:gap-0">
            <Zone icon={Smartphone} title="On the barber's phone" note="Works with no connection">
              <Step n={1} title="Tap" body="The barber picks the service and payment method on their phone.">
                <div className="space-y-2.5">
                  <div className="relative overflow-hidden flex items-center justify-between gap-3 rounded-[10px] border border-chrome bg-panel-2 py-2.5 pl-4 pr-3 shadow-[inset_0_1px_0_rgb(214_228_250/0.14)]">
                    <span className="absolute inset-y-0 left-0 w-1 rz-stripes" />
                    <span className="flex items-center gap-2.5 min-w-0">
                      <BarberPoleIcon className="w-2.5 h-6" />
                      <span className="text-sm font-semibold text-bone truncate">{exampleName}</span>
                    </span>
                    {exampleAmount && <span className="rz-figure text-base text-bone shrink-0">{exampleAmount}</span>}
                  </div>
                  <div className="h-10 flex items-center justify-center gap-2 rounded-[10px] bg-crimson text-white font-display font-semibold uppercase tracking-wider text-[0.9375rem] shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_10px_20px_-12px_rgb(0_0_0/0.95)]">
                    <Banknote className="w-4 h-4 stroke-[2.5]" />
                    Cash{exampleAmount && ` — ${exampleAmount}`}
                  </div>
                </div>
              </Step>
              <Step n={2} title="Saved on the phone" body="The sale is stored on the device first, so no connection is needed.">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rz-pill rz-pill-danger"><WifiOff className="w-3.5 h-3.5" /> Offline</span>
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-crimson-ink"><Clock className="w-3.5 h-3.5" /> Waiting to sync</span>
                  </div>
                  <ExampleCut name={exampleName} amount={exampleAmount} synced={false} />
                </div>
              </Step>
            </Zone>

            {/* Where the sale crosses from the phone to the server */}
            <div className="flex lg:flex-col items-center justify-center gap-3 lg:pt-12 text-dust">
              <span aria-hidden="true" className="hidden lg:block w-px flex-1 bg-[linear-gradient(180deg,transparent,var(--color-seam-strong))]" />
              <span aria-hidden="true" className="w-10 h-10 rounded-full bg-panel ring-1 ring-seam-strong flex items-center justify-center shrink-0">
                <RefreshCw className="w-4 h-4 text-bone-2" />
              </span>
              <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] lg:text-center">
                Syncs when<br className="hidden lg:block" /> online
              </span>
              <span aria-hidden="true" className="hidden lg:block w-px flex-1 bg-[linear-gradient(180deg,var(--color-seam-strong),transparent)]" />
            </div>

            <Zone icon={Server} title="On the shop's server" note="Once the phone is back online" start={3}>
              <Step n={3} title="Synced once" body="When online, sales upload. Each one is recorded exactly once, even if sent twice.">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rz-pill rz-pill-ok"><Wifi className="w-3.5 h-3.5" /> Online</span>
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ok-ink"><CheckCircle2 className="w-3.5 h-3.5" /> Synced</span>
                  </div>
                  <ExampleCut name={exampleName} amount={exampleAmount} synced />
                  <p className="text-xs text-dust">Sent twice, recorded once.</p>
                </div>
              </Step>
              <Step n={4} title="Closed out" body="At closing the owner reconciles the drawer and settles barber payouts.">
                <div className="space-y-2.5">
                  <dl className="text-sm tabular-nums space-y-1.5">
                    <div className="flex justify-between gap-3">
                      <dt className="text-dust">Cash sales</dt>
                      <dd className="text-bone">{exampleAmount ?? "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-dust">Counted in the drawer</dt>
                      <dd className="text-bone">{exampleAmount ?? "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-3 pt-1.5 border-t border-brass/50 font-semibold text-brass-bright">
                      <dt>= Difference</dt>
                      <dd>₱0.00</dd>
                    </div>
                  </dl>
                  <span className="rz-pill rz-pill-ok"><CheckCircle2 className="w-3.5 h-3.5" /> Drawer is balanced</span>
                </div>
              </Step>
            </Zone>
          </div>
        </section>

        {/* What the system does today */}
        <section aria-labelledby="built-title" className="mx-auto max-w-312 px-4 sm:px-6 pt-16 sm:pt-24">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:gap-12 items-start">
            <div className="space-y-3">
              <h2 id="built-title" className="rz-title text-[2rem] sm:text-[2.75rem]">Built so far</h2>
              <p className="text-dust leading-relaxed">What the system does today, for the SPCC BSIT capstone.</p>
            </div>
            <ul className="grid sm:grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-seam bg-seam shadow-[0_18px_36px_-26px_rgb(0_0_0/0.95)] rz-stagger">
              {built.map((item) => (
                <li key={item} className="flex items-start gap-3 bg-panel px-5 py-4 text-sm text-bone-2 leading-relaxed">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-ok" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}

// One region of the walkthrough: where the sale lives at that point (the phone, or the server).
function Zone({
  icon: Icon,
  title,
  note,
  start,
  children,
}: {
  icon: LucideIcon;
  title: string;
  note: string;
  start?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-3.5 border-b border-seam-strong">
        <h3 className="rz-heading text-bone">
          <Icon className="w-4 h-4 text-crimson-ink" />
          {title}
        </h3>
        <span className="text-xs text-dust">{note}</span>
      </div>
      <ol start={start} className="grid flex-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-seam">
        {children}
      </ol>
    </div>
  );
}

function Step({ n, title, body, children }: { n: number; title: string; body: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-4 py-5 sm:px-5 sm:first:pl-0 sm:last:pr-0">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="w-7 h-7 rounded-full ring-1 ring-seam-strong font-display font-semibold text-sm text-bone flex items-center justify-center shrink-0">
          {n}
        </span>
        <span className="font-display font-medium uppercase tracking-[0.06em] text-lg text-bone">{title}</span>
      </div>
      <p className="text-sm text-dust leading-relaxed">{body}</p>
      {/* An illustration of the app's own screens; the sentence above says what it shows. */}
      <div aria-hidden="true" className="rz-well mt-auto p-3 min-h-34 flex flex-col justify-center pointer-events-none select-none">
        {children}
      </div>
    </li>
  );
}

// A row from the POS's Recent cuts, as it looks before and after it syncs.
function ExampleCut({ name, amount, synced }: { name: string; amount: string | null; synced: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-seam pt-2.5 text-sm">
      <span className="font-medium text-bone truncate">{name}</span>
      <span className="flex items-center gap-2 shrink-0">
        <span className="w-5 h-5 rounded-full bg-crimson/20 text-crimson-ink flex items-center justify-center">
          <Banknote className="w-3 h-3" />
        </span>
        {amount && <span className="rz-figure text-base text-bone">{amount}</span>}
        {synced ? <CheckCircle2 className="w-4 h-4 text-ok" /> : <Clock className="w-4 h-4 text-crimson-ink" />}
      </span>
    </div>
  );
}

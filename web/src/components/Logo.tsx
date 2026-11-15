import { MustacheIcon } from "@/components/RuzzcoBrand";

/**
 * The shop's interim logo (slice 21, Decision 8): the mustache mark from the shop's own logo in a
 * crimson square, with the RUZZCO BARBERS wordmark in Oswald. One component for the sidebar, the
 * top bar, and the sign-in and approval screens, until a vector logo is delivered. No hooks, so it
 * renders in server and client components alike.
 *
 * `stacked` puts the wordmark under a larger mark (sign-in and approval cards). `markOnly` shows
 * the mark alone and names the shop for screen readers.
 */
export function Logo({ stacked = false, markOnly = false, className = "" }: { stacked?: boolean; markOnly?: boolean; className?: string }) {
  const mark = (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center bg-crimson text-on-accent ${stacked ? "h-14 w-14 rounded-xl" : "h-9 w-9 rounded-lg"}`}
    >
      <MustacheIcon className={stacked ? "h-4 w-10" : "h-2.5 w-6.5"} />
    </span>
  );
  if (markOnly) {
    return (
      <span role="img" aria-label="Ruzzco Barbers" className={`inline-flex ${className}`}>
        {mark}
      </span>
    );
  }
  return (
    <span className={`inline-flex ${stacked ? "flex-col items-center gap-2.5" : "items-center gap-2.5"} ${className}`}>
      {mark}
      <span className={`font-display uppercase leading-none text-bone ${stacked ? "text-center" : ""}`}>
        <span className={`block font-bold tracking-[0.08em] ${stacked ? "text-2xl" : "text-lg"}`}>Ruzzco</span>
        <span className={`block font-medium tracking-[0.24em] text-dust ${stacked ? "mt-1 text-xs" : "mt-0.5 text-[0.625rem]"}`}>Barbers</span>
      </span>
    </span>
  );
}

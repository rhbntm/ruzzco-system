import Image from "next/image";

/**
 * The shop's logo (the artwork in public/ruzzco-logo.jpg), cut to fit three places. The files in
 * public/brand are crops of that one image on its black field. No hooks, so it renders in server
 * and client components alike.
 *
 * - default: the RUZZCO BARBERS wordmark strip (sidebar, menu, top bar).
 * - `stacked`: the full lockup, with the poles and the arcs (sign-in and approval cards).
 * - `markOnly`: the moustache alone, square, for the narrow top bar; it names the shop for screen readers.
 */
export function Logo({ stacked = false, markOnly = false, className = "" }: { stacked?: boolean; markOnly?: boolean; className?: string }) {
  if (markOnly) {
    return (
      <Image
        src="/brand/logo-mark.png"
        alt="Ruzzco Barbers"
        width={96}
        height={96}
        className={`inline-flex h-9 w-9 shrink-0 rounded-lg ring-1 ring-seam-strong ${className}`}
      />
    );
  }
  if (stacked) {
    return (
      <Image
        src="/brand/logo-lockup.png"
        alt="Ruzzco Barbers"
        width={680}
        height={310}
        className={`h-auto w-56 max-w-full rounded-lg ring-1 ring-seam-strong ${className}`}
      />
    );
  }
  return (
    <Image
      src="/brand/logo-wordmark.png"
      alt="Ruzzco Barbers"
      width={510}
      height={102}
      className={`h-8 w-auto shrink-0 rounded-md ring-1 ring-seam-strong ${className}`}
    />
  );
}

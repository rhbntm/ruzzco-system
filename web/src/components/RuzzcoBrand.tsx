import React from "react";
import Image from "next/image";

/**
 * Gentleman's classic handlebar mustache matching Ruzzco Barbers logo
 */
export function MustacheIcon({ className = "w-6 h-3 text-crimson" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 35"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d="M50 18C44 7 31 1 18 1C7 1 0 10 0 17C0 26 12 31 22 25C31 20 40 23 50 34C60 23 69 20 78 25C88 31 100 26 100 17C100 10 93 1 82 1C69 1 56 7 50 18Z" />
    </svg>
  );
}

/**
 * Barber pole with chrome caps and red/white/blue stripes on a glass tube. It is the station's
 * state light: `spinning` turns it while the station is working (starting up, syncing) and it
 * stands still at rest. `turnOnce` gives one turn as it appears (a service is chosen).
 * A span, so it may sit inside headings and buttons.
 */
export function BarberPoleIcon({
  className = "w-3.5 h-6",
  spinning = false,
  turnOnce = false,
}: {
  className?: string;
  spinning?: boolean;
  turnOnce?: boolean;
}) {
  const motion = spinning ? "rz-pole-spin" : turnOnce ? "rz-pole-once" : "";
  return (
    <span className={`rz-pole ${className}`} aria-hidden="true">
      <span className="rz-pole-cap" />
      <span className={`rz-pole-glass rz-stripes ${motion}`} />
      <span className="rz-pole-cap" />
    </span>
  );
}

/**
 * The shop's black logo banner, as it hangs on the crimson wall. The logo file is square: the
 * artwork sits on a near-black field (rows 168-552 of 720) between pure-black bands, so a 1.9:1
 * frame shows exactly that field. Pass alt="" when a heading already names the shop.
 * It is only ever shown above the fold, where it is the page's largest image, so it loads eagerly.
 */
export function RuzzcoLogoBanner({
  className = "w-72",
  alt = "Ruzzco Barbers",
  sizes = "(min-width: 640px) 28rem, 85vw",
}: {
  className?: string;
  alt?: string;
  sizes?: string;
}) {
  return (
    <div
      className={`relative aspect-[1.9/1] overflow-hidden rounded-md bg-[#080705] ring-1 ring-white/10 shadow-[0_26px_40px_-18px_rgb(0_0_0/0.9),0_2px_6px_rgb(0_0_0/0.5)] ${className}`}
    >
      <Image
        src="/ruzzco-logo.jpg"
        alt={alt}
        fill
        sizes={sizes}
        className="object-cover"
        loading="eager"
        fetchPriority="high"
      />
    </div>
  );
}

import React from "react";
import Image from "next/image";

/**
 * Gentleman's classic handlebar mustache matching Ruzzco Barbers logo
 */
export function MustacheIcon({ className = "w-6 h-3 text-red-600" }: { className?: string }) {
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
 * Mini barber pole badge with chrome caps and red/white/blue diagonal stripes
 */
export function BarberPoleIcon({ className = "w-3.5 h-6" }: { className?: string }) {
  return (
    <div
      className={`relative rounded-full overflow-hidden border border-zinc-600 shadow-sm flex flex-col justify-between shrink-0 ${className}`}
      title="Barber Pole"
    >
      <div className="h-1 bg-gradient-to-r from-zinc-300 via-zinc-100 to-zinc-400 shrink-0" />
      <div className="w-full h-full bg-barber-pole animate-pulse" style={{ animationDuration: "3s" }} />
      <div className="h-1 bg-gradient-to-r from-zinc-300 via-zinc-100 to-zinc-400 shrink-0" />
    </div>
  );
}

/**
 * Circular official crest logo badge
 */
export function RuzzcoLogoBadge({
  size = 40,
  showBorder = true,
}: {
  size?: number;
  showBorder?: boolean;
}) {
  return (
    <div
      className={`relative rounded-full overflow-hidden bg-black shrink-0 flex items-center justify-center ${
        showBorder ? "ring-2 ring-red-600/60 shadow-lg shadow-red-950/50" : ""
      }`}
      style={{ width: size, height: size }}
    >
      <Image
        src="/ruzzco-logo.jpg"
        alt="Ruzzco Barbers"
        width={size}
        height={size}
        className="object-cover scale-110"
        priority
      />
    </div>
  );
}

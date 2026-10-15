"use client";

import { useEffect, useRef, type PointerEvent, type ReactNode } from "react";

/**
 * The glass of the home page's station mirror. Like a real mirror seen from a moving head, the
 * reflection shifts against the pointer in depth (the far room, `.rz-reflect-far`, up to 16px; the
 * sign hung in front of it, `.rz-reflect-near`, half that) and the glass's sheen follows the
 * pointer; lettering on the glass stays put. Mouse only, and never for anyone who asked for less
 * motion: everyone else sees the mirror at rest.
 */
export function MirrorGlass({ children }: { children: ReactNode }) {
  const glass = useRef<HTMLDivElement>(null);
  const frame = useRef(0);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  function follow(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const { clientX, clientY } = event;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = glass.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      const x = Math.min(Math.max((clientX - box.left) / box.width, 0), 1);
      const y = Math.min(Math.max((clientY - box.top) / box.height, 0), 1);
      const dx = 0.5 - x;
      const dy = 0.5 - y;
      el.style.setProperty("--fx", `${(dx * 32).toFixed(2)}px`);
      el.style.setProperty("--fy", `${(dy * 16).toFixed(2)}px`);
      el.style.setProperty("--nx", `${(dx * 16).toFixed(2)}px`);
      el.style.setProperty("--ny", `${(dy * 8).toFixed(2)}px`);
      // The sheen's band sits at 1.25 - 1.5p of the glass width for background-position p.
      el.style.setProperty("--sx", `${(((1.25 - (0.18 + x * 0.64)) / 1.5) * 100).toFixed(1)}%`);
    });
  }

  function rest() {
    cancelAnimationFrame(frame.current);
    const el = glass.current;
    if (!el) return;
    for (const name of ["--fx", "--fy", "--nx", "--ny", "--sx"]) el.style.removeProperty(name);
  }

  return (
    <div ref={glass} onPointerMove={follow} onPointerLeave={rest} className="rz-mirror-glass">
      {children}
    </div>
  );
}

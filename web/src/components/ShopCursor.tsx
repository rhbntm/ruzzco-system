"use client";

import { useEffect, useRef } from "react";

// What the shears open for, and where the text cursor comes back.
const INTERACTIVE =
  "a[href], button, [role='button'], label, summary, select, input[type='checkbox'], input[type='radio'], input[type='submit'], input[type='button']";
const TEXT_ENTRY =
  "input:not([type='checkbox']):not([type='radio']):not([type='submit']):not([type='button']):not([type='range']), textarea, [contenteditable='true']";

// One blade of the shears in a 16x32 box, tip at (8, 1), pivot at (8, 16.2): the blade runs up the
// right of the tip and crosses at the pivot to its crimson ring on the left.
function Blade() {
  return (
    <>
      <path d="M7.2 16.8 L5.4 23.6" stroke="#0c0b0a" strokeWidth="3" strokeLinecap="round" />
      <path d="M7.2 16.8 L5.4 23.6" stroke="#b3b9c1" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="4.6" cy="27" r="2.9" fill="none" stroke="#0c0b0a" strokeWidth="2.7" />
      <circle cx="4.6" cy="27" r="2.9" fill="none" stroke="var(--color-crimson)" strokeWidth="1.6" />
      <path
        d="M8 1 C10.4 5.6 11.4 10.6 11.1 16.2 L7.2 16.2 C7.4 11 7.6 5.6 8 1 Z"
        fill="url(#rz-cursor-chrome)"
        stroke="#0c0b0a"
        strokeWidth="0.7"
        strokeLinejoin="round"
      />
    </>
  );
}

/**
 * The shop's cursor: barber's shears that follow the mouse, open over anything clickable and snip
 * shut on a click, dropping a few clippings. Mouse only and never under reduced motion; then the
 * still shears in globals.css (`/cursors/*.svg`) stand in. Text fields keep the text cursor.
 * The shears and their clippings ride on one layer over the page, which a page transition leaves
 * alone (globals.css), so they stay on top while one page fades into the next.
 */
export function ShopCursor() {
  const layer = useRef<HTMLDivElement>(null);
  const cursor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = cursor.current;
    const over = layer.current;
    if (!el || !over) return;
    const root = document.documentElement;
    const fine = window.matchMedia("(pointer: fine)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let x = 0;
    let y = 0;
    let live = false;

    const place = () => {
      frame = 0;
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    };

    const read = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return;
      if (target.closest(TEXT_ENTRY)) {
        el.dataset.state = "text";
        return;
      }
      const control = target.closest(INTERACTIVE);
      el.dataset.state = !control ? "rest" : control.matches(":disabled, [aria-disabled='true']") ? "disabled" : "ready";
    };

    // A few hairs fall from the blades on a snip.
    const clippings = (atX: number, atY: number) => {
      for (let i = 0; i < 3; i++) {
        const hair = document.createElement("span");
        hair.className = "rz-clip";
        if (i === 1) hair.style.backgroundColor = "var(--color-bone-2)";
        hair.style.setProperty("--x0", `${atX + (i - 1) * 3}px`);
        hair.style.setProperty("--y0", `${atY + 2}px`);
        hair.style.setProperty("--dx", `${(i - 1) * 7 + (Math.random() * 4 - 2)}px`);
        hair.style.setProperty("--r0", `${Math.round(Math.random() * 120 - 60)}deg`);
        hair.style.setProperty("--r1", `${Math.round(Math.random() * 240 - 120)}deg`);
        hair.addEventListener("animationend", () => hair.remove(), { once: true });
        over.appendChild(hair);
      }
    };

    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      x = event.clientX;
      y = event.clientY;
      el.dataset.visible = "true";
      read(event.target);
      if (!frame) frame = requestAnimationFrame(place);
    };

    const press = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      el.dataset.snip = "true";
      if (el.dataset.state !== "text") clippings(event.clientX, event.clientY);
    };

    const release = () => {
      delete el.dataset.snip;
    };

    const leave = (event: MouseEvent) => {
      if (!event.relatedTarget) el.dataset.visible = "false";
    };

    const listen = (on: boolean) => {
      if (on) {
        window.addEventListener("pointermove", move, { passive: true });
        window.addEventListener("pointerdown", press, { passive: true });
        window.addEventListener("pointerup", release, { passive: true });
        document.addEventListener("mouseout", leave);
      } else {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerdown", press);
        window.removeEventListener("pointerup", release);
        document.removeEventListener("mouseout", leave);
      }
    };

    const apply = () => {
      const on = fine.matches && !reduce.matches;
      if (on === live) return;
      live = on;
      root.classList.toggle("rz-cursor-live", on);
      listen(on);
      if (!on) el.dataset.visible = "false";
    };

    apply();
    fine.addEventListener("change", apply);
    reduce.addEventListener("change", apply);
    return () => {
      fine.removeEventListener("change", apply);
      reduce.removeEventListener("change", apply);
      if (live) listen(false);
      root.classList.remove("rz-cursor-live");
      cancelAnimationFrame(frame);
      document.querySelectorAll(".rz-clip").forEach((hair) => hair.remove());
    };
  }, []);

  return (
    <div ref={layer} className="rz-cursor-layer" aria-hidden="true">
      <div ref={cursor} className="rz-cursor" data-visible="false" data-state="rest">
        <svg className="rz-cursor-art" viewBox="0 0 16 32" width="20" height="40">
          <defs>
            <linearGradient id="rz-cursor-chrome" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#6f757d" />
              <stop offset="0.45" stopColor="#f6f7f9" />
              <stop offset="0.7" stopColor="#b3b9c1" />
              <stop offset="1" stopColor="#7f858d" />
            </linearGradient>
          </defs>
          <g className="rz-cursor-blade rz-cursor-blade-b">
            <g transform="translate(16 0) scale(-1 1)">
              <Blade />
            </g>
          </g>
          <g className="rz-cursor-blade rz-cursor-blade-a">
            <Blade />
          </g>
          <circle cx="8" cy="16.2" r="1.2" fill="var(--color-brass-bright)" stroke="#0c0b0a" strokeWidth="0.5" />
        </svg>
      </div>
    </div>
  );
}

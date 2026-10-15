"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef } from "react";

// What the air holds. Far dust is too small to show hair, so clippings drift only at middle and
// near depths, and the nearest specks are out of focus.
const DUST = 0;
const CLIPPING = 1;
const BLUR = 2;

type Speck = {
  kind: number;
  x: number;
  y: number;
  /** Depth: 0 by the wall, 1 nearest the glass. Near specks are larger and move more. */
  z: number;
  /** Air pushed into it (by the shears, a snip or a scroll), px/s. Settles back. */
  vx: number;
  vy: number;
  /** Its own fall, px/s. */
  fall: number;
  /** How far the room's draft carries it, px/s. */
  sway: number;
  /** Radius of dust, or length of a clipping, px. */
  size: number;
  /** A clipping's thickness, px. */
  width: number;
  /** A clipping's curl: which of the drawn hairs it is. */
  curl: number;
  rot: number;
  spin: number;
  /** Extra spin from a snip or a passing blade. Settles back. */
  tumble: number;
  tone: number;
  alpha: number;
  phase: number;
  flicker: number;
  /** Light caught from the shears' chrome, 0 to 1. */
  glint: number;
};

// The air's colours: dust and bone, warmed toward crimson ink where the accent wall's light falls.
const TONES: [number, number, number][] = [
  [166, 158, 147],
  [216, 208, 196],
];
const WARM: [number, number, number] = [242, 127, 132];
const WARM_STEPS = 6;
const CURLS = [-0.12, 0, 0.12];

const EDGE = 32; // px the air runs past the screen before it wraps round
const REACH = 160; // px around the shears that the air feels them
// A passing blade drags the air along, (px/s) per px it travels, and pushes it gently aside. Over
// one pass through its reach a speck on its path moves some 50px: it stirs the air, never sweeps it.
const DRAG = 1.2;
const PART = 1;
const STROKE = 24; // px of a blade's travel that counts in one step, however fast the hand
const PUFF = 200; // px a snip's puff of air reaches
const PUFF_FORCE = 240; // px/s at the blades
const STIR = 0.26; // a scroll stirs the near air, which carries on a little after the page stops
const TILT_RATE = 0.07; // the light tilts up the wall at 7% of the scroll...
const TILT_MAX = 0.12; // ...up to 12% of the screen (the light runs 12vh past the foot to allow it)

// The hair sprite: drawn 32px long and 2px thick in a 40 x 12 box, near the size it is shown at so
// scaling it down never thins a hair to nothing; each clipping scales it to its own length.
const HAIR_W = 40;
const HAIR_H = 12;
const HAIR_LEN = 32;
const HAIR_THICK = 2;

function mix(a: [number, number, number], b: [number, number, number], t: number) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t)) as [number, number, number];
}

function canvas2d(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext("2d") };
}

// A speck of light, drawn once per colour and reused for every speck in the air.
function speckSprite([r, g, b]: [number, number, number], blur: boolean) {
  const { canvas, ctx } = canvas2d(64, 64);
  if (!ctx) return canvas;
  const fill = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  const stops: [number, number][] = blur
    ? // out of focus: a flat disc, a touch brighter at its rim, as a lens draws it
      [[0, 0.5], [0.66, 0.44], [0.84, 0.52], [0.94, 0.2], [1, 0]]
    : // in focus: a bright core blooming into its own soft halo
      [[0, 1], [0.12, 0.92], [0.3, 0.4], [0.55, 0.1], [1, 0]];
  for (const [at, a] of stops) fill.addColorStop(at, `rgb(${r} ${g} ${b} / ${a})`);
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, 64, 64);
  return canvas;
}

// A clipping: a fine curved hair with a soft edge, drawn once per colour and curl.
function hairSprite([r, g, b]: [number, number, number], curl: number) {
  const { canvas, ctx } = canvas2d(HAIR_W, HAIR_H);
  if (!ctx) return canvas;
  const x0 = (HAIR_W - HAIR_LEN) / 2;
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(x0, HAIR_H / 2);
    ctx.quadraticCurveTo(HAIR_W / 2, HAIR_H / 2 + curl * HAIR_LEN * 0.5, x0 + HAIR_LEN, HAIR_H / 2);
  };
  ctx.lineCap = "round";
  ctx.strokeStyle = `rgb(${r} ${g} ${b} / 0.35)`;
  ctx.lineWidth = HAIR_THICK * 1.8;
  trace();
  ctx.stroke();
  ctx.strokeStyle = `rgb(${r} ${g} ${b})`;
  ctx.lineWidth = HAIR_THICK;
  trace();
  ctx.stroke();
  return canvas;
}

// One of the room's lights at a point: full at its centre, nothing from 70% of its radii out, as
// the gradients in globals.css fall off.
function glow(x: number, y: number, cx: number, cy: number, rx: number, ry: number) {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  const r = Math.sqrt(dx * dx + dy * dy) / 0.7;
  return r < 1 ? 1 - r : 0;
}

/**
 * The room behind every page: the shop's light on the wall, and the air in front of it, where
 * fine hair clippings and dust drift down through the light. The specks are lit by the room's own
 * lights (warm under the accent wall and by the embers, nearly gone in the dark between) and catch
 * the light off the shears as they pass. With a mouse, the shears drag the air along and push it
 * aside, and a snip sends a puff through it. Scrolling moves near specks faster than far ones, the
 * near ones carry on a little after the page stops, and the light tilts up the wall.
 *
 * Without JavaScript, or with reduced motion, the room is still: the light alone, as globals.css
 * draws it. Phones get less air at half the frame rate, and no cursor. The air holds still under a
 * dialog or the Insights presentation, which cover it.
 */
export function ShopRoom() {
  const lightRef = useRef<HTMLDivElement>(null);
  const airRef = useRef<HTMLCanvasElement>(null);
  const cutUntil = useRef(0);
  const pathname = usePathname();

  // A navigation sets the new page at its own scroll position. That is a cut, not a scroll, so the
  // air doesn't fly with it (this runs in the same commit as the router's scroll reset).
  useLayoutEffect(() => {
    cutUntil.current = performance.now() + 160;
  }, [pathname]);

  useEffect(() => {
    const canvas = airRef.current;
    const light = lightRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !light || !ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarse = window.matchMedia("(pointer: coarse)");

    // Every colour a speck can take, from plain dust to dust in the crimson light.
    const shade = (tone: [number, number, number], i: number, warmest: number) =>
      mix(tone, WARM, (i / (WARM_STEPS - 1)) * warmest);
    const dots = TONES.map((tone) => Array.from({ length: WARM_STEPS }, (_, i) => speckSprite(shade(tone, i, 0.7), false)));
    const blurs = TONES.map((tone) => Array.from({ length: WARM_STEPS }, (_, i) => speckSprite(shade(tone, i, 0.7), true)));
    const hairs = TONES.map((tone) =>
      Array.from({ length: WARM_STEPS }, (_, i) => CURLS.map((curl) => hairSprite(shade(tone, i, 0.55), curl))),
    );

    const specks: Speck[] = [];
    let phone = coarse.matches;
    let step = phone ? 1000 / 30 : 1000 / 60;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let frame = 0;
    let running = false;
    let resized = true;
    let last = 0; // the last step of the air, ms
    let lightLast = 0;
    let shown = 0; // the air comes up with the lights when the page first loads
    let lightY = 0; // the light's tilt, px
    let lightShown = 0;
    let scrollLast = window.scrollY;
    let scrolled = 0; // px scrolled since the air last stepped
    let scrollV = 0;
    let paused = false;
    let pauseCheck = 0;
    let mouseIn = false;
    let mx = 0;
    let my = 0;
    let mLastX = 0;
    let mLastY = 0;
    const snips: number[] = [];

    const seed = (p: Speck) => {
      const z = Math.random() ** 1.15;
      const pick = Math.random();
      p.kind = z > 0.75 && pick < 0.5 ? BLUR : z > 0.3 && pick < 0.45 ? CLIPPING : DUST;
      p.z = z;
      p.x = Math.random() * w;
      p.y = Math.random() * h;
      p.vx = p.vy = p.tumble = p.glint = 0;
      p.sway = 3 + z * 11;
      p.width = 0;
      p.curl = Math.floor(Math.random() * CURLS.length);
      if (p.kind === BLUR) {
        p.size = 5 + Math.random() * 9;
        p.fall = 3 + z * 5;
        p.alpha = 0.08 + Math.random() * 0.12;
      } else if (p.kind === CLIPPING) {
        p.size = 6 + z * 11 + Math.random() * 3;
        p.width = 0.55 + z * 0.65;
        p.fall = 5 + z * 13;
        p.alpha = 0.65 + Math.random() * 0.35;
      } else {
        p.size = 0.5 + z * 1.5 + Math.random() * 0.3;
        p.fall = 2 + z * 7;
        p.alpha = 0.6 + Math.random() * 0.4;
      }
      p.rot = Math.random() * Math.PI * 2;
      p.spin = (0.25 + Math.random() * 1.1) * (Math.random() < 0.5 ? -1 : 1);
      p.tone = Math.random() < 0.5 ? 0 : 1;
      p.phase = Math.random() * Math.PI * 2;
      p.flicker = 0.5 + Math.random() * 1.4;
      return p;
    };

    // Fit the canvas to the room and fill it with as much air as it holds: less on a phone, where
    // the pages cover most of it.
    const fit = () => {
      resized = false;
      const rect = canvas.getBoundingClientRect();
      const nw = Math.max(1, Math.round(rect.width));
      const nh = Math.max(1, Math.round(rect.height));
      // The specks are soft, so a phone draws them at a lower resolution than its screen.
      const ndpr = Math.min(window.devicePixelRatio || 1, phone ? 1.25 : 2);
      if (w && h && (nw !== w || nh !== h)) {
        for (const p of specks) {
          p.x *= nw / w;
          p.y *= nh / h;
        }
      }
      w = nw;
      h = nh;
      if (canvas.width !== Math.round(w * ndpr) || canvas.height !== Math.round(h * ndpr)) {
        canvas.width = Math.round(w * ndpr);
        canvas.height = Math.round(h * ndpr);
      }
      dpr = ndpr;
      const area = w * h;
      const want = phone
        ? Math.min(60, Math.max(30, Math.round(area / 5000)))
        : Math.min(220, Math.max(60, Math.round(area / 6500)));
      while (specks.length < want) specks.push(seed({} as Speck));
      specks.length = want;
    };

    // The light tilts up the wall as the page goes down. Every frame, so it stays with the scroll
    // even while the air steps at half rate on a phone; eased, so a navigation's jump back to the
    // top is a glide rather than a cut.
    const tilt = (now: number, scrollY: number) => {
      const dt = Math.min(0.1, (now - lightLast) / 1000);
      lightLast = now;
      const target = -Math.min(scrollY * TILT_RATE, h * TILT_MAX);
      lightY += (target - lightY) * (1 - Math.exp(-dt * 14));
      if (Math.abs(lightY - lightShown) > 0.15) {
        lightShown = lightY;
        light.style.transform = `translate3d(0, ${lightY.toFixed(2)}px, 0)`;
      }
    };

    const stepAir = (dt: number, t: number) => {
      // How far the shears moved since the last step, and which way is across their path.
      const mdx = mouseIn ? mx - mLastX : 0;
      const mdy = mouseIn ? my - mLastY : 0;
      mLastX = mx;
      mLastY = my;
      const moved = Math.hypot(mdx, mdy);
      const nx = moved > 0 ? -mdy / moved : 0;
      const ny = moved > 0 ? mdx / moved : 0;
      const travel = Math.min(moved, STROKE);
      const kept = moved > 0 ? travel / moved : 0;

      scrollV += (scrolled / dt - scrollV) * 0.5;
      const settle = Math.exp(-dt * 2.2);
      const unwind = Math.exp(-dt * 1.6);
      const ease = 1 - Math.exp(-dt * 9);
      shown = Math.min(1, shown + dt / 1.4);

      for (const p of specks) {
        const depth = 0.3 + 0.7 * p.z;
        let caught = 0;

        // The shears move the air they pass through: specks near the blades' path are dragged
        // along and pushed aside. Standing still, the shears only catch the light.
        if (mouseIn) {
          const dx = p.x - mx;
          const dy = p.y - my;
          const d2 = dx * dx + dy * dy;
          if (d2 < REACH * REACH) {
            const near = 1 - Math.sqrt(d2) / REACH;
            caught = near * near;
            if (travel > 0.5) {
              const f = caught * depth;
              const side = dx * nx + dy * ny < 0 ? -1 : 1;
              p.vx += (mdx * kept * DRAG + nx * side * travel * PART) * f;
              p.vy += (mdy * kept * DRAG + ny * side * travel * PART) * f;
              p.tumble += travel * 0.04 * f * Math.sign(p.spin);
            }
          }
        }

        // A snip puffs the air out from the blades, and a little up.
        for (let i = 0; i < snips.length; i += 2) {
          const dx = p.x - snips[i];
          const dy = p.y - snips[i + 1];
          const d2 = dx * dx + dy * dy;
          if (d2 < PUFF * PUFF) {
            const d = Math.sqrt(d2) || 1;
            const k = 1 - d / PUFF;
            const f = k * k * depth * PUFF_FORCE;
            p.vx += (dx / d) * f;
            p.vy += (dy / d) * f - f * 0.25;
            p.tumble += (Math.random() * 2 - 1) * 7 * k;
            caught = Math.max(caught, k);
          }
        }

        // The room's draft: a slow current shared by neighbouring specks, with each one's own flutter.
        const draft = Math.sin(p.y * 0.0043 + t * 0.21) * 0.6 + Math.sin((p.x + p.y) * 0.0016 - t * 0.12) * 0.4;
        const lift = Math.cos(p.x * 0.0037 - t * 0.17) * 0.3;
        const flutter = Math.sin(t * p.flicker * 0.8 + p.phase) * 0.35;

        // Scrolling carries the specks by their depth, and stirs the near ones.
        p.vy -= scrolled * STIR * p.z;
        p.x += ((draft + flutter) * p.sway + p.vx) * dt;
        p.y += (p.fall + lift * p.sway + p.vy) * dt - scrolled * (0.1 + 0.45 * p.z);
        p.vx *= settle;
        p.vy *= settle;
        p.tumble *= unwind;
        p.rot += (p.spin + p.tumble) * dt;
        p.glint += (caught - p.glint) * ease;

        if (p.y > h + EDGE) {
          p.y -= h + 2 * EDGE;
          p.x = Math.random() * w;
        } else if (p.y < -EDGE) {
          p.y += h + 2 * EDGE;
          p.x = Math.random() * w;
        }
        if (p.x > w + EDGE) p.x -= w + 2 * EDGE;
        else if (p.x < -EDGE) p.x += w + 2 * EDGE;
      }
      snips.length = 0;
      scrolled = 0;
    };

    const draw = (t: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const up = shown * shown * (3 - 2 * shown);
      if (up <= 0) return;
      // Dust first, under one shared transform; hairs after, each turned to its own angle.
      let based = false;
      for (let pass = 0; pass < 2; pass++) {
        for (const p of specks) {
          if ((p.kind === CLIPPING) !== (pass === 1)) continue;

          // The room's light where the speck is: the accent wall, the LED tube, the two embers.
          // Dust shows where the light falls and all but vanishes in the dark between.
          const wall = 0.42 * glow(p.x, p.y, w * 0.5, lightY - h * 0.15, w * 1.3, h * 0.85);
          const tube = 0.06 * glow(p.x, p.y, w * 0.5, lightY - 112, 960, 256);
          const embers =
            0.36 * glow(p.x, p.y, w * 1.05, lightY + h * 1.05, w * 0.85, h * 0.7) +
            0.18 * glow(p.x, p.y, -w * 0.05, lightY + h * 0.75, w * 0.7, h * 0.6);
          const warmth = wall + embers;
          const lit = Math.min(1, 0.16 + warmth * 3.4 + tube * 8);

          let a = p.alpha * lit * up * (1 + p.glint * 1.8);
          if (p.kind === CLIPPING) {
            // A hair flashes as it turns broadside to the light.
            const c = Math.cos(p.rot);
            a *= 0.25 + 0.75 * c * c;
          } else {
            a *= 0.62 + 0.38 * Math.sin(t * p.flicker + p.phase);
          }
          if (a < 0.01) continue;
          ctx.globalAlpha = Math.min(1, a);

          // Warm where the crimson light falls; the shears' chrome lights them whiter.
          const warm = Math.round((warmth / (warmth + tube * 2.5 + 0.05)) * (1 - p.glint * 0.75) * (WARM_STEPS - 1));

          if (p.kind === CLIPPING) {
            const along = (Math.cos(p.rot) * p.size * dpr) / HAIR_LEN;
            const down = (Math.sin(p.rot) * p.size * dpr) / HAIR_LEN;
            const thick = (p.width * dpr) / HAIR_THICK;
            ctx.setTransform(along, down, -Math.sin(p.rot) * thick, Math.cos(p.rot) * thick, p.x * dpr, p.y * dpr);
            ctx.drawImage(hairs[p.tone][warm][p.curl], -HAIR_W / 2, -HAIR_H / 2);
            continue;
          }

          const img = (p.kind === BLUR ? blurs : dots)[p.tone][warm];
          const d = p.kind === BLUR ? p.size * 2.2 : p.size * 7 * (1 + p.glint * 0.35);
          // Streaked along their way while the page scrolls fast, the nearer the more.
          const vx = p.vx;
          const vy = p.fall + p.vy - scrollV * (0.1 + 0.45 * p.z);
          const stretch = 1 + Math.min(Math.hypot(vx, vy) / 700, 1) * p.z;
          if (stretch > 1.05) {
            const angle = Math.atan2(vy, vx);
            const c = Math.cos(angle) * dpr;
            const s = Math.sin(angle) * dpr;
            ctx.setTransform(c * stretch, s * stretch, -s, c, p.x * dpr, p.y * dpr);
            ctx.drawImage(img, -d / 2, -d / 2, d, d);
            based = false;
          } else {
            if (!based) {
              ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
              based = true;
            }
            ctx.drawImage(img, p.x - d / 2, p.y - d / 2, d, d);
          }
        }
      }
    };

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (resized) fit();

      // A dialog's frosted backdrop or the Insights presentation covers the room; the air holds
      // still under them rather than make the frost redraw for every frame.
      if (now - pauseCheck > 400) {
        pauseCheck = now;
        paused = document.fullscreenElement !== null || document.querySelector(".rz-overlay, .rz-stage") !== null;
      }
      const scrollY = window.scrollY;
      if (paused) {
        scrollLast = scrollY;
        last = lightLast = now;
        return;
      }

      let moved = scrollY - scrollLast;
      scrollLast = scrollY;
      if (now < cutUntil.current || Math.abs(moved) > h * 0.75) moved = 0;
      scrolled += moved;
      tilt(now, scrollY);

      if (now - last < step - 1) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      stepAir(dt, now / 1000);
      draw(now / 1000);
    };

    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      mx = event.clientX;
      my = event.clientY;
      if (!mouseIn) {
        mLastX = mx;
        mLastY = my;
        mouseIn = true;
      }
    };

    const press = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      snips.push(event.clientX, event.clientY);
    };

    const leave = (event: MouseEvent) => {
      if (!event.relatedTarget) mouseIn = false;
    };

    const away = () => {
      mouseIn = false;
    };

    const resize = () => {
      resized = true;
    };

    const repoint = () => {
      phone = coarse.matches;
      step = phone ? 1000 / 30 : 1000 / 60;
      mouseIn = false;
      resized = true;
    };

    const listen = (on: boolean) => {
      if (on) {
        window.addEventListener("pointermove", move, { passive: true });
        window.addEventListener("pointerdown", press, { passive: true });
        window.addEventListener("resize", resize);
        window.addEventListener("blur", away);
        document.addEventListener("mouseout", leave);
        coarse.addEventListener("change", repoint);
      } else {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerdown", press);
        window.removeEventListener("resize", resize);
        window.removeEventListener("blur", away);
        document.removeEventListener("mouseout", leave);
        coarse.removeEventListener("change", repoint);
      }
    };

    const apply = () => {
      const on = !reduce.matches;
      if (on === running) return;
      running = on;
      listen(on);
      if (on) {
        scrollLast = window.scrollY;
        last = lightLast = performance.now();
        frame = requestAnimationFrame(tick);
      } else {
        cancelAnimationFrame(frame);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        light.style.transform = "";
        lightY = lightShown = 0;
        mouseIn = false;
      }
    };

    apply();
    reduce.addEventListener("change", apply);
    return () => {
      reduce.removeEventListener("change", apply);
      if (running) listen(false);
      cancelAnimationFrame(frame);
      light.style.transform = "";
    };
  }, []);

  return (
    <div className="rz-room" aria-hidden="true">
      <div ref={lightRef} className="rz-room-light" />
      <canvas ref={airRef} className="rz-room-air" />
    </div>
  );
}

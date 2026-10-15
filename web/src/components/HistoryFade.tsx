"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

// A still copy of an element as it looks right now. A clone keeps only the markup, so carry over
// what was typed and drawn since (never a PIN: a password field appearing with a value could set
// off a password manager), and let its images show at once.
function still(el: HTMLElement) {
  const copy = el.cloneNode(true) as HTMLElement;
  const fields = el.querySelectorAll("input, textarea, select");
  const twins = copy.querySelectorAll("input, textarea, select");
  fields.forEach((field, i) => {
    const twin = twins[i];
    if (field instanceof HTMLInputElement && twin instanceof HTMLInputElement) {
      if (field.type !== "file" && field.type !== "password") twin.value = field.value;
      twin.checked = field.checked;
    } else if (field instanceof HTMLTextAreaElement && twin instanceof HTMLTextAreaElement) {
      twin.value = field.value;
    } else if (field instanceof HTMLSelectElement && twin instanceof HTMLSelectElement) {
      twin.selectedIndex = field.selectedIndex;
    }
  });
  const drawn = copy.querySelectorAll("canvas");
  el.querySelectorAll("canvas").forEach((canvas, i) => {
    if (canvas.width && canvas.height) drawn[i]?.getContext("2d")?.drawImage(canvas, 0, 0);
  });
  copy.querySelectorAll("img").forEach((img) => {
    img.loading = "eager";
  });
  return copy;
}

/**
 * Back and forward fade the way a link does. A link's fade is a view transition (app/template.tsx),
 * but React applies a back or forward navigation at once, inside the popstate event, so that the
 * browser can put the scroll position back; that leaves no moment to capture the page being left.
 * So just before the swap, a still copy of that page is laid over it, scrolled as it was, and fades
 * out (globals.css, .rz-ghost), while the new page comes up underneath a beat later. The browser's
 * own swipe-back animation, a same-page change and the Insights presentation are left alone.
 */
export function HistoryFade() {
  const pathname = usePathname();
  const showing = useRef(pathname);

  useEffect(() => {
    showing.current = pathname;
  }, [pathname]);

  useEffect(() => {
    const root = document.documentElement;
    let scrollX = window.scrollX;
    let scrollY = window.scrollY;
    let ghost: HTMLElement | null = null;
    let timer = 0;

    const settle = () => {
      window.clearTimeout(timer);
      ghost?.remove();
      ghost = null;
      root.classList.remove("rz-traverse");
    };

    // Where the page was scrolled before the browser restores the next one.
    const scrolled = () => {
      scrollX = window.scrollX;
      scrollY = window.scrollY;
    };

    const traverse = (event: PopStateEvent) => {
      if (location.pathname === showing.current) return;
      if ((event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition) return;
      if (document.fullscreenElement || document.querySelector(".rz-stage")) return;
      settle();

      const copy = document.createElement("div");
      copy.className = "rz-ghost";
      copy.setAttribute("aria-hidden", "true");
      copy.inert = true;
      copy.style.width = `${root.clientWidth}px`;
      for (const child of Array.from(document.body.children)) {
        if (!(child instanceof HTMLElement) || child.hidden || child.localName.includes("-")) continue;
        if (child.matches("script, style, link, noscript, template, .rz-room, .rz-cursor-layer")) continue;
        copy.appendChild(still(child));
      }
      document.body.appendChild(copy);
      copy.scrollTop = scrollY;
      copy.scrollLeft = scrollX;
      copy.addEventListener("animationend", () => copy.remove(), { once: true });
      ghost = copy;
      root.classList.add("rz-traverse");
      timer = window.setTimeout(settle, 700);
    };

    window.addEventListener("scroll", scrolled, { passive: true });
    // Capture, so the copy is taken before the router's own listener swaps the page.
    window.addEventListener("popstate", traverse, true);
    return () => {
      window.removeEventListener("scroll", scrolled);
      window.removeEventListener("popstate", traverse, true);
      settle();
    };
  }, []);

  return null;
}

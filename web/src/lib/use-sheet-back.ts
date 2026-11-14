import { useEffect, useRef } from "react";
import { IDLE, sheetPop, syncSheets, type SheetMove, type SheetNav } from "./sheet-stack";

// Where a sheet's history entry keeps its depth. Next.js copies its own keys into the same state.
const MARK = "rzSheet";

function markOf(state: unknown): number {
  const mark = (state as Record<string, unknown> | null)?.[MARK];
  return typeof mark === "number" && Number.isInteger(mark) && mark > 0 ? mark : 0;
}

function apply(move: SheetMove, nav: { current: SheetNav }, close: (count: number) => void) {
  nav.current = move.nav;
  // Same address: the entry only gives the phone's Back something to return from.
  for (const mark of move.push) window.history.pushState({ [MARK]: mark }, "");
  if (move.go !== 0) window.history.go(move.go);
  if (move.close > 0) close(move.close);
}

/**
 * The phone's Back closes the sheet on top instead of leaving the page (slice 17b; the rules are
 * in lib/sheet-stack.ts). `depth` is how many sheets are open; `onBack(count)` closes that many
 * from the top and must record nothing.
 */
export function useSheetBack(depth: number, onBack: (count: number) => void) {
  const nav = useRef<SheetNav>(IDLE);
  const live = useRef({ depth, onBack });

  useEffect(() => {
    live.current = { depth, onBack };
  });

  useEffect(() => {
    apply(syncSheets(nav.current, depth, markOf(window.history.state)), nav, (count) => live.current.onBack(count));
  }, [depth]);

  useEffect(() => {
    const page = window.location.pathname;
    const onPopState = (event: PopStateEvent) => {
      // Leaving the page: the router's business. The sheets go with the page.
      if (window.location.pathname !== page) {
        nav.current = IDLE;
        return;
      }
      const move = sheetPop(nav.current, live.current.depth, markOf(event.state));
      if (!move.handled) return;
      // A sheet entry has the page's own address and router state, so the router has nothing to
      // change: keep the event from it, and the page (with the ticket's inputs) stays as it is.
      event.stopImmediatePropagation();
      apply(move, nav, (count) => live.current.onBack(count));
    };
    // Capture, so this runs before the router's own listener.
    window.addEventListener("popstate", onPopState, true);
    return () => window.removeEventListener("popstate", onPopState, true);
  }, []);
}

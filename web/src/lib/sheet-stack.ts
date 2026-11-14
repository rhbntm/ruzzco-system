/**
 * The sheets on /pos and the phone's Back (slice 17b). Pure: no DOM, no React. /pos uses it
 * through lib/use-sheet-back.ts; the tests drive it with a pretend browser history.
 *
 * Every open sheet has one browser-history entry, marked with its depth (1 = the bottom sheet;
 * the page's own entry counts as 0). So the phone's Back lands on the entry below and closes the
 * sheet on top, instead of leaving the POS. Nothing here records, changes or drops a sale.
 */

export type SheetId = "settings" | "charge" | "digital" | "done";

export interface SheetFlags {
  settings: boolean;
  charging: boolean;
  /** The GCash/Maya dialog. It opens from the charge sheet and sits on top of it. */
  digital: boolean;
  /** The done screen. It replaces the charge sheet once the sale is saved. */
  done: boolean;
}

/** The open sheets, bottom to top. Back closes the last one. */
export function openSheets(flags: SheetFlags): SheetId[] {
  const sheets: SheetId[] = [];
  if (flags.settings) sheets.push("settings");
  if (flags.charging) sheets.push("charge");
  if (flags.digital) sheets.push("digital");
  if (flags.done) sheets.push("done");
  return sheets;
}

export interface SheetNav {
  /** The depth our own step back (a sheet closed on screen) is heading for; null when none is under way. */
  target: number | null;
}

export const IDLE: SheetNav = { target: null };

export interface SheetMove {
  nav: SheetNav;
  /** Depth marks of the history entries to push, in order. */
  push: number[];
  /** Steps for history.go(): negative to step back over entries, 0 for none. */
  go: number;
  /** How many sheets to close, from the top. */
  close: number;
  /** For a popstate: it was about a sheet entry, so the router has nothing to do with it. */
  handled: boolean;
}

const stay = (nav: SheetNav, handled = false): SheetMove => ({ nav, push: [], go: 0, close: 0, handled });

/**
 * The open sheets changed (`depth` of them now) while the browser sits on the entry marked `mark`.
 * A new sheet gets an entry; a sheet closed on screen gives its entry back. Replacing one sheet by
 * another at the same depth (the charge sheet becoming the done screen) changes nothing.
 */
export function syncSheets(nav: SheetNav, depth: number, mark: number): SheetMove {
  // Our own step back has not landed yet: wait for it (sheetPop syncs again when it does).
  if (nav.target !== null && mark !== nav.target) return stay(nav);
  if (depth > mark) {
    return { nav: IDLE, push: Array.from({ length: depth - mark }, (_, i) => mark + i + 1), go: 0, close: 0, handled: false };
  }
  if (depth < mark) return { nav: { target: depth }, push: [], go: depth - mark, close: 0, handled: false };
  return stay(IDLE);
}

/**
 * The browser went back or forward on this page and landed on the entry marked `mark`, with
 * `depth` sheets open.
 */
export function sheetPop(nav: SheetNav, depth: number, mark: number): SheetMove {
  // Our own step back landed: nothing to close. A sheet opened meanwhile still gets its entry.
  if (nav.target !== null && mark === nav.target) return { ...syncSheets(IDLE, depth, mark), handled: true };
  // Back: close the sheets above the entry.
  if (mark < depth) return { nav: IDLE, push: [], go: 0, close: depth - mark, handled: true };
  // Forward into the entry of a sheet that is already closed: step back out; it does not reopen.
  if (mark > depth) return { nav: { target: depth }, push: [], go: depth - mark, close: 0, handled: true };
  // Level with the open sheets. With none open this is the page's own entry: the browser's business.
  return stay(IDLE, depth > 0);
}

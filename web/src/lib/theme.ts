// The theme switch (UI only). Light is the default; the dark palette (the tokens under
// :root[data-theme="dark"] in globals.css) is chosen with the switch in the owner menu and kept in
// this browser's localStorage. No colour literal here: the browser's tint follows the --color-wall token.

export const THEME_KEY = "ruzzco-theme";
export const THEME_EVENT = "ruzzco-theme-change";

/** Runs in <head> before the first paint, so a chosen dark theme never flashes light. */
export const THEME_INIT_SCRIPT = `(function(){try{if(localStorage.getItem("${THEME_KEY}")==="dark"){document.documentElement.setAttribute("data-theme","dark")}}catch(e){}})();`;

export function isDark(): boolean {
  return typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "dark";
}

/** The phone browser's toolbar follows the page's canvas colour. */
function tintToolbar() {
  const meta = document.querySelector('meta[name="theme-color"]');
  const wall = getComputedStyle(document.documentElement).getPropertyValue("--color-wall").trim();
  if (meta && wall) meta.setAttribute("content", wall);
}

export function setTheme(toDark: boolean) {
  const root = document.documentElement;
  if (toDark) root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
  try {
    if (toDark) localStorage.setItem(THEME_KEY, "dark");
    else localStorage.removeItem(THEME_KEY);
  } catch {
    // Storage blocked: the theme still changes for this visit.
  }
  tintToolbar();
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function subscribeTheme(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

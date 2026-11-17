"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { isDark, setTheme, subscribeTheme } from "@/lib/theme";

// Light or dark for this browser. The server render is always light; the chosen theme is applied
// before paint by the script in the root layout, and these controls follow it.
function useDark() {
  const dark = useSyncExternalStore(subscribeTheme, isDark, () => false);
  // Keep the phone toolbar tint right when the page opens already dark.
  useEffect(() => { if (dark) setTheme(true); }, [dark]);
  return dark;
}

// The barber's pages have no corner button: on /pos the switch is in the phone settings.
const BARBER_PATHS = ["/pos", "/shift-log"];

/** One icon fixed in the top right corner (root layout), above the sticky headers and below dialogs. */
export function ThemeToggle() {
  const dark = useDark();
  const pathname = usePathname() ?? "";
  if (BARBER_PATHS.includes(pathname)) return null;
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      onClick={() => setTheme(!dark)}
      aria-label={label}
      title={label}
      className="rz-btn rz-btn-secondary rz-btn-icon fixed right-2 top-3 z-[45] min-h-10 min-w-10 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
    >
      {dark ? <Sun aria-hidden="true" className="h-4 w-4" /> : <Moon aria-hidden="true" className="h-4 w-4" />}
    </button>
  );
}

/** The same switch as a row in the POS phone settings. */
export function ThemeSwitchButton() {
  const dark = useDark();
  return (
    <button type="button" onClick={() => setTheme(!dark)} className="rz-btn rz-btn-secondary w-full min-h-12">
      {dark ? <Sun aria-hidden="true" className="w-4 h-4 text-dust" /> : <Moon aria-hidden="true" className="w-4 h-4 text-dust" />}
      {dark ? "Light mode" : "Dark mode"}
    </button>
  );
}

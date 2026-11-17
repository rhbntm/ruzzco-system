"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { isDark, setTheme, subscribeTheme } from "@/lib/theme";

// Light or dark for this browser (the owner menu). The server render is always light; the chosen
// theme is applied before paint by the script in the root layout, and this button follows it.
export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribeTheme, isDark, () => false);
  // Keep the phone toolbar tint right when the page opens already dark.
  useEffect(() => { if (dark) setTheme(true); }, [dark]);
  return (
    <button type="button" onClick={() => setTheme(!dark)} className="rz-btn rz-btn-secondary w-full min-h-11 justify-start">
      {dark ? <Sun aria-hidden="true" className="h-4 w-4" /> : <Moon aria-hidden="true" className="h-4 w-4" />}
      {dark ? "Light mode" : "Dark mode"}
    </button>
  );
}

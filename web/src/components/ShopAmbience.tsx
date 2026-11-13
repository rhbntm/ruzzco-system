"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { ShopCursor } from "./ShopCursor";
import { ShopRoom } from "./ShopRoom";

/** Pages that are worked at the counter: plain wall, no moving air, the system cursor (slice 17). */
function isPlainPage(pathname: string | null) {
  return pathname === "/pos" || Boolean(pathname?.startsWith("/pos/"));
}

/**
 * The room (light, clippings and dust) and the shears cursor behind every page, except on the POS,
 * where readability comes first. `html.rz-plain` also drops the wall's grain and the still shears
 * cursor (globals.css). Unmounting stops the room's animation and the cursor's listeners.
 */
export function ShopAmbience() {
  const plain = isPlainPage(usePathname());

  useEffect(() => {
    document.documentElement.classList.toggle("rz-plain", plain);
    return () => document.documentElement.classList.remove("rz-plain");
  }, [plain]);

  if (plain) return null;
  return (
    <>
      <ShopRoom />
      <ShopCursor />
    </>
  );
}

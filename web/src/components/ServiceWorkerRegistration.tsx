"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js, which lets an installed phone open the POS and the shift log
 * without a connection. Service workers need HTTPS, so on the plain-HTTP setup (and on
 * http://localhost while developing) this does nothing.
 * NEXT_PUBLIC_SERVICE_WORKER=off removes the worker and its copies from each phone on its next
 * visit, in case it ever needs to be switched off.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || location.protocol !== "https:") return;

    if (process.env.NEXT_PUBLIC_SERVICE_WORKER === "off") {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) void registration.unregister();
      });
      void caches.keys().then((keys) => {
        for (const key of keys) if (key.startsWith("ruzzco-")) void caches.delete(key);
      });
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      console.warn("[pwa] service worker registration failed:", error);
    });
  }, []);

  return null;
}

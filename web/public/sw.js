/*
 * Ruzzco service worker: lets an installed phone open the POS and the shift log without a
 * connection. Registered by src/components/ServiceWorkerRegistration.tsx, over HTTPS only.
 *
 * What it keeps: copies of /pos and /shift-log and of the files they load (/_next/static,
 * /_next/image, icons, images, the manifest), so they open when the shop PC can't be reached.
 * Pages and files always come from the network first; a copy is used only when the network
 * fails or takes over 5 s.
 * The start page (/, where the installed app and the Android app open) then goes straight to
 * the POS, so a barber can keep taking sales. No page waits more than 15 s for the PC: a PC
 * that is on but not running Ruzzco may not answer at all, and the phone would wait minutes.
 * Offline starts need the production server (npm run build, npm run start): under npm run dev
 * the pages only start while the dev server answers.
 *
 * What it never touches:
 * - Writes. Sales still go to IndexedDB first and sync through POST /api/v1/transactions/sync
 *   exactly as before; any request other than GET passes straight through.
 * - /api/. Live data is never answered from a copy.
 * - Owner pages (/ledger, /payment-qr, /forecast, /insights), the home page (its forecast panel
 *   is owner-only) and End-of-Day Cash. An offline copy could show owner figures without the
 *   PIN. Offline, these show offline.html instead; the home page opens the POS.
 *
 * Change VERSION to make every phone drop its copies and start over.
 */
const VERSION = "1";
const PAGES = `ruzzco-pages-v${VERSION}`;
const FILES = `ruzzco-files-v${VERSION}`;
const POS = "/pos";
const OFFLINE_PAGES = [POS, "/shift-log"];
const START_PAGE = "/";
const FALLBACK = "/offline.html";
// Pages with a copy, and the start page, wait this long for the PC; pages without a copy longer.
const PAGE_TIMEOUT_MS = 5000;
const NO_COPY_TIMEOUT_MS = 15000;
// After the PC failed to answer, pages open at once (their copy, the POS or offline.html) for
// this long instead of waiting again; the start page's redirect would otherwise wait twice.
const UNREACHABLE_FOR_MS = 30000;
const MAX_FILES = 500;
const FILE_TYPES = /\.(?:png|jpe?g|webp|svg|ico|cur|woff2?)$/i;
// Safari loads the manifest with every page; without a copy, an unreachable PC holds the page's
// load for the whole connection timeout.
const MANIFEST = "/manifest.webmanifest";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const pages = await caches.open(PAGES);
      await pages.add(new Request(FALLBACK, { cache: "reload" }));
      await (await caches.open(FILES)).add(new Request(MANIFEST, { cache: "reload" })).catch(() => undefined);
      // Best effort: a page that can't be stored now is stored the next time it opens online.
      await Promise.all(OFFLINE_PAGES.map((path) => storePage(path).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("ruzzco-") && key !== PAGES && key !== FILES) await caches.delete(key);
      }
      await trim(await caches.open(FILES));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  // Data for in-app navigation (React Server Components): network only. When it fails, Next
  // loads the page normally, and that request comes back here as a navigation.
  if (request.headers.has("RSC") || url.searchParams.has("_rsc")) return;

  if (request.mode === "navigate") {
    event.respondWith(openPage(request, url));
  } else if (url.pathname.startsWith("/_next/static/") || url.pathname === "/_next/image" || url.pathname === MANIFEST || FILE_TYPES.test(url.pathname)) {
    event.respondWith(loadFile(request));
  }
});

let unreachableUntil = 0;

async function openPage(request, url) {
  const keep = OFFLINE_PAGES.includes(url.pathname);
  const start = url.pathname === START_PAGE;
  const pages = await caches.open(PAGES);
  const stored = keep ? await pages.match(url.pathname, { ignoreVary: true, ignoreSearch: true }) : undefined;

  const network = fetch(request).then(async (response) => {
    if (response.status < 500) unreachableUntil = 0;
    if (keep && response.ok && response.type === "basic") await pages.put(url.pathname, response.clone());
    return response;
  });
  network.catch(() => undefined); // a late failure after the copy was shown is expected

  // Prefer a fresh page, but don't keep a barber waiting on a PC that is off. With a copy (and
  // on the start page) a server error counts as no answer, so the POS stays usable; elsewhere
  // only the HTTPS gateway's "Ruzzco isn't running" (502, or 504) does. Right after the PC
  // failed to answer, don't wait for it again; the fetch above still runs and resets this.
  if (Date.now() >= unreachableUntil) {
    const lenient = stored || start;
    const response = await Promise.race([network, delay(lenient ? PAGE_TIMEOUT_MS : NO_COPY_TIMEOUT_MS)]).catch(() => undefined);
    if (response && (lenient ? response.status < 500 : response.status !== 502 && response.status !== 504)) {
      return response;
    }
    unreachableUntil = Date.now() + UNREACHABLE_FOR_MS;
  }

  if (stored) return stored;
  // The start page: straight to the POS, which takes sales without the PC.
  if (start && (await pages.match(POS, { ignoreVary: true }))) {
    return Response.redirect(new URL(POS, self.location.origin).href, 302);
  }
  return (await pages.match(FALLBACK, { ignoreVary: true })) ?? Response.error();
}

let storedSinceTrim = 0;

// Files, like pages, come from the network first, with the same limits: a file with a copy
// waits at most PAGE_TIMEOUT_MS, and not at all right after the PC failed to answer. Otherwise
// one slow image keeps the page loading (and the Android app's progress bar showing).
async function loadFile(request) {
  const files = await caches.open(FILES);
  const stored = await files.match(request, { ignoreVary: true });
  const network = fetch(request).then(async (response) => {
    if (response.ok && response.type === "basic") {
      await files.put(request, response.clone());
      if (++storedSinceTrim >= 50) {
        storedSinceTrim = 0;
        await trim(files);
      }
    }
    return response;
  });
  if (!stored) return network;
  network.catch(() => undefined); // a late failure after the copy was used is expected
  if (Date.now() < unreachableUntil) return stored;
  const response = await Promise.race([network, delay(PAGE_TIMEOUT_MS)]).catch(() => undefined);
  return response && response.status < 500 ? response : stored;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Stores a page and the files its HTML names, so it opens offline before it has ever been
// opened from this phone's home screen.
async function storePage(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok || response.type !== "basic") return;
  const html = await response.clone().text();
  await (await caches.open(PAGES)).put(path, response);

  const files = await caches.open(FILES);
  const urls = new Set();
  for (const match of html.matchAll(/["'(](\/_next\/static\/[^"'()\s\\]+)/g)) {
    urls.add(match[1].replace(/&amp;/g, "&"));
  }
  await Promise.all(
    [...urls].map(async (fileUrl) => {
      try {
        const file = await fetch(fileUrl);
        if (file.ok) await files.put(fileUrl, file);
      } catch {
        // stored later, when the page loads it online
      }
    }),
  );
  await trim(files);
}

// Keeps the newest MAX_FILES files; every rebuild of the app adds new file names.
async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_FILES; i++) await cache.delete(keys[i]);
}

import type { MetadataRoute } from "next";

// The installed app (PWA): its name, colours and icons on a phone's home screen. Phones can
// install it only over HTTPS (npm run https); over plain HTTP they ignore this file.
// The icons in public/icons are made by android/tools/make_icons.py.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Ruzzco Barbers",
    short_name: "Ruzzco",
    description: "Point of sale and end-of-day books for Ruzzco Barbers.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0c0b0a",
    theme_color: "#0c0b0a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

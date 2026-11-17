import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { HistoryFade } from "@/components/HistoryFade";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

// Oswald (SIL OFL 1.1, see fonts/Oswald-OFL.txt), the condensed caps of the shop's logo.
// Subset to Latin and the peso sign and served by this app, so neither the build nor the
// phones ever ask Google for it.
const oswald = localFont({
  src: "./fonts/Oswald-Variable.woff2",
  variable: "--font-oswald",
  weight: "200 700",
  display: "swap",
});

// The tab icon is app/icon.png and the iPhone Home Screen icon is app/apple-icon.png (Next.js
// file conventions); an `icons` entry here would hide them. The installed app's name and icons
// are in app/manifest.ts.
export const metadata: Metadata = {
  title: "Ruzzco Barbers — POS & Revenue Forecasting DSS",
  description: "Offline-First Mobile POS and Decision Support System for Ruzzco Barbers (Caloocan)",
  // iPhones: Safari > Share > Add to Home Screen opens the system full screen, without Safari's
  // bars, named "Ruzzco" under its icon. The status bar keeps the system colours and the pages start below it.
  // Works over plain HTTP too; opening offline needs HTTPS (npm run https).
  appleWebApp: {
    capable: true,
    title: "Ruzzco",
    statusBarStyle: "default",
  },
  // Next writes `capable` as mobile-web-app-capable; older iPhones look for the apple- name.
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

// Phone browsers tint their toolbar to the app's canvas (the light theme's --color-wall).
export const viewport: Viewport = {
  themeColor: "#f6f7f8",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${oswald.variable} h-full antialiased`}
      // The theme script below may set data-theme before React loads; that is not a mismatch in our markup.
      suppressHydrationWarning
    >
      <head>
        {/* Applies a chosen dark theme before the first paint (see lib/theme.ts) */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body
        className="min-h-full flex flex-col"
        // Browser extensions (subtitle, grammar and password tools) add classes and attributes
        // to <body> before React loads; that is not a mismatch in our markup. This tag only.
        suppressHydrationWarning
      >
        {/* The barber-pole ribbon across the top of every page */}
        <div aria-hidden="true" className="rz-ribbon shrink-0" />
        {children}
        {/* Back and forward fade out the page being left, as a link's page transition does */}
        <HistoryFade />
        {/* Over HTTPS: the POS and shift log open on an installed phone without a connection */}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}

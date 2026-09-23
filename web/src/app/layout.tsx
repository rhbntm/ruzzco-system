import type { Metadata } from "next";
import { Geist, Geist_Mono, Oswald } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Ruzzco Barbers — POS & Revenue Forecasting DSS",
  description: "Offline-First Mobile POS and Decision Support System for Ruzzco Barbers (Caloocan)",
  icons: {
    icon: "/ruzzco-logo.jpg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${oswald.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-[#0b0c10] text-zinc-100">
        {/* Authentic Barbershop Pole Ribbon */}
        <div className="h-1.5 w-full bg-barber-pole shrink-0 shadow-sm" />
        {children}
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

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
      className="h-full antialiased dark"
    >
      <body className="min-h-full flex flex-col bg-[#0b0c10] text-zinc-100">
        {/* Authentic Barbershop Pole Ribbon */}
        <div className="h-1.5 w-full bg-barber-pole shrink-0 shadow-sm" />
        {children}
      </body>
    </html>
  );
}

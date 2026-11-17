import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev server only: page origins allowed to load /_next resources and the hot-reload socket.
  // Next matches hostnames only (ports are ignored, `*` is one label) and always allows localhost.
  // Phones open the POS at ruzzco.local (npm run https) or at this PC's private address, which
  // depends on the Wi-Fi: 192.168.x.x on most routers, 10.x.x.x or 172.x.x.x on phone hotspots.
  allowedDevOrigins: ["127.0.0.1", "192.168.*.*", "10.*.*.*", "172.*.*.*", "*.local"],
  // Slice 27: Insights became Reports. Old links and bookmarks land on /reports (its owner check
  // and approval screen apply there); old ?date / ?days parameters are ignored.
  // Security headers on every response. frame-ancestors/X-Frame-Options stop other sites from
  // embedding the app (clickjacking). No full CSP and no HSTS: inline scripts and the plain-HTTP
  // local gateway would need more work; Vercel adds HSTS itself.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  async redirects() {
    return [{ source: "/insights", destination: "/reports", permanent: true }];
  },
};

export default nextConfig;

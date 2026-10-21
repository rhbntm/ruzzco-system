import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev server only: page origins allowed to load /_next resources and the hot-reload socket.
  // Next matches hostnames only (ports are ignored, `*` is one label) and always allows localhost.
  // Phones open the POS at ruzzco.local (npm run https) or at this PC's private address, which
  // depends on the Wi-Fi: 192.168.x.x on most routers, 10.x.x.x or 172.x.x.x on phone hotspots.
  allowedDevOrigins: ["127.0.0.1", "192.168.*.*", "10.*.*.*", "172.*.*.*", "*.local"],
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev server only: page origins allowed to load /_next resources and the hot-reload socket.
  // Next matches hostnames only (ports are ignored) and always allows localhost; phones on the
  // shop Wi-Fi open the POS at 192.168.x.x.
  allowedDevOrigins: ["127.0.0.1", "192.168.*.*"],
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "localhost",
    "localhost:3000",
    "127.0.0.1",
    "127.0.0.1:3000",
    "192.168.1.4",
    "192.168.1.4:3000",
    "192.168.1.*",
    "192.168.*.*",
  ],
};

export default nextConfig;

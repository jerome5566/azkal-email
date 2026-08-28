import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "@node-rs/argon2"],
  experimental: { serverActions: { bodySizeLimit: "50mb" } },
  poweredByHeader: false,
};

export default nextConfig;

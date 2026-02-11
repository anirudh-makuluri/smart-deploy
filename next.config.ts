import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: "standalone",
  // Ensure TypeScript path aliases work during build
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": path.resolve(__dirname, "./src"),
    };
    return config;
  },
};

export default nextConfig;

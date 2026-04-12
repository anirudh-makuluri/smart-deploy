import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// Turbopack standalone tracing currently produces invalid chunk paths on Windows.
	// Keep standalone for Linux/Docker, skip it for local Windows builds.
	output: process.platform === "win32" ? undefined : "standalone",
	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: "**",
			},
		],
	},
};

export default nextConfig;

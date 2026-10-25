import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// Turbopack standalone tracing currently produces invalid chunk paths on Windows.
	// Keep standalone for Linux/Docker, skip it for local Windows builds.
	output: process.platform === "win32" ? undefined : "standalone",
	headers: () => [{ source: "/apps/authorize", headers: [
		{ key: "Referrer-Policy", value: "no-referrer" },
		{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
		{ key: "X-Frame-Options", value: "DENY" },
		{ key: "X-Content-Type-Options", value: "nosniff" },
	] }],
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

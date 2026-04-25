import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// Turbopack standalone tracing currently produces invalid chunk paths on Windows.
	// Keep standalone for Linux/Docker, skip it for local Windows builds.
	output: process.platform === "win32" ? undefined : "standalone",
	// Moss ships non-ESM assets that Turbopack cannot place in route chunks.
	// Keep these packages external so they load at runtime only on the server.
	serverExternalPackages: ["@moss-dev/moss", "@moss-dev/moss-core"],
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

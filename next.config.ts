import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
	// Enable standalone output for Docker deployment
	output: "standalone",

};

export default nextConfig;

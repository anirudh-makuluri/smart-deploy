import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/database/**/*.test.ts"],
		fileParallelism: false,
		maxWorkers: 1,
		hookTimeout: 30_000,
	},
	resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});

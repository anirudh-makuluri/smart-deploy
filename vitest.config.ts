import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
	test: {
		environment: "jsdom",
		setupFiles: ["./test/setup.ts"],
		include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html"],
			include: ["src/**/*.{ts,tsx}"],
			exclude: ["**/*.d.ts"],
			thresholds: {
				lines: 1,
				functions: 1,
				branches: 1,
				statements: 1,
			},
		},
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
});

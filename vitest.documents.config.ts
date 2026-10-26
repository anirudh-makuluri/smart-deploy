import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
	test: { environment: "node", include: ["tests/integration/appDocuments.test.ts"], maxWorkers: 1,
		fileParallelism: false, hookTimeout: 30000, testTimeout: 15000 },
	resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});

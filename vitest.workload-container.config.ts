import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({ test: { environment: "node", include: ["tests/integration/workloadTlsContainer.test.ts"], maxWorkers: 1, testTimeout: 60000 },
	resolve: { alias: { "@": path.resolve(__dirname, "./src") } } });

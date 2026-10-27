import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({ test: { environment: "node", include: ["tests/integration/privateDemoWorker.test.ts", "tests/integration/privateDemoWorkerProcess.test.ts"], fileParallelism: false, maxWorkers: 1, testTimeout: 20000 }, resolve: { alias: { "@": path.resolve(__dirname, "./src") } } });

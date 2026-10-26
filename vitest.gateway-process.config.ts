import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["tests/integration/gatewayProcess.test.ts"], maxWorkers: 1, testTimeout: 20000 } });

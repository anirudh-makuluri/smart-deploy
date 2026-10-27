import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["tests/integration/curatedNotesContainer.test.ts"], maxWorkers: 1, testTimeout: 60000 } });

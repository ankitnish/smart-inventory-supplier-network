import { defineConfig } from "vitest/config";
// `npm test` runs fast unit tests. `npm run test:integration` (inside Docker) runs DB tests on a separate *_test database.
const integration = !!process.env.RUN_INTEGRATION;
export default defineConfig({
  test: {
    include: integration ? ["tests/integration/**/*.test.ts"] : ["tests/*.test.ts"],
    globalSetup: integration ? ["tests/integration/global-setup.ts"] : [],
    fileParallelism: false, testTimeout: 30_000, hookTimeout: 120_000,
  },
});

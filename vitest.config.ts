import { defineConfig } from "vitest/config";

const sourceConditions = ["eliza-source", "node", "module", "development|production"];

export default defineConfig({
  resolve: { conditions: sourceConditions },
  ssr: {
    resolve: {
      conditions: sourceConditions,
      externalConditions: ["eliza-source", "node", "module-sync"],
    },
  },
  test: {
    environment: "node",
    pool: "forks",
    execArgv: ["--conditions=eliza-source", "--import", "tsx"],
    maxWorkers: 2,
    allowOnly: false,
    passWithNoTests: false,
    retry: 0,
    projects: [
      {
        extends: true,
        test: {
          name: "integration",
          include: ["{deploy,packages,sites}/**/*.test.{ts,tsx}"],
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
      {
        extends: true,
        test: {
          name: "e2e",
          include: ["tests/e2e/**/*.test.{ts,tsx}"],
          testTimeout: 180_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});

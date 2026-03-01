import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    passWithNoTests: true,
    coverage: {
      provider: "istanbul",
      enabled: true,
      include: ["src/**/*.ts", "functions/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.spec.ts", "**/__mocks__/**"],
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
      reporter: ["text", "lcov", "json-summary"],
    },
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          compatibilityFlags: ["nodejs_compat"],
        },
      },
    },
  },
});

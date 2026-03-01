import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: ["src/app.ts", "functions/**/*.ts"],
  project: ["src/**/*.ts", "functions/**/*.ts"],
  ignoreDependencies: ["@cloudflare/vitest-pool-workers", "@vitest/coverage-v8"],
};

export default config;

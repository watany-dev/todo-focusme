import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: ["src/app.ts", "functions/**/*.ts"],
  project: ["src/**/*.ts", "functions/**/*.ts"],
  ignoreDependencies: ["cloudflare"],
};

export default config;

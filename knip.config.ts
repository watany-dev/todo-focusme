import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: ["src/app.ts", "functions/**/*.ts"],
  project: ["src/**/*.ts", "functions/**/*.ts"],
};

export default config;

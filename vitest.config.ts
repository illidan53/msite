import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "lightweight-charts": fileURLToPath(new URL("./src/test/lightweightChartsMock.ts", import.meta.url)),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "server",
          environment: "node",
          include: ["server/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "shared",
          environment: "node",
          include: ["shared/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "src",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          setupFiles: ["src/test/setup.ts"],
        },
      },
    ],
  },
});

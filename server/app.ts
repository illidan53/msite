import express from "express";
import type { Express } from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defaultConfigDir } from "./config/configPaths";
import { apiErrorHandler } from "./http/apiError";
import { MarketDataProvider } from "./market/marketDataProvider";
import { PolygonClient } from "./market/polygonClient";
import { createConfigRoutes } from "./routes/configRoutes";
import { createMarketRoutes } from "./routes/marketRoutes";
import { createRateRoutes } from "./routes/rateRoutes";

export interface CreateAppOptions {
  configDir?: string;
  nodeEnv?: string;
  polygonApiKey?: string;
  staticDir?: string;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const configDir = options.configDir ?? process.env.CONFIG_DIR ?? defaultConfigDir();
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "production";
  const polygonApiKey = options.polygonApiKey ?? process.env.POLYGON_API_KEY;
  const staticDir = options.staticDir ?? process.env.STATIC_DIR ?? resolve(process.cwd(), "dist");
  const marketDataProvider = new MarketDataProvider(new PolygonClient(polygonApiKey));
  const indexHtml = resolve(staticDir, "index.html");

  app.use(express.json());

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      service: "stock-workbench-api",
    });
  });

  app.use(
    "/api",
    createConfigRoutes({
      configDir,
    }),
  );
  app.use("/api", createRateRoutes());
  app.use("/api", createMarketRoutes(marketDataProvider));

  if (nodeEnv === "production" && existsSync(indexHtml)) {
    app.use(express.static(staticDir, { index: false }));
    app.get(/^(?!\/api(?:\/|$)).*/, (_request, response) => {
      response.sendFile(indexHtml);
    });
  }

  app.use(apiErrorHandler);

  return app;
}

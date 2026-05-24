import express from "express";
import type { Express } from "express";
import { defaultConfigDir } from "./config/configPaths";
import { apiErrorHandler } from "./http/apiError";
import { MarketDataProvider } from "./market/marketDataProvider";
import { PolygonClient } from "./market/polygonClient";
import { RecommendationService } from "./recommendations/recommendationService";
import { createConfigRoutes } from "./routes/configRoutes";
import { createMarketRoutes } from "./routes/marketRoutes";
import { createRateRoutes } from "./routes/rateRoutes";
import { createRecommendationRoutes } from "./routes/recommendationRoutes";

export interface CreateAppOptions {
  adminToken?: string;
  configDir?: string;
  nodeEnv?: string;
  polygonApiKey?: string;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const configDir = options.configDir ?? process.env.CONFIG_DIR ?? defaultConfigDir();
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "production";
  const adminToken = options.adminToken ?? process.env.APP_ADMIN_TOKEN;
  const polygonApiKey = options.polygonApiKey ?? process.env.POLYGON_API_KEY;
  const marketDataProvider = new MarketDataProvider(new PolygonClient(polygonApiKey));
  const recommendationService = new RecommendationService(marketDataProvider);

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
      adminToken,
      configDir,
      nodeEnv,
    }),
  );
  app.use("/api", createRateRoutes());
  app.use("/api", createMarketRoutes(marketDataProvider));
  app.use("/api", createRecommendationRoutes(recommendationService));
  app.use(apiErrorHandler);

  return app;
}

import express from "express";
import type { Express } from "express";
import { defaultConfigDir } from "./config/configPaths";
import { apiErrorHandler } from "./http/apiError";
import { createConfigRoutes } from "./routes/configRoutes";

export interface CreateAppOptions {
  adminToken?: string;
  configDir?: string;
  nodeEnv?: string;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const configDir = options.configDir ?? process.env.CONFIG_DIR ?? defaultConfigDir();
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  const adminToken =
    options.adminToken ?? process.env.APP_ADMIN_TOKEN ?? process.env.ADMIN_TOKEN;

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
  app.use(apiErrorHandler);

  return app;
}

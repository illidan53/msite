import { Router } from "express";
import { ConfigRepository } from "../config/configRepository";

export interface ConfigRoutesOptions {
  configDir?: string;
}

export function createConfigRoutes(options: ConfigRoutesOptions = {}): Router {
  const router = Router();
  const repository = new ConfigRepository({ configDir: options.configDir });

  router.get("/config", async (_request, response) => {
    response.json(await repository.readConfig());
  });

  router.get("/watchlists", async (_request, response) => {
    response.json(await repository.readWatchlists());
  });

  return router;
}

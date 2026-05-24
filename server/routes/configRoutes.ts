import { Router } from "express";
import { ConfigRepository } from "../config/configRepository";
import { requireAdminToken } from "../http/authGuard";

export interface ConfigRoutesOptions {
  adminToken?: string;
  configDir?: string;
  nodeEnv?: string;
}

export function createConfigRoutes(options: ConfigRoutesOptions = {}): Router {
  const router = Router();
  const repository = new ConfigRepository({ configDir: options.configDir });
  const adminGuard = requireAdminToken({
    adminToken: options.adminToken,
    nodeEnv: options.nodeEnv,
  });

  router.get("/config", async (_request, response) => {
    response.json(await repository.readConfig());
  });

  router.get("/watchlists", async (_request, response) => {
    response.json(await repository.readWatchlists());
  });

  router.put("/config/watchlists", adminGuard, async (request, response) => {
    response.json(await repository.writeWatchlists(request.body));
  });

  return router;
}

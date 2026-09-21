import { Router } from "express";
import {
  researchAccess,
  parseIps,
  type ResearchAccessOptions,
} from "../research/access";
import { z } from "zod";
import { ApiError } from "../http/apiError";
import type { ResearchService } from "../research/service";
const symbol = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(20)
  .regex(/^(?=.*[A-Z0-9])[A-Z0-9.-]+$/);
const schema = z
  .object({
    symbol,
    benchmark: symbol.default("SPY"),
    locale: z.enum(["en", "zh"]).default("en"),
    module: z
      .enum(["all", "quant", "fundamentals", "news", "ai"])
      .default("all"),
    baseId: z.string().uuid().optional(),
  })
  .strict();
export function createResearchRoutes(
  service: ResearchService,
  options: ResearchAccessOptions = {
    allowedIps: parseIps(process.env.RESEARCH_ALLOWED_IPS),
    trustedProxyIps: parseIps(process.env.RESEARCH_TRUSTED_PROXY_IPS),
  },
) {
  const access = researchAccess(options);
  const router = Router();
  router.get("/research", async (_req, res) => {
    res.set("Cache-Control", "no-store").json(await service.list());
  });
  router.get("/research/access", (req, res) => {
    res.set("Cache-Control", "no-store").json(access(req));
  });
  router.get("/research/:id", async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.id).success)
      throw new ApiError(400, "INVALID_ID", "Invalid report ID");
    res.set("Cache-Control", "no-store").json(await service.get(req.params.id));
  });
  router.post("/research/:id/history", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!access(req).canRun)
      throw new ApiError(
        403,
        "RESEARCH_IP_FORBIDDEN",
        "This IP address is not allowed to generate history",
      );
    if (!z.string().uuid().safeParse(req.params.id).success)
      throw new ApiError(400, "INVALID_ID", "Invalid report ID");
    res.json(await service.buildHistory(req.params.id));
  });
  router.post("/research", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!access(req).canRun) {
      throw new ApiError(
        403,
        "RESEARCH_IP_FORBIDDEN",
        "This IP address is not allowed to run research",
        { source: "research" },
      );
    }
    const input = schema.safeParse(req.body);
    if (!input.success)
      throw new ApiError(
        400,
        "INVALID_RESEARCH_INPUT",
        "Invalid symbol or analysis options",
      );
    res
      .status(202)
      .set("Cache-Control", "no-store")
      .json(await service.start(input.data));
  });
  return router;
}

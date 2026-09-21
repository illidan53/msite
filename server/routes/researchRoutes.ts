import { Router } from "express";
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
export function createResearchRoutes(service: ResearchService) {
  const router = Router();
  router.get("/research", async (_req, res) => {
    res.set("Cache-Control", "no-store").json(await service.list());
  });
  router.get("/research/:id", async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.id).success)
      throw new ApiError(400, "INVALID_ID", "Invalid report ID");
    res.set("Cache-Control", "no-store").json(await service.get(req.params.id));
  });
  router.post("/research", async (req, res) => {
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

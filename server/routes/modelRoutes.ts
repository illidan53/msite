import { Router } from "express";
import { z } from "zod";
import { ApiError } from "../http/apiError";
import {
  parseIps,
  researchAccess,
  type ResearchAccessOptions,
} from "../research/access";
import type { ModelScanService } from "../research/modelScan";

const symbol = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(20)
  .regex(/^(?=.*[A-Z0-9])[A-Z0-9.-]+$/);

/** Scan results are public; starting a scan uses the research IP allowlist. */
export function createModelRoutes(
  service: ModelScanService,
  options: ResearchAccessOptions = {
    allowedIps: parseIps(process.env.RESEARCH_ALLOWED_IPS),
    trustedProxyIps: parseIps(process.env.RESEARCH_TRUSTED_PROXY_IPS),
  },
) {
  const access = researchAccess(options);
  const router = Router();
  router.get("/models/scan", async (_req, res) => {
    res.set("Cache-Control", "no-store").json(await service.state());
  });
  router.post("/models/scan", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!access(req).canRun)
      throw new ApiError(
        403,
        "RESEARCH_IP_FORBIDDEN",
        "This IP address is not allowed to run model scans",
        { source: "research" },
      );
    res.status(202).json(await service.start());
  });
  router.get("/models/charts/:symbol", async (req, res) => {
    const parsed = symbol.safeParse(req.params.symbol);
    if (!parsed.success)
      throw new ApiError(400, "INVALID_SYMBOL", "Invalid symbol");
    res.set("Cache-Control", "no-store").json(await service.chart(parsed.data));
  });
  return router;
}

import { Router } from "express";
import { z } from "zod";
import { ApiError } from "../http/apiError";
import {
  parseIps,
  researchAccess,
  type ResearchAccessOptions,
} from "../research/access";
import type { StrategyService } from "../strategy/service";

const symbol = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(20)
  .regex(/^(?=.*[A-Z0-9])[A-Z0-9.-]+$/);
const book = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
const runSchema = z.object({ job: z.enum(["daily", "backtest"]) }).strict();

/**
 * Results are public; anything that fetches market data, spends compute or
 * sends email uses the research IP allowlist.
 */
export function createStrategyRoutes(
  service: StrategyService,
  options: ResearchAccessOptions = {
    allowedIps: parseIps(process.env.RESEARCH_ALLOWED_IPS),
    trustedProxyIps: parseIps(process.env.RESEARCH_TRUSTED_PROXY_IPS),
  },
) {
  const access = researchAccess(options);
  const router = Router();
  const parse = <T>(
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    value: unknown,
    code: string,
  ) => {
    const result = schema.safeParse(value);
    if (!result.success)
      throw new ApiError(400, code, "Invalid strategy input", {
        source: "strategy",
      });
    return result.data;
  };
  const allowed = (req: Parameters<typeof access>[0]) => {
    if (!access(req).canRun)
      throw new ApiError(
        403,
        "RESEARCH_IP_FORBIDDEN",
        "This IP address is not allowed to run the quant system",
        { source: "strategy" },
      );
  };
  router.use("/strategy", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.get("/strategy/state", async (_req, res) => {
    res.json(await service.state());
  });
  router.get("/strategy/latest", async (_req, res) => {
    res.json(await service.latest());
  });
  router.get("/strategy/charts/:book/:symbol", async (req, res) => {
    res.json(
      await service.chart(
        parse(book, req.params.book, "INVALID_BOOK"),
        parse(symbol, req.params.symbol, "INVALID_SYMBOL"),
      ),
    );
  });
  router.get("/strategy/signals", async (req, res) => {
    const limit = parse(
      z.coerce.number().int().min(1).max(1000).default(200),
      req.query.limit,
      "INVALID_LIMIT",
    );
    const filter = parse(book.optional(), req.query.book, "INVALID_BOOK");
    res.json(await service.signals(limit, filter));
  });
  router.get("/strategy/paper/:book", async (req, res) => {
    res.json(await service.paper(parse(book, req.params.book, "INVALID_BOOK")));
  });
  router.get("/strategy/reports", async (_req, res) => {
    res.json(await service.reports());
  });
  router.get("/strategy/reports/:id", async (req, res) => {
    res.json(
      await service.report(parse(z.string().uuid(), req.params.id, "INVALID_ID")),
    );
  });
  router.get("/strategy/outbox", async (_req, res) => {
    res.json(await service.outbox());
  });
  router.post("/strategy/run", async (req, res) => {
    allowed(req);
    const { job } = parse(runSchema, req.body, "INVALID_STRATEGY_RUN");
    res.status(202).json(await service.start(job));
  });
  router.post("/strategy/test-email", async (req, res) => {
    allowed(req);
    res.status(202).json(await service.testEmail());
  });
  return router;
}

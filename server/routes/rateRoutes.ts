import { Router } from "express";
import { z } from "zod";
import { ApiError } from "../http/apiError";
import type { RatePlanInput } from "../rate/ratePlanner";
import { evaluateRatePlan } from "../rate/ratePlanner";

const ratePlanEvaluationRequestSchema = z
  .object({
    activeSymbolCount: z.number().finite().nonnegative(),
    cacheHitRatio: z.number().finite(),
    customCallsPerMinute: z.number().finite().positive().optional(),
    endpointCount: z.number().finite().positive(),
    hardThreshold: z.number().finite(),
    intervalSeconds: z.number().finite().positive(),
    paidPlanName: z.string().optional(),
    plan: z.enum(["free", "paid", "custom"]),
    warningThreshold: z.number().finite(),
  })
  .refine((value) => value.warningThreshold < value.hardThreshold, {
    message: "warningThreshold must be lower than hardThreshold",
    path: ["warningThreshold"],
  });

export function createRateRoutes(): Router {
  const router = Router();

  router.post("/rate-plan/evaluate", (request, response) => {
    response.json(evaluateRatePlan(parseRatePlanEvaluationRequest(request.body)));
  });

  return router;
}

function parseRatePlanEvaluationRequest(input: unknown): RatePlanInput {
  const result = ratePlanEvaluationRequestSchema.safeParse(input);

  if (!result.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Invalid rate plan input", {
      details: result.error.issues.map((issue) => ({
        message: issue.message,
        path: issue.path,
      })),
      source: "rate",
    });
  }

  return result.data;
}

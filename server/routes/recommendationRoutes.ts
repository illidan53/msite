import { Router } from "express";
import { z } from "zod";
import type { RecommendationCandidate } from "../../shared/types";
import { ApiError } from "../http/apiError";
import type { RecommendInput } from "../recommendations/recommendationService";

const recommendationRequestSchema = z.object({
  excludedSymbols: z.array(z.string().trim().min(1)).default([]),
  limit: z.number().int().min(1).max(50).default(8),
  pinnedSymbols: z.array(z.string().trim().min(1)).default([]),
  theme: z.string().trim().min(1),
});

export interface RecommendationRouteService {
  recommend(input: RecommendInput): Promise<RecommendationCandidate[]>;
}

export function createRecommendationRoutes(service: RecommendationRouteService): Router {
  const router = Router();

  router.post("/watchlists/recommendations", async (request, response) => {
    const recommendationRequest = parseRecommendationRequest(request.body);
    response.json(await service.recommend(recommendationRequest));
  });

  return router;
}

function parseRecommendationRequest(input: unknown): RecommendInput {
  const result = recommendationRequestSchema.safeParse(input);

  if (!result.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Invalid recommendation input", {
      details: result.error.issues.map((issue) => ({
        message: issue.message,
        path: issue.path,
      })),
      source: "recommendations",
    });
  }

  return result.data;
}

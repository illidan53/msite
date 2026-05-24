import { Router } from "express";
import { evaluateRatePlan } from "../rate/ratePlanner";

export function createRateRoutes(): Router {
  const router = Router();

  router.post("/rate-plan/evaluate", (request, response) => {
    response.json(evaluateRatePlan(request.body));
  });

  return router;
}

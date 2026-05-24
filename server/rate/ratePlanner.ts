import type { PolygonPlan, RatePlanEvaluation } from "../../shared/types";

type RatePlanStatus = RatePlanEvaluation["status"];

export interface RatePlanInput {
  activeSymbolCount: number;
  cacheHitRatio: number;
  customCallsPerMinute?: number;
  endpointCount: number;
  hardThreshold: number;
  intervalSeconds: number;
  paidPlanName?: string;
  plan: PolygonPlan;
  warningThreshold: number;
}

const FREE_CALLS_PER_MINUTE = 5;
const DEFAULT_CUSTOM_CALLS_PER_MINUTE = 60;
const DISABLEABLE_INTERVALS_SECONDS = [5, 10, 15, 30, 60, 120, 300];

export function evaluateRatePlan(input: RatePlanInput): RatePlanEvaluation {
  const estimatedCallsPerMinute = estimateCallsPerMinute(input);
  const budgetCallsPerMinute = budgetForPlan(input);
  const paidLocalLoadWarning =
    input.plan === "paid" && input.activeSymbolCount >= 50 && input.intervalSeconds <= 10;
  const ratio =
    budgetCallsPerMinute === null ? 0 : estimatedCallsPerMinute / budgetCallsPerMinute;
  const status = statusForRatio({
    hardThreshold: input.hardThreshold,
    paidLocalLoadWarning,
    ratio,
    warningThreshold: input.warningThreshold,
  });

  return {
    disabledIntervals:
      budgetCallsPerMinute === null ? [] : disabledIntervals(input, budgetCallsPerMinute),
    estimatedCallsPerMinute,
    intervalSeconds: input.intervalSeconds,
    message: messageForEvaluation(input, {
      budgetCallsPerMinute,
      estimatedCallsPerMinute,
      paidLocalLoadWarning,
      ratio,
      status,
    }),
    plan: input.plan,
    status,
  };
}

function budgetForPlan(input: RatePlanInput): number | null {
  if (input.plan === "paid") {
    return null;
  }

  if (input.plan === "custom") {
    return input.customCallsPerMinute ?? DEFAULT_CUSTOM_CALLS_PER_MINUTE;
  }

  return FREE_CALLS_PER_MINUTE;
}

function disabledIntervals(input: RatePlanInput, budgetCallsPerMinute: number): number[] {
  return DISABLEABLE_INTERVALS_SECONDS.filter((intervalSeconds) => {
    const ratio = estimateCallsPerMinute({ ...input, intervalSeconds }) / budgetCallsPerMinute;

    return ratio >= input.hardThreshold;
  });
}

function estimateCallsPerMinute(input: RatePlanInput): number {
  const activeSymbolCount = Math.max(0, input.activeSymbolCount);
  const endpointCount = Math.max(1, input.endpointCount);
  const cacheHitRatio = boundCacheHitRatio(input.cacheHitRatio);

  if (activeSymbolCount === 0) {
    return 0;
  }

  return Math.ceil(
    activeSymbolCount * endpointCount * (60 / input.intervalSeconds) * (1 - cacheHitRatio),
  );
}

function boundCacheHitRatio(cacheHitRatio: number): number {
  return Math.min(0.95, Math.max(0, cacheHitRatio));
}

function statusForRatio(input: {
  hardThreshold: number;
  paidLocalLoadWarning: boolean;
  ratio: number;
  warningThreshold: number;
}): RatePlanStatus {
  if (input.ratio >= input.hardThreshold) {
    return "blocked";
  }

  if (input.ratio >= input.warningThreshold || input.paidLocalLoadWarning) {
    return "warning";
  }

  return "ok";
}

function messageForEvaluation(
  input: RatePlanInput,
  evaluation: {
    budgetCallsPerMinute: number | null;
    estimatedCallsPerMinute: number;
    paidLocalLoadWarning: boolean;
    ratio: number;
    status: RatePlanStatus;
  },
): string {
  if (input.plan === "paid") {
    const paidPlanName = input.paidPlanName ?? "paid plan";

    if (evaluation.paidLocalLoadWarning) {
      return `${paidPlanName} has unlimited REST calls, but this refresh cadence may create aggressive local load.`;
    }

    return `${paidPlanName} has unlimited REST calls for this planner.`;
  }

  const budget = `${evaluation.budgetCallsPerMinute} calls/min`;
  const usage = `${evaluation.estimatedCallsPerMinute} calls/min`;

  if (evaluation.status === "blocked") {
    return `This refresh cadence is blocked because ${usage} exceeds the configured ${budget} budget.`;
  }

  if (evaluation.status === "warning") {
    return `This refresh cadence is near the configured ${budget} budget at ${usage}.`;
  }

  return `This refresh cadence is within the configured ${budget} budget at ${usage}.`;
}

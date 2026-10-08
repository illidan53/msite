import {
  ruleFamilies,
  type RuleContribution,
  type RuleFamily,
  type RuleId,
} from "../../shared/strategy";
import { ruleCatalog } from "../../shared/strategyRules";
import type { SystemFrame } from "./types";

/** Catalog order; every engine vector over rules uses it. */
export const engineRules: RuleId[] = ruleCatalog.map((rule) => rule.id);
export const ruleFamilyIndex = ruleCatalog.map((rule) =>
  ruleFamilies.indexOf(rule.family),
);
const familyBase = new Float64Array(ruleFamilies.length);
const familyAvailable = new Float64Array(ruleFamilies.length);

/**
 * Spec §3.4 redistribution: an unavailable rule's weight goes pro rata to the
 * available rules of its family; a family with nothing available hands its
 * weight pro rata to the families that have something. Writes fractions that
 * sum to 1 into `out` and returns false (all zeros) when nothing is available.
 */
export function redistributeWeights(
  base: ArrayLike<number>,
  available: ArrayLike<number | boolean>,
  out: Float64Array,
) {
  // Called for every symbol-session, so reuse the per-family scratch sums.
  familyBase.fill(0);
  familyAvailable.fill(0);
  for (let j = 0; j < out.length; j++) {
    const family = ruleFamilyIndex[j];
    familyBase[family] += base[j];
    if (available[j] && base[j] > 0) familyAvailable[family] += base[j];
  }
  let total = 0;
  for (let f = 0; f < familyBase.length; f++)
    if (familyAvailable[f] > 0) total += familyBase[f];
  out.fill(0);
  if (!(total > 0)) return false;
  for (let j = 0; j < out.length; j++) {
    const family = ruleFamilyIndex[j];
    if (available[j] && base[j] > 0)
      out[j] = (familyBase[family] / total) * (base[j] / familyAvailable[family]);
  }
  return true;
}

/** A rule votes when it has weight, a finite capped forecast and passes its speed limit. */
export function availableRules(frame: SystemFrame, i: number, t: number) {
  return engineRules.map(
    (rule) =>
      frame.baseWeights[rule] > 0 &&
      Number.isFinite(frame.forecasts[rule][i][t]) &&
      frame.costPass[rule][i][t] === 1,
  );
}

/** Effective rule weights (fractions summing to 1) for symbol i at t, or {} when none vote. */
export function effectiveWeights(
  frame: SystemFrame,
  i: number,
  t: number,
): Partial<Record<RuleId, number>> {
  const weights = new Float64Array(engineRules.length);
  const base = engineRules.map((rule) => frame.baseWeights[rule]);
  if (!redistributeWeights(base, availableRules(frame, i, t), weights)) return {};
  return Object.fromEntries(
    engineRules.flatMap((rule, j) => (weights[j] > 0 ? [[rule, weights[j]]] : [])),
  );
}

/** Each family's base-weighted average capped forecast over its voting rules. */
export function familyForecasts(
  frame: SystemFrame,
  i: number,
  t: number,
): Record<RuleFamily, number | null> {
  const available = availableRules(frame, i, t);
  const sums = ruleFamilies.map(() => ({ weighted: 0, weight: 0 }));
  engineRules.forEach((rule, j) => {
    if (!available[j]) return;
    const sum = sums[ruleFamilyIndex[j]];
    sum.weighted += frame.baseWeights[rule] * frame.forecasts[rule][i][t];
    sum.weight += frame.baseWeights[rule];
  });
  return Object.fromEntries(
    ruleFamilies.map((family, f) => [
      family,
      sums[f].weight > 0 ? sums[f].weighted / sums[f].weight : null,
    ]),
  ) as Record<RuleFamily, number | null>;
}

/** FDM × w × f per voting rule, largest |contribution| first (signal drivers). */
export function ruleContributions(
  frame: SystemFrame,
  i: number,
  t: number,
): RuleContribution[] {
  const fdm = frame.fdm[i][t];
  if (!Number.isFinite(fdm)) return [];
  return Object.entries(effectiveWeights(frame, i, t))
    .map(([rule, weight]) => ({
      rule: rule as RuleId,
      contribution: fdm * weight * frame.forecasts[rule as RuleId][i][t],
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

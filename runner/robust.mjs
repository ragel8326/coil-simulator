// Stage C: tolerance-robust re-ranking. A nominal optimum can be a knife-edge
// that manufacturing tolerance pushes off target; this re-sorts Stage B's
// candidates by the 95th-percentile max-deviation under Monte Carlo
// perturbation instead of the nominal max-deviation, per the implementation
// spec section 3-5. Tolerance values come from assumptions.json — every one
// is a placeholder until confirmed (see that file's "status" fields).
import { readFileSync } from "node:fs";
import { evaluate } from "./core.mjs";
import { judge } from "./constraints.mjs";
import { stateFromDesign } from "./search.mjs";
import { mulberry32 } from "./rng.mjs";

const assumptionsPath = new URL("./assumptions.json", import.meta.url);
export const ASSUMPTIONS = JSON.parse(readFileSync(assumptionsPath, "utf8"));

function gauss(rng) {
  let u = 0, v = 0;
  while (!u) u = rng();
  while (!v) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// One Monte Carlo trial: perturb R1, R2, d, dw by their (sigma = 3sigma/3)
// tolerances and re-evaluate max deviation and feasibility.
function trial(S0, params, rng) {
  const sigR = ASSUMPTIONS.coilRadiusTolerance3Sigma_mm.value / 3;
  const sigD = ASSUMPTIONS.coilSeparationTolerance3Sigma_mm.value / 3;
  const sigDw = ASSUMPTIONS.wireDiameterTolerance3Sigma_mm.value / 3;

  const p = { ...params };
  p.R1 = params.R1 + gauss(rng) * sigR;
  p.R2 = params.R2 + gauss(rng) * sigR;
  p.d = params.d + gauss(rng) * sigD;
  const dwPerturbed = S0.dw + (gauss(rng) * sigDw) / 1000;

  const S0p = { ...S0, dw: Math.max(1e-6, dwPerturbed) };
  const S = stateFromDesign(S0p, p, params.dir2);
  const E = evaluate(S);
  const j = judge(S, E);
  return { maxDev: E.maxDev, feasible: j.feasible };
}

// Runs K trials for one candidate and returns the 95th-percentile maxDev plus
// the feasible fraction (how often manufacturing noise alone breaks a task
// requirement that the nominal design met).
export function robustRank(S0, candidate, K = 500, seed = 12345) {
  const rng = mulberry32(seed);
  const devs = new Array(K);
  let feasibleCount = 0;
  for (let i = 0; i < K; i++) {
    const t = trial(S0, candidate.params, rng);
    devs[i] = t.maxDev;
    if (t.feasible) feasibleCount++;
  }
  devs.sort((a, b) => a - b);
  const p95 = devs[Math.min(K - 1, Math.floor(K * 0.95))];
  const median = devs[Math.floor(K / 2)];
  return {
    ...candidate,
    robust: { p95MaxDev: p95, medianMaxDev: median, feasibleFraction: feasibleCount / K, trials: K, seed },
  };
}

// Re-ranks a list of Stage-B candidates by p95 max deviation (ascending —
// more robust first), keeping the nominal ranking available for comparison.
export function reRankByRobustness(S0, candidates, K = 500, seed = 12345) {
  const ranked = candidates.map(c => robustRank(S0, c, K, seed));
  ranked.sort((a, b) => a.robust.p95MaxDev - b.robust.p95MaxDev);
  return ranked;
}

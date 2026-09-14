// Stage S — plain random sweep of the design space.
//
// This is NOT optimization. It evaluates N randomly drawn designs and records
// every one of them, feasible or not, so there is a large table to look at in
// Excel: which regions of the space satisfy the requirements at all, how each
// variable trades against max deviation, where the heating limit starts biting.
//
// It is cheap: one objective evaluation costs ~0.042 ms, so 30,000 designs per
// wire gauge take about a second. Stage A (DE) is what actually finds good
// designs; this stage is what makes the space visible.
import { STRUCT_VARS, evalDesign, baseFromS0 } from "./search.mjs";
import { mulberry32 } from "./rng.mjs";

export function randomSweep(S0, n, { seed = 20260913, dirs = [1, -1], act = STRUCT_VARS } = {}) {
  const rng = mulberry32(seed);
  // Start from S0's own values (base) for every variable, then randomize
  // only the ones in `act`. When a variable is fixed (excluded from `act`
  // by run.mjs's --fix), its base value — which run.mjs already set on S0 —
  // passes through untouched instead of being overwritten by a random draw.
  const base = { ...baseFromS0(S0), I: S0.I };
  const rows = [];
  for (let i = 0; i < n; i++) {
    const p = { ...base };
    for (const v of act) {
      const x = v.min + rng() * (v.max - v.min);
      p[v.k] = v.int ? Math.round(x) : +x.toFixed(4);
    }
    const dir2 = dirs[Math.min(dirs.length - 1, Math.floor(rng() * dirs.length))];
    const { S, E, feasible, softOk, violations, currentDensityValue } = evalDesign(S0, p, dir2);
    rows.push({
      stage: "S-sweep", dw_mm: +(S0.dw * 1000).toFixed(3), sample: i,
      params: {
        ...p, dir2,
        R1: Math.round(S.c1.R * 1e9) / 1e6, m1: S.c1.m, n1: S.c1.n, last1: S.c1.last,
        R2: Math.round(S.c2.R * 1e9) / 1e6, m2: S.c2.m, n2: S.c2.n, last2: S.c2.last,
        d: Math.round(S.d * 1e9) / 1e6, I: S.I,
      },
      feasible, softOk, violations,
      metrics: {
        maxDev: E.maxDev, rmsDev: E.rmsDev, nonlin: E.nonlin,
        h1solo: E.h1solo, hAt0: E.hAt0, hAtD: E.hAtD,
        Rtot: E.Rtot, P: E.P, V: E.V, wireLen: E.L1 + E.L2,
        N1: E.N1, N2: E.N2, J: currentDensityValue,
        width1: S.c1.m * S.dw * 1000, width2: S.c2.m * S.dw * 1000,
        thick1: S.c1.n * S.dw * 1000, thick2: S.c2.n * S.dw * 1000,
        bore1: 2 * (S.c1.R * 1000 - S.c1.n * S.dw * 1000 / 2),
        bore2: 2 * (S.c2.R * 1000 - S.c2.n * S.dw * 1000 / 2),
        overlap: (S.c1.m * S.dw * 1000) / 2 + (S.c2.m * S.dw * 1000) / 2 > S.d * 1000,
      },
    });
  }
  return rows;
}

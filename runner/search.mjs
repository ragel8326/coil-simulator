// Stage A (multi-start DE) and Stage B (integer-grid neighbor search) of the
// runner pipeline. All physics/optimizer calls go through core.mjs — this
// file only adds search strategy (seeds, neighborhoods), never new math.
import {
  OPTVARS, packFromVec, objective, evaluate, coilTurns, H_pack, OE,
  optimizeDE, refineLocal,
} from "./core.mjs";
import { judge } from "./constraints.mjs";
import { mulberry32 } from "./rng.mjs";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

// All searchable variables including current I, in OPTVARS order. This is
// the runner's default search set (wider than the web UI's default checked
// subset). I must stay searchable here: current density = I / wireArea does
// not depend on R/m/n/d at all, so at dw=0.3/0.4mm the safe-current-density
// constraint is only satisfiable at all by lowering I below the 1A cap.
export const STRUCT_VARS = OPTVARS;

// Stage B (integer-grid neighbor search) only covers the 7 variables the
// implementation spec names for it (R1, m1, n1, R2, m2, n2, d) — current I
// is a Stage-A/DE variable only, both because the spec's neighbor-grid list
// omits it and because I's own range (0.1-1.0A) is too narrow relative to a
// +-1.0-unit neighbor window to grid-search sensibly.
export const NEIGHBOR_VARS = OPTVARS.filter(v => v.k !== "I");

function baseFromS0(S0) {
  return {
    R1: S0.c1.R * 1000, m1: S0.c1.m, n1: S0.c1.n, R2: S0.c2.R * 1000,
    m2: S0.c2.m, n2: S0.c2.n, d: S0.d * 1000,
  };
}

// Build a full evaluable state S from a packed design vector p (mm/turns) plus
// a base S0 (for dw, I, h1, h2, jsafe, reqSolo25) and a coil-2 direction.
export function stateFromDesign(S0, p, dir2) {
  const dw = S0.dw;
  const last1 = Math.min(Math.max(1, p.m1), S0.c1.last);
  const last2 = Math.min(Math.max(1, p.m2), S0.c2.last);
  const c1 = { R: p.R1 / 1000, m: Math.max(1, p.m1), n: Math.max(1, p.n1), last: last1, dw, xc: 0, dir: S0.c1.dir };
  const c2 = { R: p.R2 / 1000, m: Math.max(1, p.m2), n: Math.max(1, p.n2), last: last2, dw, xc: p.d / 1000, dir: dir2 };
  const I = p.I ?? S0.I;
  const d = p.d / 1000;
  return {
    I, dw, d, c1, c2, xa: 0, xb: d,
    h1: S0.h1, h2: S0.h2, jsafe: S0.jsafe, reqSolo25: S0.reqSolo25,
  };
}

function evalDesign(S0, p, dir2) {
  const S = stateFromDesign(S0, p, dir2);
  const E = evaluate(S);
  const j = judge(S, E);
  return { S, E, ...j };
}

// ---- Stage A: multi-start DE, seeds 0..restarts-1 ----------------------

// Runs exactly one seed end-to-end (DE -> local refinement -> constraint
// judgement). Pulled out on its own so both the sequential path (multiStart)
// and the worker-thread path (worker.mjs) call the identical code.
export function runSeed(S0, act, lo, hi, seed, { gens, mode, minWin, dirs }) {
  const t0 = Date.now();
  const rng = mulberry32(seed);
  const de = optimizeDE(S0, act, lo, hi, { mode, minWin, dirs, gens, rng });
  let bestX = de.bestX, bestDir = de.bestDir, bestObj = de.bestObj;
  let refined = false, objAfterRefine = bestObj;
  const base = baseFromS0(S0);
  if (bestX) {
    const r = refineLocal(S0, base, act, bestX, bestDir, mode, minWin, lo, hi);
    if (r.refined) { bestX = r.vec; objAfterRefine = r.objAfter; refined = true; }
  }
  const p = bestX ? packFromVec(base, bestX, act) : null;
  const ms = Date.now() - t0;

  if (!p) {
    return { seed, feasible: false, obj: Infinity, refined: false, params: null, metrics: null, ms };
  }
  const { S, E, feasible, violations, currentDensityValue } = evalDesign(S0, p, bestDir);
  return {
    seed, feasible, obj: objAfterRefine, refined, violations,
    params: { ...p, dir2: bestDir, last1: S.c1.last, last2: S.c2.last },
    metrics: {
      maxDev: E.maxDev, rmsDev: E.rmsDev, nonlin: E.nonlin,
      h1solo: E.h1solo, hAt0: E.hAt0, hAtD: E.hAtD,
      Rtot: E.Rtot, P: E.P, V: E.V, wireLen: E.L1 + E.L2,
      N1: E.N1, N2: E.N2,
      // 제작 가능성을 눈으로 확인하기 위한 치수 (제약으로 걸지는 않는다).
      // 축 방향 폭 = 층당 턴수 x 도선 지름, 반경 방향 두께 = 층수 x 도선 지름.
      width1: S.c1.m * S.dw * 1000, width2: S.c2.m * S.dw * 1000,
      thick1: S.c1.n * S.dw * 1000, thick2: S.c2.n * S.dw * 1000,
      J: currentDensityValue,
    },
    ms,
  };
}

export function multiStart(S0, act, lo, hi, { restarts, gens, mode, minWin, dirs, onSeed } = {}) {
  const runs = [];
  const convergence = []; // best-so-far objective after each seed, in seed order
  let bestSoFar = Infinity;

  for (let seed = 0; seed < restarts; seed++) {
    const record = runSeed(S0, act, lo, hi, seed, { gens, mode, minWin, dirs });
    runs.push(record);
    if (record.feasible && record.obj < bestSoFar) bestSoFar = record.obj;
    convergence.push({ n: seed + 1, bestSoFar });
    if (onSeed) onSeed(record, seed, restarts);
  }
  return { runs, convergence };
}

const WORKER_PATH = fileURLToPath(new URL("./worker.mjs", import.meta.url));

// Same result as multiStart(), but seeds are distributed across up to
// `workers` concurrent worker_threads (one short-lived worker per seed, capped
// concurrency). Falls back to the sequential path when workers <= 1.
// Sequential and parallel runs of the same seeds are identical since
// runSeed() is a pure function of (S0, act, lo, hi, seed, opts).
export function parallelMultiStart(S0, act, lo, hi, { restarts, gens, mode, minWin, dirs, workers = 1, onSeed } = {}) {
  if (workers <= 1) return multiStart(S0, act, lo, hi, { restarts, gens, mode, minWin, dirs, onSeed });

  return new Promise((resolve, reject) => {
    const results = new Array(restarts);
    const opts = { gens, mode, minWin, dirs };
    const concurrency = Math.max(1, Math.min(workers, restarts));
    let nextSeed = 0, active = 0, settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      const convergence = [];
      let bestSoFar = Infinity;
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.feasible && r.obj < bestSoFar) bestSoFar = r.obj;
        convergence.push({ n: i + 1, bestSoFar });
      }
      resolve({ runs: results, convergence });
    };

    const launchNext = () => {
      if (nextSeed >= restarts) {
        if (active === 0) finish();
        return;
      }
      const seed = nextSeed++;
      active++;
      const worker = new Worker(WORKER_PATH, { workerData: { S0, act, lo, hi, seed, opts } });
      worker.once("message", msg => {
        active--;
        worker.terminate();
        if (settled) return;
        if (!msg.ok) { settled = true; reject(new Error("worker failed on seed " + msg.seed + ": " + msg.error)); return; }
        results[msg.record.seed] = msg.record;
        if (onSeed) onSeed(msg.record, msg.record.seed, restarts);
        launchNext();
      });
      worker.once("error", err => { if (!settled) { settled = true; reject(err); } });
    };
    for (let i = 0; i < concurrency; i++) launchNext();
  });
}

// ---- Stage B: integer-grid neighbor search around top designs ----------
// contVars: continuous vars get a step (0.1mm normally, or 1mm when snapped)
// searched over +-1.0mm (11 or 2 steps); int vars get +-2 exhaustively.
function neighborOffsets(range, step) {
  const offs = [];
  for (let v = -range; v <= range + 1e-9; v += step) offs.push(+v.toFixed(6));
  return offs;
}

function* cartesian(arrays) {
  if (!arrays.length) { yield []; return; }
  const [first, ...rest] = arrays;
  for (const v of first) {
    for (const tail of cartesian(rest)) yield [v, ...tail];
  }
}

// Stage B neighbor search around one design (a packed `p`, same shape as
// multiStart's record.params).
//
// A full Cartesian sweep over all 7 variables is not tractable: integers at
// +-2 (5 values each) times continuous at +-1.0mm/0.1mm (21 values each) is
// 5^4 * 21^3 = 5,788,125 designs per seed, about 4 minutes at 0.042ms per
// objective() call — roughly 4 hours for the full pipeline. So the sweep is
// split:
//   (1) the 4 integer variables (m1, n1, m2, n2) ARE swept exhaustively over
//       their 5^4 = 625 combinations, because turns-per-layer and layer count
//       interact strongly and a one-at-a-time sweep would miss joint moves;
//   (2) the 3 continuous variables (R1, R2, d) are searched by coordinate
//       descent — one variable at a time, others held fixed.
// Steps (1) and (2) repeat until a full pass yields no improvement, so the
// result is a local optimum in the coordinate sense, not a global one. Cost
// is roughly 1,000 evaluations per seed instead of 5.8 million.
//
// `snap: true` anchors the continuous grid on whole millimetres (the centre is
// rounded first), which is what the integer-mm bobbin variant needs — stepping
// by 1mm from 43.8mm would otherwise produce 42.8/43.8/44.8, none of them whole.
export function neighborSearch(S0, act, seedParams, mode, minWin,
  { contStep = 0.1, contRange = 1.0, intRange = 2, snap = false, maxPasses = 10 } = {}) {
  const dir2 = seedParams.dir2;
  const intVars = act.filter(v => v.int);
  const contVars = act.filter(v => !v.int);

  // Both neighbourhoods stay anchored on the SEED design, so the search never
  // drifts outside the +-2 turn / +-contRange mm window the spec describes.
  const intAxes = intVars.map(v =>
    neighborOffsets(intRange, 1).map(o => Math.max(1, Math.round(seedParams[v.k] + o))));
  const contAxes = contVars.map(v => {
    const centre = snap ? Math.round(seedParams[v.k]) : seedParams[v.k];
    return neighborOffsets(contRange, contStep).map(o => +(centre + o).toFixed(6));
  });

  // In snap mode every continuous variable must LAND on the integer grid, so
  // the seed's fractional values are rounded before the search starts. Without
  // this the descent simply keeps the (better) fractional seed values and the
  // "integer-mm" variant silently returns a non-integer design.
  let cur = { ...seedParams };
  if (snap) contVars.forEach(v => { cur[v.k] = Math.round(seedParams[v.k]); });
  let curObj = objective(cur, S0, mode, minWin, dir2);
  let evaluated = 1;
  let passes = 0;

  for (let pass = 0; pass < maxPasses; pass++) {
    let passImproved = false;
    passes = pass + 1;

    // (1) exhaustive over the integer block, continuous variables held fixed
    if (intVars.length) {
      for (const combo of cartesian(intAxes)) {
        const p = { ...cur };
        intVars.forEach((v, i) => { p[v.k] = combo[i]; });
        evaluated++;
        const o = objective(p, S0, mode, minWin, dir2);
        if (o < curObj) { curObj = o; cur = p; passImproved = true; }
      }
    }

    // (2) coordinate descent over the continuous variables, one at a time
    contVars.forEach((v, vi) => {
      for (const val of contAxes[vi]) {
        if (val === cur[v.k]) continue;
        const p = { ...cur, [v.k]: val };
        evaluated++;
        const o = objective(p, S0, mode, minWin, dir2);
        if (o < curObj) { curObj = o; cur = p; passImproved = true; }
      }
    });

    if (!passImproved) break;
  }

  if (!(curObj < 1e5)) {
    return { improved: false, params: seedParams, obj: null, evaluated, passes };
  }

  const { S, E, feasible, violations, currentDensityValue } = evalDesign(S0, cur, dir2);
  return {
    improved: true, evaluated, passes,
    params: { ...cur, dir2, last1: S.c1.last, last2: S.c2.last },
    obj: curObj, feasible, violations,
    metrics: {
      maxDev: E.maxDev, rmsDev: E.rmsDev, nonlin: E.nonlin,
      h1solo: E.h1solo, hAt0: E.hAt0, hAtD: E.hAtD,
      Rtot: E.Rtot, P: E.P, V: E.V, wireLen: E.L1 + E.L2,
      N1: E.N1, N2: E.N2,
      // 제작 가능성을 눈으로 확인하기 위한 치수 (제약으로 걸지는 않는다).
      // 축 방향 폭 = 층당 턴수 x 도선 지름, 반경 방향 두께 = 층수 x 도선 지름.
      width1: S.c1.m * S.dw * 1000, width2: S.c2.m * S.dw * 1000,
      thick1: S.c1.n * S.dw * 1000, thick2: S.c2.n * S.dw * 1000,
      J: currentDensityValue,
    },
  };
}

export { evalDesign, baseFromS0 };

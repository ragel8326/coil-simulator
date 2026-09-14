// Stage A (multi-start DE) and Stage B (integer-grid neighbor search) of the
// runner pipeline. All physics/optimizer calls go through core.mjs — this
// file only adds search strategy (seeds, neighborhoods), never new math.
import {
  OPTVARS, packFromVec, capTurns, snapDim, objective, evaluate, coilTurns, H_pack, OE,
  optimizeDE, refineLocal,
} from "./core.mjs";
import { judge } from "./constraints.mjs";
import { mulberry32 } from "./rng.mjs";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

// The assignment says to assume approximately 1 A, and the team fixed I at
// 1 A on 2026-09-14. Keep I in OPTVARS (web checkbox and --fix I remain
// available), but do not move it in the runner's default structural search.
export const STRUCT_VARS = OPTVARS.filter(v => v.k !== "I");

// Removes any variable the caller has pinned to a fixed value (see run.mjs
// --fix) from a search-variable list. The fixed value itself doesn't live
// here — it lives on S0 (see run.mjs's FIX_SETTERS/applyFix), and
// packFromVec()'s `{...base}` spread already reproduces any key missing
// from `act` unchanged, so simply excluding the key from the search list is
// enough to stop the optimizer from ever moving it.
export function searchVars(vars, fix) {
  if (!fix || !Object.keys(fix).length) return vars;
  return vars.filter(v => !(v.k in fix));
}

// Stage B (integer-grid neighbor search) only covers the 7 variables the
// implementation spec names for it (R1, m1, n1, R2, m2, n2, d) — current I
// is a Stage-A/DE variable only, both because the spec's neighbor-grid list
// omits it and because I's own range (0.1-1.0A) is too narrow relative to a
// +-1.0-unit neighbor window to grid-search sensibly.
export const NEIGHBOR_VARS = OPTVARS.filter(v => v.k !== "I");

// With R1 and current fixed, Task 1 is cheap and exact enough to enumerate.
// Every returned pair is a full-layer winding and already respects maxTurns.
export function enumerateCoil1(S0) {
  const out = [];
  for (let m1 = 1; m1 <= 80; m1++) {
    for (let n1 = 1; n1 <= 40; n1++) {
      if (S0.maxTurns > 0 && m1 * n1 > S0.maxTurns) continue;
      const c1 = { ...S0.c1, m: m1, n: n1, last: m1 };
      const h1solo = H_pack(c1.xc, coilTurns(c1), 1, S0.I) / OE;
      if (Math.abs(h1solo - 25) <= 1.0) out.push({ m1, n1, h1solo });
    }
  }
  return out;
}

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
  // objective() 와 똑같이 턴수 상한과 치수 격자를 적용해야 탐색 결과와 최종 지표가 어긋나지 않는다.
  const g = S0.dimStep;
  const R1s = snapDim(p.R1, g), R2s = snapDim(p.R2, g), ds = snapDim(p.d, g);
  const t1 = capTurns(Math.max(1, p.m1), Math.max(1, p.n1), S0.maxTurns);
  const t2 = capTurns(Math.max(1, p.m2), Math.max(1, p.n2), S0.maxTurns);
  const last1 = Math.min(t1.m, S0.c1.last);
  const last2 = Math.min(t2.m, S0.c2.last);
  const c1 = { R: R1s / 1000, m: t1.m, n: t1.n, last: last1, dw, xc: 0, dir: S0.c1.dir };
  const c2 = { R: R2s / 1000, m: t2.m, n: t2.n, last: last2, dw, xc: ds / 1000, dir: dir2 };
  const I = p.I ?? S0.I;
  const d = ds / 1000;
  return {
    I, dw, d, c1, c2, xa: 0, xb: d,
    h1: S0.h1, h2: S0.h2, jsafe: S0.jsafe, reqSolo25: S0.reqSolo25,
  };
}

// 실제로 만들어진 설계값을 돌려준다.
// 탐색이 내놓은 원값(p)은 치수 격자와 턴수 상한을 거치기 전 값이라, 그대로 기록하면
// "파일에는 41.839mm, 38층이라고 적혀 있는데 계산은 41.8mm, 14층으로 했다"가 된다.
// 평가에 쓰인 상태 S 에서 되읽어 기록해야 어긋나지 않는다.
function builtParams(S, p, dir2) {
  const r = v => Math.round(v * 1e6) / 1e6;
  return {
    ...p,
    R1: r(S.c1.R * 1000), m1: S.c1.m, n1: S.c1.n, last1: S.c1.last,
    R2: r(S.c2.R * 1000), m2: S.c2.m, n2: S.c2.n, last2: S.c2.last,
    d: r(S.d * 1000), I: S.I, dir2,
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
    return { seed, feasible: false, obj: Infinity, refined: false, deObjectiveCalls: de.evals, params: null, metrics: null, ms };
  }
  const { S, E, feasible, softOk, violations, currentDensityValue } = evalDesign(S0, p, bestDir);
  return {
    seed, feasible, softOk, obj: objAfterRefine, refined, deObjectiveCalls: de.evals, violations,
    params: builtParams(S, p, bestDir),
    metrics: {
      maxDev: E.maxDev, rmsDev: E.rmsDev, normMaxDev: E.normMaxDev, normRmsDev: E.normRmsDev, nonlin: E.nonlin,
      h1solo: E.h1solo, hAt0: E.hAt0, hAtD: E.hAtD,
      Rtot: E.Rtot, P: E.P, V: E.V, wireLen: E.L1 + E.L2,
      N1: E.N1, N2: E.N2,
      // 제작 가능성을 눈으로 확인하기 위한 치수 (제약으로 걸지는 않는다).
      // 축 방향 폭 = 층당 턴수 x 도선 지름, 반경 방향 두께 = 층수 x 도선 지름.
      width1: S.c1.m * S.dw * 1000, width2: S.c2.m * S.dw * 1000,
      thick1: S.c1.n * S.dw * 1000, thick2: S.c2.n * S.dw * 1000,
      // 프로브가 지나갈 안지름과, 두 코일이 축 방향으로 겹치는지 여부.
      // 겹침은 제약이 아니라 표시다 — 반경이 다르면 코일2가 코일1 안쪽에 들어갈 수 있다.
      bore1: 2 * (S.c1.R * 1000 - S.c1.n * S.dw * 1000 / 2),
      bore2: 2 * (S.c2.R * 1000 - S.c2.n * S.dw * 1000 / 2),
      overlap: (S.c1.m * S.dw * 1000) / 2 + (S.c2.m * S.dw * 1000) / 2 > S.d * 1000,
      J: currentDensityValue,
    },
    ms,
  };
}

export function multiStart(S0, act, lo, hi, { restarts, gens, mode, minWin, dirs, onSeed, seedStart = 0 } = {}) {
  const runs = [];
  const convergence = []; // best-so-far objective after each seed, in seed order
  let bestSoFar = Infinity;

  for (let seed = seedStart; seed < seedStart + restarts; seed++) {
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
export function parallelMultiStart(S0, act, lo, hi, { restarts, gens, mode, minWin, dirs, workers = 1, onSeed, seedStart = 0 } = {}) {
  if (workers <= 1) return multiStart(S0, act, lo, hi, { restarts, gens, mode, minWin, dirs, onSeed, seedStart });

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
      const seed = seedStart + nextSeed++;
      active++;
      const worker = new Worker(WORKER_PATH, { workerData: { S0, act, lo, hi, seed, opts } });
      worker.once("message", msg => {
        active--;
        worker.terminate();
        if (settled) return;
        if (!msg.ok) { settled = true; reject(new Error("worker failed on seed " + msg.seed + ": " + msg.error)); return; }
        results[msg.record.seed - seedStart] = msg.record;
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

  const { S, E, feasible, softOk, violations, currentDensityValue } = evalDesign(S0, cur, dir2);
  return {
    improved: true, evaluated, passes, softOk,
    params: builtParams(S, cur, dir2),
    obj: curObj, feasible, violations,
    metrics: {
      maxDev: E.maxDev, rmsDev: E.rmsDev, normMaxDev: E.normMaxDev, normRmsDev: E.normRmsDev, nonlin: E.nonlin,
      h1solo: E.h1solo, hAt0: E.hAt0, hAtD: E.hAtD,
      Rtot: E.Rtot, P: E.P, V: E.V, wireLen: E.L1 + E.L2,
      N1: E.N1, N2: E.N2,
      // 제작 가능성을 눈으로 확인하기 위한 치수 (제약으로 걸지는 않는다).
      // 축 방향 폭 = 층당 턴수 x 도선 지름, 반경 방향 두께 = 층수 x 도선 지름.
      width1: S.c1.m * S.dw * 1000, width2: S.c2.m * S.dw * 1000,
      thick1: S.c1.n * S.dw * 1000, thick2: S.c2.n * S.dw * 1000,
      // 프로브가 지나갈 안지름과, 두 코일이 축 방향으로 겹치는지 여부.
      // 겹침은 제약이 아니라 표시다 — 반경이 다르면 코일2가 코일1 안쪽에 들어갈 수 있다.
      bore1: 2 * (S.c1.R * 1000 - S.c1.n * S.dw * 1000 / 2),
      bore2: 2 * (S.c2.R * 1000 - S.c2.n * S.dw * 1000 / 2),
      overlap: (S.c1.m * S.dw * 1000) / 2 + (S.c2.m * S.dw * 1000) / 2 > S.d * 1000,
      J: currentDensityValue,
    },
  };
}

export { evalDesign, baseFromS0 };

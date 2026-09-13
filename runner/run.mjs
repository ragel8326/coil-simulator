#!/usr/bin/env node
// CLI entry point. Orchestrates: Stage A (multi-start DE) -> Stage B
// (integer-grid neighbor search, both 0.1mm-continuous and integer-mm-snap
// variants) -> Stage C (tolerance-robust re-ranking) -> report writing.
// See ../README.md and the implementation spec this was built from for the
// rationale behind each stage.
import { mkdirSync, writeFileSync } from "node:fs";
import { parallelMultiStart, neighborSearch, STRUCT_VARS, NEIGHBOR_VARS } from "./search.mjs";
import { reRankByRobustness } from "./robust.mjs";
import { randomSweep } from "./sweep.mjs";
import { gapSweep } from "./gapsweep.mjs";
import { writeRawJsonl, writeTopCsv, writeConvergenceCsv, writeReportMd, writeGapSweepCsv } from "./report.mjs";

function parseArgs(argv) {
  const args = {
    dw: [0.3, 0.4, 0.5],
    restarts: 30,
    gens: 300,   // 탐색 범위를 넓힌 만큼 세대 수도 올렸다 (2026-09-13)
    objective: "max",
    mc: 500,
    workers: 1,
    out: `runs/${new Date().toISOString().slice(0, 10)}`,
    minWin: 20,
    top: 20,
    candidates: 50,   // 공차 검사까지 넘길 상위 설계 수 (예전에는 10개로 고정돼 있었다)
    sweep: 30000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--dw": args.dw = next().split(",").map(Number); break;
      case "--restarts": args.restarts = +next(); break;
      case "--gens": args.gens = +next(); break;
      case "--objective": args.objective = next(); break;
      case "--mc": args.mc = +next(); break;
      case "--workers": args.workers = +next(); break;
      case "--out": args.out = next(); break;
      case "--min-win": args.minWin = +next(); break;
      case "--top": args.top = +next(); break;
      case "--sweep": args.sweep = +next(); break;
      case "--candidates": args.candidates = +next(); break;
      default:
        console.error(`Unknown argument: ${a}`);
        process.exit(1);
    }
  }
  return args;
}

// Default base design (index.html's shipped defaults) — the starting point
// for h1/h2/I/jsafe/reqSolo25 and for c1/c2's "last" turn counts, which are
// not search variables (see assumptions.json).
function defaultS0(dw_mm) {
  const dw = dw_mm / 1000;
  // last(마지막 층 턴수)를 크게 잡아 사실상 제한을 없앤다. 실제 last 는
  // min(m, 이 값)으로 계산되므로 결과는 last = m, 즉 모든 층이 꽉 찬 권선이 된다.
  // 이전에는 웹 UI 기본값 15가 그대로 들어와 있어서, 층당 턴수를 40으로 찾아도
  // 맨 윗층만 15바퀴로 잘리는 숨은 제약이 걸려 있었다.
  const FULL = 100000;
  const c1 = { R: 43.8 / 1000, m: 19, n: 11, last: FULL, dw, xc: 0, dir: 1 };
  const c2 = { R: 20 / 1000, m: 15, n: 1, last: FULL, dw, xc: 56.5 / 1000, dir: -1 };
  const d = 56.5 / 1000;
  return { I: 1, dw, d, c1, c2, xa: 0, xb: d, h1: 25, h2: 10, jsafe: 5, reqSolo25: true };
}

async function runForWireGauge(dw, args, rawSink) {
  const S0 = defaultS0(dw);
  const act = STRUCT_VARS;
  const lo = act.map(v => v.min), hi = act.map(v => v.max);
  const dirs = [1, -1];
  const opts = { restarts: args.restarts, gens: args.gens, mode: args.objective, minWin: args.minWin, dirs, workers: args.workers };

  process.stderr.write(`\n[dw=${dw}mm] Stage A: ${args.restarts} restarts × ${args.gens} generations...\n`);
  let done = 0;
  const { runs, convergence } = await parallelMultiStart(S0, act, lo, hi, {
    ...opts,
    onSeed: (record) => {
      done++;
      rawSink.push({ stage: "A", dw_mm: dw, ...record });
      if (done % 5 === 0 || done === args.restarts) {
        process.stderr.write(`  [dw=${dw}mm] ${done}/${args.restarts} seeds done\n`);
      }
    },
  });

  const feasible = runs.filter(r => r.feasible);
  feasible.sort((a, b) => a.obj - b.obj);
  const topN = feasible.slice(0, Math.max(1, args.candidates));

  if (args.sweep > 0) {
    process.stderr.write(`[dw=${dw}mm] Stage S: random sweep of ${args.sweep} designs...\n`);
    for (const row of randomSweep(S0, args.sweep)) rawSink.sweep.push(row);
  }

  process.stderr.write(`[dw=${dw}mm] Stage B: integer-grid neighbor search around top ${topN.length} feasible design(s)...\n`);
  const stageB = [];
  // 팀은 보빈을 정수 mm 로 만들기로 했으므로, 실제로 제작할 설계는 정수 mm 쪽이다.
  // 소수점 설계와 따로 모아 자기들끼리 공차 재랭킹까지 거쳐 순위를 매긴다.
  const stageBint = [];
  for (const cand of topN) {
    const cont = neighborSearch(S0, NEIGHBOR_VARS, cand.params, args.objective, args.minWin, { contStep: 0.1 });
    rawSink.push({ stage: "B-continuous", dw_mm: dw, seed: cand.seed, ...cont });
    stageB.push({ dw_mm: dw, stage: "B", seed: cand.seed, obj: cont.obj ?? cand.obj, feasible: cont.feasible ?? cand.feasible, params: cont.params ?? cand.params, metrics: cont.metrics ?? cand.metrics });

    const snapped = neighborSearch(S0, NEIGHBOR_VARS, cand.params, args.objective, args.minWin, { contStep: 1, contRange: 2, snap: true });
    rawSink.push({ stage: "B-integer-snap", dw_mm: dw, seed: cand.seed, ...snapped });
    if (snapped.improved && snapped.feasible) {
      stageBint.push({ dw_mm: dw, stage: "B-int", seed: cand.seed, obj: snapped.obj,
        feasible: snapped.feasible, params: snapped.params, metrics: snapped.metrics });
    }
  }
  stageB.sort((a, b) => a.obj - b.obj);
  stageBint.sort((a, b) => a.obj - b.obj);

  process.stderr.write(`[dw=${dw}mm] Stage C: tolerance Monte Carlo (K=${args.mc}) re-ranking...\n`);
  const stageC = reRankByRobustness(S0, stageB, args.mc);
  for (const c of stageC) rawSink.push({ stage: "C", dw_mm: dw, ...c });

  // 정수 mm 설계만 따로 같은 방식으로 재랭킹 — 이 1등이 실제로 제작할 설계다.
  const stageCint = reRankByRobustness(S0, stageBint, args.mc);
  for (const c of stageCint) rawSink.push({ stage: "C-int", dw_mm: dw, ...c });

  // 레일형 보빈용 간격 스윕 — 최종 선택 설계 하나를 놓고 간격을 훑는다.
  let gapRows = [];
  const railSeed = stageCint.length ? stageCint[0] : (stageC.length ? stageC[0] : null);
  if (railSeed) {
    process.stderr.write(`[dw=${dw}mm] Stage R: rail gap sweep around d=${Math.round(railSeed.params.d)}mm...\n`);
    gapRows = gapSweep(S0, railSeed.params);
  }

  // Integer-mm snap comparison for the report: snap the rank-1 (post-robust)
  // design's continuous variables to whole millimeters and see how much
  // max-deviation is lost.
  let integerSnapTop = null, snapDelta = null;
  if (stageC.length) {
    const snapped = neighborSearch(S0, NEIGHBOR_VARS, stageC[0].params, args.objective, args.minWin, { contStep: 1, contRange: 2, snap: true });
    if (snapped.feasible) {
      integerSnapTop = snapped;
      snapDelta = snapped.metrics.maxDev - stageC[0].metrics.maxDev;
    }
  }

  return {
    dw, restarts: args.restarts, feasibleCount: feasible.length,
    bestNominal: feasible.length ? feasible[0].obj : null,
    bestRobust: stageC.length ? stageC[0].robust.p95MaxDev : null,
    top: stageC.slice(0, args.top),
    gapRows,
    railSeedParams: railSeed ? railSeed.params : null,
    topInteger: stageCint.slice(0, args.top),
    bestIntegerRobust: stageCint.length ? stageCint[0].robust.p95MaxDev : null,
    bestIntegerNominal: stageCint.length ? stageCint[0].metrics.maxDev : null,
    integerSnapTop, snapDelta,
    convergence,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.out, { recursive: true });

  const rawSink = [];
  rawSink.sweep = [];
  const dwResults = [];
  const convergenceByDw = {};

  for (const dw of args.dw) {
    const r = await runForWireGauge(dw, args, rawSink);
    dwResults.push(r);
    convergenceByDw[dw] = r.convergence;
  }

  writeRawJsonl(`${args.out}/raw.jsonl`, rawSink);
  if (rawSink.sweep.length) writeRawJsonl(`${args.out}/sweep.jsonl`, rawSink.sweep);
  writeFileSync(`${args.out}/summary.json`, JSON.stringify(
    dwResults.map(r => ({
      dw: r.dw, restarts: r.restarts, feasibleCount: r.feasibleCount,
      bestNominal: r.bestNominal, bestRobust: r.bestRobust, snapDelta: r.snapDelta,
      bestIntegerNominal: r.bestIntegerNominal, bestIntegerRobust: r.bestIntegerRobust,
    })), null, 2));

  const topEntries = [];
  for (const r of dwResults) {
    for (const e of r.top) topEntries.push({ ...e, dw_mm: r.dw, stage: "final" });
  }
  writeTopCsv(`${args.out}/top.csv`, topEntries);

  const topIntEntries = [];
  for (const r of dwResults) {
    for (const e of r.topInteger || []) topIntEntries.push({ ...e, dw_mm: r.dw, stage: "final-int" });
  }
  writeTopCsv(`${args.out}/top_integer.csv`, topIntEntries);

  const gapAll = [];
  for (const r of dwResults) for (const g of (r.gapRows || [])) gapAll.push(g);
  writeGapSweepCsv(`${args.out}/gap_sweep.csv`, gapAll);
  writeConvergenceCsv(`${args.out}/convergence.csv`, convergenceByDw);
  writeReportMd(`${args.out}/report.md`, { dwResults, cliArgs: process.argv.slice(2) });

  process.stderr.write(`\nDone. Output written to ${args.out}/{raw.jsonl,sweep.jsonl,top.csv,top_integer.csv,gap_sweep.csv,convergence.csv,summary.json,report.md}\n`);
  for (const r of dwResults) {
    process.stderr.write(`  dw=${r.dw}mm: ${r.feasibleCount}/${r.restarts} feasible, best nominal max-dev = ${r.bestNominal ?? "none"}\n`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });

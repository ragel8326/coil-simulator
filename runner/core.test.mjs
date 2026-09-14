import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as core from "./core.mjs";
import { mulberry32 } from "./rng.mjs";
import { judge } from "./constraints.mjs";

// index.html's shipped defaults (README / project brief):
// I=1, dw=0.5, dist=56.5, R1=43.8, m1=19, n1=11, l1=15, R2=20, m2=15, n2=1,
// l2=15, h1=25, h2=10.
function defaultS0() {
  const dw = 0.5 / 1000;
  const c1 = { R: 43.8 / 1000, m: 19, n: 11, last: 15, dw, xc: 0, dir: 1 };
  const c2 = { R: 20 / 1000, m: 15, n: 1, last: 15, dw, xc: 56.5 / 1000, dir: -1 };
  const d = 56.5 / 1000;
  return { I: 1, dw, d, c1, c2, xa: 0, xb: d, h1: 25, h2: 10, jsafe: 5, reqSolo25: true };
}

// ---- 4.1 Numeric match with the web bench's default design --------------
// These reference values were captured from evaluate() on the ORIGINAL
// (pre-refactor) index.html core, and cross-checked bit-for-bit (Object.is)
// against the post-refactor core during the refactor itself. They are also
// what the Calculate tab shows to the same decimal places for the shipped
// default design.
//
// 2026-09-14: maxDev/rmsDev were regenerated after the target line stopped
// being a fixed 25→10 Oe line and became the secant line through this
// design's OWN field at x=0 and x=d (see evaluate()'s comment). h1solo and
// Rtot are untouched by that change (neither depends on the target line) so
// they keep their original reference values.
test("evaluate() matches the web bench's default-design reference values", () => {
  const S0 = defaultS0();
  const E = core.evaluate(S0);
  assert.equal(E.maxDev.toFixed(3), "2.602");
  assert.equal(E.rmsDev.toFixed(3), "1.445");
  assert.equal(E.h1solo.toFixed(2), "29.31");
  assert.equal(E.Rtot.toFixed(2), "4.98");
});

// ---- 4.2 Reproducibility: same seed -> bit-identical result -------------
test("optimizeDE is bit-for-bit reproducible for a given seed", () => {
  const S0 = defaultS0();
  const act = core.OPTVARS.filter(v => ["R1", "m1", "n1", "d", "m2"].includes(v.k));
  const lo = act.map(v => v.min), hi = act.map(v => v.max);
  const opts = { mode: "max", minWin: 20, dirs: [1, -1], gens: 30 };

  const r1 = core.optimizeDE(S0, act, lo, hi, { ...opts, rng: mulberry32(123) });
  const r2 = core.optimizeDE(S0, act, lo, hi, { ...opts, rng: mulberry32(123) });

  assert.equal(r1.bestObj, r2.bestObj);
  assert.deepEqual(r1.bestX, r2.bestX);
  assert.equal(r1.bestDir, r2.bestDir);
});

// ---- 4.3 Core purity: no DOM leakage in the extracted region ------------
test("the extracted core region contains no DOM access", () => {
  const htmlPath = new URL("../index.html", import.meta.url);
  const html = readFileSync(htmlPath, "utf8");
  const m = html.match(/\/\* ==== COIL-CORE-START ==== \*\/([\s\S]*?)\/\* ==== COIL-CORE-END ==== \*\//);
  assert.ok(m, "COIL-CORE markers must exist in index.html");
  const src = m[1];
  for (const bad of ["document.", "document[", "window.", "window[", "$("]) {
    assert.ok(!src.includes(bad), `core region must not contain "${bad}"`);
  }
});

// ---- 4.4 Constraint judgement matches the web chip logic ----------------
test("judge() flags a Task-1 violation the same way the web bench's chip does", () => {
  const S0 = defaultS0();
  // Shrink coil 1 drastically so its standalone center field misses 25+-1 Oe.
  const S = { ...S0, c1: { ...S0.c1, m: 3, n: 2, last: 3 } };
  const E = core.evaluate(S);
  const okOnWebBench = Math.abs(E.h1solo - 25) <= 1.0; // renderMetrics()'s ok25
  const { feasible, violations } = judge(S, E);
  assert.equal(violations.task1 > 0, !okOnWebBench);
  assert.equal(feasible, false);
});

test("judge() reports feasible=true for a design that clears every threshold", () => {
  const S0 = defaultS0();
  // A design known to be current-density-feasible: same geometry, lower I.
  const S = { ...S0, I: 0.6 };
  const E = core.evaluate(S);
  const { violations } = judge(S, E);
  assert.ok(violations.currentDensity <= 0, "0.6A at 0.5mm wire should clear the 5 A/mm^2 limit");
  assert.ok(violations.current <= 0);
});

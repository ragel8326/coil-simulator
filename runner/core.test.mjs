import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as core from "./core.mjs";
import { mulberry32 } from "./rng.mjs";
import { judge } from "./constraints.mjs";
import { enumerateCoil1 } from "./search.mjs";

// index.html's shipped defaults (README / project brief):
// I=1, dw=0.5, dist=56.5, R1=43.8, m1=19, n1=11, l1=15, R2=20, m2=15, n2=1,
// l2=15, h1=25, h2=10.
function defaultS0() {
  const dw = 0.5 / 1000;
  const c1 = { R: 43.8 / 1000, m: 19, n: 11, last: 15, dw, xc: 0, dir: 1 };
  const c2 = { R: 20 / 1000, m: 15, n: 1, last: 15, dw, xc: 56.5 / 1000, dir: -1 };
  const d = 56.5 / 1000;
  return { I: 1, dw, d, c1, c2, xa: 0, xb: d, h1: 25, h2: 10, jsafe: 5, reqSolo25: true, dimStep: 0.1, maxTurns: 200 };
}

// ---- 4.1 Numeric match with the web bench's default design --------------
// The deviation reference is the fixed nominal 25→10 Oe target line
// (S0.h1/S0.h2), not the secant through the design's actual endpoint
// fields (that version lives in the original coil-bench project).
test("evaluate() matches the web bench's default-design reference values", () => {
  const S0 = defaultS0();
  const E = core.evaluate(S0);
  assert.equal(E.maxDev.toFixed(3), "7.871");
  assert.equal(E.rmsDev.toFixed(3), "4.664");
  assert.equal(E.wt[0], S0.h1);
  assert.equal(E.wt.at(-1), S0.h2);
  assert.equal(E.h1solo.toFixed(2), "29.31");
  assert.equal(E.Rtot.toFixed(2), "4.98");
});

// evaluate()'s target line always starts/ends exactly on S.h1/S.h2, even
// when the design's own actual endpoint fields (hAt0/hAtD) land elsewhere.
test("evaluate()'s target line endpoints are exactly S.h1/S.h2", () => {
  const designs = [
    defaultS0(),
    { ...defaultS0(), I: 0.6 },
    (() => {
      const S = defaultS0();
      S.c1 = { ...S.c1, m: 3, n: 2, last: 3 };
      return S;
    })(),
  ];
  for (const S0 of designs) {
    const E = core.evaluate(S0);
    assert.equal(E.wt[0], S0.h1);
    assert.equal(E.wt.at(-1), S0.h2);
  }
});

test("endpoint requirement penalty gives DE a gradient instead of a 1e6 plateau", () => {
  const S0 = defaultS0();
  const base = { R1: 43.8, n1: 2, R2: 20, m2: 3, n2: 1, d: 56.5 };
  const weak = core.objective({ ...base, m1: 3 }, S0, "max", 20, -1);
  const lessWeak = core.objective({ ...base, m1: 8 }, S0, "max", 20, -1);
  assert.ok(Number.isFinite(weak) && weak < 1e6);
  assert.ok(Number.isFinite(lessWeak) && lessWeak < 1e6);
  assert.notEqual(weak, lessWeak);
});

// With a fixed 25→10 Oe target line, the normalization is by the constant
// 15 Oe target drop, not by the design's own (current-dependent) endpoint
// drop. So normMaxDev/normRmsDev are NOT invariant to current here — only
// the endpoint-secant version (in the original coil-bench project) has that
// property. Changing the current changes the curve but not the target line.
test("normalized deviations are the Oe deviation divided by the fixed 15 Oe target drop", () => {
  const base = defaultS0();
  const close = (a, b) => assert.ok(Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b)));
  for (const I of [1.0, 0.9, 0.5]) {
    const e = core.evaluate({ ...base, I });
    close(e.normMaxDev, e.maxDev / 15);
    close(e.normRmsDev, e.rmsDev / 15);
  }
  const e1 = core.evaluate({ ...base, I: 1.0 });
  const e05 = core.evaluate({ ...base, I: 0.5 });
  assert.notEqual(e1.normMaxDev, e05.normMaxDev);
});

test("LM residual SSE per sample is identical to the normalized MSE objective", () => {
  const S0 = defaultS0();
  const designs = [
    { R1: 43.8, m1: 19, n1: 11, R2: 20, m2: 15, n2: 1, d: 56.5, I: 1 },
    { R1: 24, m1: 30, n1: 3, R2: 50.3, m2: 29, n2: 1, d: 57.0, I: 1 },
    { R1: 35.2, m1: 12, n1: 7, R2: 41.1, m2: 8, n2: 4, d: 72.4, I: 0.7 },
  ];
  for (const p of designs) {
    const e = core.objectiveResiduals(p, S0, 20, -1);
    const ssePerSample = e.reduce((s, v) => s + v * v, 0) / 61;
    const obj = core.objective(p, S0, "mse", 20, -1);
    assert.ok(Math.abs(ssePerSample - obj) <= 1e-12 * Math.max(1, Math.abs(obj)));
  }
});

test("LM refines unsnapped dimensions without carrying a flat direction to a bound", () => {
  const S0 = defaultS0();
  S0.c1 = { ...S0.c1, R: 0.024, last: 100000 };
  S0.c2 = { ...S0.c2, last: 100000 };
  const base = { R1: 24, m1: S0.c1.m, n1: S0.c1.n, R2: 20, m2: S0.c2.m, n2: S0.c2.n, d: 56.5 };
  const act = core.OPTVARS.filter(v => !["R1", "I"].includes(v.k));
  const lo = act.map(v => v.min), hi = act.map(v => v.max);
  // Seed 3 no longer leaves room for LM to improve under the fixed 25→10 Oe
  // target line (the objective landscape shifted vs. the endpoint-secant
  // version in the original coil-bench project); seed 1 does.
  const de = core.optimizeDE(S0, act, lo, hi, { mode: "mse", minWin: 20, dirs: [1, -1], gens: 100, rng: mulberry32(1) });
  const r = core.refineLocal(S0, base, act, de.bestX, de.bestDir, "mse", 20, lo, hi);
  assert.equal(r.refined, true);
  const r2i = act.findIndex(v => v.k === "R2");
  assert.notEqual(r.vec[r2i], act[r2i].min);
  assert.notEqual(r.vec[r2i], act[r2i].max);
});

test("coil-1 enumeration returns only Task-1-feasible full-layer windings", () => {
  for (const dwmm of [0.4, 0.5]) {
    const S0 = defaultS0();
    S0.dw = dwmm / 1000;
    S0.c1 = { ...S0.c1, R: 0.024, dw: S0.dw };
    const choices = enumerateCoil1(S0);
    assert.equal(choices.length, 26);
    assert.ok(choices.every(c => c.m1 * c.n1 <= 200 && Math.abs(c.h1solo - 25) <= 1));
  }
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

// ---- Off-axis field (review-only Sensitivity-tab check) ------------------
test("ellipKE() matches reference K(m), E(m) values", () => {
  const z = core.ellipKE(0);
  assert.ok(Math.abs(z.K - Math.PI / 2) < 1e-12 && Math.abs(z.E - Math.PI / 2) < 1e-12);
  const h = core.ellipKE(0.5);
  assert.equal(h.K.toFixed(6), "1.854075");
  assert.equal(h.E.toFixed(6), "1.350644");
});

// A 중심설계: as rho -> 0 the off-axis Hz must reduce to the on-axis H_pack value.
test("H_pack_offaxis() at rho=1e-6 m reproduces the on-axis field at x=0", () => {
  const dw = 0.5 / 1000, d = 53.6 / 1000;
  const T1 = core.coilTurns({ R: 46.25 / 1000, m: 40, n: 5, last: 26, dw, xc: 0 });
  const T2 = core.coilTurns({ R: 22.25 / 1000, m: 20, n: 1, last: 11, dw, xc: d });
  const onAxis = (core.H_pack(0, T1, 1, 1) + core.H_pack(0, T2, 1, 1)) / core.OE;
  const a = core.H_pack_offaxis(0, 1e-6, T1, 1, 1), b = core.H_pack_offaxis(0, 1e-6, T2, 1, 1);
  const hz = (a.Hz + b.Hz) / core.OE;
  assert.equal(onAxis.toFixed(4), "24.9597");
  assert.equal(hz.toFixed(4), "24.9597");
  assert.deepEqual(core.H_pack_offaxis(0, 0, T1, 1, 1), { Hz: core.H_pack(0, T1, 1, 1), Hr: 0 });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import * as ab from "./asbuilt.mjs";

// 9/29 실측 (222턴, G=40mm) — index.html 의 예시 버튼과 같은 값.
// mean_Oe 같은 여분 열은 무시하고 reading 열로 다시 평균을 내는지도 같이 확인한다.
const CSV_0929 = `x_mm,reading_1,reading_2,reading_3,mean_Oe
0,25.2,25.2,25.4,999
5,22.9,22.9,23.3,999
10,20.4,20.5,20.5,999
15,18.1,18.1,17.7,999
20,15.7,16,15.5,999
25,13.6,13.5,13.8,999
30,12.2,12.4,12.3,999
35,11.5,11.8,11.7,999
40,10.3,10.5,10.2,999`;
const X = [0, 5, 10, 15, 20, 25, 30, 35, 40];

const near = (got, want, tol, what) =>
  assert.ok(Math.abs(got - want) <= tol, `${what}: got ${got.toFixed(4)}, want ${want} ± ${tol}`);
const nearAll = (got, want, tol, what) => want.forEach((w, i) => near(got[i], w, tol, `${what}[x=${X[i]}]`));

test("defaults are the 9/29 as-built configuration", () => {
  const g = ab.AB_DEFAULTS;
  assert.deepEqual(
    [g.R1b, g.W1, g.t, g.N1, g.m1, g.p1, g.layerMode, g.R2b, g.W2, g.N2, g.dw, g.c2Place, g.dir2, g.G, g.I, g.rho],
    [45, 20, 4, 222, 31, 0.6, "uniform", 22, 10, 11, 0.5, "near", 1, 40, 1, 0]);
});

test("coil 1 turn array: uniform layers, spread order 0,7,14,…, positions in m", () => {
  assert.deepEqual(ab.abSpreadOrder(31).slice(0, 6), [0, 7, 14, 21, 28, 4]);
  const T = ab.abCoil1Turns(ab.AB_DEFAULTS);
  assert.equal(T.N, 222);
  // 222 = 31·7 + 5 → 칸 0, 7, 14, 21, 28 만 8층
  T.counts.forEach((c, i) => assert.equal(c, [0, 7, 14, 21, 28].includes(i) ? 8 : 7, `column ${i}`));
  // 칸 0, 층 0: x = −24 + (20/31)·0.5 mm, r = 45.3 mm
  near(T.xs[0] * 1000, -24 + 20 / 31 * 0.5, 1e-9, "x of first turn");
  near(T.rs[0] * 1000, 45.3, 1e-9, "r of first turn");
  assert.ok(Math.max(...T.xs) < -0.004 && Math.min(...T.xs) > -0.024, "turns stay inside [−24, −4] mm");
});

test("coil 2 turn array: 11 turns at r=22.25 mm, first centre 44.25 mm", () => {
  const T = ab.abCoil2Turns(ab.AB_DEFAULTS);
  assert.equal(T.N, 11);
  near(T.rs[0] * 1000, 22.25, 1e-9, "r");
  near(T.xs[0] * 1000, 44.25, 1e-9, "first centre");
  near(T.xs[10] * 1000, 49.25, 1e-9, "last centre");
  near(ab.abCoil2Start({ ...ab.AB_DEFAULTS, c2Place: "center" }), 44 + (10 - 5.5) / 2, 1e-12, "center start");
  near(ab.abCoil2Start({ ...ab.AB_DEFAULTS, c2Place: "far" }), 44 + 10 - 5.5, 1e-12, "far start");
});

test("skewed layers always sum to N1 and follow the thick-side toggle", () => {
  for (const [a, b] of [[4, 10], [2, 12], [10, 4]]) {
    for (const thickSide of ["coil2", "outer"]) {
      const L = ab.abLayerCounts({ ...ab.AB_DEFAULTS, layerMode: "skew", a, b, thickSide });
      assert.equal(L.reduce((p, q) => p + q, 0), 222, `${a}→${b} ${thickSide}`);
    }
  }
  const L = ab.abLayerCounts({ ...ab.AB_DEFAULTS, layerMode: "skew", a: 4, b: 10, thickSide: "coil2" });
  assert.ok(L.at(-1) > L[0], "coil-2 side is thicker");
  const R = ab.abLayerCounts({ ...ab.AB_DEFAULTS, layerMode: "skew", a: 4, b: 10, thickSide: "outer" });
  assert.ok(R[0] > R.at(-1), "outer side is thicker");
  // m1 이 7의 배수여도 남는 턴이 칸 두 개에 몰리지 않아야 한다
  const U = ab.abLayerCounts({ ...ab.AB_DEFAULTS, m1: 14, N1: 222 });
  assert.equal(U.reduce((p, q) => p + q, 0), 222);
  assert.ok(Math.max(...U) - Math.min(...U) <= 1);
});

test("default model (I=1, ρ=0) matches the reference field values", () => {
  const M = ab.abModel(ab.AB_DEFAULTS);
  nearAll(X.map(x => M.unit(x).total), [25.99, 23.78, 21.36, 18.96, 16.75, 14.85, 13.32, 12.17, 11.27], 0.01, "H");
});

test("9/29 data: RMS vs model and straight-line deviations at the entered I", () => {
  const parsed = ab.abParseCSV(CSV_0929);
  assert.equal(parsed.points.length, 9);
  assert.deepEqual(parsed.points.map(p => p.order), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  near(parsed.points[0].mean, 25.2667, 1e-4, "mean recomputed from readings, not mean_Oe");

  const g = ab.AB_DEFAULTS;
  const A = ab.abAnalyze(g, ab.abModel(g), parsed.points);
  assert.equal(A.I, 1, "model uses the entered I");
  assert.equal(A.Iest, undefined, "no back-calculated current");
  near(A.rms, 0.92, 0.01, "RMS measured − model at I=1");
  // I=1 에서의 모델 직선 이탈 (예전 추정 I=0.953 기준값 0 −0.35 −0.90 … 을 1/0.953 배 한 것과 같음)
  nearAll(A.modelDev, [0.00, -0.37, -0.94, -1.51, -1.88, -1.94, -1.63, -0.94, 0.00], 0.01, "model chord dev (I=1)");
  nearAll(A.measDev, [0.00, -0.37, -1.07, -1.70, -2.07, -2.30, -1.77, -0.53, 0.00], 0.01, "measured chord dev");
  assert.equal(A.measEnds.approx, false);
});

test("skew 4→10 (coil-2 side thicker) model at x=0 and x=40", () => {
  const M = ab.abModel({ ...ab.AB_DEFAULTS, layerMode: "skew", a: 4, b: 10, thickSide: "coil2" });
  near(M.unit(0).total, 26.50, 0.01, "H(0)");
  near(M.unit(40).total, 11.67, 0.01, "H(40)");
});

test("off-axis path: ρ → 0 converges to the on-axis H_pack value", () => {
  const on = ab.abModel(ab.AB_DEFAULTS).unit(20).total;
  const off = ab.abModel({ ...ab.AB_DEFAULTS, rho: 1e-3 }).unit(20).total;
  near(off, on, 1e-4, "H(20) at ρ=0.001 mm");
});

test("CSV parser rejects files without x_mm / reading columns", () => {
  assert.throws(() => ab.abParseCSV("pos,val\n0,1"), /x_mm/);
  assert.throws(() => ab.abParseCSV("x_mm,mean_Oe\n0,1"), /reading/);
});

// DOM-free reproduction of index.html's sensitivity() (Sensitivity tab), used
// to check the "Δ max deviation" column against the fixed 25 -> 10 Oe target
// line (2026-09-23 change). Physics comes from core.mjs; only the table logic
// (addTurns / evalWith / add) is mirrored here. Prints both the old endpoint-
// secant Δmax and the fixed-line Δmax for comparison.
//
//   node runner/sensitivity_check.mjs
import { coilTurns, H_pack, OE } from "./core.mjs";

// A 중심설계 (same inputs as the web page's left panel), default tolerances.
const dw = 0.5e-3, d = 53.6e-3;
const S0 = {
  I: 1, dw, d,
  c1: { R: 46.25e-3, m: 40, n: 5, last: 26, dw, xc: 0, dir: 1 },
  c2: { R: 22.25e-3, m: 20, n: 1, last: 11, dw, xc: d, dir: 1 },
  xa: 0, xb: d, h1: 25, h2: 10,
};
const tR = 0.5e-3, tN = 1, td = 1e-3, tI = 0.01, tx = 0.5e-3;

// Copy of index.html addTurns().
const addTurns = (c, k) => {
  let total = Math.max(1, c.m * (c.n - 1) + c.last + k);
  c.n = Math.max(1, Math.ceil(total / c.m));
  c.last = total - c.m * (c.n - 1);
  if (c.last <= 0) { c.n = Math.max(1, c.n - 1); c.last = total - c.m * (c.n - 1); }
};

// Mirror of sensitivity()'s evalWith; `fixed` picks the target line.
const evalWith = (mod, fixed) => {
  const s = JSON.parse(JSON.stringify(S0));
  mod(s);
  s.c2.xc = s.d;
  const T1 = coilTurns(s.c1), T2 = coilTurns(s.c2);
  const f = x => (H_pack(x, T1, s.c1.dir, s.I) + H_pack(x, T2, s.c2.dir, s.I)) / OE;
  const NP = 61, hs = [], xshift = mod.xshift || 0;
  const hA = f(s.xa + xshift), hB = f(s.xb + xshift);
  let maxd = 0;
  for (let i = 0; i < NP; i++) {
    const u = i / (NP - 1), x = s.xa + (s.xb - s.xa) * u;
    const h = f(x + xshift);
    const t = fixed ? S0.h1 + (S0.h2 - S0.h1) * u : hA + (hB - hA) * u;
    hs.push(h); if (Math.abs(h - t) > maxd) maxd = Math.abs(h - t);
  }
  return { hStart: hs[0], hMid: hs[(NP - 1) / 2 | 0], hEnd: hs[NP - 1], maxd };
};

const baseOld = evalWith(() => { }, false), baseNew = evalWith(() => { }, true);
const rows = [];
const add = (name, fPlus, fMinus) => {
  const r = fixed => {
    const a = evalWith(fPlus, fixed), b = evalWith(fMinus, fixed), base = fixed ? baseNew : baseOld;
    return {
      dStart: (a.hStart - b.hStart) / 2, dMid: (a.hMid - b.hMid) / 2, dEnd: (a.hEnd - b.hEnd) / 2,
      pctMid: Math.abs((a.hMid - b.hMid) / 2 / base.hMid * 100),
      dMax: Math.max(a.maxd, b.maxd) - base.maxd,
    };
  };
  rows.push({ name, old: r(false), neu: r(true) });
};
add("Coil 1 radius ±0.5 mm", s => { s.c1.R += tR; }, s => { s.c1.R -= tR; });
add("Coil 2 radius ±0.5 mm", s => { s.c2.R += tR; }, s => { s.c2.R -= tR; });
add("Coil 1 turns ±1", s => addTurns(s.c1, tN), s => addTurns(s.c1, -tN));
add("Coil 2 turns ±1", s => addTurns(s.c2, tN), s => addTurns(s.c2, -tN));
add("Separation d ±1 mm", s => { s.d += td; }, s => { s.d -= td; });
add("Current ±1%", s => { s.I *= 1 + tI; }, s => { s.I *= 1 - tI; });
const px = () => { }; px.xshift = tx; const mx = () => { }; mx.xshift = -tx;
add("Probe position ±0.5 mm", px, mx);

const sg = v => (v >= 0 ? "+" : "") + v.toFixed(3);
console.log(`base maxd: endpoint-secant ${baseOld.maxd.toFixed(3)} Oe, fixed 25->10 ${baseNew.maxd.toFixed(3)} Oe`);
console.log(["Parameter".padEnd(24), "ΔH start", "ΔH mid", "ΔH end", "% mid", "Δmax old", "Δmax new"].join("\t"));
for (const { name, old, neu } of rows) {
  if ([old.dStart - neu.dStart, old.dMid - neu.dMid, old.dEnd - neu.dEnd].some(v => v !== 0))
    throw new Error(`ΔH columns differ between old and new for ${name}`);
  console.log([name.padEnd(24), sg(neu.dStart), sg(neu.dMid), sg(neu.dEnd), neu.pctMid.toFixed(2) + "%",
    sg(old.dMax), sg(neu.dMax)].join("\t"));
}

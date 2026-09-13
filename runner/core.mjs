// Extracts the DOM-free "core" (physics + DE optimizer) straight out of
// ../index.html so the runner and the browser page share a single source of
// truth for the field model and objective function. Never reimplement the
// physics here — if index.html's core marker moves or its content changes
// shape, fix index.html or this extractor, not a parallel copy of the math.
import { readFileSync } from "node:fs";

const htmlPath = new URL("../index.html", import.meta.url);
const html = readFileSync(htmlPath, "utf8");

const CORE_RE = /\/\* ==== COIL-CORE-START ==== \*\/([\s\S]*?)\/\* ==== COIL-CORE-END ==== \*\//;
// 마커가 두 번 이상 들어가면 정규식이 첫 번째 END 에서 잘라버려 코어가 통째로
// 빠진 채로 넘어간다. 그 경우 에러 메시지가 "X is not defined" 로만 나와 원인을
// 찾기 어려우므로 여기서 먼저 명시적으로 잡는다.
for (const marker of ["COIL-CORE-START", "COIL-CORE-END"]) {
  const n = html.split(marker).length - 1;
  if (n !== 1) throw new Error(`index.html 의 ${marker} 마커가 ${n}개입니다 — 정확히 1개여야 합니다.`);
}
const m = html.match(CORE_RE);
if (!m) {
  throw new Error(
    "COIL-CORE markers not found in index.html — the core extraction " +
    "contract is broken. Restore the /* ==== COIL-CORE-START/END ==== */ " +
    "comments around the physics/optimizer code."
  );
}

const coreSrc = m[1];
for (const bad of ["document.", "document[", "window.", "window[", "$("]) {
  if (coreSrc.includes(bad)) {
    throw new Error(
      `DOM-dependent code ("${bad}") leaked into the COIL-CORE region of ` +
      `index.html. The core must stay pure (no DOM access) so it can run ` +
      `under Node.`
    );
  }
}

const EXPORTED = [
  "OE", "RHO", "clamp",
  "coilTurns", "turnCount", "H_pack", "H_thin", "wireLength", "resistance",
  "evaluate", "lsq", "findInflection",
  "OPTVARS", "packFromVec", "objective", "refineLocal",
  "optimizeDEGen", "optimizeDE",
  "solveLin", "invert",
];

const wrapped =
  coreSrc + "\n;export { " + EXPORTED.join(", ") + " };\n";

const mod = await import(
  "data:text/javascript;base64," + Buffer.from(wrapped, "utf8").toString("base64")
);

export const {
  OE, RHO, clamp,
  coilTurns, turnCount, H_pack, H_thin, wireLength, resistance,
  evaluate, lsq, findInflection,
  OPTVARS, packFromVec, objective, refineLocal,
  optimizeDEGen, optimizeDE,
  solveLin, invert,
} = mod;

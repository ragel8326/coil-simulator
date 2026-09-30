// Extracts the DOM-free As-built helpers (ASBUILT-CORE region) out of
// ../index.html, together with the COIL-CORE region they call into
// (H_pack, H_pack_offaxis, OE), so the test runs exactly the code the
// "실험 조건 (As-built)" tab runs. Same contract as core.mjs: never copy the
// math here — fix index.html or this extractor instead.
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function region(name) {
  for (const marker of [`${name}-START`, `${name}-END`]) {
    const n = html.split(`==== ${marker} ====`).length - 1;
    if (n !== 1) throw new Error(`index.html 의 ${marker} 마커가 ${n}개입니다 — 정확히 1개여야 합니다.`);
  }
  const re = new RegExp(`/\\* ==== ${name}-START ==== \\*/([\\s\\S]*?)/\\* ==== ${name}-END ==== \\*/`);
  const src = html.match(re)[1];
  for (const bad of ["document.", "document[", "window.", "window[", "$("]) {
    if (src.includes(bad)) throw new Error(`DOM-dependent code ("${bad}") leaked into the ${name} region of index.html.`);
  }
  return src;
}

const EXPORTED = [
  "OE", "H_pack", "H_pack_offaxis",
  "AB_DEFAULTS", "abSpreadOrder", "abLayerCounts", "abCoil1Turns", "abCoil2Start", "abCoil2Turns",
  "abModel", "abParseCSV", "abChordDev", "abMeasEnds", "abAnalyze",
];
const wrapped = region("COIL-CORE") + "\n" + region("ASBUILT-CORE") + "\n;export { " + EXPORTED.join(", ") + " };\n";
const mod = await import("data:text/javascript;base64," + Buffer.from(wrapped, "utf8").toString("base64"));

export const {
  OE, H_pack, H_pack_offaxis,
  AB_DEFAULTS, abSpreadOrder, abLayerCounts, abCoil1Turns, abCoil2Start, abCoil2Turns,
  abModel, abParseCSV, abChordDev, abMeasEnds, abAnalyze,
} = mod;

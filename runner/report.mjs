// Output writers: raw.jsonl (every run, unfiltered), top.csv (feasible
// designs, ranked), convergence.csv (best-so-far vs restart count), and
// report.md (the human-readable summary). No search/physics logic lives
// here — this file only formats what search.mjs/robust.mjs produced.
import { writeFileSync, mkdirSync } from "node:fs";
import { ASSUMPTIONS } from "./robust.mjs";

function csvCell(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvRow(cells) { return cells.map(csvCell).join(","); }

export function writeRawJsonl(path, records) {
  const lines = records.map(r => JSON.stringify(r)).join("\n") + "\n";
  writeFileSync(path, lines, "utf8");
}

// 총 턴수 = 층당 턴수 x (층수 - 1) + 마지막 층 턴수.
// index.html 의 turnCount() 와 같은 식이다.
function turnsOf(m, n, last) {
  if (m == null || n == null || last == null) return "";
  return m * (n - 1) + last;
}

const TOP_COLUMNS = [
  "dw_mm", "stage", "rank", "seed", "obj", "feasible",
  "R1_mm", "m1", "n1", "last1", "R2_mm", "m2", "n2", "last2", "d_mm", "I_A", "dir2",
  "N1_turns", "N2_turns",
  "width1_mm", "width2_mm", "thick1_mm", "thick2_mm",
  "bore1_mm", "bore2_mm", "overlap", "softOk",
  "maxDev_Oe", "rmsDev_Oe", "nonlin_Oe", "h1solo_Oe", "hAt0_Oe", "hAtD_Oe",
  "Rtot_ohm", "P_W", "V_V", "wireLen_m", "J_A_per_mm2",
  "p95MaxDev_Oe", "feasibleFraction",
];

export function writeTopCsv(path, entries) {
  const rows = [csvRow(TOP_COLUMNS)];
  entries.forEach((e, i) => {
    const p = e.params || {};
    const m = e.metrics || {};
    rows.push(csvRow([
      e.dw_mm, e.stage, i + 1, e.seed ?? "", e.obj, e.feasible,
      p.R1, p.m1, p.n1, p.last1, p.R2, p.m2, p.n2, p.last2, p.d, p.I ?? "", p.dir2,
      m.N1 ?? turnsOf(p.m1, p.n1, p.last1), m.N2 ?? turnsOf(p.m2, p.n2, p.last2),
      m.width1 ?? "", m.width2 ?? "", m.thick1 ?? "", m.thick2 ?? "",
      m.bore1 ?? "", m.bore2 ?? "", m.overlap ?? "", e.softOk ?? "",
      m.maxDev, m.rmsDev, m.nonlin, m.h1solo, m.hAt0, m.hAtD,
      m.Rtot, m.P, m.V, m.wireLen, m.J,
      e.robust ? e.robust.p95MaxDev : "", e.robust ? e.robust.feasibleFraction : "",
    ]));
  });
  // UTF-8 BOM so Excel opens Korean-adjacent text correctly.
  writeFileSync(path, "﻿" + rows.join("\n") + "\n", "utf8");
}

export function writeConvergenceCsv(path, byDw) {
  const rows = [csvRow(["dw_mm", "n_restarts", "best_so_far"])];
  for (const [dw, convergence] of Object.entries(byDw)) {
    for (const c of convergence) rows.push(csvRow([dw, c.n, c.bestSoFar]));
  }
  writeFileSync(path, "﻿" + rows.join("\n") + "\n", "utf8");
}

function fmt(v, d = 3) { return typeof v === "number" && isFinite(v) ? v.toFixed(d) : "—"; }

export function writeReportMd(path, { dwResults, cliArgs }) {
  const lines = [];
  lines.push("# Coil bench optimization run");
  lines.push("");
  lines.push(`Generated ${new Date().toISOString()} — CLI args: \`${cliArgs.join(" ")}\``);
  lines.push("");
  lines.push("> **Assumptions banner — values below are UNCONFIRMED unless marked otherwise.**");
  lines.push("> See `runner/assumptions.json` for the full list and reasons.");
  lines.push(">");
  for (const [key, a] of Object.entries(ASSUMPTIONS)) {
    if (key.startsWith("_") || key === "toleranceModel") continue;
    lines.push(`> - **${key}** = ${JSON.stringify(a.value)} (${a.status}) — ${a.note}`);
  }
  lines.push("");

  lines.push("## Wire-gauge comparison");
  lines.push("");
  lines.push("| dw (mm) | feasible / restarts | best max-dev (Oe) | best p95 max-dev (Oe) | integer-snap Δ max-dev (Oe) |");
  lines.push("|---|---|---|---|---|");
  for (const r of dwResults) {
    lines.push(`| ${r.dw} | ${r.feasibleCount} / ${r.restarts} | ${fmt(r.bestNominal)} | ${fmt(r.bestRobust)} | ${fmt(r.snapDelta)} |`);
  }
  lines.push("");

  for (const r of dwResults) {
    lines.push(`## dw = ${r.dw} mm — top designs (ranked by tolerance-robust 95th-percentile max deviation)`);
    lines.push("");
    if (!r.top.length) {
      lines.push("_No feasible design found at this wire gauge within the searched ranges._");
      lines.push("");
      continue;
    }
    lines.push("| rank | R1 (mm) | m1×n1 (last) | R2 (mm) | m2×n2 (last) | d (mm) | I (A) | dir2 | max-dev nominal (Oe) | max-dev p95 (Oe) | J (A/mm²) |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
    r.top.forEach((e, i) => {
      const p = e.params, m = e.metrics;
      lines.push(`| ${i + 1} | ${fmt(p.R1, 1)} | ${p.m1}×${p.n1} (${p.last1}) | ${fmt(p.R2, 1)} | ${p.m2}×${p.n2} (${p.last2}) | ${fmt(p.d, 1)} | ${fmt(p.I ?? "", 3)} | ${p.dir2 > 0 ? "+" : "−"} | ${fmt(m.maxDev)} | ${e.robust ? fmt(e.robust.p95MaxDev) : "—"} | ${fmt(m.J, 2)} |`);
    });
    lines.push("");
    if (r.integerSnapTop) {
      lines.push(`**Integer-mm snap of rank-1 design**: max-dev ${fmt(r.integerSnapTop.metrics ? r.integerSnapTop.metrics.maxDev : NaN)} Oe ` +
        `(nominal was ${fmt(r.top[0].metrics.maxDev)} Oe, Δ = ${fmt(r.snapDelta)} Oe) — ` +
        (r.snapDelta != null && r.snapDelta < 0.05
          ? "small enough that an integer-mm bobbin looks free."
          : "non-trivial — check whether an integer-mm bobbin is still acceptable."));
      lines.push("");
    }
  }

  lines.push("## Convergence — how many restarts are enough?");
  lines.push("");
  lines.push("See `convergence.csv` for the full best-so-far-vs-restart-count series per wire gauge; " +
    "plot it to see where the curve flattens (that restart count is enough for future runs).");
  lines.push("");

  mkdirSync(path.substring(0, path.lastIndexOf("/")), { recursive: true });
  writeFileSync(path, lines.join("\n"), "utf8");
}

// 레일형 보빈 간격 스윕 표. 열 순서는 gapsweep.mjs 가 만드는 객체 순서를 따른다.
export function writeGapSweepCsv(path, rows) {
  if (!rows.length) { writeFileSync(path, "\ufeff(간격 스윕 결과 없음)\n", "utf8"); return; }
  const cols = Object.keys(rows[0]);
  const out = [csvRow(cols), ...rows.map(r => csvRow(cols.map(c => r[c])))];
  writeFileSync(path, "\ufeff" + out.join("\n") + "\n", "utf8");
}

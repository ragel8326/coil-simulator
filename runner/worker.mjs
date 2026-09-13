// worker_threads worker: runs one multi-start seed (DE -> local refinement ->
// constraint judgement) via search.runSeed, identical to the sequential path.
// Spawned and fed work by parallelMultiStart() below.
import { parentPort, workerData } from "node:worker_threads";
import { runSeed } from "./search.mjs";

const { S0, act, lo, hi, seed, opts } = workerData;
try {
  const record = runSeed(S0, act, lo, hi, seed, opts);
  parentPort.postMessage({ ok: true, record });
} catch (err) {
  parentPort.postMessage({ ok: false, error: String(err && err.stack || err), seed });
}

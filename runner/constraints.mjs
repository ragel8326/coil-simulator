// Manufacturability/task judgments — kept byte-for-byte in sync with the
// chip logic in index.html's renderMetrics(). If a threshold changes there,
// change it here too (and vice versa); this file must never invent its own
// numbers.
//
// Violated designs are NOT discarded by the caller — this module just
// reports how far each design misses each requirement, in the same units
// renderMetrics() shows, so "how close did we get" stays visible.

export function currentDensity(S) {
  const dwmm = S.dw * 1000;
  const wireArea = Math.PI * (dwmm / 2) * (dwmm / 2); // mm^2
  return S.I / wireArea; // A/mm^2
}

export function judge(S, E) {
  const task1Excess = Math.max(0, Math.abs(E.h1solo - 25) - 1.0);
  const task3StartExcess = Math.max(0, Math.abs(E.hAt0 - 25) - 1.0);
  const task3EndExcess = Math.max(0, Math.abs(E.hAtD - 10) - 1.0);
  const currentExcess = Math.max(0, S.I - 1.0); // "<= 1.001 A" bench check; 1.0 is the real limit
  const J = currentDensity(S);
  const jExcess = Math.max(0, J - S.jsafe);

  const violations = {
    task1: task1Excess,
    task3Start: task3StartExcess,
    task3End: task3EndExcess,
    current: currentExcess,
    currentDensity: jExcess,
  };
  const feasible = Object.values(violations).every(v => v <= 0);

  return { feasible, violations, currentDensityValue: J };
}

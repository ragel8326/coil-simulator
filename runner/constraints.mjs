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

  // 하드 제약: 이걸 어기면 과제 요구사항 자체를 못 맞추므로 탈락이다.
  const hard = {
    task1: task1Excess,
    task3Start: task3StartExcess,
    task3End: task3EndExcess,
    current: currentExcess,
  };
  // 소프트 제약: 전류밀도 5 A/mm2 는 출처가 확인되지 않은 가정값이고, 측정이
  // 몇 분짜리라면 잠깐 넘겨도 되는 성격이다. 그래서 탈락시키지 않고 넘었는지만
  // 표시하며, 순위를 매길 때 넘지 않은 설계를 앞세우는 방식으로 반영한다.
  const violations = { ...hard, currentDensity: jExcess };
  const feasible = Object.values(hard).every(v => v <= 0);
  const softOk = jExcess <= 0;

  return { feasible, softOk, violations, currentDensityValue: J };
}

// 레일형 보빈용 간격 스윕.
//
// 팀은 코일 간격(gap)을 바꿔가며 실험할 수 있도록 보빈을 교체 가능한 레일형으로
// 만들기로 했다. 그 경우 코일 자체(반경·턴수·층수·도선)는 한 번 감으면 고정이고,
// 실험대에서 바꿀 수 있는 것은 두 코일 사이 거리와 전원 장치의 전류뿐이다.
//
// 그래서 이 단계는 최종 선택된 설계 하나를 놓고, 간격을 정수 mm 로 훑으면서
// 각 간격마다 전류를 다시 맞췄을 때 성능이 어떻게 되는지 표로 만든다. 어느 간격의
// 보빈을 출력할지, 실험대에서 전류를 얼마로 맞출지를 이 표에서 읽으면 된다.
//
// 주의: 목표 자기장 구간이 [0, d] 이므로 간격을 바꾸면 측정 구간 자체가 바뀐다.
// 즉 이 표는 "같은 코일로 다른 구배를 만들어 본다"는 뜻이지, 한 구배를 미세조정
// 하는 것이 아니다.
import { evalDesign } from "./search.mjs";

export function gapSweep(S0, params, { range = 20, step = 1, iLo = 0.1, iHi = 1.0, iSteps = 181 } = {}) {
  const dir2 = params.dir2;
  const d0 = Math.round(params.d);
  const rows = [];

  for (let d = Math.max(10, d0 - range); d <= d0 + range; d += step) {
    // 전류는 전원 장치 다이얼로 바꿀 수 있으므로 간격마다 다시 최적화한다.
    // 자기장은 전류에 비례하지만 목표 직선은 고정이므로, 간격마다 최적 전류가 다르다.
    // 요구사항을 통과하는 전류 중에서 가장 좋은 것을 고른다. 편차만 보고 고르면
    // 전류가 낮아져 코일1 단독 25±1 Oe(Task 1) 같은 조건을 어기는 값이 뽑힌다.
    // 통과하는 전류가 하나도 없으면 그 사실을 표시하고 편차 기준 최선을 남긴다.
    let bestOk = null, bestAny = null;
    for (let k = 0; k < iSteps; k++) {
      const I = iLo + ((iHi - iLo) * k) / (iSteps - 1);
      const p = { ...params, d, I };
      const r = evalDesign(S0, p, dir2);
      if (!bestAny || r.E.maxDev < bestAny.r.E.maxDev) bestAny = { r, I };
      if (r.feasible && (!bestOk || r.E.maxDev < bestOk.r.E.maxDev)) bestOk = { r, I };
    }
    const { r, I } = bestOk || bestAny;
    rows.push({
      dw_mm: +(S0.dw * 1000).toFixed(3),
      d_mm: d,
      bestI_A: +I.toFixed(4),
      feasible: r.feasible,
      anyFeasibleCurrent: !!bestOk,
      maxDev_Oe: r.E.maxDev,
      rmsDev_Oe: r.E.rmsDev,
      hAt0_Oe: r.E.hAt0,
      hAtD_Oe: r.E.hAtD,
      h1solo_Oe: r.E.h1solo,
      J_A_per_mm2: r.currentDensityValue,
      Rtot_ohm: r.E.Rtot,
      V_V: r.E.V,
      P_W: r.E.P,
      viol_task1: r.violations.task1,
      viol_x0: r.violations.task3Start,
      viol_xd: r.violations.task3End,
      viol_current: r.violations.current,
      viol_J: r.violations.currentDensity,
    });
  }
  return rows;
}

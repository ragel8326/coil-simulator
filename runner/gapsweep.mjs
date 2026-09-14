// 레일형 보빈용 간격 스윕.
//
// 팀은 코일 간격(gap)을 바꿔가며 실험할 수 있도록 보빈을 교체 가능한 레일형으로
// 만들기로 했다. 그 경우 코일 자체(반경·턴수·층수·도선)는 한 번 감으면 고정이고,
// 실험대에서 바꾸는 것은 두 코일 사이 거리뿐이다. 과제 원문과 팀의
// 2026-09-14 결정에 따라 전류는 모든 간격에서 S0.I(기본 1 A)로 고정한다.
//
// 그래서 이 단계는 최종 선택된 설계 하나를 놓고, 간격을 정수 mm 로 훑으면서
// 각 간격에서 고정 전류 성능이 어떻게 되는지 표로 만든다.
//
// 주의: 목표 자기장 구간이 [0, d] 이므로 간격을 바꾸면 측정 구간 자체가 바뀐다.
// 즉 이 표는 "같은 코일로 다른 구배를 만들어 본다"는 뜻이지, 한 구배를 미세조정
// 하는 것이 아니다.
import { evalDesign } from "./search.mjs";

export function gapSweep(S0, params, { range = 20, step = 1 } = {}) {
  const dir2 = params.dir2;
  const d0 = Math.round(params.d);
  const rows = [];

  for (let d = Math.max(10, d0 - range); d <= d0 + range; d += step) {
    const I = S0.I;
    const r = evalDesign(S0, { ...params, d, I }, dir2);
    rows.push({
      dw_mm: +(S0.dw * 1000).toFixed(3),
      d_mm: d,
      bestI_A: +I.toFixed(4),
      feasible: r.feasible,
      anyFeasibleCurrent: r.feasible,
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

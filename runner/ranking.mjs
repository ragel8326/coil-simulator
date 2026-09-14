// 순위 비교 규칙.
//
// 가우스미터가 0.1 Oe 단위까지만 읽으므로, 편차가 0.78 인 설계와 0.80 인 설계는
// 실물에서 구분할 방법이 없다. 그런 차이 때문에 턴수를 200 더 감는 것은 손해다.
// 그래서 편차를 측정 분해능 격자로 양자화해 같은 칸에 들어오면 동점으로 보고,
// 동점 안에서는 만들기 쉬운 쪽(총 턴수가 적고, 그다음 구리선이 짧은 쪽)을 앞세운다.
//
// 양자화 후 비교하므로 정렬 순서가 항상 일관된다. 오차 범위로 "비슷하면 같다"고
// 비교하면 a=b, b=c 인데 a≠c 인 상황이 생겨 정렬이 뒤죽박죽될 수 있다.
export const FIELD_RESOLUTION_OE = 0.1;

const turnsOf = r => ((r.metrics || {}).N1 || 0) + ((r.metrics || {}).N2 || 0);
const wireOf = r => (r.metrics || {}).wireLen ?? Infinity;

export function rankCompare(getMetric, res = FIELD_RESOLUTION_OE) {
  return (a, b) => {
    // 1순위: 전류밀도 소프트 한계를 넘지 않은 설계
    const sa = a.softOk === false ? 1 : 0, sb = b.softOk === false ? 1 : 0;
    if (sa !== sb) return sa - sb;
    // 2순위: 측정으로 구분 가능한 수준의 성능
    const va = getMetric(a), vb = getMetric(b);
    const qa = Math.round((isFinite(va) ? va : 1e9) / res);
    const qb = Math.round((isFinite(vb) ? vb : 1e9) / res);
    if (qa !== qb) return qa - qb;
    // 3순위: 감기 쉬운 쪽
    const ta = turnsOf(a), tb = turnsOf(b);
    if (ta !== tb) return ta - tb;
    return wireOf(a) - wireOf(b);
  };
}

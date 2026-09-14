#!/usr/bin/env python3
"""러너 실행 결과 폴더(runs/<날짜>) 하나를 엑셀 파일 하나로 합친다.

사용법:  python3 runner/to_xlsx.py runs/2026-09-13 [출력파일.xlsx]

시트 구성
  읽는법     각 열이 무슨 뜻인지
  가정값     아직 확인되지 않은 입력값 목록
  굵기비교   도선 굵기별 요약
  상위설계   공차까지 반영해 최종 순위를 매긴 설계
  최적화결과 최적화가 찾아낸 모든 설계 (재시작 1회 = 1행)
  전수탐색   무작위로 뽑아 계산만 해본 설계 전부
  수렴       재시작 횟수에 따른 최고 성능 변화
"""
import json, sys, csv, io, os
from openpyxl import Workbook

HEAD = {
    "stage": "단계", "dw_mm": "도선굵기(mm)", "seed": "시드", "sample": "표본번호",
    "obj": "목적함수값", "feasible": "요구사항충족", "rank": "순위",
    "params.R1": "코일1반경(mm)", "params.m1": "코일1 층당턴수", "params.n1": "코일1 층수",
    "params.last1": "코일1 마지막층턴수", "params.R2": "코일2반경(mm)",
    "params.m2": "코일2 층당턴수", "params.n2": "코일2 층수", "params.last2": "코일2 마지막층턴수",
    "params.d": "코일간격(mm)", "params.I": "전류(A)", "params.dir2": "코일2감는방향",
    "metrics.maxDev": "최대편차(Oe)", "metrics.rmsDev": "RMS편차(Oe)", "metrics.nonlin": "비선형성(Oe)",
    "metrics.h1solo": "코일1단독중심(Oe)", "metrics.hAt0": "x=0자기장(Oe)", "metrics.hAtD": "x=d자기장(Oe)",
    "metrics.Rtot": "총저항(Ω)", "metrics.P": "소비전력(W)", "metrics.V": "필요전압(V)",
    "metrics.wireLen": "구리선길이(m)", "metrics.N1": "코일1총턴수", "metrics.N2": "코일2총턴수",
    "metrics.J": "전류밀도(A/mm²)",
    "N1_turns": "코일1총턴수", "N2_turns": "코일2총턴수",
    "metrics.bore1": "코일1 안지름(mm)", "metrics.bore2": "코일2 안지름(mm)",
    "metrics.overlap": "두 코일 축방향 겹침", "softOk": "전류밀도 한계 이내",
    "bore1_mm": "코일1 안지름(mm)", "bore2_mm": "코일2 안지름(mm)",
    "overlap": "두 코일 축방향 겹침",
    "maxTurns": "턴수 상한", "softOkCount": "전류밀도 이내 개수", "dimStep": "치수 격자(mm)",
    "bestI_A": "그 간격에서 최적 전류(A)",
    "anyFeasibleCurrent": "요구사항 통과 전류 존재",
    "viol_task1": "위반_Task1", "viol_x0": "위반_x=0", "viol_xd": "위반_x=d",
    "viol_current": "위반_전류상한", "viol_J": "위반_전류밀도",
    "metrics.width1": "코일1 축방향폭(mm)", "metrics.width2": "코일2 축방향폭(mm)",
    "metrics.thick1": "코일1 반경방향두께(mm)", "metrics.thick2": "코일2 반경방향두께(mm)",
    "width1_mm": "코일1 축방향폭(mm)", "width2_mm": "코일2 축방향폭(mm)",
    "thick1_mm": "코일1 반경방향두께(mm)", "thick2_mm": "코일2 반경방향두께(mm)",
    # top.csv / top_integer.csv / summary.json 의 영문 열 이름도 한글로
    "rank": "순위", "R1_mm": "코일1반경(mm)", "m1": "코일1 층당턴수", "n1": "코일1 층수",
    "last1": "코일1 마지막층턴수", "R2_mm": "코일2반경(mm)", "m2": "코일2 층당턴수",
    "n2": "코일2 층수", "last2": "코일2 마지막층턴수", "d_mm": "코일간격(mm)",
    "I_A": "전류(A)", "dir2": "코일2감는방향",
    "maxDev_Oe": "최대편차(Oe)", "rmsDev_Oe": "RMS편차(Oe)", "nonlin_Oe": "비선형성(Oe)",
    "h1solo_Oe": "코일1단독중심(Oe)", "hAt0_Oe": "x=0자기장(Oe)", "hAtD_Oe": "x=d자기장(Oe)",
    "Rtot_ohm": "총저항(Ω)", "P_W": "소비전력(W)", "V_V": "필요전압(V)",
    "wireLen_m": "구리선길이(m)", "J_A_per_mm2": "전류밀도(A/mm²)",
    "p95MaxDev_Oe": "공차반영 p95최대편차(Oe)", "feasibleFraction": "공차하 충족비율",
    "dw": "도선굵기(mm)", "restarts": "최적화반복횟수", "feasibleCount": "요구사항충족개수",
    "bestNominal": "최고 최대편차(Oe)", "bestRobust": "최고 p95최대편차(Oe)",
    "snapDelta": "정수mm 손실(Oe)", "bestIntegerNominal": "정수mm 최고 최대편차(Oe)",
    "bestIntegerRobust": "정수mm 최고 p95최대편차(Oe)",
    "violations.task1": "위반_Task1", "violations.task3Start": "위반_x=0",
    "violations.task3End": "위반_x=d", "violations.current": "위반_전류상한",
    "violations.currentDensity": "위반_전류밀도",
    "robust.p95MaxDev": "공차반영 p95최대편차(Oe)", "robust.feasibleFraction": "공차하 충족비율",
}
GLOSS = [
    ("최대편차(Oe)", "목표 직선(25→10 Oe)에서 가장 크게 벗어난 값. 작을수록 좋다."),
    ("공차반영 p95최대편차(Oe)", "제작 오차를 감안해 여러 번 시뮬레이션했을 때, 나쁜 쪽 5%에 해당하는 최대편차. 상위설계 순위는 이 값 기준."),
    ("요구사항충족", "Task1(코일1 단독 25±1 Oe), x=0에서 25±1, x=d에서 10±1, 전류 1A 이하, 전류밀도 한계 이하를 모두 만족하면 TRUE."),
    ("위반_*", "각 요구사항을 얼마나 초과했는지. 0이면 통과."),
    ("전류밀도(A/mm²)", "전류 ÷ 도선 단면적. 높을수록 코일이 뜨거워진다."),
    ("전류밀도 한계 이내", "전류밀도 5 A/mm²를 넘지 않으면 TRUE. 이 값은 탈락 기준이 아니라 소프트 기준이라, 순위를 매길 때 TRUE 인 설계를 먼저 줄세우고 FALSE 는 뒤로 보낸다."),
    ("두 코일 축방향 겹침", "두 코일이 축 방향으로 서로 파고드는지. 반경이 다르면 한쪽이 다른 쪽 안으로 들어가 실제로 만들 수는 있지만, 레일에 나란히 놓는 구조는 아니다."),
    ("코일1/2 안지름(mm)", "코일 안쪽 구멍의 지름. 자기장 측정 프로브가 이 안을 지나가야 하므로, 프로브 두께보다 커야 한다."),
    ("턴수 상한", "그 실행에서 코일 하나당 허용한 최대 턴수. 0 이면 무제한."),
    ("축방향폭 / 반경방향두께(mm)", "코일을 감았을 때 실제로 차지하는 크기. 폭 = 층당 턴수 x 도선 지름, 두께 = 층수 x 도선 지름. 프로그램은 이 값에 제한을 걸지 않으므로, 보빈에 들어가는 크기인지는 직접 보고 판단해야 한다."),
    ("코일2감는방향", "+1이면 코일1과 같은 방향, -1이면 반대 방향."),
    ("정수mm설계 시트", "반경과 간격이 모두 정수 mm 인 설계만 모아 따로 순위를 매긴 표. 보빈을 정수 mm 로 제작하므로 실제로 만들 설계는 이 시트의 1등이다."),
    ("간격스윕 시트", "레일형 보빈용. 코일은 그대로 두고 두 코일 사이 간격만 1mm 씩 바꿨을 때의 성능. 간격마다 전류를 다시 맞춘 값이 함께 들어 있어, 어느 간격의 보빈을 출력하고 실험대에서 전류를 얼마로 맞출지 이 표에서 읽으면 된다."),
    ("단계", "S-sweep=무작위 탐색, A=최적화 재시작, B-*=이웃 정밀탐색, C=공차 재랭킹, C-int/final-int=정수 mm 설계 재랭킹."),
]

# 열별 표시 자리수. 측정으로 읽을 수 있는 자기장 값은 소수점 1자리,
# 설계 치수도 1자리(0.1mm 격자). 편차 지표는 설계끼리 비교하는 값이라 3자리를 남긴다.
ROUND = {
    "코일1반경(mm)": 1, "코일2반경(mm)": 1, "코일간격(mm)": 1,
    "코일1 축방향폭(mm)": 1, "코일2 축방향폭(mm)": 1,
    "코일1 반경방향두께(mm)": 1, "코일2 반경방향두께(mm)": 1,
    "코일1 안지름(mm)": 1, "코일2 안지름(mm)": 1,
    "x=0자기장(Oe)": 1, "x=d자기장(Oe)": 1, "코일1단독중심(Oe)": 1,
    "최대편차(Oe)": 3, "RMS편차(Oe)": 3, "비선형성(Oe)": 3,
    "공차반영 p95최대편차(Oe)": 3, "목적함수값": 3,
    "전류(A)": 3, "그 간격에서 최적 전류(A)": 3,
    "전류밀도(A/mm²)": 2, "구리선길이(m)": 1,
    "총저항(Ω)": 2, "소비전력(W)": 2, "필요전압(V)": 2,
    "공차하 충족비율": 3,
}

def num(v):
    # 엑셀에서 17자리 부동소수점은 읽기만 어렵고 파일만 키운다. 유효숫자 8자리로 줄인다.
    if isinstance(v, float) and v == v and v not in (float("inf"), float("-inf")):
        return float(f"{v:.8g}")
    return v

def flat(rec, prefix=""):
    out = {}
    for k, v in rec.items():
        key = prefix + k
        if isinstance(v, dict):
            out.update(flat(v, key + "."))
        elif not isinstance(v, (list, tuple)):
            out[key] = num(v)
    return out

def add_turns(r):
    """총 턴수 = 층당 턴수 x (층수 - 1) + 마지막 층 턴수. index.html 의 turnCount() 와 같은 식.
    러너가 넣어준 값이 있으면 그대로 두고, 없을 때만(예전 실행 결과) 계산해 채운다."""
    for i in ("1", "2"):
        pre = "params." if ("params.m" + i) in r else ""
        m, n, last = r.get(pre + "m" + i), r.get(pre + "n" + i), r.get(pre + "last" + i)
        key = "metrics.N" + i if pre else "N" + i + "_turns"
        if r.get(key) in (None, "") and None not in (m, n, last):
            try:
                r[key] = int(float(m)) * (int(float(n)) - 1) + int(float(last))
            except (TypeError, ValueError):
                pass
    return r

def read_jsonl(path):
    if not os.path.exists(path): return []
    with io.open(path, encoding="utf-8") as f:
        return [add_turns(flat(json.loads(l))) for l in f if l.strip()]

def add_sheet(wb, title, rows, order=None):
    ws = wb.create_sheet(title)
    if not rows:
        ws.append(["(데이터 없음)"]); return
    keys = order or sorted({k for r in rows for k in r},
                           key=lambda k: (list(HEAD).index(k) if k in HEAD else 999, k))
    names = [HEAD.get(k, k) for k in keys]
    ws.append(names)
    digits = [ROUND.get(n) for n in names]
    for r in rows:
        out = []
        for k, d in zip(keys, digits):
            v = r.get(k)
            if d is not None:
                try:
                    v = round(float(v), d)
                except (TypeError, ValueError):
                    pass
            out.append(v)
        ws.append(out)
    ws.freeze_panes = "A2"

def main():
    argv = sys.argv[1:]
    out = None
    if "--out" in argv:
        i = argv.index("--out"); out = argv[i + 1]; argv = argv[:i] + argv[i + 2:]
    runs = [a.rstrip("/") for a in argv]
    run = runs[0]
    if out is None: out = os.path.join(run, "결과.xlsx")
    wb = Workbook(); wb.remove(wb.active)

    ws = wb.create_sheet("읽는법")
    ws.append(["열 이름", "뜻"])
    for a, b in GLOSS: ws.append([a, b])
    ws.column_dimensions["A"].width = 28; ws.column_dimensions["B"].width = 90

    apath = os.path.join(os.path.dirname(__file__), "assumptions.json")
    if os.path.exists(apath):
        a = json.load(io.open(apath, encoding="utf-8"))
        items = a.get("assumptions", a)
        rows = []
        if isinstance(items, dict):
            # _read_me / toleranceModel 은 설명 문자열이지 가정 항목이 아니므로 제외한다.
            for k, v in items.items():
                if k in ("_read_me", "toleranceModel") or k.startswith("_"):
                    continue
                d = v if isinstance(v, dict) else {"value": v}
                # assumptions.json 은 status: "confirmed"/"unconfirmed" 문자열을 쓴다
                # (예전에 여기서 존재하지 않는 "confirmed" 불리언 키를 찾는 바람에
                # 실제로는 확정인 항목도 전부 "미확정"으로 나오는 버그가 있었다).
                status = d.get("status")
                confirmed = status == "confirmed" if status is not None else bool(d.get("confirmed"))
                rows.append({"항목": k, "값": d.get("value"),
                             "확정여부": "확정" if confirmed else "미확정",
                             "설명": d.get("note") or d.get("reason") or ""})
        add_sheet(wb, "가정값", rows, order=["항목", "값", "확정여부", "설명"])

    summ = []
    for rd in runs:
        sp = os.path.join(rd, "summary.json")
        if os.path.exists(sp): summ += [flat(r) for r in json.load(io.open(sp, encoding="utf-8"))]
    add_sheet(wb, "굵기비교", summ)

    tops = []
    for rd in runs:
        tp = os.path.join(rd, "top.csv")
        if os.path.exists(tp):
            with io.open(tp, encoding="utf-8-sig") as f: tops += [add_turns(r) for r in csv.DictReader(f)]
    add_sheet(wb, "상위설계", tops)

    ints = []
    for rd in runs:
        ip = os.path.join(rd, "top_integer.csv")
        if os.path.exists(ip):
            with io.open(ip, encoding="utf-8-sig") as f: ints += [add_turns(r) for r in csv.DictReader(f)]
    add_sheet(wb, "정수mm설계", ints)

    gaps = []
    for rd in runs:
        gp = os.path.join(rd, "gap_sweep.csv")
        if os.path.exists(gp):
            with io.open(gp, encoding="utf-8-sig") as f: gaps += list(csv.DictReader(f))
    add_sheet(wb, "간격스윕", gaps)

    opt, swp = [], []
    for rd in runs:
        opt += read_jsonl(os.path.join(rd, "raw.jsonl"))
        swp += read_jsonl(os.path.join(rd, "sweep.jsonl"))
    add_sheet(wb, "최적화결과", opt)
    add_sheet(wb, "전수탐색", swp)

    conv = []
    for rd in runs:
        cp = os.path.join(rd, "convergence.csv")
        if os.path.exists(cp):
            with io.open(cp, encoding="utf-8-sig") as f: conv += list(csv.DictReader(f))
    add_sheet(wb, "수렴", conv)

    wb.save(out)
    print("엑셀 저장:", out)

main()

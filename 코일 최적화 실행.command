#!/bin/bash
# 코일 벤치 대량 최적화 — 파인더에서 더블클릭해 실행합니다.
# 묻는 말에 숫자만 답하면 자동으로 돌아가고, 끝나면 엑셀 파일이 만들어집니다.

cd "$(dirname "$0")" || exit 1
B=$'\033[1m'; D=$'\033[2m'; G=$'\033[32m'; R=$'\033[31m'; N=$'\033[0m'

pause_exit() { echo ""; read -n 1 -s -r -p "아무 키나 누르면 창이 닫힙니다."; echo ""; exit "${1:-0}"; }

clear
echo ""
echo "  ${B}코일 벤치 대량 최적화${N}"
echo "  ${D}$(pwd)${N}"
echo ""

# ---- 필요한 프로그램이 깔려 있는지 확인 ----------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "  ${R}Node.js가 설치되어 있지 않습니다.${N}"
  echo "  https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 더블클릭해주세요."
  pause_exit 1
fi
if ! python3 -c "import openpyxl" >/dev/null 2>&1; then
  echo "  ${R}엑셀 저장에 필요한 openpyxl 이 없습니다.${N}"
  echo "  터미널에 아래 한 줄을 실행한 뒤 다시 더블클릭해주세요."
  echo ""
  echo "      pip3 install openpyxl"
  pause_exit 1
fi

# ---- 1. 도선 굵기 ---------------------------------------------------------
echo "  ${B}1. 도선 굵기를 고르세요.${N}"
echo "     1) 0.3 mm      2) 0.4 mm      3) 0.5 mm      4) 세 가지 전부"
read -p "     번호 [기본 4]: " a
case "${a:-4}" in
  1) DWS="0.3" ;;
  2) DWS="0.4" ;;
  3) DWS="0.5" ;;
  *) DWS="0.3 0.4 0.5" ;;
esac
echo "     → ${G}${DWS} mm${N}"
echo ""

# ---- 2. 최적화 횟수 -------------------------------------------------------
echo "  ${B}2. 최적화를 몇 번 반복할까요?${N}"
echo "     ${D}한 번에 하나씩 처음부터 다시 찾습니다. 많을수록 더 좋은 설계가 나올 확률이 올라갑니다.${N}"
echo "     ${D}굵기 하나당 120번이면 약 1분 20초 걸립니다.${N}"
read -p "     횟수 [기본 120]: " RESTARTS
RESTARTS="${RESTARTS:-120}"
case "$RESTARTS" in ''|*[!0-9]*) echo "     ${R}숫자가 아닙니다. 120으로 진행합니다.${N}"; RESTARTS=120 ;; esac
echo "     → ${G}${RESTARTS}번${N}"
echo ""

# ---- 3. 전수탐색 개수 -----------------------------------------------------
echo "  ${B}3. 무작위로 계산해볼 설계를 몇 개 뽑을까요?${N}"
echo "     ${D}최적화와 별개로, 설계 공간을 넓게 훑어보는 표입니다. 엑셀의 '전수탐색' 시트가 됩니다.${N}"
echo "     ${D}3만 개는 몇 초면 끝납니다. 0을 넣으면 건너뜁니다.${N}"
read -p "     개수 [기본 30000]: " SWEEP
SWEEP="${SWEEP:-30000}"
case "$SWEEP" in ''|*[!0-9]*) echo "     ${R}숫자가 아닙니다. 30000으로 진행합니다.${N}"; SWEEP=30000 ;; esac
echo "     → ${G}${SWEEP}개${N}"
echo ""

# ---- 4. 결과 폴더 이름 ----------------------------------------------------
DEF="$(date +%Y-%m-%d_%H%M)"
echo "  ${B}4. 결과를 어떤 이름으로 저장할까요?${N}"
read -p "     이름 [기본 ${DEF}]: " NAME
NAME="${NAME:-$DEF}"
OUT="runs/${NAME}"
echo "     → ${G}${OUT}/${N}"
echo ""

# ---- 확인 -----------------------------------------------------------------
NGAUGE=$(echo $DWS | wc -w | tr -d ' ')
CORES_EST=$(sysctl -n hw.perflevel0.physicalcpu 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)
EST=$(( (RESTARTS * 56 / 10 / CORES_EST + 15) * NGAUGE ))
echo "  ${D}------------------------------------------------------------${N}"
echo "  예상 소요 시간: 약 ${B}$(( EST / 60 ))분 $(( EST % 60 ))초${N}"
echo "  ${D}도중에 멈추려면 Control + C 를 누르세요.${N}"
echo ""
read -p "  시작할까요? [Enter=시작, n=취소]: " go
case "$go" in [nN]*) echo "  취소했습니다."; pause_exit 0 ;; esac
echo ""

GENS=300
CORES=$(sysctl -n hw.perflevel0.physicalcpu 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)

# ---- 실행 -----------------------------------------------------------------
START=$(date +%s)
DIRS=""
for DW in $DWS; do
  TAG="dw$(echo "$DW" | tr -d '.')"
  echo "  ${B}[${DW} mm]${N} 계산 중..."
  node runner/run.mjs --dw "$DW" --restarts "$RESTARTS" --gens "$GENS" --mc 500 \
       --sweep "$SWEEP" --workers "$CORES" --out "${OUT}/${TAG}" || { echo "  ${R}실행 중 문제가 생겼습니다.${N}"; pause_exit 1; }
  DIRS="$DIRS ${OUT}/${TAG}"
done

echo ""
echo "  ${B}엑셀 파일 만드는 중...${N}"
XLSX="${OUT}/코일벤치_결과_${NAME}.xlsx"
python3 runner/to_xlsx.py --out "$XLSX" $DIRS || { echo "  ${R}엑셀 저장에 실패했습니다.${N}"; pause_exit 1; }

ELAPSED=$(( $(date +%s) - START ))
echo ""
echo "  ${G}끝났습니다.${N} (${B}$(( ELAPSED / 60 ))분 $(( ELAPSED % 60 ))초${N} 걸렸습니다)"
echo ""
echo "  엑셀 파일: ${B}${XLSX}${N}"
echo "  ${D}요약 보고서는 각 굵기 폴더의 report.md 에 있습니다.${N}"
echo ""
open "$OUT" 2>/dev/null
pause_exit 0

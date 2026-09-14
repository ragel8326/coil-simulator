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

# ---- 2. 턴수 상한 ---------------------------------------------------------
echo "  ${B}2. 코일 하나당 감을 수 있는 최대 턴수는?${N}"
echo "     ${D}손으로 감는 현실적 한계입니다. 쉼표로 여러 개를 넣으면 각각 돌려서 비교표를 만듭니다.${N}"
echo "     ${D}0 을 넣으면 제한 없이 돌립니다(턴수가 천 단위로 올라가고 훨씬 오래 걸립니다).${N}"
read -p "     턴수 [기본 200,300,400]: " TURNS_IN
TURNS_IN="${TURNS_IN:-200,300,400}"
TURNS=$(echo "$TURNS_IN" | tr ',' ' ')
for t in $TURNS; do
  case "$t" in ''|*[!0-9]*) echo "     ${R}'$t' 는 숫자가 아닙니다. 200,300,400 으로 진행합니다.${N}"; TURNS="200 300 400"; break ;; esac
done
echo "     → ${G}${TURNS}턴${N}"
echo ""

# ---- 3. 최적화 횟수 -------------------------------------------------------
echo "  ${B}3. 최적화를 몇 번 반복할까요?${N}"
echo "     ${D}한 번에 하나씩 처음부터 다시 찾습니다. 많을수록 더 좋은 설계가 나올 확률이 올라갑니다.${N}"
read -p "     횟수 [기본 1000]: " RESTARTS
RESTARTS="${RESTARTS:-1000}"
case "$RESTARTS" in ''|*[!0-9]*) echo "     ${R}숫자가 아닙니다. 1000으로 진행합니다.${N}"; RESTARTS=1000 ;; esac
echo "     → ${G}${RESTARTS}번${N}"
echo ""

# ---- 4. 전수탐색 개수 -----------------------------------------------------
echo "  ${B}4. 무작위로 계산해볼 설계를 몇 개 뽑을까요?${N}"
echo "     ${D}엑셀의 '전수탐색' 시트가 됩니다. 3만 개는 몇 초면 끝납니다. 0을 넣으면 건너뜁니다.${N}"
read -p "     개수 [기본 30000]: " SWEEP
SWEEP="${SWEEP:-30000}"
case "$SWEEP" in ''|*[!0-9]*) echo "     ${R}숫자가 아닙니다. 30000으로 진행합니다.${N}"; SWEEP=30000 ;; esac
echo "     → ${G}${SWEEP}개${N}"
echo ""

# ---- 5. 결과 폴더 이름 ----------------------------------------------------
DEF="$(date +%Y-%m-%d_%H%M)"
echo "  ${B}5. 결과를 어떤 이름으로 저장할까요?${N}"
read -p "     이름 [기본 ${DEF}]: " NAME
NAME="${NAME:-$DEF}"
OUT="runs/${NAME}"
echo "     → ${G}${OUT}/${N}"
echo ""

# ---- 6. 고정할 변수 (선택) -------------------------------------------------
echo "  ${B}6. 이미 확정된 값이 있으면 고정하세요. (선택 — 비워두면 전부 탐색)${N}"
echo "     ${D}예: R1=24  → 코일1 반경을 24mm(직경 48mm)로 고정하고 나머지만 찾습니다.${N}"
echo "     ${D}여러 개는 쉼표로: R1=24,I=0.48${N}"
echo "     ${D}사용 가능한 변수: R1,m1,n1(코일1 반경mm·층당턴수·층수), R2,m2,n2(코일2), d(간격mm), I(전류A)${N}"
read -p "     고정할 변수 [기본: 없음]: " FIX_IN
if [ -n "$FIX_IN" ]; then
  echo "     → ${G}${FIX_IN}${N}"
else
  echo "     → ${G}(없음 — 8개 변수 모두 탐색)${N}"
fi
echo ""

FIX_ARGS=()
if [ -n "$FIX_IN" ]; then FIX_ARGS=(--fix "$FIX_IN"); fi

# ---- 확인 -----------------------------------------------------------------
NGAUGE=$(echo $DWS | wc -w | tr -d ' ')
NTURN=$(echo $TURNS | wc -w | tr -d ' ')
CORES=$(sysctl -n hw.perflevel0.physicalcpu 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)
GENS=300
# 턴수 상한이 있으면 코일이 작아 계산이 가볍다. 무제한이면 훨씬 무겁다.
SEC=15; for t in $TURNS; do [ "$t" = "0" ] && SEC=56; done
EST=$(( (RESTARTS * SEC / 10 / CORES + 15) * NGAUGE * NTURN ))
echo "  ${D}------------------------------------------------------------${N}"
echo "  실행 횟수: ${B}$(( NGAUGE * NTURN ))회${N}  (굵기 ${NGAUGE} × 턴수상한 ${NTURN})"
echo "  예상 소요 시간: 약 ${B}$(( EST / 60 ))분 $(( EST % 60 ))초${N}   ${D}(코어 ${CORES}개 사용)${N}"
if [ -n "$FIX_IN" ]; then echo "  고정 변수: ${B}${FIX_IN}${N}"; fi
echo "  ${D}도중에 멈추려면 Control + C 를 누르세요.${N}"
echo ""
read -p "  시작할까요? [Enter=시작, n=취소]: " go
case "$go" in [nN]*) echo "  취소했습니다."; pause_exit 0 ;; esac
echo ""

# ---- 실행 -----------------------------------------------------------------
START=$(date +%s)
DIRS=""
for T in $TURNS; do
  if [ "$T" = "0" ]; then TTAG="turns무제한"; else TTAG="turns${T}"; fi
  for DW in $DWS; do
    TAG="dw$(echo "$DW" | tr -d '.')"
    echo "  ${B}[턴수 ${T} · ${DW} mm]${N} 계산 중..."
    node runner/run.mjs --dw "$DW" --restarts "$RESTARTS" --gens "$GENS" --mc 500 \
         --sweep "$SWEEP" --workers "$CORES" --max-turns "$T" \
         "${FIX_ARGS[@]}" \
         --out "${OUT}/${TTAG}/${TAG}" || { echo "  ${R}실행 중 문제가 생겼습니다.${N}"; pause_exit 1; }
    DIRS="$DIRS ${OUT}/${TTAG}/${TAG}"
  done
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
echo "  ${D}굵기비교 시트에서 턴수 상한별 성적을 나란히 보실 수 있습니다.${N}"
echo ""
open "$OUT" 2>/dev/null
pause_exit 0

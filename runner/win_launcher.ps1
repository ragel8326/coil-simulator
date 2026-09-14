# 코일 벤치 대량 최적화 — 윈도우용 실행기
# 「코일 최적화 실행.bat」이 이 파일을 호출합니다. 직접 실행하지 않아도 됩니다.

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

Set-Location (Split-Path -Parent $PSScriptRoot)

function Pause-Exit($code = 0) {
  Write-Host ""
  Write-Host "  아무 키나 누르면 창이 닫힙니다." -NoNewline
  try { [void][System.Console]::ReadKey($true) } catch { Read-Host }
  Write-Host ""
  exit $code
}

Clear-Host
Write-Host ""
Write-Host "  코일 벤치 대량 최적화" -ForegroundColor White
Write-Host "  $(Get-Location)" -ForegroundColor DarkGray
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "  Node.js가 설치되어 있지 않습니다." -ForegroundColor Red
  Write-Host "  https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해주세요."
  Pause-Exit 1
}

$PyExe = $null; $PyPre = @()
foreach ($cand in @("python", "py", "python3")) {
  if (-not (Get-Command $cand -ErrorAction SilentlyContinue)) { continue }
  $pre = if ($cand -eq "py") { @("-3") } else { @() }
  try {
    & $cand @pre "-c" "import openpyxl" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $PyExe = $cand; $PyPre = $pre; break }
  } catch {}
}
if (-not $PyExe) {
  Write-Host "  엑셀 저장에 필요한 파이썬(openpyxl)이 준비되지 않았습니다." -ForegroundColor Red
  Write-Host "  파이썬이 없다면 https://python.org 에서 설치하시고,"
  Write-Host "  설치되어 있다면 명령 프롬프트에 아래 한 줄을 실행한 뒤 다시 실행해주세요."
  Write-Host ""
  Write-Host "      pip install openpyxl"
  Pause-Exit 1
}

# ---- 1. 도선 굵기 -----------------------------------------------------------
Write-Host "  1. 도선 굵기를 고르세요." -ForegroundColor White
Write-Host "     1) 0.3 mm      2) 0.4 mm      3) 0.5 mm      4) 세 가지 전부"
$a = Read-Host "     번호 [기본 4]"
switch ($a) {
  "1"     { $DWS = @("0.3") }
  "2"     { $DWS = @("0.4") }
  "3"     { $DWS = @("0.5") }
  default { $DWS = @("0.3", "0.4", "0.5") }
}
Write-Host "     -> $($DWS -join ', ') mm" -ForegroundColor Green
Write-Host ""

# ---- 2. 턴수 상한 -----------------------------------------------------------
Write-Host "  2. 코일 하나당 감을 수 있는 최대 턴수는?" -ForegroundColor White
Write-Host "     손으로 감는 현실적 한계입니다. 쉼표로 여러 개를 넣으면 각각 돌려서 비교표를 만듭니다." -ForegroundColor DarkGray
Write-Host "     0 을 넣으면 제한 없이 돌립니다(턴수가 천 단위로 올라가고 훨씬 오래 걸립니다)." -ForegroundColor DarkGray
$t = Read-Host "     턴수 [기본 200,300,400]"
if ([string]::IsNullOrWhiteSpace($t)) { $t = "200,300,400" }
$TURNS = @()
$bad = $false
foreach ($x in ($t -split ',')) {
  $x = $x.Trim()
  if ($x -match '^\d+$') { $TURNS += [int]$x } else { $bad = $true }
}
if ($bad -or $TURNS.Count -eq 0) {
  Write-Host "     숫자가 아닌 값이 있습니다. 200,300,400 으로 진행합니다." -ForegroundColor Red
  $TURNS = @(200, 300, 400)
}
Write-Host "     -> $($TURNS -join ', ')턴" -ForegroundColor Green
Write-Host ""

# ---- 3. 최적화 횟수 ---------------------------------------------------------
Write-Host "  3. 최적화를 몇 번 반복할까요?" -ForegroundColor White
Write-Host "     한 번에 하나씩 처음부터 다시 찾습니다. 많을수록 더 좋은 설계가 나올 확률이 올라갑니다." -ForegroundColor DarkGray
$r = Read-Host "     횟수 [기본 1000]"
if ($r -match '^\d+$') { $RESTARTS = [int]$r } else {
  if ($r -ne "") { Write-Host "     숫자가 아닙니다. 1000으로 진행합니다." -ForegroundColor Red }
  $RESTARTS = 1000
}
Write-Host "     -> $RESTARTS 번" -ForegroundColor Green
Write-Host ""

# ---- 4. 전수탐색 개수 -------------------------------------------------------
Write-Host "  4. 무작위로 계산해볼 설계를 몇 개 뽑을까요?" -ForegroundColor White
Write-Host "     엑셀의 전수탐색 시트가 됩니다. 3만 개는 몇 초면 끝납니다. 0을 넣으면 건너뜁니다." -ForegroundColor DarkGray
$s = Read-Host "     개수 [기본 30000]"
if ($s -match '^\d+$') { $SWEEP = [int]$s } else {
  if ($s -ne "") { Write-Host "     숫자가 아닙니다. 30000으로 진행합니다." -ForegroundColor Red }
  $SWEEP = 30000
}
Write-Host "     -> $SWEEP 개" -ForegroundColor Green
Write-Host ""

# ---- 5. 고정값 --------------------------------------------------------------
Write-Host "  5. 최적화 중 고정할 값이 있나요?" -ForegroundColor White
Write-Host "     고정한 항목은 탐색하지 않고 입력한 값을 그대로 사용합니다." -ForegroundColor DarkGray
Write-Host "     예: R1=24 또는 R1=24,I=1   ·   없으면 Enter" -ForegroundColor DarkGray
Write-Host "     항목: R1,m1,n1,R2,m2,n2,d,I" -ForegroundColor DarkGray
$FIX_IN = Read-Host "     고정값 [기본 없음]"
$FIX_IN = $FIX_IN -replace '\s', ''
$FIX_ARGS = @()
if (-not [string]::IsNullOrWhiteSpace($FIX_IN)) {
  $FIX_ARGS = @("--fix", $FIX_IN)
  Write-Host "     -> $FIX_IN" -ForegroundColor Green
} else {
  Write-Host "     -> 고정값 없음" -ForegroundColor Green
}
Write-Host ""

# ---- 6. 결과 폴더 이름 ------------------------------------------------------
$def = Get-Date -Format "yyyy-MM-dd_HHmm"
Write-Host "  6. 결과를 어떤 이름으로 저장할까요?" -ForegroundColor White
$NAME = Read-Host "     이름 [기본 $def]"
if ([string]::IsNullOrWhiteSpace($NAME)) { $NAME = $def }
$OUT = "runs/$NAME"
Write-Host "     -> $OUT/" -ForegroundColor Green
Write-Host ""

# ---- 확인 -------------------------------------------------------------------
$CORES = [int]$env:NUMBER_OF_PROCESSORS
if ($CORES -lt 1) { $CORES = 4 }
$GENS = 300
$sec = if ($TURNS -contains 0) { 5.6 } else { 1.5 }
$runs = $DWS.Count * $TURNS.Count
$est = [int](($RESTARTS * $sec / $CORES + 15) * $runs)
Write-Host "  ------------------------------------------------------------" -ForegroundColor DarkGray
Write-Host ("  실행 횟수: {0}회  (굵기 {1} x 턴수상한 {2})" -f $runs, $DWS.Count, $TURNS.Count)
Write-Host "  고정값: $(if ($FIX_IN) { $FIX_IN } else { '없음' })"
Write-Host ("  예상 소요 시간: 약 {0}분 {1}초   (코어 {2}개 사용)" -f [int]($est / 60), ($est % 60), $CORES)
Write-Host "  도중에 멈추려면 Control + C 를 누르세요." -ForegroundColor DarkGray
Write-Host ""
$go = Read-Host "  시작할까요? [Enter=시작, n=취소]"
if ($go -match '^[nN]') { Write-Host "  취소했습니다."; Pause-Exit 0 }
Write-Host ""

# ---- 실행 -------------------------------------------------------------------
$start = Get-Date
$DIRS = @()
foreach ($T in $TURNS) {
  $TTAG = if ($T -eq 0) { "turns무제한" } else { "turns$T" }
  foreach ($DW in $DWS) {
    $TAG = "dw" + ($DW -replace '\.', '')
    Write-Host "  [턴수 $T · $DW mm] 계산 중..." -ForegroundColor White
    & node runner/run.mjs --dw $DW --restarts $RESTARTS --gens $GENS --mc 500 --sweep $SWEEP --workers $CORES --max-turns $T @FIX_ARGS --out "$OUT/$TTAG/$TAG"
    if ($LASTEXITCODE -ne 0) {
      Write-Host "  실행 중 문제가 생겼습니다." -ForegroundColor Red
      Pause-Exit 1
    }
    $DIRS += "$OUT/$TTAG/$TAG"
  }
}

Write-Host ""
Write-Host "  엑셀 파일 만드는 중..." -ForegroundColor White
$XLSX = "$OUT/코일벤치_결과_$NAME.xlsx"
& $PyExe @PyPre runner/to_xlsx.py --out $XLSX @DIRS
if ($LASTEXITCODE -ne 0) {
  Write-Host "  엑셀 저장에 실패했습니다." -ForegroundColor Red
  Pause-Exit 1
}

$elapsed = [int]((Get-Date) - $start).TotalSeconds
Write-Host ""
Write-Host ("  끝났습니다. ({0}분 {1}초 걸렸습니다)" -f [int]($elapsed / 60), ($elapsed % 60)) -ForegroundColor Green
Write-Host ""
Write-Host "  엑셀 파일: $XLSX" -ForegroundColor White
Write-Host "  굵기비교 시트에서 턴수 상한별 성적을 나란히 보실 수 있습니다." -ForegroundColor DarkGray
Write-Host ""
try { Start-Process explorer.exe (Resolve-Path $OUT).Path } catch {}
Pause-Exit 0

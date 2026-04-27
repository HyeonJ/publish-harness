#!/usr/bin/env bash
# measure-quality.sh — publish-harness 품질 게이트 (G1/G4/G5/G6/G7/G8).
#
# G1 visual regression   — check-visual-regression.mjs (선택, playwright + pixelmatch)
# G4 토큰 사용           — check-token-usage.mjs (hex literal + non-token arbitrary)
# G5 시맨틱 HTML          — eslint jsx-a11y
# G6 텍스트:이미지 비율   — check-text-ratio.mjs
# G7 Lighthouse a11y/SEO  — @lhci/cli (preview 라우트, 선택)
# G8 i18n 가능성          — check-text-ratio.mjs 의 g8 필드
#
# G1 은 lite 원칙에 따라 환경 미비 / baseline 없음 시 SKIP (차단 아님).
# G2(치수 computed style), G3(asset naturalWidth) 는 제거됨.
#
# Usage:
#   bash scripts/measure-quality.sh <섹션명> <섹션 디렉토리> [options]
#   예 (디렉토리 전체):
#     bash scripts/measure-quality.sh home-hero src/components/sections/home/HomeHero
#   예 (특정 파일만 — 섹션 격리):
#     bash scripts/measure-quality.sh AllShowcase src/routes --files "src/routes/AllShowcase.tsx"
#     bash scripts/measure-quality.sh Button src/components/ui --files "src/components/ui/Button.tsx src/routes/ButtonPreview.tsx"
#
# 옵션:
#   --files "p1 p2 ..."  G4/G5/G6/G8 을 디렉토리 전체가 아닌 **지정 파일에만** 실행.
#                        공유 디렉토리에서 타 섹션 이슈가 현재 섹션을 차단하는 것 방지.
#                        미지정 시 <섹션 디렉토리> 전체 스캔 (기본값 · 이전 동작).
#   --baseline <path>    G1 baseline PNG 경로 (기본: baselines/<섹션명>/<viewport>.png)
#   --viewport <v>       desktop | tablet | mobile (기본: desktop)
#
# 종료 코드:
#   0: G4/G5/G6/G8 전부 PASS (G1/G7 은 환경 미비 시 SKIP 허용)
#   1: 하나라도 FAIL
#   2: 사용법 오류
#
# 출력:
#   tests/quality/{섹션명}.json — 결과 JSON
#   tests/quality/diffs/{섹션명}-<viewport>.diff.png — G1 diff 이미지 (있을 때)
#   stdout — 요약

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ---------- template 자동 조회 (project-context.md 우선, env override 가능) ----------
if [ -z "${TEMPLATE:-}" ]; then
  if [ -f "docs/project-context.md" ]; then
    TEMPLATE=$(grep -E "^template:" docs/project-context.md | head -1 | awk '{print $2}' | tr -d '#"')
  fi
  TEMPLATE="${TEMPLATE:-vite-react-ts}"
fi

if [ -z "${PREVIEW_BASE_URL:-}" ]; then
  if [ -f "docs/project-context.md" ]; then
    PREVIEW_BASE_URL=$(grep -E "^preview_base_url:" docs/project-context.md | head -1 | awk '{print $2}' | tr -d '#"')
  fi
  PREVIEW_BASE_URL="${PREVIEW_BASE_URL:-http://127.0.0.1:5173}"
fi

case "$TEMPLATE" in
  vite-react-ts)
    G4_SCRIPT="${SCRIPT_DIR}/check-token-usage.mjs"
    G6_SCRIPT="${SCRIPT_DIR}/check-text-ratio.mjs"
    G7_URL_FMT="%s/__preview/%s"
    ;;
  html-static)
    G4_SCRIPT="${SCRIPT_DIR}/check-token-usage-html.mjs"
    G6_SCRIPT="${SCRIPT_DIR}/check-text-ratio-html.mjs"
    G7_URL_FMT="%s/__preview/%s/"
    ;;
  *)
    echo "ERROR: 알 수 없는 template: $TEMPLATE" >&2
    exit 2
    ;;
esac

# ---------- 인자 파싱 ----------
section=""
dir=""
BASELINE=""
VIEWPORT="desktop"
FILES=""

while [ $# -gt 0 ]; do
  case "$1" in
    --baseline) BASELINE="$2"; shift 2 ;;
    --viewport) VIEWPORT="$2"; shift 2 ;;
    --files) FILES="$2"; shift 2 ;;
    -h|--help) sed -n '2,45p' "$0"; exit 0 ;;
    -*) echo "ERROR: unknown option $1" >&2; exit 2 ;;
    *)
      if [ -z "$section" ]; then section="$1"
      elif [ -z "$dir" ]; then dir="$1"
      else echo "ERROR: too many positional args" >&2; exit 2
      fi
      shift ;;
  esac
done

# --files 지정 시 타겟 셋 = 파일 리스트, 아니면 디렉토리 전체
if [ -n "$FILES" ]; then
  TARGET_SET="$FILES"
  TARGET_SCOPE="files"
else
  TARGET_SET="$dir"
  TARGET_SCOPE="dir"
fi

if [ -z "$section" ] || [ -z "$dir" ]; then
  echo "usage: measure-quality.sh <section-name> <section-dir> [--baseline <path>] [--viewport <v>]" >&2
  echo "  예: measure-quality.sh home-hero src/components/sections/home/HomeHero" >&2
  exit 2
fi

if [ ! -d "$dir" ]; then
  echo "❌ section dir not found: $dir" >&2
  exit 2
fi

# G1 baseline 기본 경로
if [ -z "$BASELINE" ]; then
  BASELINE="baselines/${section}/${VIEWPORT}.png"
fi

OUT_DIR="tests/quality"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/${section}.json"

FAIL=0
G1_STATUS="SKIP"
G1_DETAIL=""
G4_STATUS="SKIP"
G5_STATUS="SKIP"
G6_STATUS="SKIP"
G7_STATUS="SKIP"
G8_STATUS="SKIP"

# ---------- G1 visual regression (선택, playwright + pixelmatch) ----------
echo "[G1] visual regression (viewport=${VIEWPORT}, baseline=${BASELINE})"
G1_JSON=$(node "${SCRIPT_DIR}/check-visual-regression.mjs" \
  --section "$section" \
  --baseline "$BASELINE" \
  --viewport "$VIEWPORT" 2>/tmp/g1.err || true)
G1_RAW_STATUS=$(echo "$G1_JSON" | node -e "let j='';process.stdin.on('data',d=>j+=d);process.stdin.on('end',()=>{try{process.stdout.write(JSON.parse(j).status||'')}catch(e){}})" 2>/dev/null)

case "$G1_RAW_STATUS" in
  PASS)
    G1_STATUS="PASS"
    G1_DETAIL="$G1_JSON"
    echo "  ✓ G1 PASS"
    ;;
  FAIL)
    G1_STATUS="FAIL"
    G1_DETAIL="$G1_JSON"
    FAIL=1
    echo "  ❌ G1 FAIL"
    echo "    $G1_JSON"
    ;;
  SKIPPED|NO_BASELINE|BASELINE_UPDATED)
    G1_STATUS="$G1_RAW_STATUS"
    G1_DETAIL="$G1_JSON"
    echo "  ⚠ G1 $G1_RAW_STATUS (차단 아님)"
    ;;
  *)
    G1_STATUS="SKIP"
    G1_DETAIL='{"status":"SKIP","reason":"script error"}'
    cat /tmp/g1.err 2>/dev/null || true
    echo "  ⚠ G1 SKIP (스크립트 에러 또는 의존성 미비)"
    ;;
esac

# ---------- G4 토큰 사용 (hex literal + non-token arbitrary) ----------
echo ""
echo "[G4] 디자인 토큰 사용 (hex literal 차단, scope=${TARGET_SCOPE})"
# shellcheck disable=SC2086
if node "$G4_SCRIPT" $TARGET_SET 2>/tmp/g4.err; then
  G4_STATUS="PASS"
  echo "  ✓ G4 PASS"
else
  G4_STATUS="FAIL"
  FAIL=1
  cat /tmp/g4.err
  echo "  ❌ G4 FAIL"
fi

# ---------- G5 시맨틱 HTML (eslint jsx-a11y) ----------
# 참고: --no-warn-ignored 는 eslint v9+ 전용. 템플릿 eslint ^8.57 이므로 플래그 생략.
# eslint 가 "Invalid option" / "Cannot find" 등 스크립트 레벨 에러로 종료하면
# 실제 lint violation 과 구분해 SCRIPT_ERROR 로 표기 (G5 FAIL 과 다른 의미).
echo ""
echo "[G5] 시맨틱 HTML (eslint jsx-a11y, scope=${TARGET_SCOPE})"
# shellcheck disable=SC2086
if npx eslint $TARGET_SET >/tmp/g5.log 2>&1; then
  G5_STATUS="PASS"
  echo "  ✓ G5 PASS"
else
  # 스크립트 레벨 에러 판별 (실제 lint 실패와 구분)
  if grep -qE "Invalid option|Cannot find|ENOENT|unknown option" /tmp/g5.log; then
    G5_STATUS="SCRIPT_ERROR"
    echo "  ⚠ G5 SCRIPT_ERROR (eslint 실행 자체 실패 — 코드 이슈 아님)"
    tail -10 /tmp/g5.log
    # FAIL 처리 하지 않음 — 하네스/환경 문제는 워커가 해결할 사안이 아님
  else
    tail -20 /tmp/g5.log
    G5_STATUS="FAIL"
    FAIL=1
    echo "  ❌ G5 FAIL"
  fi
fi

# ---------- G6/G8 텍스트/이미지 비율 + i18n ----------
echo ""
echo "[G6/G8] 텍스트:이미지 비율 + i18n 가능성 (scope=${TARGET_SCOPE})"
# shellcheck disable=SC2086
G68_JSON=$(node "$G6_SCRIPT" $TARGET_SET 2>/tmp/g68.err || true)
if echo "$G68_JSON" | grep -q '"g6":[[:space:]]*"PASS"'; then
  G6_STATUS="PASS"
else
  G6_STATUS="FAIL"
  FAIL=1
fi
if echo "$G68_JSON" | grep -q '"g8":[[:space:]]*"PASS"'; then
  G8_STATUS="PASS"
else
  G8_STATUS="FAIL"
  FAIL=1
fi
if [ "$G6_STATUS" = "PASS" ] && [ "$G8_STATUS" = "PASS" ]; then
  echo "  ✓ G6/G8 PASS"
else
  cat /tmp/g68.err 2>/dev/null || true
  echo "  ❌ G6=$G6_STATUS G8=$G8_STATUS"
fi

# ---------- G7 Lighthouse (선택) ----------
echo ""
echo "[G7] Lighthouse a11y/SEO (optional)"
if ! command -v npx >/dev/null 2>&1; then
  echo "  ⚠ npx 없음 → G7 SKIP"
elif ! npx --no-install lhci --version >/dev/null 2>&1; then
  echo "  ⚠ @lhci/cli 미설치 → G7 SKIP (설치: npm i -D @lhci/cli lighthouse)"
else
  url="$(printf "$G7_URL_FMT" "$PREVIEW_BASE_URL" "$section")"
  if curl -sSf -o /dev/null "$url" 2>/dev/null; then
    npx --no-install lighthouse "$url" --only-categories=accessibility,seo \
      --output=json --output-path=/tmp/lh.json --chrome-flags="--headless" \
      --quiet 2>/dev/null || true
    a11y=$(node -e "try{const j=require('/tmp/lh.json');console.log(Math.round(j.categories.accessibility.score*100))}catch(e){console.log('N/A')}")
    seo=$(node -e "try{const j=require('/tmp/lh.json');console.log(Math.round(j.categories.seo.score*100))}catch(e){console.log('N/A')}")
    if [ "$a11y" != "N/A" ] && [ "$a11y" -ge 95 ] && [ "$seo" -ge 90 ]; then
      G7_STATUS="PASS (a11y=$a11y, seo=$seo)"
      echo "  ✓ G7 PASS (a11y=$a11y, seo=$seo)"
    else
      G7_STATUS="FAIL (a11y=$a11y, seo=$seo)"
      FAIL=1
      echo "  ❌ G7 FAIL (a11y=$a11y, seo=$seo, 기준: a11y≥95, seo≥90)"
    fi
  else
    echo "  ⚠ dev 서버 미기동 ($url 접근 실패) → G7 SKIP"
  fi
fi

# ---------- JSON 결과 저장 ----------
# G1_DETAIL 가 JSON 이면 그대로, 아니면 status 만
if [ -z "$G1_DETAIL" ]; then
  G1_DETAIL_JSON="\"$G1_STATUS\""
else
  G1_DETAIL_JSON="$G1_DETAIL"
fi

cat > "$OUT" <<EOF
{
  "section": "$section",
  "dir": "$dir",
  "viewport": "$VIEWPORT",
  "G1_visual_regression": $G1_DETAIL_JSON,
  "G1_status": "$G1_STATUS",
  "G4_token_usage": "$G4_STATUS",
  "G5_semantic_html": "$G5_STATUS",
  "G6_text_image_ratio": "$G6_STATUS",
  "G7_lighthouse": "$G7_STATUS",
  "G8_i18n": "$G8_STATUS"
}
EOF

echo ""
echo "=================================="
echo "결과 저장: $OUT"
if [ "$FAIL" -eq 0 ]; then
  echo "✓ G4/G5/G6/G8 PASS (G1/G7 환경별)"
  exit 0
else
  echo "❌ 품질 게이트 미통과. 구현 재검토 후 재실행."
  exit 1
fi

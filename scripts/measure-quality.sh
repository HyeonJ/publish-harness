#!/usr/bin/env bash
# measure-quality.sh — lite 하네스 품질 게이트 (G4/G5/G6/G7/G8).
#
# G4 토큰 사용           — check-token-usage.mjs (hex literal + non-token arbitrary)
# G5 시맨틱 HTML          — eslint jsx-a11y
# G6 텍스트:이미지 비율   — check-text-ratio.mjs
# G7 Lighthouse a11y/SEO  — @lhci/cli (preview 라우트, 선택)
# G8 i18n 가능성          — check-text-ratio.mjs 의 g8 필드
#
# G1(pixelmatch), G2(치수 computed style), G3(asset naturalWidth) 는 lite에서 제거.
# 필요 시 프로젝트별 scripts/ 아래 별도 스크립트로 추가.
#
# Usage:
#   bash scripts/measure-quality.sh <섹션명> <섹션 디렉토리>
#   예: bash scripts/measure-quality.sh home-hero src/components/sections/home/HomeHero
#
# 종료 코드:
#   0: G4/G5/G6/G8 전부 PASS (G7 은 환경 미비 시 SKIP 허용)
#   1: 하나라도 FAIL
#   2: 사용법 오류
#
# 출력:
#   tests/quality/{섹션명}.json — 결과 JSON
#   stdout — 요약

set -u

section="${1:-}"
dir="${2:-}"

if [ -z "$section" ] || [ -z "$dir" ]; then
  echo "usage: measure-quality.sh <section-name> <section-dir>" >&2
  echo "  예: measure-quality.sh home-hero src/components/sections/home/HomeHero" >&2
  exit 2
fi

if [ ! -d "$dir" ]; then
  echo "❌ section dir not found: $dir" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="tests/quality"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/${section}.json"

FAIL=0
G4_STATUS="SKIP"
G5_STATUS="SKIP"
G6_STATUS="SKIP"
G7_STATUS="SKIP"
G8_STATUS="SKIP"

# ---------- G4 토큰 사용 (hex literal + non-token arbitrary) ----------
echo "[G4] 디자인 토큰 사용 (hex literal 차단)"
if node "${SCRIPT_DIR}/check-token-usage.mjs" "$dir" 2>/tmp/g4.err; then
  G4_STATUS="PASS"
  echo "  ✓ G4 PASS"
else
  G4_STATUS="FAIL"
  FAIL=1
  cat /tmp/g4.err
  echo "  ❌ G4 FAIL"
fi

# ---------- G5 시맨틱 HTML (eslint jsx-a11y) ----------
echo ""
echo "[G5] 시맨틱 HTML (eslint jsx-a11y)"
if npx eslint "$dir" --no-warn-ignored >/tmp/g5.log 2>&1; then
  G5_STATUS="PASS"
  echo "  ✓ G5 PASS"
else
  tail -20 /tmp/g5.log
  G5_STATUS="FAIL"
  FAIL=1
  echo "  ❌ G5 FAIL"
fi

# ---------- G6/G8 텍스트/이미지 비율 + i18n ----------
echo ""
echo "[G6/G8] 텍스트:이미지 비율 + i18n 가능성"
G68_JSON=$(node "${SCRIPT_DIR}/check-text-ratio.mjs" "$dir" 2>/tmp/g68.err || true)
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
  url="http://127.0.0.1:5173/__preview/${section}"
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
cat > "$OUT" <<EOF
{
  "section": "$section",
  "dir": "$dir",
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
  echo "✓ G4/G5/G6/G8 PASS (G7 환경별)"
  exit 0
else
  echo "❌ 품질 게이트 미통과. 구현 재검토 후 재실행."
  exit 1
fi

#!/usr/bin/env bash
# extract-tokens.sh — Figma 파일에서 디자인 토큰 추출 후 프로젝트에 주입.
#
# 산출:
#   src/styles/tokens.css    — :root { --brand-*, --surface-*, --text-*, --space-*, --radius-* }
#   src/styles/fonts.css     — @font-face 블록 (감지된 폰트 family만)
#   docs/token-audit.md      — 추출 요약 + 네이밍 소스 표시
#   tmp/figma-raw.json       — REST /v1/files 원본 (디버깅용)
#
# 전략:
#   1. Component 페이지 지정 시  → 그 페이지만 스캔 + 레이어명 기반 네이밍
#   2. 페이지 지정 없으면        → 전체 파일 빈도 스캔 + 휴리스틱 네이밍 (fallback)
#
# Usage:
#   bash scripts/extract-tokens.sh <fileKey> [옵션]
#
#   # 전체 파일 스캔 (fallback)
#   bash scripts/extract-tokens.sh ABC123
#
#   # Component 페이지 지정 (권장 — Figma에 Component/Design System 페이지 있을 때)
#   bash scripts/extract-tokens.sh ABC123 --component-page 10:5282
#
#   # legacy 호환: 두 번째 positional 인자 = pageNodeId (deprecated, --component-page 권장)
#   bash scripts/extract-tokens.sh ABC123 10:5282
#
# 인자:
#   fileKey                       Figma URL /design/<fileKey>/... 의 fileKey
#   --component-page <nodeId>     Component/Design System 페이지 Node ID
#                                 (URL의 node-id=10-5282 → 10:5282 로 입력, dash 도 자동 변환)
#
# 환경변수:
#   FIGMA_TOKEN  Figma Personal Access Token (필수)

set -u

FILE_KEY=""
COMPONENT_PAGE=""

# 인자 파싱
while [ $# -gt 0 ]; do
  case "$1" in
    --component-page)
      COMPONENT_PAGE="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    -*)
      echo "ERROR: unknown option $1" >&2
      exit 2
      ;;
    *)
      if [ -z "$FILE_KEY" ]; then
        FILE_KEY="$1"
      elif [ -z "$COMPONENT_PAGE" ]; then
        # legacy positional: 두 번째 positional = pageNodeId
        COMPONENT_PAGE="$1"
        echo "[extract-tokens] NOTE: positional pageNodeId 사용. --component-page 형식 권장." >&2
      else
        echo "ERROR: too many positional args" >&2
        exit 2
      fi
      shift
      ;;
  esac
done

if [ -z "$FILE_KEY" ]; then
  echo "usage: extract-tokens.sh <fileKey> [--component-page <nodeId>]" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "${SCRIPT_DIR}/_lib/load-figma-token.sh"

if [ -z "${FIGMA_TOKEN:-}" ]; then
  echo "ERROR: FIGMA_TOKEN 미설정." >&2
  echo "  bash scripts/setup-figma-token.sh 로 대화형 등록" >&2
  exit 2
fi

mkdir -p src/styles docs tmp

# ---------- Figma REST /v1/files 호출 ----------
MODE="full"
if [ -n "$COMPONENT_PAGE" ]; then
  NODE_ID_NORM="${COMPONENT_PAGE/-/:}"
  URL="https://api.figma.com/v1/files/${FILE_KEY}/nodes?ids=${NODE_ID_NORM}&depth=4"
  MODE="component"
  echo "[extract-tokens] mode=component (page nodeId: ${NODE_ID_NORM})"
else
  URL="https://api.figma.com/v1/files/${FILE_KEY}?depth=4"
  echo "[extract-tokens] mode=full (전체 파일 스캔)"
fi

echo "[extract-tokens] fetch $URL"
curl -sS -H "X-Figma-Token: ${FIGMA_TOKEN}" "$URL" > tmp/figma-raw.json

if ! node -e "JSON.parse(require('fs').readFileSync('tmp/figma-raw.json','utf8'))" 2>/dev/null; then
  echo "ERROR: Figma 응답이 유효한 JSON 아님." >&2
  head -c 500 tmp/figma-raw.json >&2
  exit 3
fi

# ---------- Node 기반 분석 ----------
node "${SCRIPT_DIR}/_extract-tokens-analyze.mjs" tmp/figma-raw.json "$MODE"

echo ""
echo "[extract-tokens] 완료"
echo "  - src/styles/tokens.css"
echo "  - src/styles/fonts.css"
echo "  - docs/token-audit.md (mode=${MODE})"
if [ "$MODE" = "full" ]; then
  echo ""
  echo "  TIP: Figma에 Component 또는 Design System 페이지가 따로 있다면"
  echo "       다음 명령으로 재실행하면 네이밍 품질이 좋아집니다:"
  echo "       bash scripts/extract-tokens.sh ${FILE_KEY} --component-page <그 페이지 nodeId>"
fi

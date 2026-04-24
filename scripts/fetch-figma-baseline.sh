#!/usr/bin/env bash
# fetch-figma-baseline.sh — Figma 노드 → baseline PNG (G1 visual regression 입력).
#
# figma-rest-image.sh 의 얇은 래퍼. 경로 규약 `baselines/<section>/<viewport>.png` 강제.
# figma 모드 전용. spec 모드는 이 스크립트 사용하지 않음 (handoff 번들 또는
# render-spec-baseline.mjs 경로).
#
# Usage:
#   scripts/fetch-figma-baseline.sh <fileKey> <nodeId> <section> [viewport] [--scale N]
#
# 예:
#   scripts/fetch-figma-baseline.sh ABC123 12:345 home-hero desktop
#   scripts/fetch-figma-baseline.sh ABC123 12:346 home-hero mobile --scale 2
#
# 인자:
#   fileKey      Figma URL의 /design/<fileKey>/...
#   nodeId       "12:345" 또는 "12-345"
#   section      섹션 식별자 (check-visual-regression.mjs --section 과 동일)
#   viewport     desktop | tablet | mobile (default: desktop)
#
# 옵션:
#   --scale N    1 | 2 | 3 | 4 (default: 2)
#
# 저장 경로:
#   baselines/<section>/<viewport>.png
#
# 환경변수:
#   FIGMA_TOKEN  Figma PAT (필수)
#
# 종료 코드:
#   0 성공
#   2 인자 오류
#   3 figma-rest-image.sh 실패 (상세는 그쪽 에러 참조)

set -euo pipefail

FILE_KEY=""
NODE_ID=""
SECTION=""
VIEWPORT="desktop"
SCALE="2"

while [ $# -gt 0 ]; do
  case "$1" in
    --scale)
      SCALE="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,30p' "$0"; exit 0 ;;
    -*)
      echo "ERROR: unknown option $1" >&2; exit 2 ;;
    *)
      if [ -z "$FILE_KEY" ]; then FILE_KEY="$1"
      elif [ -z "$NODE_ID" ]; then NODE_ID="$1"
      elif [ -z "$SECTION" ]; then SECTION="$1"
      elif [ "$VIEWPORT" = "desktop" ] && [[ "$1" =~ ^(desktop|tablet|mobile)$ ]]; then VIEWPORT="$1"
      else echo "ERROR: too many positional args: $1" >&2; exit 2
      fi
      shift ;;
  esac
done

if [ -z "$FILE_KEY" ] || [ -z "$NODE_ID" ] || [ -z "$SECTION" ]; then
  echo "ERROR: fileKey, nodeId, section 필수." >&2
  echo "  scripts/fetch-figma-baseline.sh <fileKey> <nodeId> <section> [viewport] [--scale N]" >&2
  exit 2
fi

case "$VIEWPORT" in
  desktop|tablet|mobile) ;;
  *)
    echo "ERROR: viewport 은 desktop|tablet|mobile 중 하나" >&2
    exit 2 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_PATH="baselines/${SECTION}/${VIEWPORT}.png"

echo "[fetch-figma-baseline] section=${SECTION} viewport=${VIEWPORT} → ${OUT_PATH}"

# figma-rest-image.sh 호출
bash "${SCRIPT_DIR}/figma-rest-image.sh" "$FILE_KEY" "$NODE_ID" "$OUT_PATH" --scale "$SCALE" || exit 3

echo "[fetch-figma-baseline] OK"

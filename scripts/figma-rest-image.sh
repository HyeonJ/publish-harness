#!/usr/bin/env bash
# figma-rest-image.sh — Figma REST Images API로 노드 PNG 다운로드.
#
# Framelink MCP 대체. Framelink가 세션 간 disconnect 불안정 + Claude Code
# sub-agent cleanup 버그로 영구 폐기됨 (F-015). Figma REST API는 사용자 본인
# Figma PAT로 Figma 서버에 직접 호출하며 분당 수천 req 관대한 quota.
#
# Usage:
#   scripts/figma-rest-image.sh <fileKey> <nodeId> <output-path> [--scale N] [--format fmt]
#
# 예:
#   scripts/figma-rest-image.sh 7X964y4dde6h4XUoVPxk9X 0:1 figma-screenshots/home-landing-full.png
#   scripts/figma-rest-image.sh ABC123 12:345 src/assets/hero/bg.png --scale 2
#
# 인자:
#   fileKey      Figma URL의 /design/<fileKey>/... 부분
#   nodeId       "12:345" 또는 "12-345" (URL 형식 모두 수용)
#   output-path  저장 경로 (부모 디렉토리 자동 생성)
#
# 옵션:
#   --scale N    1 | 2 | 3 | 4 (default: 2) — 2+가 고해상도 capture 권장
#   --format fmt png | jpg | svg | pdf (default: png)
#
# 환경변수:
#   FIGMA_TOKEN   Figma Personal Access Token (필수)
#                 Windows: powershell env var로 저장 후 이 스크립트가 자동 로드
#                 macOS/Linux: export FIGMA_TOKEN=figd_...
#   ALLOW_FRAME   =1 시 FRAME/GROUP/SECTION nodeId 차단 우회. 기본값 비설정.
#                 이유: FRAME nodeId 를 image asset 으로 export 하면 자식
#                 textbox/button 도 같이 raster 화 → 이중 렌더 사고
#                 (modern-retro-strict main-hero-defect). 정당한 케이스
#                 (회고 F7 — frame fill IMAGE) 에서만 ALLOW_FRAME=1 사용.
#
# 종료 코드:
#   0 성공
#   2 인자 오류 / 환경 미설정 / 노드 type 차단
#   3 API 호출 실패 (Figma 서버 에러 또는 권한 없음)
#   4 S3 다운로드 실패

set -euo pipefail

# ---------- 인자 파싱 ----------
FILE_KEY=""
NODE_ID=""
OUT_PATH=""
SCALE="2"
FORMAT="png"

while [ $# -gt 0 ]; do
  case "$1" in
    --scale)
      SCALE="$2"; shift 2 ;;
    --format)
      FORMAT="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,30p' "$0"; exit 0 ;;
    -*)
      echo "ERROR: unknown option $1" >&2; exit 2 ;;
    *)
      if [ -z "$FILE_KEY" ]; then FILE_KEY="$1"
      elif [ -z "$NODE_ID" ]; then NODE_ID="$1"
      elif [ -z "$OUT_PATH" ]; then OUT_PATH="$1"
      else echo "ERROR: too many positional args: $1" >&2; exit 2
      fi
      shift ;;
  esac
done

if [ -z "$FILE_KEY" ] || [ -z "$NODE_ID" ] || [ -z "$OUT_PATH" ]; then
  echo "ERROR: fileKey, nodeId, output-path 모두 필수." >&2
  echo "  scripts/figma-rest-image.sh <fileKey> <nodeId> <output-path> [--scale N] [--format fmt]" >&2
  exit 2
fi

# nodeId 정규화: "12-345" → "12:345" (URL 형식 → API 형식)
NODE_ID="${NODE_ID/-/:}"

# ---------- FIGMA_TOKEN 로드 ----------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "${SCRIPT_DIR}/_lib/load-figma-token.sh"

if [ -z "${FIGMA_TOKEN:-}" ]; then
  echo "ERROR: FIGMA_TOKEN 미설정." >&2
  echo "  bash scripts/setup-figma-token.sh 로 대화형 등록" >&2
  echo "  또는 수동 등록 후 새 터미널 세션" >&2
  exit 2
fi

# ---------- Step 0: 노드 type 검증 (modern-retro-strict main-hero-defect 차단) ----------
# FRAME/GROUP/SECTION nodeId 를 image asset 으로 export 하면 자식 textbox/button
# 도 같이 raster 화 → 이중 렌더 사고. leaf image node (RECTANGLE/VECTOR/INSTANCE)
# 만 허용. 정당한 frame fill IMAGE 케이스 (회고 F7) 는 ALLOW_FRAME=1 로 우회.
NODES_URL="https://api.figma.com/v1/files/${FILE_KEY}/nodes?ids=${NODE_ID}&depth=0"
NODES_JSON=$(curl -sS -H "X-Figma-Token: ${FIGMA_TOKEN}" "$NODES_URL")
NODE_TYPE=$(echo "$NODES_JSON" | node -e "
let j='';
process.stdin.on('data',d=>j+=d);
process.stdin.on('end',()=>{
  try {
    const o = JSON.parse(j);
    const node = o.nodes && o.nodes['${NODE_ID}'];
    if (node && node.document && node.document.type) {
      process.stdout.write(node.document.type);
    }
  } catch(e) {}
})" 2>/dev/null)

if [ -z "$NODE_TYPE" ]; then
  echo "WARN: 노드 type 식별 실패 (응답 형식 또는 권한). type 검증 SKIP." >&2
elif [ "${ALLOW_FRAME:-0}" != "1" ]; then
  case "$NODE_TYPE" in
    FRAME|GROUP|SECTION|CANVAS)
      echo "ERROR: nodeId ${NODE_ID} type=${NODE_TYPE} — frame composite export 위험" >&2
      echo "       FRAME/GROUP/SECTION 을 image asset 으로 export 하면 자식 textbox/button 도" >&2
      echo "       같이 raster 화되어 이중 렌더 사고 발생 (main-hero-defect)." >&2
      echo "" >&2
      echo "  해결책 1: leaf image node 식별" >&2
      echo "    Figma 에서 ${NODE_ID} 를 클릭한 후 자식 트리를 펼쳐서" >&2
      echo "    실제 image fill 을 가진 RECTANGLE/VECTOR 의 nodeId 사용" >&2
      echo "    (예: ${NODE_ID} 의 photo 자식 노드)" >&2
      echo "" >&2
      echo "  해결책 2: ALLOW_FRAME=1 (의도된 frame composite — 회고 F7 케이스)" >&2
      echo "    ALLOW_FRAME=1 bash $0 \"\$@\"" >&2
      exit 2 ;;
  esac
fi

# ---------- Step 1: Figma API 호출 — S3 URL 받기 ----------
IMAGES_URL="https://api.figma.com/v1/images/${FILE_KEY}?ids=${NODE_ID}&format=${FORMAT}&scale=${SCALE}"

echo "[figma-rest-image] fetch S3 URL: ${NODE_ID} scale=${SCALE} format=${FORMAT}${NODE_TYPE:+ type=${NODE_TYPE}}"

API_JSON=$(curl -sS -H "X-Figma-Token: ${FIGMA_TOKEN}" "$IMAGES_URL")
# 에러 포착 규칙:
#   1. Figma API 는 에러 시 { err: "msg" } 또는 { status: 4xx/5xx, err?: "..." }
#   2. 본문이 HTML/평문이면 JSON.parse 실패 → parse-error 로 표기 (curl/Cloudflare 중간 실패)
#   3. 에러 없으면 빈 문자열 (아래 if 블록 skip)
API_ERR=$(echo "$API_JSON" | node -e "
let j='';
process.stdin.on('data',d=>j+=d);
process.stdin.on('end',()=>{
  try {
    const o = JSON.parse(j);
    if (o.err) { process.stdout.write(o.err); }
    else if (o.status && o.status >= 400) { process.stdout.write('HTTP ' + o.status + ': ' + JSON.stringify(o)); }
  } catch (e) {
    process.stdout.write('parse-error (body not JSON): ' + e.message);
  }
})" 2>/dev/null)

if [ -n "$API_ERR" ]; then
  echo "ERROR: Figma API returned error: $API_ERR" >&2
  echo "  URL: $IMAGES_URL" >&2
  echo "  Response: $API_JSON" >&2
  exit 3
fi

# images.{nodeId}의 S3 URL 추출
S3_URL=$(echo "$API_JSON" | node -e "let j=''; process.stdin.on('data',d=>j+=d); process.stdin.on('end',()=>{try{const o=JSON.parse(j); const u=o.images && o.images['${NODE_ID}']; if(u)process.stdout.write(u)}catch(e){}})")

if [ -z "$S3_URL" ] || [ "$S3_URL" = "null" ]; then
  echo "ERROR: 응답에 S3 URL 없음 (노드 ID 잘못됐거나 렌더링 실패)" >&2
  echo "  Response: $API_JSON" >&2
  exit 3
fi

# ---------- Step 2: S3에서 PNG 다운로드 ----------
mkdir -p "$(dirname "$OUT_PATH")"

echo "[figma-rest-image] download S3 → $OUT_PATH"
HTTP_CODE=$(curl -sS -o "$OUT_PATH" -w "%{http_code}" "$S3_URL")

if [ "$HTTP_CODE" != "200" ]; then
  echo "ERROR: S3 다운로드 실패 HTTP $HTTP_CODE" >&2
  echo "  URL: $S3_URL" >&2
  rm -f "$OUT_PATH" 2>/dev/null || true
  exit 4
fi

# 최종 검증: 파일 존재 + 비어있지 않음
if [ ! -s "$OUT_PATH" ]; then
  echo "ERROR: 다운로드된 파일이 비어있음: $OUT_PATH" >&2
  rm -f "$OUT_PATH" 2>/dev/null || true
  exit 4
fi

SIZE=$(stat -c %s "$OUT_PATH" 2>/dev/null || stat -f %z "$OUT_PATH" 2>/dev/null || echo "?")
echo "[figma-rest-image] OK ${OUT_PATH} (${SIZE} bytes)"

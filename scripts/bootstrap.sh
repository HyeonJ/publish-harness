#!/usr/bin/env bash
# bootstrap.sh — publish-harness 원샷 프로젝트 셋업.
#
# 두 가지 모드:
#   figma (기본) — Figma URL 에서 토큰 자동 추출 (라이브 디자인 쿼리)
#   spec         — 정적 핸드오프 번들 (tokens.css + tailwind.config.js + components-spec.md) 임포트
#
# Usage:
#   # figma 모드 (기본)
#   bash bootstrap.sh <figma-url> [project-name] [--component-url <url>]
#   bash bootstrap.sh --mode figma <figma-url> [project-name]
#
#   # spec 모드
#   bash bootstrap.sh --mode spec --from-handoff <dir> [project-name]
#
# 인자:
#   figma-url         figma 모드: Figma 파일 URL 또는 fileKey
#   project-name      (선택) package.json name, default: 현재 디렉토리명
#
# 옵션:
#   --mode figma|spec        소스 모드 (default: figma)
#   --from-handoff <dir>     spec 모드 필수. 핸드오프 폴더 경로
#                            (tokens.css, tailwind.config.js, components-spec.md 포함)
#   --component-url <url>    figma 모드 전용. Component/DS 페이지 URL.
#                            지정 시 토큰 추출이 그 페이지만 스캔 + 레이어명 기반 네이밍.
#   --template <name>        출력 템플릿: vite-react-ts (default) | html-static.
#                            html-static 은 figma 모드만 지원 (spec×html-static 은 mismatch).
#
# 환경변수:
#   FIGMA_TOKEN     figma 모드 필수 (extract-tokens 호출용). spec 모드는 불필요.
#   HARNESS_DIR     (선택) publish-harness 위치. 미지정 시 이 스크립트 위치 기반 자동 탐지

set -u

MODE="figma"
TEMPLATE="vite-react-ts"
FIGMA_URL=""
PROJECT_NAME=""
COMPONENT_URL=""
HANDOFF_DIR=""

# 인자 파싱: 옵션 + positional 혼합
while [ $# -gt 0 ]; do
  case "$1" in
    --mode)
      MODE="$2"
      shift 2
      ;;
    --from-handoff)
      HANDOFF_DIR="$2"
      shift 2
      ;;
    --template)
      TEMPLATE="$2"
      shift 2
      ;;
    --component-url)
      COMPONENT_URL="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,35p' "$0"
      exit 0
      ;;
    -*)
      echo "ERROR: unknown option $1" >&2
      exit 2
      ;;
    *)
      # figma 모드에서 첫 번째 positional 은 figma-url, 두 번째는 project-name
      # spec 모드에서는 전부 project-name 후보 (figma-url 슬롯 없음)
      if [ "$MODE" = "figma" ] && [ -z "$FIGMA_URL" ]; then
        FIGMA_URL="$1"
      elif [ -z "$PROJECT_NAME" ]; then
        PROJECT_NAME="$1"
      else
        echo "ERROR: too many positional args" >&2
        exit 2
      fi
      shift
      ;;
  esac
done

PROJECT_NAME="${PROJECT_NAME:-$(basename "$PWD")}"

# ---------- template × mode 조합 검증 (mode 단독 검증 전) ----------
case "$TEMPLATE" in
  vite-react-ts)
    : # 기존 default. 모든 mode 호환
    ;;
  html-static)
    if [ "$MODE" = "spec" ]; then
      echo "ERROR: spec × html-static 조합은 지원하지 않음 (매트릭스 §제외)" >&2
      echo "  상세: docs/template-support-matrix.md 의 §제외 절 참조" >&2
      exit 2
    fi
    ;;
  *)
    echo "ERROR: 알 수 없는 --template: $TEMPLATE (vite-react-ts | html-static)" >&2
    exit 2
    ;;
esac

# ---------- 모드별 검증 ----------
case "$MODE" in
  figma)
    if [ -z "$FIGMA_URL" ]; then
      echo "usage (figma 모드): bootstrap.sh <figma-url> [project-name] [--component-url <url>]" >&2
      echo "  예: bootstrap.sh https://figma.com/design/ABC123/Project my-project" >&2
      exit 2
    fi
    ;;
  spec)
    if [ -z "$HANDOFF_DIR" ]; then
      echo "usage (spec 모드): bootstrap.sh --mode spec --from-handoff <dir> [project-name]" >&2
      echo "  예: bootstrap.sh --mode spec --from-handoff ../chapter/handoff my-project" >&2
      exit 2
    fi
    if [ ! -d "$HANDOFF_DIR" ]; then
      echo "ERROR: --from-handoff 경로가 디렉토리 아님: $HANDOFF_DIR" >&2
      exit 3
    fi
    # 필수 파일 검증
    MISSING=""
    for f in tokens.css tailwind.config.js components-spec.md; do
      [ -f "$HANDOFF_DIR/$f" ] || MISSING="$MISSING $f"
    done
    if [ -n "$MISSING" ]; then
      echo "ERROR: handoff 폴더에 필수 파일 없음:$MISSING" >&2
      echo "  요구: tokens.css, tailwind.config.js, components-spec.md" >&2
      exit 3
    fi
    # 선택 파일 경고
    for f in tokens.js design-tokens.json README.md; do
      [ -f "$HANDOFF_DIR/$f" ] || echo "  ⚠ handoff 선택 파일 없음 (무시): $f" >&2
    done
    HANDOFF_DIR="$(cd "$HANDOFF_DIR" && pwd)"  # 절대경로 변환
    ;;
  *)
    echo "ERROR: 유효하지 않은 --mode: $MODE (figma 또는 spec)" >&2
    exit 2
    ;;
esac

# ---------- figma 모드 전용: fileKey / component-page 파싱 ----------
FILE_KEY=""
COMPONENT_NODE_ID=""
if [ "$MODE" = "figma" ]; then
  if [[ "$FIGMA_URL" =~ figma\.com/(design|file)/([^/]+) ]]; then
    FILE_KEY="${BASH_REMATCH[2]}"
  else
    # URL이 아니면 fileKey 그대로
    FILE_KEY="$FIGMA_URL"
    FIGMA_URL="https://www.figma.com/design/${FILE_KEY}"
  fi

  if [ -n "$COMPONENT_URL" ]; then
    if [[ "$COMPONENT_URL" =~ node-id=([0-9]+-[0-9]+) ]]; then
      COMPONENT_NODE_ID="${BASH_REMATCH[1]/-/:}"
    elif [[ "$COMPONENT_URL" =~ ^[0-9]+[-:][0-9]+$ ]]; then
      COMPONENT_NODE_ID="${COMPONENT_URL/-/:}"
    else
      echo "WARN: --component-url 에서 node-id 추출 실패. Component 모드 스킵." >&2
    fi
  fi
fi

echo "[bootstrap] mode=${MODE} template=${TEMPLATE} project=${PROJECT_NAME}"
if [ "$MODE" = "figma" ]; then
  echo "[bootstrap] fileKey=${FILE_KEY}"
  [ -n "$COMPONENT_NODE_ID" ] && echo "[bootstrap] component-page nodeId=${COMPONENT_NODE_ID}"
else
  echo "[bootstrap] handoff=${HANDOFF_DIR}"
fi

# HARNESS_DIR 결정
if [ -z "${HARNESS_DIR:-}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  HARNESS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
fi

if [ ! -d "$HARNESS_DIR/templates/$TEMPLATE" ]; then
  echo "ERROR: HARNESS_DIR 에 templates/$TEMPLATE 없음: $HARNESS_DIR" >&2
  exit 3
fi

# ---------- 환경 선행 체크 (doctor.sh) ----------
# set -u 만 있어 파이프라인의 마지막 명령 exit 가 스크립트에 반영됨.
# doctor.sh 가 FAIL 해도 tail 이 0 을 리턴하면 스크립트가 계속 진행되므로
# exit code 를 명시적으로 포착한다.
if [ -f "$HARNESS_DIR/scripts/doctor.sh" ]; then
  echo "[bootstrap] 선행 환경 체크 (doctor.sh)"
  DOCTOR_ARGS="--skip-project"
  if [ "$MODE" = "spec" ]; then
    DOCTOR_ARGS="$DOCTOR_ARGS --skip-figma"
  fi
  bash "$HARNESS_DIR/scripts/doctor.sh" $DOCTOR_ARGS > /tmp/bootstrap-doctor.log 2>&1
  DOCTOR_RC=$?
  tail -20 /tmp/bootstrap-doctor.log
  if [ "$DOCTOR_RC" -ne 0 ]; then
    echo "" >&2
    echo "ERROR: 필수 환경 미비. 위 출력의 [✗] 항목을 해결한 후 재실행하세요." >&2
    echo "  전체 로그: /tmp/bootstrap-doctor.log" >&2
    echo "  셋업 가이드: ${HARNESS_DIR}/docs/SETUP.md" >&2
    exit 4
  fi
  echo ""
fi

# 현재 디렉토리 비어있는지 확인 (node_modules 제외)
EXISTING=$(find . -maxdepth 1 -mindepth 1 ! -name node_modules ! -name ".git" 2>/dev/null | wc -l)
if [ "$EXISTING" -gt 0 ]; then
  echo "WARN: 현재 디렉토리 비어있지 않음. 파일 덮어쓰기 가능성." >&2
  echo "  계속하려면 3초 안에 Ctrl+C 로 취소하거나 Enter." >&2
  read -t 3 -r || true
fi

# ---------- 1. 템플릿 복사 ----------
echo "[bootstrap] 1/9 템플릿 복사 ($TEMPLATE)"
cp -r "$HARNESS_DIR/templates/$TEMPLATE/." .

# ---------- 2. 템플릿 치환 ----------
echo "[bootstrap] 2/9 템플릿 placeholder 치환"

# 모드별 표시 문자열
if [ "$MODE" = "figma" ]; then
  SOURCE_INFO="Figma · ${FIGMA_URL}"
  FILE_KEY_DISPLAY="$FILE_KEY"
  FIGMA_URL_DISPLAY="$FIGMA_URL"
else
  SOURCE_INFO="Spec Bundle · ${HANDOFF_DIR}"
  FILE_KEY_DISPLAY="N/A (spec mode)"
  FIGMA_URL_DISPLAY="N/A (spec mode)"
fi

# package.json name
if [ -f package.json ]; then
  node -e "
    const fs=require('fs');
    const p=JSON.parse(fs.readFileSync('package.json','utf8'));
    p.name='${PROJECT_NAME}'.toLowerCase().replace(/[^a-z0-9-]/g,'-');
    fs.writeFileSync('package.json', JSON.stringify(p,null,2)+'\n');
  "
fi
# index.html title
if [ -f index.html ]; then
  sed -i.bak "s/{PROJECT_NAME}/${PROJECT_NAME}/g" index.html && rm -f index.html.bak
fi
# PROGRESS.md 템플릿 → PROGRESS.md
if [ -f PROGRESS.md.tmpl ]; then
  sed -e "s|{PROJECT_NAME}|${PROJECT_NAME}|g" \
      -e "s|{FIGMA_URL}|${FIGMA_URL_DISPLAY}|g" \
      -e "s|{FILE_KEY}|${FILE_KEY_DISPLAY}|g" \
      -e "s|{MODE}|${MODE}|g" \
      -e "s|{SOURCE_INFO}|${SOURCE_INFO}|g" \
      -e "s|{TEMPLATE}|${TEMPLATE}|g" \
      PROGRESS.md.tmpl > PROGRESS.md
  rm -f PROGRESS.md.tmpl
fi

# ---------- 3. .claude/ 복사 ----------
echo "[bootstrap] 3/9 .claude/ agents + skills 복사"
mkdir -p .claude
cp -r "$HARNESS_DIR/.claude/agents" .claude/
cp -r "$HARNESS_DIR/.claude/skills" .claude/

# ---------- 4. scripts/ 복사 ----------
echo "[bootstrap] 4/9 scripts/ 복사"
mkdir -p scripts/_lib
cp "$HARNESS_DIR/scripts/_lib/load-figma-token.sh" scripts/_lib/
cp "$HARNESS_DIR/scripts/figma-rest-image.sh" scripts/
cp "$HARNESS_DIR/scripts/extract-tokens.sh" scripts/
cp "$HARNESS_DIR/scripts/_extract-tokens-analyze.mjs" scripts/
cp "$HARNESS_DIR/scripts/check-text-ratio.mjs" scripts/
cp "$HARNESS_DIR/scripts/check-token-usage.mjs" scripts/
cp "$HARNESS_DIR/scripts/check-text-ratio-html.mjs" scripts/
cp "$HARNESS_DIR/scripts/check-token-usage-html.mjs" scripts/
cp "$HARNESS_DIR/scripts/check-visual-regression.mjs" scripts/
cp "$HARNESS_DIR/scripts/fetch-figma-baseline.sh" scripts/
cp "$HARNESS_DIR/scripts/render-spec-baseline.mjs" scripts/
cp "$HARNESS_DIR/scripts/measure-quality.sh" scripts/
cp "$HARNESS_DIR/scripts/doctor.sh" scripts/
cp "$HARNESS_DIR/scripts/setup-figma-token.sh" scripts/
chmod +x scripts/*.sh scripts/*.mjs scripts/_lib/*.sh 2>/dev/null || true

# ---------- 5. docs/ 복사 ----------
echo "[bootstrap] 5/9 docs/ 복사"
mkdir -p docs
cp "$HARNESS_DIR/docs/workflow.md" docs/
cp "$HARNESS_DIR/docs/team-playbook.md" docs/
# project-context.md.tmpl → project-context.md (치환)
if [ -f "$HARNESS_DIR/docs/project-context.md.tmpl" ]; then
  PREVIEW_URL_DISPLAY="http://127.0.0.1:5173"
  sed -e "s|{PROJECT_NAME}|${PROJECT_NAME}|g" \
      -e "s|{FIGMA_URL}|${FIGMA_URL_DISPLAY}|g" \
      -e "s|{FILE_KEY}|${FILE_KEY_DISPLAY}|g" \
      -e "s|{MODE}|${MODE}|g" \
      -e "s|{SOURCE_INFO}|${SOURCE_INFO}|g" \
      -e "s|{TEMPLATE}|${TEMPLATE}|g" \
      -e "s|{PREVIEW_URL}|${PREVIEW_URL_DISPLAY}|g" \
      "$HARNESS_DIR/docs/project-context.md.tmpl" > docs/project-context.md
fi

# ---------- 6. CLAUDE.md 복사 ----------
echo "[bootstrap] 6/9 CLAUDE.md 복사"
cp "$HARNESS_DIR/CLAUDE.md" CLAUDE.md

# ---------- 7. npm install ----------
echo "[bootstrap] 7/9 npm install (오래 걸릴 수 있음)"
if command -v npm >/dev/null 2>&1; then
  npm install --loglevel=error 2>&1 | tail -20 || echo "  ⚠ npm install 실패 — 수동 실행 필요"
else
  echo "  ⚠ npm 미설치 — Node 18+ 설치 후 'npm install' 수동 실행"
fi

# ---------- 8. 토큰 소스 주입 (모드별 분기) ----------
if [ "$MODE" = "figma" ]; then
  echo "[bootstrap] 8/9 extract-tokens.sh 실행 (Figma 토큰 추출)"
  if [ -f "scripts/_lib/load-figma-token.sh" ]; then
    . scripts/_lib/load-figma-token.sh
  fi

  if [ -z "${FIGMA_TOKEN:-}" ]; then
    echo "  ⚠ FIGMA_TOKEN 미설정 — 토큰 추출 스킵"
    echo "  설정: bash scripts/setup-figma-token.sh"
    if [ -n "$COMPONENT_NODE_ID" ]; then
      echo "  이후 수동 재실행: bash scripts/extract-tokens.sh ${FILE_KEY} --component-page ${COMPONENT_NODE_ID}"
    else
      echo "  이후 수동 재실행: bash scripts/extract-tokens.sh ${FILE_KEY}"
    fi
  else
    if [ -n "$COMPONENT_NODE_ID" ]; then
      bash scripts/extract-tokens.sh "$FILE_KEY" --component-page "$COMPONENT_NODE_ID" \
        || echo "  ⚠ extract-tokens 실패 — 수동 재시도 필요"
    else
      bash scripts/extract-tokens.sh "$FILE_KEY" \
        || echo "  ⚠ extract-tokens 실패 — 수동 재시도 필요"
    fi
  fi

  # html-static 의 경우 extract-tokens 가 만든 src/styles/tokens.css 를
  # public/css/tokens.css 로 이동 (vite 와 다른 위치).
  if [ "$TEMPLATE" = "html-static" ] && [ -f "src/styles/tokens.css" ]; then
    mkdir -p public/css
    mv src/styles/tokens.css public/css/tokens.css
    rmdir src/styles 2>/dev/null || true
    rmdir src 2>/dev/null || true
    echo "  ✓ public/css/tokens.css (html-static 위치로 이동)"
  fi
else
  # spec 모드: handoff 파일을 프로젝트에 주입
  echo "[bootstrap] 8/9 handoff 번들 임포트 (spec 모드)"

  # tokens.css → src/styles/tokens.css (템플릿 placeholder 덮어쓰기)
  mkdir -p src/styles
  cp "$HANDOFF_DIR/tokens.css" src/styles/tokens.css
  echo "  ✓ src/styles/tokens.css"

  # tailwind.config.js → 루트 (템플릿의 tailwind.config.ts 대체)
  cp "$HANDOFF_DIR/tailwind.config.js" tailwind.config.js
  rm -f tailwind.config.ts  # TS 버전 제거 (JS 버전이 우선)
  echo "  ✓ tailwind.config.js (tailwind.config.ts 제거)"

  # tokens.js → src/lib/tokens.js (선택)
  if [ -f "$HANDOFF_DIR/tokens.js" ]; then
    mkdir -p src/lib
    cp "$HANDOFF_DIR/tokens.js" src/lib/tokens.js
    echo "  ✓ src/lib/tokens.js"
  fi

  # design-tokens.json → docs/ (참조용)
  if [ -f "$HANDOFF_DIR/design-tokens.json" ]; then
    cp "$HANDOFF_DIR/design-tokens.json" docs/design-tokens.json
    echo "  ✓ docs/design-tokens.json"
  fi

  # components-spec.md → docs/ (섹션 워커가 참조)
  cp "$HANDOFF_DIR/components-spec.md" docs/components-spec.md
  echo "  ✓ docs/components-spec.md"

  # handoff README 있으면 참조 문서로 보존
  if [ -f "$HANDOFF_DIR/README.md" ]; then
    cp "$HANDOFF_DIR/README.md" docs/handoff-README.md
    echo "  ✓ docs/handoff-README.md"
  fi

  # token-audit.md 생성 (extract-tokens 대신 manifest 역할)
  cat > docs/token-audit.md <<EOF
# docs/token-audit.md — 토큰 인벤토리 (spec 모드)

**소스**: \`${HANDOFF_DIR}\`
**모드**: spec (handoff 번들 임포트)
**생성일**: $(date '+%Y-%m-%d')

## 주입된 파일

- \`src/styles/tokens.css\` — CSS 커스텀 프로퍼티 (:root)
- \`tailwind.config.js\` — Tailwind 설정 (토큰 매핑 포함)
- \`src/lib/tokens.js\` — ESM 토큰 export (있으면)
- \`docs/design-tokens.json\` — DTCG 포맷 원본 (있으면)
- \`docs/components-spec.md\` — 컴포넌트 API 명세

## 사용

- **CSS**: \`var(--<token-name>)\` — \`src/styles/tokens.css\` 참조
- **Tailwind 클래스**: \`tailwind.config.js\` 의 theme 섹션 참조
- **JS**: \`import { colors, typography } from '@/lib/tokens'\`

## 섹션 워커 지침

섹션 워커는 \`docs/components-spec.md\` 를 읽고 해당 컴포넌트의 Purpose/Props/Variants/Tokens 를 참조해 구현한다. Figma REST 호출은 spec 모드에서 사용하지 않음.

## 재임포트 (handoff 업데이트 시)

\`\`\`bash
bash scripts/bootstrap.sh --mode spec --from-handoff ${HANDOFF_DIR} ${PROJECT_NAME}
\`\`\`

> ⚠ 덮어쓰기 주의: 기존 tokens.css / tailwind.config.js / components-spec.md 변경사항 손실 가능.
EOF
  echo "  ✓ docs/token-audit.md"
fi

# ---------- 9. git init + 초기 커밋 ----------
echo "[bootstrap] 9/9 git init + 초기 커밋"
if [ ! -d .git ]; then
  git init -q
fi
git add -A 2>/dev/null || true
if [ "$MODE" = "figma" ]; then
  COMMIT_MSG="chore: bootstrap publish-harness (figma mode, fileKey ${FILE_KEY})"
else
  COMMIT_MSG="chore: bootstrap publish-harness (spec mode, handoff ${HANDOFF_DIR})"
fi
git commit -q -m "$COMMIT_MSG" || echo "  (이미 커밋된 상태)"

echo ""
echo "=================================="
echo "✓ bootstrap 완료 (mode=${MODE})"
echo ""
echo "⚠⚠⚠ 중요 — Claude Code 세션 재시작 필수 ⚠⚠⚠"
echo ""
echo "  이 bootstrap을 Claude Code 세션 안에서 실행했다면,"
echo "  방금 생성된 .claude/agents/section-worker.md 는 현재 세션의 Agent"
echo "  레지스트리에 반영되지 않습니다 (세션 시작 시점에 동결됨)."
echo ""
echo "  반드시 다음 순서를 지키세요:"
echo "  1. 현재 Claude 세션에서 /exit"
echo "  2. 같은 디렉토리에서 'claude --dangerously-skip-permissions' 재시작"
echo "  3. 새 세션에서 'publish-harness 스킬로 첫 페이지/컴포넌트 진행' 지시"
echo ""
echo "=================================="
echo "다음 단계 (세션 재시작 후):"
if [ "$MODE" = "figma" ]; then
  echo "  1. docs/token-audit.md 를 열어 추출된 토큰 검토"
  echo "  2. docs/project-context.md 에 페이지 Node ID 채우기"
  echo "  3. npm run dev 로 dev 서버 기동 (선택)"
  echo "  4. Claude Code 세션에서:"
  echo "     \"publish-harness 스킬로 첫 페이지 진행\""
else
  echo "  1. docs/components-spec.md 를 열어 임포트된 컴포넌트 명세 검토"
  echo "  2. docs/project-context.md 에 구현할 컴포넌트 목록 채우기"
  echo "  3. npm run dev 로 dev 서버 기동 (선택)"
  echo "  4. Claude Code 세션에서:"
  echo "     \"publish-harness 스킬로 Foundation 컴포넌트부터 진행\""
fi
echo ""

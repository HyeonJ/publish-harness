#!/usr/bin/env bash
# doctor.sh — publish-harness 환경 점검.
#
# 설치는 하지 않는다. 상태만 확인하고 미비한 항목에 대해 해결 명령어 안내.
#
# Usage:
#   bash scripts/doctor.sh [--strict] [--skip-project] [--skip-figma]
#
# 옵션:
#   --strict         선택 항목(lhci/gh 등)이 없어도 exit 1
#   --skip-project   §5 프로젝트 구조 체크 스킵 (bootstrap.sh 에서 빈 디렉토리 실행 시 사용)
#   --skip-figma     §2 Figma MCP / §3 Figma 인증 체크 스킵 (spec 모드 bootstrap 용)
#
# 종료 코드:
#   0 모든 필수 OK
#   1 하나 이상 필수 미비

set -u

STRICT=0
SKIP_PROJECT=0
SKIP_FIGMA=0
for arg in "$@"; do
  case "$arg" in
    --strict) STRICT=1 ;;
    --skip-project) SKIP_PROJECT=1 ;;
    --skip-figma) SKIP_FIGMA=1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "${SCRIPT_DIR}/_lib/load-figma-token.sh"

FAIL=0
WARN=0

ok()    { printf "  \033[32m[✓]\033[0m %-22s %s\n" "$1" "$2"; }
bad()   { printf "  \033[31m[✗]\033[0m %-22s %s\n" "$1" "$2"; FAIL=$((FAIL+1)); }
warn()  { printf "  \033[33m[⚠]\033[0m %-22s %s\n" "$1" "$2"; WARN=$((WARN+1)); }
hint()  { printf "      \033[2m→ %s\033[0m\n" "$1"; }

section() { printf "\n\033[1m%s\033[0m\n" "$1"; }

echo "=== publish-harness doctor ==="

# ========== 필수 시스템 ==========
section "1/5 시스템 도구"

# Node
if command -v node >/dev/null 2>&1; then
  NODE_VER=$(node -v | sed 's/^v//')
  NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 18 ] 2>/dev/null; then
    ok "Node" "v${NODE_VER}"
  else
    bad "Node" "v${NODE_VER} (18+ 필요)"
    hint "https://nodejs.org 에서 LTS 설치"
  fi
else
  bad "Node" "미설치"
  hint "https://nodejs.org 에서 LTS (v20+) 설치"
fi

# npm
if command -v npm >/dev/null 2>&1; then
  ok "npm" "$(npm -v)"
else
  bad "npm" "미설치"
  hint "Node 설치 시 동반"
fi

# bash
ok "bash" "$(bash --version 2>/dev/null | head -1 | awk '{print $4}' | cut -d'(' -f1)"

# git
if command -v git >/dev/null 2>&1; then
  ok "git" "$(git --version | awk '{print $3}')"
else
  bad "git" "미설치"
  hint "https://git-scm.com"
fi

# curl
if command -v curl >/dev/null 2>&1; then
  ok "curl" "설치됨"
else
  bad "curl" "미설치"
  hint "대부분 OS에 내장. Windows Git Bash는 기본 포함"
fi

# ========== Claude Code ==========
section "2/5 Claude Code"

if command -v claude >/dev/null 2>&1; then
  CLAUDE_VER=$(claude --version 2>/dev/null | head -1 || echo "unknown")
  ok "Claude Code CLI" "${CLAUDE_VER}"

  # Figma MCP 등록 여부 (spec 모드면 스킵)
  if [ "$SKIP_FIGMA" -eq 0 ]; then
    if claude mcp list 2>/dev/null | grep -qi "figma"; then
      ok "Figma MCP" "등록됨"
    else
      warn "Figma MCP" "미등록"
      hint "claude mcp add figma-developer-mcp -- npx -y figma-developer-mcp --figma-api-key=\$FIGMA_TOKEN --stdio"
    fi
  fi
else
  bad "Claude Code CLI" "미설치"
  hint "https://docs.claude.com/ko/docs/claude-code/overview 참고"
fi

# ========== Figma 토큰 ==========
section "3/5 Figma 인증"

if [ "$SKIP_FIGMA" -eq 1 ]; then
  printf "  \033[2m(--skip-figma: spec 모드 → Figma 인증 체크 생략)\033[0m\n"
elif [ -n "${FIGMA_TOKEN:-}" ]; then
  prefix="${FIGMA_TOKEN:0:6}"
  ok "FIGMA_TOKEN" "${prefix}..."

  # smoke test
  me_json=$(curl -sS --max-time 10 -H "X-Figma-Token: ${FIGMA_TOKEN}" "https://api.figma.com/v1/me" 2>/dev/null || echo "")
  if echo "$me_json" | grep -q '"email"'; then
    email=$(echo "$me_json" | node -e "let j=''; process.stdin.on('data',d=>j+=d); process.stdin.on('end',()=>{try{const o=JSON.parse(j); process.stdout.write(o.email||'')}catch(e){}})" 2>/dev/null)
    ok "Figma API 연결" "${email}"
  else
    bad "Figma API 연결" "인증 실패 (토큰 무효)"
    hint "bash scripts/setup-figma-token.sh 로 재설정"
  fi
else
  bad "FIGMA_TOKEN" "미설정"
  hint "bash scripts/setup-figma-token.sh 실행"
fi

# ========== 선택 도구 ==========
section "4/5 선택 도구"

# gh CLI
if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then
    ok "gh CLI" "로그인됨"
  else
    warn "gh CLI" "설치됨 but 로그인 안됨"
    hint "gh auth login"
  fi
else
  warn "gh CLI" "미설치 (GitHub 리포 자동 생성용, 선택)"
  hint "https://cli.github.com"
fi

# lhci
if command -v lhci >/dev/null 2>&1 || npx --no-install lhci --version >/dev/null 2>&1; then
  ok "@lhci/cli" "설치됨 (G7 가능)"
else
  warn "@lhci/cli" "미설치 (G7 Lighthouse 스킵됨)"
  hint "프로젝트에서 npm i -D @lhci/cli lighthouse"
fi

# ========== 프로젝트 레벨 체크 ==========
if [ "$SKIP_PROJECT" -eq 0 ]; then
  section "5/5 프로젝트 구조 (실행 위치 기준)"

  if [ -f "package.json" ]; then
    ok "package.json" "존재"
  else
    warn "package.json" "없음 (하네스 루트 또는 미부트스트랩 프로젝트)"
  fi

  if [ -f "src/styles/tokens.css" ]; then
    ok "src/styles/tokens.css" "존재"
  else
    warn "tokens.css" "없음"
    hint "bash scripts/extract-tokens.sh <fileKey>"
  fi

  if [ -f "PROGRESS.md" ]; then
    ok "PROGRESS.md" "존재"
  else
    warn "PROGRESS.md" "없음 (새 프로젝트면 bootstrap.sh 로 생성)"
  fi
else
  section "5/5 프로젝트 구조"
  printf "  \033[2m(--skip-project: bootstrap 초입 실행 → 프로젝트 체크 생략)\033[0m\n"
fi

# ========== 결과 ==========
printf "\n\033[1m결과\033[0m\n"
if [ "$FAIL" -gt 0 ]; then
  printf "  \033[31m✗ 필수 항목 ${FAIL}개 미비\033[0m, 경고 ${WARN}개\n"
  exit 1
fi

if [ "$WARN" -gt 0 ]; then
  printf "  \033[33m⚠ 경고 ${WARN}개\033[0m (필수는 모두 OK)\n"
  [ "$STRICT" -eq 1 ] && exit 1
  exit 0
fi

printf "  \033[32m✓ 모든 항목 OK\033[0m\n"
exit 0

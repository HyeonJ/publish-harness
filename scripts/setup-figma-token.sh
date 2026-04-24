#!/usr/bin/env bash
# setup-figma-token.sh — FIGMA_TOKEN 전역 env var 대화형 등록.
#
# 수행:
#   1. 이미 설정돼 있으면 prefix + Figma /v1/me 확인 후 종료
#   2. 없으면 PAT 발급 URL 안내
#   3. 사용자가 토큰 입력 (입력 숨김)
#   4. Figma /v1/me 로 smoke test
#   5. OS 감지 후 전역 등록:
#      - Windows: PowerShell User scope
#      - macOS/Linux: ~/.bashrc + ~/.zshrc 중 존재하는 쪽에 export 추가
#   6. 완료 안내 (새 터미널 세션부터 적용)
#
# Usage:
#   bash scripts/setup-figma-token.sh

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "${SCRIPT_DIR}/_lib/load-figma-token.sh"

echo "=== Figma Personal Access Token 셋업 ==="
echo ""

# ---------- 기존 토큰 확인 ----------
if [ -n "${FIGMA_TOKEN:-}" ]; then
  echo "[1/4] 기존 FIGMA_TOKEN 발견."
  prefix="${FIGMA_TOKEN:0:6}"
  echo "      토큰 prefix: ${prefix}..."
  echo ""
  echo "[2/4] Figma API 연결 확인 (/v1/me)"
  me_json=$(curl -sS -H "X-Figma-Token: ${FIGMA_TOKEN}" "https://api.figma.com/v1/me" || echo "")
  if echo "$me_json" | grep -q '"email"'; then
    email=$(echo "$me_json" | node -e "let j=''; process.stdin.on('data',d=>j+=d); process.stdin.on('end',()=>{try{const o=JSON.parse(j); process.stdout.write(o.email||'')}catch(e){}})" 2>/dev/null)
    echo "      ✓ 인증 성공 — email: ${email}"
    echo ""
    echo "이미 셋업 완료. 종료."
    exit 0
  else
    echo "      ✗ 토큰이 유효하지 않음. 새로 발급 권장."
    echo ""
    read -p "새 토큰으로 교체하시겠습니까? [y/N]: " ans
    case "$ans" in
      y|Y) ;;
      *) echo "취소. 종료."; exit 0 ;;
    esac
  fi
fi

# ---------- PAT 발급 안내 ----------
echo ""
echo "[PAT 발급 방법]"
echo "  1. 웹 브라우저에서 열기: https://www.figma.com/developers/api#access-tokens"
echo "  2. Figma 로그인 후 Settings → Security → Personal access tokens"
echo "  3. 'Generate new token' 클릭"
echo "  4. 이름 입력 (예: 'publish-harness')"
echo "  5. Expiration 선택 (90일 권장)"
echo "  6. 스코프: 'File content' → Read only 만 체크"
echo "  7. 생성된 토큰 'figd_...' 복사"
echo ""

# ---------- 토큰 입력 ----------
echo "[1/4] 토큰 입력 (화면에 표시되지 않음)"
read -r -s -p "      FIGMA_TOKEN: " TOKEN_INPUT
echo ""

if [ -z "$TOKEN_INPUT" ]; then
  echo "ERROR: 빈 값 입력됨. 종료." >&2
  exit 2
fi

if [[ ! "$TOKEN_INPUT" =~ ^figd_ ]]; then
  echo "WARN: 'figd_' 로 시작하지 않음. Figma PAT 형식 확인 권장."
  read -p "      그래도 진행? [y/N]: " ans
  case "$ans" in
    y|Y) ;;
    *) echo "취소."; exit 2 ;;
  esac
fi

export FIGMA_TOKEN="$TOKEN_INPUT"

# ---------- smoke test ----------
echo ""
echo "[2/4] Figma API 연결 확인 (/v1/me)"
me_json=$(curl -sS -H "X-Figma-Token: ${FIGMA_TOKEN}" "https://api.figma.com/v1/me" || echo "")
if ! echo "$me_json" | grep -q '"email"'; then
  echo "      ✗ 인증 실패. 응답:"
  echo "$me_json" | head -c 500
  echo ""
  echo "토큰을 확인하고 다시 시도해 주세요."
  exit 3
fi
email=$(echo "$me_json" | node -e "let j=''; process.stdin.on('data',d=>j+=d); process.stdin.on('end',()=>{try{const o=JSON.parse(j); process.stdout.write(o.email||'')}catch(e){}})" 2>/dev/null)
echo "      ✓ 인증 성공 — email: ${email}"

# ---------- OS별 전역 등록 ----------
echo ""
echo "[3/4] 전역 env var 등록"

OS="$(uname -s 2>/dev/null || echo Unknown)"

case "$OS" in
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    # Windows Git Bash
    if command -v powershell >/dev/null 2>&1; then
      powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('FIGMA_TOKEN', '${FIGMA_TOKEN}', 'User')" && \
        echo "      ✓ Windows User scope에 등록 완료" || \
        { echo "      ✗ PowerShell 등록 실패."; exit 3; }
    else
      echo "      ✗ PowerShell 미발견. 수동 등록 필요:"
      echo "        [Environment]::SetEnvironmentVariable('FIGMA_TOKEN', '${FIGMA_TOKEN}', 'User')"
      exit 3
    fi
    ;;
  Darwin|Linux)
    # macOS / Linux — 보안 개선: 토큰 값은 ~/.config/publish-harness/token (mode 600) 에 저장.
    # rc 파일에는 "파일에서 읽어오는" export 만 기록 → rc 파일 자체를 읽어도 토큰 평문 노출 안 됨.
    TOKEN_DIR="$HOME/.config/publish-harness"
    TOKEN_FILE="$TOKEN_DIR/token"
    mkdir -p "$TOKEN_DIR"
    chmod 700 "$TOKEN_DIR"
    # 토큰 값만 저장 (newline 없이)
    printf '%s' "$FIGMA_TOKEN" > "$TOKEN_FILE"
    chmod 600 "$TOKEN_FILE"
    echo "      ✓ ${TOKEN_FILE} (mode 600) 에 토큰 값 저장"

    # rc 파일 선택
    RC=""
    if [ -n "${ZSH_VERSION:-}" ] || [ "${SHELL##*/}" = "zsh" ]; then
      RC="$HOME/.zshrc"
    elif [ -f "$HOME/.bashrc" ]; then
      RC="$HOME/.bashrc"
    else
      RC="$HOME/.profile"
    fi

    RC_LINE="export FIGMA_TOKEN=\"\$(cat ~/.config/publish-harness/token 2>/dev/null)\""

    if grep -q "FIGMA_TOKEN" "$RC" 2>/dev/null; then
      # 기존 줄(평문이든 파일참조든) 교체
      if sed --version >/dev/null 2>&1; then
        sed -i "/export FIGMA_TOKEN=/c\\${RC_LINE}" "$RC"
      else
        sed -i '' "/export FIGMA_TOKEN=/c\\
${RC_LINE}" "$RC"
      fi
      echo "      ✓ ${RC} 의 기존 FIGMA_TOKEN 줄을 파일참조형으로 교체"
    else
      echo "" >> "$RC"
      echo "# publish-harness" >> "$RC"
      echo "$RC_LINE" >> "$RC"
      echo "      ✓ ${RC} 에 파일참조 export 추가"
    fi
    ;;
  *)
    echo "      ✗ 알 수 없는 OS: $OS"
    echo "        수동으로 다음 명령 실행:"
    echo "        export FIGMA_TOKEN='${FIGMA_TOKEN}'"
    exit 3
    ;;
esac

# ---------- 안내 ----------
echo ""
echo "[4/4] 완료"
echo ""
echo "⚠ 이미 열려있는 터미널 세션에는 반영되지 않음."
echo "  - Windows: 이 터미널 닫고 새 PowerShell/cmd/Git Bash 열기"
echo "      (어느 셸이든 OK — Git Bash 필수 아님)"
echo "  - macOS/Linux: 'source ${RC:-~/.bashrc}' 또는 새 터미널"
echo ""
echo "확인 명령 (새 세션에서):"
echo "  - PowerShell:  \$env:FIGMA_TOKEN.Substring(0,10)"
echo "  - cmd:         echo %FIGMA_TOKEN:~0,10%"
echo "  - bash/Linux:  printenv FIGMA_TOKEN | head -c 10"
echo ""
echo "다음 단계: bash scripts/doctor.sh 로 전체 환경 최종 확인"
echo "  (PowerShell/cmd에서도 'bash scripts/doctor.sh' 그대로 실행 가능)"

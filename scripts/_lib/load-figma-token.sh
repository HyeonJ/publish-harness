#!/usr/bin/env bash
# _lib/load-figma-token.sh — FIGMA_TOKEN env var 로드 공용 헬퍼.
#
# Usage (source):
#   SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
#   . "${SCRIPT_DIR}/_lib/load-figma-token.sh"
#
#   if [ -z "${FIGMA_TOKEN:-}" ]; then
#     echo "ERROR: FIGMA_TOKEN 미설정." >&2
#     exit 2
#   fi
#
# 동작:
#   1. Windows + PowerShell 있으면 User scope env var에서 자동 로드
#      - Git Bash ~/.bashrc 의 stale token 이 User scope token 을 덮어쓰는
#        사고가 반복되어, Windows 에서는 User scope token 을 기본 우선한다.
#      - 임시 shell token 을 강제로 쓰려면 PUBLISH_HARNESS_ALLOW_SHELL_FIGMA_TOKEN=1
#        을 설정한다.
#   2. Windows User scope token 이 없고 이미 export 된 FIGMA_TOKEN 있으면 사용
#   3. 여전히 없으면 호출자가 에러 처리
#
# 이 스크립트 자체는 에러를 내지 않는다. 호출자가 `FIGMA_TOKEN` 빈값 여부로
# 판단. 이유: setup-figma-token.sh / doctor.sh 처럼 "토큰 미설정 자체가 정상
# 플로우" 인 경우도 있기 때문.

POWERSHELL_BIN=""
if command -v powershell >/dev/null 2>&1; then
  POWERSHELL_BIN="powershell"
elif command -v powershell.exe >/dev/null 2>&1; then
  POWERSHELL_BIN="powershell.exe"
fi

if [ -n "$POWERSHELL_BIN" ] && [ "${PUBLISH_HARNESS_ALLOW_SHELL_FIGMA_TOKEN:-0}" != "1" ]; then
  # Windows User scope에서 로드. Git Bash login rc 의 stale token 보다 우선한다.
  USER_SCOPE_FIGMA_TOKEN=$("$POWERSHELL_BIN" -NoProfile -Command "[Environment]::GetEnvironmentVariable('FIGMA_TOKEN', 'User')" 2>/dev/null | tr -d '\r\n')
  if [ -n "${USER_SCOPE_FIGMA_TOKEN:-}" ]; then
    FIGMA_TOKEN="$USER_SCOPE_FIGMA_TOKEN"
    export FIGMA_TOKEN
  fi
fi

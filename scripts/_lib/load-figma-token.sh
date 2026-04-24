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
#   1. 이미 export 된 FIGMA_TOKEN 있으면 그대로 사용
#   2. Windows + PowerShell 있으면 User scope env var에서 자동 로드
#   3. 여전히 없으면 호출자가 에러 처리
#
# 이 스크립트 자체는 에러를 내지 않는다. 호출자가 `FIGMA_TOKEN` 빈값 여부로
# 판단. 이유: setup-figma-token.sh / doctor.sh 처럼 "토큰 미설정 자체가 정상
# 플로우" 인 경우도 있기 때문.

if [ -z "${FIGMA_TOKEN:-}" ]; then
  if command -v powershell >/dev/null 2>&1; then
    # Windows User scope에서 로드
    FIGMA_TOKEN=$(powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('FIGMA_TOKEN', 'User')" 2>/dev/null | tr -d '\r\n')
    if [ -n "${FIGMA_TOKEN:-}" ]; then
      export FIGMA_TOKEN
    fi
  fi
fi

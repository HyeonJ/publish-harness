#!/usr/bin/env bash
# test-strict-gates.sh — fixture 일괄 검증
# 각 fixture 에서 measure-quality.sh 실행 → 의도된 PASS/FAIL 일치 검증.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
FIXTURE_DIR="${ROOT}/tests/fixtures/strict-gate"

# 본 스크립트는 G11 정적 축만 격리 검증한다 (check-layout-escapes.mjs 단독 호출).
# 다음 fixture 들은 다른 축 (G1 L2 anchor / G1 strict legacy / G11 runtime sweep) 이 필요해 skip:
#   - fail-anchor-required-missing       → G1 L2 (manifest required check)
#   - fail-text-block-on-non-text-element → G1 L2 (semantic element check)
#   - fail-data-allow-escape-text-child  → 미구현 정적 룰 (subtree text-child 감지)
#   - fail-dynamic-classname             → G11 runtime sweep (동적 className 합성)
#   - fail-no-anchor-manifest / pass-legacy-valid / fail-legacy-* → G1 strict legacy
OUT_OF_SCOPE_PATTERN='^(fail-anchor-required-missing|fail-text-block-on-non-text-element|fail-data-allow-escape-text-child|fail-dynamic-classname|fail-no-anchor-manifest|pass-legacy-valid|fail-legacy-invalid-creator|fail-legacy-expired)$'

pass_count=0
fail_count=0
skip_count=0
for fix in "$FIXTURE_DIR"/*/; do
  name=$(basename "$fix")
  if [[ "$name" =~ $OUT_OF_SCOPE_PATTERN ]]; then
    echo "  ⊝ $name (out of scope: G1 L2 / runtime / legacy)"
    skip_count=$((skip_count + 1))
    continue
  fi
  expected_pass=true
  case "$name" in
    fail-*) expected_pass=false ;;
  esac
  # measure-quality.sh 의 G11 만 격리 검증 (G1 은 baseline PNG 의존)
  src_dir="$fix/src/components/sections/hero"
  if [ ! -d "$src_dir" ]; then
    echo "SKIP $name (no src dir)"
    skip_count=$((skip_count + 1))
    continue
  fi
  files=$(find "$src_dir" -type f \( -name "*.tsx" -o -name "*.jsx" \) | tr '\n' ' ')
  result=$(node "${SCRIPT_DIR}/check-layout-escapes.mjs" --section hero --files "$files" 2>&1 || true)
  # 첫 번째 "status": "VALUE" 매치에서 VALUE 만 추출 (trailing 따옴표 제거)
  status=$(echo "$result" | grep -oE '"status":[[:space:]]*"[A-Z_]+"' | head -1 | grep -oE '[A-Z_]+' | tail -1)
  case "$status" in
    PASS) actual_pass=true ;;
    FAIL) actual_pass=false ;;
    *) actual_pass=unknown ;;
  esac
  if [ "$expected_pass" = "$actual_pass" ]; then
    echo "  ✓ $name (expected=$expected_pass, actual=$actual_pass)"
    pass_count=$((pass_count + 1))
  else
    echo "  ❌ $name (expected=$expected_pass, actual=$actual_pass)"
    echo "$result" | head -10
    fail_count=$((fail_count + 1))
  fi
done

echo ""
echo "Total: $((pass_count + fail_count + skip_count)) | Passed: $pass_count | Failed: $fail_count | Skipped: $skip_count"
[ $fail_count -eq 0 ]

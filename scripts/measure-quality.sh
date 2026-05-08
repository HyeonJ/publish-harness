#!/usr/bin/env bash
# measure-quality.sh - publish-harness quality gates.
#
# Execution order is intentional and shared by Claude/Codex workers:
#   G10 -> G4 -> G11 -> G12 -> G5 -> G6/G8 -> G7 -> G1
#
# G1 visual regression is the final gate. It compares the finished preview
# against the Figma/spec baseline after static, structural, semantic, and
# content gates have already run.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "${SCRIPT_DIR}/_lib/node-shim.sh"

sanitize_scalar() {
  printf '%s' "$1" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

if [ -z "${TEMPLATE:-}" ]; then
  if [ -f "docs/project-context.md" ]; then
    TEMPLATE=$(grep -E "^template:" docs/project-context.md | head -1 | awk '{print $2}' | tr -d '#"')
  fi
  TEMPLATE="${TEMPLATE:-vite-react-ts}"
fi
TEMPLATE=$(sanitize_scalar "$TEMPLATE")

if [ -z "${MODE:-}" ]; then
  if [ -f "progress.json" ]; then
    MODE=$(node -e "try{const p=require('./progress.json');process.stdout.write(p.project?.mode||'')}catch(e){}" 2>/dev/null || true)
  fi
  if [ -z "${MODE:-}" ] && [ -f "docs/project-context.md" ]; then
    MODE=$(grep -E "^mode:" docs/project-context.md | head -1 | awk '{print $2}' | tr -d '#"')
  fi
  MODE="${MODE:-figma}"
fi
MODE=$(sanitize_scalar "$MODE")

if [ -z "${PREVIEW_BASE_URL:-}" ]; then
  if [ -f "docs/project-context.md" ]; then
    PREVIEW_BASE_URL=$(grep -E "^preview_base_url:" docs/project-context.md | head -1 | awk '{print $2}' | tr -d '#"')
  fi
  PREVIEW_BASE_URL="${PREVIEW_BASE_URL:-http://127.0.0.1:5173}"
fi
PREVIEW_BASE_URL=$(sanitize_scalar "$PREVIEW_BASE_URL")

case "$TEMPLATE" in
  vite-react-ts)
    G4_SCRIPT="${SCRIPT_DIR}/check-token-usage.mjs"
    G6_SCRIPT="${SCRIPT_DIR}/check-text-ratio.mjs"
    G7_URL_FMT="%s/__preview/%s"
    ;;
  html-static)
    G4_SCRIPT="${SCRIPT_DIR}/check-token-usage-html.mjs"
    G6_SCRIPT="${SCRIPT_DIR}/check-text-ratio-html.mjs"
    G7_URL_FMT="%s/__preview/%s/"
    ;;
  nextjs-app-router)
    G4_SCRIPT="${SCRIPT_DIR}/check-token-usage.mjs"
    G6_SCRIPT="${SCRIPT_DIR}/check-text-ratio.mjs"
    G7_URL_FMT="%s/__preview/%s"
    ;;
  *)
    echo "ERROR: unsupported template: $TEMPLATE" >&2
    exit 2
    ;;
esac

section=""
dir=""
BASELINE=""
VIEWPORT="desktop"
FILES=""

while [ $# -gt 0 ]; do
  case "$1" in
    --baseline) BASELINE="$2"; shift 2 ;;
    --viewport) VIEWPORT="$2"; shift 2 ;;
    --files) FILES="$2"; shift 2 ;;
    -h|--help) sed -n '2,45p' "$0"; exit 0 ;;
    -*) echo "ERROR: unknown option $1" >&2; exit 2 ;;
    *)
      if [ -z "$section" ]; then section="$1"
      elif [ -z "$dir" ]; then dir="$1"
      else echo "ERROR: too many positional args" >&2; exit 2
      fi
      shift
      ;;
  esac
done

if [ -n "$FILES" ]; then
  TARGET_SET="$FILES"
  TARGET_SCOPE="files"
else
  TARGET_SET="$dir"
  TARGET_SCOPE="dir"
fi

if [ -z "$section" ] || [ -z "$dir" ]; then
  echo "usage: measure-quality.sh <section-name> <section-dir> [--baseline <path>] [--viewport <v>]" >&2
  echo "  example: measure-quality.sh home-hero src/components/sections/home/HomeHero" >&2
  exit 2
fi

if [ ! -d "$dir" ]; then
  echo "section dir not found: $dir" >&2
  exit 2
fi

EFFECTIVE_DIR="$dir"
if [ "$TARGET_SCOPE" = "dir" ] && { [ "$dir" = "." ] || [ "$dir" = "./" ]; }; then
  if [ "$TEMPLATE" = "html-static" ] && [ -d "public" ]; then
    EFFECTIVE_DIR="public"
  elif [ -d "src" ]; then
    EFFECTIVE_DIR="src"
  fi
  TARGET_SET="$EFFECTIVE_DIR"
fi

if [ -z "$BASELINE" ]; then
  BASELINE="baselines/${section}/${VIEWPORT}.png"
fi

if [ -f "progress.json" ]; then
  PROGRESS_PREFLIGHT=$(SECTION_NAME="$section" node <<'NODE'
const fs = require('node:fs');
const sectionName = process.env.SECTION_NAME;
try {
  const progress = JSON.parse(fs.readFileSync('progress.json', 'utf8'));
  const pages = (progress.pages || []).filter((page) => page.status !== 'skipped');
  const sections = (progress.sections || []).filter((section) => section.status !== 'skipped');
  const section = sections.find((item) => item.name === sectionName);
  const pageLinkedSections = new Set(pages.flatMap((page) => page.sections || []));
  if (!section) {
    console.error(`section "${sectionName}" is not registered in progress.json`);
    process.exit(1);
  }
  if ((progress.project?.mode || 'figma') === 'figma' && pages.length > 1 && sections.length < pages.length) {
    console.error(`multi-page figma project has ${pages.length} active pages but only ${sections.length} active section(s); run one quality gate per discovered route/page`);
    process.exit(1);
  }
  if ((progress.project?.mode || 'figma') === 'figma' && pages.length > 0 && !pageLinkedSections.has(sectionName)) {
    console.error(`section "${sectionName}" is not linked to any active page; route/page quality gates must use the discovered page section names`);
    process.exit(1);
  }
  process.exit(0);
} catch (error) {
  console.error(`progress.json preflight failed: ${error.message}`);
  process.exit(1);
}
NODE
  ) || {
    echo "ERROR: progress preflight failed before quality gates" >&2
    echo "$PROGRESS_PREFLIGHT" >&2
    exit 1
  }
fi

OUT_DIR="tests/quality"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/${section}.json"
INCOMPLETE_SENTINEL=".publish-harness/INCOMPLETE.json"

FAIL=0
G1_STATUS="SKIP"
G1_DETAIL=""
G4_STATUS="SKIP"
G5_STATUS="SKIP"
G6_STATUS="SKIP"
G7_STATUS="SKIP"
G8_STATUS="SKIP"
G10_STATUS="SKIP"
G11_STATUS="SKIP"
G12_STATUS="SKIP"
G12_JSON=""

echo "[measure-quality] gate order: G10 -> G4 -> G11 -> G12 -> G5 -> G6/G8 -> G7 -> G1"

# ---------- G10 write-protected paths ----------
echo ""
echo "[G10] write-protected paths"
G10_PATHS_JSON="${SCRIPT_DIR}/write-protected-paths.json"
if [ ! -f "$G10_PATHS_JSON" ]; then
  echo "  - G10 SKIP - SSoT JSON missing ($G10_PATHS_JSON)"
elif node "${SCRIPT_DIR}/check-write-protection.mjs" --paths "$G10_PATHS_JSON" 2>/tmp/g10.err >/tmp/g10.out; then
  G10_STATUS="PASS"
  echo "  - G10 PASS"
else
  G10_STATUS="FAIL"
  FAIL=1
  cat /tmp/g10.out 2>/dev/null || true
  cat /tmp/g10.err 2>/dev/null || true
  echo "  - G10 FAIL"
fi

# ---------- G4 token usage ----------
echo ""
echo "[G4] token usage (scope=${TARGET_SCOPE})"
# shellcheck disable=SC2086
if node "$G4_SCRIPT" $TARGET_SET 2>/tmp/g4.err; then
  G4_STATUS="PASS"
  echo "  - G4 PASS"
else
  G4_STATUS="FAIL"
  FAIL=1
  cat /tmp/g4.err
  echo "  - G4 FAIL"
fi

# ---------- G11 layout escape budget ----------
echo ""
echo "[G11] layout escape budget"
G11_FILES=""
if [ "$TARGET_SCOPE" = "files" ]; then
  G11_FILES="$TARGET_SET"
else
  G11_FILES="__DIR__"
fi

if [ -z "$G11_FILES" ]; then
  echo "  - G11 SKIP (no source files)"
else
  if [ "$TARGET_SCOPE" = "files" ]; then
    G11_ARGS=(--section "$section" --files "$G11_FILES")
  else
    G11_ARGS=(--section "$section" --dir "$EFFECTIVE_DIR")
  fi
  if node "${SCRIPT_DIR}/check-layout-escapes.mjs" "${G11_ARGS[@]}" >/tmp/g11.out 2>/tmp/g11.err; then
    G11_STATUS="PASS"
    echo "  - G11 PASS"
  else
    G11_STATUS="FAIL"
    FAIL=1
    cat /tmp/g11.out 2>/dev/null || true
    cat /tmp/g11.err 2>/dev/null || true
    echo "  - G11 FAIL"
  fi
fi

# ---------- G12 React reusability ----------
echo ""
echo "[G12] React reusability"
if [ "$TEMPLATE" = "html-static" ]; then
  echo "  - G12 SKIP (html-static)"
elif [ ! -f "${SCRIPT_DIR}/check-react-reusability.mjs" ]; then
  echo "  - G12 SKIP - script missing"
else
  if [ "$TARGET_SCOPE" = "files" ]; then
    G12_JSON=$(node "${SCRIPT_DIR}/check-react-reusability.mjs" --section "$section" --dir "$EFFECTIVE_DIR" --files "$TARGET_SET" 2>/tmp/g12.err || true)
  else
    G12_JSON=$(node "${SCRIPT_DIR}/check-react-reusability.mjs" --section "$section" --dir "$EFFECTIVE_DIR" 2>/tmp/g12.err || true)
  fi

  if echo "$G12_JSON" | grep -q '"status":[[:space:]]*"PASS"'; then
    G12_STATUS="PASS"
    G12_WARNING_COUNT=$(echo "$G12_JSON" | node -e "let j='';process.stdin.on('data',d=>j+=d);process.stdin.on('end',()=>{try{const x=JSON.parse(j);process.stdout.write(String((x.warnings||[]).length))}catch(e){process.stdout.write('0')}})" 2>/dev/null)
    if [ "${G12_WARNING_COUNT:-0}" -gt 0 ]; then
      echo "$G12_JSON"
      echo "  - G12 warning(s): ${G12_WARNING_COUNT}"
    fi
    echo "  - G12 PASS"
  else
    G12_STATUS="FAIL"
    FAIL=1
    echo "$G12_JSON"
    cat /tmp/g12.err 2>/dev/null || true
    echo "  - G12 FAIL"
  fi
fi

# ---------- G5 semantic HTML / lint ----------
echo ""
echo "[G5] semantic HTML / lint (scope=${TARGET_SCOPE})"
# shellcheck disable=SC2086
if npx eslint $TARGET_SET >/tmp/g5.log 2>&1; then
  G5_STATUS="PASS"
  echo "  - G5 PASS"
else
  if grep -qE "Invalid option|Cannot find|ENOENT|unknown option" /tmp/g5.log; then
    G5_STATUS="SCRIPT_ERROR"
    echo "  - G5 SCRIPT_ERROR (eslint execution failed)"
    tail -10 /tmp/g5.log
  else
    tail -20 /tmp/g5.log
    G5_STATUS="FAIL"
    FAIL=1
    echo "  - G5 FAIL"
  fi
fi

# ---------- G6/G8 text-image ratio + i18n ----------
echo ""
echo "[G6/G8] text/image ratio + i18n (scope=${TARGET_SCOPE})"
# shellcheck disable=SC2086
G68_JSON=$(node "$G6_SCRIPT" $TARGET_SET 2>/tmp/g68.err || true)
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
  echo "  - G6/G8 PASS"
else
  cat /tmp/g68.err 2>/dev/null || true
  echo "  - G6=$G6_STATUS G8=$G8_STATUS"
fi

# ---------- G7 Lighthouse ----------
echo ""
echo "[G7] Lighthouse a11y/SEO"
if ! command -v npx >/dev/null 2>&1; then
  G7_STATUS="FAIL (npx missing)"
  FAIL=1
  echo "  - G7 FAIL - npx missing"
elif ! npx --no-install lighthouse --version >/dev/null 2>&1; then
  G7_STATUS="FAIL (lighthouse missing)"
  FAIL=1
  echo "  - G7 FAIL - lighthouse missing (install: npm i -D lighthouse @lhci/cli)"
else
  url="$(printf "$G7_URL_FMT" "$PREVIEW_BASE_URL" "$section")"
  if curl -sSf -o /dev/null "$url" 2>/dev/null; then
    npx --no-install lighthouse "$url" --only-categories=accessibility,seo \
      --output=json --output-path=/tmp/lh.json --chrome-flags="--headless" \
      --quiet 2>/dev/null || true
    a11y=$(node -e "try{const j=require('/tmp/lh.json');console.log(Math.round(j.categories.accessibility.score*100))}catch(e){console.log('N/A')}")
    seo=$(node -e "try{const j=require('/tmp/lh.json');console.log(Math.round(j.categories.seo.score*100))}catch(e){console.log('N/A')}")
    if [ "$a11y" != "N/A" ] && [ "$a11y" -ge 95 ] && [ "$seo" -ge 90 ]; then
      G7_STATUS="PASS (a11y=$a11y, seo=$seo)"
      echo "  - G7 PASS (a11y=$a11y, seo=$seo)"
    else
      G7_STATUS="FAIL (a11y=$a11y, seo=$seo)"
      FAIL=1
      echo "  - G7 FAIL (a11y=$a11y, seo=$seo, thresholds: a11y>=95, seo>=90)"
    fi
  else
    G7_STATUS="FAIL (dev server unreachable: $url)"
    FAIL=1
    echo "  - G7 FAIL - dev server unreachable ($url)"
  fi
fi

# ---------- G1 visual regression final ----------
echo ""
echo "[G1] visual regression final (section=${section})"
G1_BASELINE_DIR="baselines/${section}"
if [ "${LITE:-0}" = "1" ]; then
  if [ "${ALLOW_G1_LITE:-0}" = "1" ] && [ "$MODE" != "figma" ]; then
    echo "  - LITE=1 - strict visual opt-out (G1 lite)"
    G1_JSON=$(node "${SCRIPT_DIR}/check-visual-regression.mjs" \
      --section "$section" \
      --baseline "${BASELINE:-${G1_BASELINE_DIR}/desktop.png}" \
      --preview-base "$PREVIEW_BASE_URL" \
      --viewport "${VIEWPORT}" 2>/tmp/g1.err || true)
  else
    G1_JSON='{"section":"'"$section"'","status":"FAIL","reason":"LITE=1 is not allowed for final figma publishing quality gates; prepare strict baselines and rerun without LITE","strictEffective":false}'
  fi
elif [ -d "$G1_BASELINE_DIR" ]; then
  AVAIL_VIEWPORTS=""
  for v in desktop tablet mobile; do
    if [ -f "${G1_BASELINE_DIR}/${v}.png" ]; then
      AVAIL_VIEWPORTS="${AVAIL_VIEWPORTS}${AVAIL_VIEWPORTS:+,}${v}"
    fi
  done
  if [ -z "$AVAIL_VIEWPORTS" ]; then
    AVAIL_VIEWPORTS="desktop"
  fi
  G1_JSON=$(node "${SCRIPT_DIR}/check-visual-regression.mjs" \
    --section "$section" \
    --baseline-dir "$G1_BASELINE_DIR" \
    --preview-base "$PREVIEW_BASE_URL" \
    --viewports "$AVAIL_VIEWPORTS" \
    --strict 2>/tmp/g1.err || true)
else
  G1_JSON='{"section":"'"$section"'","status":"FAIL","reason":"baselines/'"$section"'/ missing - run prepare-baseline.mjs before final visual gate","strictEffective":false}'
fi

G1_RAW_STATUS=$(echo "$G1_JSON" | node -e "let j='';process.stdin.on('data',d=>j+=d);process.stdin.on('end',()=>{try{process.stdout.write(JSON.parse(j).status||'')}catch(e){}})" 2>/dev/null)
case "$G1_RAW_STATUS" in
  PASS)
    G1_STATUS="PASS"; G1_DETAIL="$G1_JSON"
    echo "  - G1 PASS"
    ;;
  FAIL)
    G1_STATUS="FAIL"; G1_DETAIL="$G1_JSON"; FAIL=1
    echo "  - G1 FAIL"
    echo "    $G1_JSON"
    ;;
  SKIPPED|NO_BASELINE|BASELINE_UPDATED)
    G1_STATUS="$G1_RAW_STATUS"; G1_DETAIL="$G1_JSON"
    if [ "$MODE" = "figma" ]; then
      G1_STATUS="FAIL"
      FAIL=1
    fi
    echo "  - G1 $G1_RAW_STATUS"
    ;;
  *)
    G1_STATUS="SKIP"; G1_DETAIL='{"status":"SKIP","reason":"script error"}'
    cat /tmp/g1.err 2>/dev/null || true
    echo "  - G1 SKIP"
    ;;
esac

if [ -z "$G1_DETAIL" ]; then
  G1_DETAIL_JSON="\"$G1_STATUS\""
else
  G1_DETAIL_JSON="$G1_DETAIL"
fi

if [ -n "${G12_JSON:-}" ]; then
  G12_DETAIL_JSON="$G12_JSON"
else
  G12_DETAIL_JSON='{"status":"SKIP","failures":[],"warnings":[]}'
fi

cat > "$OUT" <<EOF
{
  "section": "$section",
  "dir": "$dir",
  "viewport": "$VIEWPORT",
  "gate_order": ["G10", "G4", "G11", "G12", "G5", "G6/G8", "G7", "G1"],
  "G1_visual_regression": $G1_DETAIL_JSON,
  "G1_status": "$G1_STATUS",
  "G4_token_usage": "$G4_STATUS",
  "G5_semantic_html": "$G5_STATUS",
  "G6_text_image_ratio": "$G6_STATUS",
  "G7_lighthouse": "$G7_STATUS",
  "G8_i18n": "$G8_STATUS",
  "G10_write_protection": "$G10_STATUS",
  "G11_layout_escapes": "$G11_STATUS",
  "G12_reusability": "$G12_STATUS",
  "G12_detail": $G12_DETAIL_JSON
}
EOF

if [ -f "progress.json" ]; then
  node "${SCRIPT_DIR}/progress-update.mjs" record-gate-result \
    --section "${section}" \
    --result-file "${OUT}" 2>/dev/null \
    || echo "[measure-quality] progress.json update failed; run record-gate-result manually"
  node "${SCRIPT_DIR}/progress-render.mjs" 2>/dev/null || true
fi

echo ""
echo "=================================="
echo "Result saved: $OUT"
if [ "$FAIL" -eq 0 ]; then
  echo "PASS: G10/G4/G11/G12/G5/G6/G8/G7/G1 completed"
  exit 0
else
  echo "FAIL: one or more quality gates failed"
  mkdir -p ".publish-harness"
  G1_STATUS_ENV="$G1_STATUS" \
  G4_STATUS_ENV="$G4_STATUS" \
  G5_STATUS_ENV="$G5_STATUS" \
  G6_STATUS_ENV="$G6_STATUS" \
  G7_STATUS_ENV="$G7_STATUS" \
  G8_STATUS_ENV="$G8_STATUS" \
  G10_STATUS_ENV="$G10_STATUS" \
  G11_STATUS_ENV="$G11_STATUS" \
  G12_STATUS_ENV="$G12_STATUS" \
  QUALITY_RESULT_ENV="$OUT" \
  node - "$INCOMPLETE_SENTINEL" "$section" <<'NODE'
const { writeFileSync } = require('node:fs');
const [path, section] = process.argv.slice(2);
const gateFields = {
  G1: process.env.G1_STATUS_ENV,
  G4: process.env.G4_STATUS_ENV,
  G5: process.env.G5_STATUS_ENV,
  G6: process.env.G6_STATUS_ENV,
  G7: process.env.G7_STATUS_ENV,
  G8: process.env.G8_STATUS_ENV,
  G10: process.env.G10_STATUS_ENV,
  G11: process.env.G11_STATUS_ENV,
  G12: process.env.G12_STATUS_ENV,
};
const failures = Object.entries(gateFields)
  .filter(([, status]) => !String(status || "").startsWith("PASS"))
  .map(([gate, status]) => ({
    code: `${gate}_NOT_PASSING`,
    gate,
    status: status || "MISSING",
    message: `${gate} is ${status || "MISSING"}`,
  }));
writeFileSync(path, JSON.stringify({
  status: "BLOCKED_INCOMPLETE",
  requiredFinalPrefix: "BLOCKED/INCOMPLETE: publish-harness completion contract failed.",
  forbiddenCompletionClaims: ["completed", "done", "finished", "implemented", "published", "\uC644\uB8CC", "\uC644\uB8CC\uD588\uC2B5\uB2C8\uB2E4", "\uAD6C\uD604 \uC644\uB8CC", "\uD37C\uBE14\uB9AC\uC2F1 \uC644\uB8CC", "\uBC18\uC601\uD588\uC2B5\uB2C8\uB2E4"],
  blockedIsTerminalOnlyWhen: "external blocker or explicit user stop; otherwise continue fixing until completion contract passes",
  message: "measure-quality.sh failed; publishing is incomplete.",
  section,
  qualityResult: process.env.QUALITY_RESULT_ENV,
  failures,
  updatedAt: new Date().toISOString(),
}, null, 2) + "\n", "utf8");
NODE
  echo "BLOCKED/INCOMPLETE: publish-harness completion contract failed."
  echo "Do not report completed/done/finished/implemented/published or completion claims."
  echo "Blocked is not terminal unless there is an external blocker or explicit user stop."
  echo "Fix the failed gates, rerun measure-quality.sh for every route/page, then run:"
  echo "  node scripts/assert-completion-contract.mjs"
  exit 1
fi

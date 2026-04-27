# G10 Write-Protected Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** `section-worker.md` §금지 절을 머신리더블 SSoT 로 옮기고, `measure-quality.sh` 의 신규 G10 블록으로 통합해 워커의 write-protected paths 위반을 결정적으로 차단.

**Architecture:** SSoT JSON (`scripts/write-protected-paths.json`) → `scripts/check-write-protection.mjs` 가 git diff 로 변경 path 검사 → `measure-quality.sh` G10 블록이 호출. 모든 기존 게이트 무수정 호환.

**Tech Stack:** Node 18+, ES modules, `node:child_process` (git diff), JSON only.

**Spec:** [`docs/superpowers/specs/2026-04-27-g10-write-protected-paths-design.md`](../specs/2026-04-27-g10-write-protected-paths-design.md)

---

## File Structure

| 파일 | 책임 | Task |
|---|---|---|
| `scripts/write-protected-paths.json` | SSoT — 보호 path 리스트 | T1 |
| `scripts/check-write-protection.mjs` | G10 검출 스크립트 | T2 |
| `tests/fixtures/g10/*` | PASS/FAIL fixture (commit hash 또는 임시 git repo) | T2 |
| `scripts/measure-quality.sh` | G10 블록 추가 | T3 |
| `scripts/bootstrap.sh` | 신규 2 파일 복사 추가 | T4 |
| `.claude/agents/section-worker.md` | §금지 절을 SSoT 인용으로 변경 | T5 |
| smoke-modern-retro / publish-harness | 회귀 검증 | T6 |
| `README.md` / `docs/template-support-matrix.md` / `CLAUDE.md` | 게이트 매트릭스 갱신 | T7 |

---

### Task 1: SSoT JSON 작성

- [ ] **Step 1: scripts/write-protected-paths.json 작성**

```json
{
  "version": 1,
  "description": "Write-protected paths — workers must never modify. Enforced by G10 (check-write-protection.mjs).",
  "paths": [
    "src/styles/tokens.css",
    "public/css/tokens.css",
    "src/styles/fonts.css",
    "public/css/fonts.css",
    "tailwind.config.js",
    "tailwind.config.ts",
    "docs/components-spec.md",
    "docs/handoff-README.md",
    "public/css/main.css"
  ]
}
```

- [ ] **Step 2: JSON parse 검증**

Run:
```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('scripts/write-protected-paths.json','utf8')).paths.length)"
```
Expected: `9`

---

### Task 2: G10 검출 스크립트 + fixture

- [ ] **Step 1: scripts/check-write-protection.mjs 작성**

```javascript
#!/usr/bin/env node
/**
 * G10 — write-protected paths 게이트.
 *
 * Usage:
 *   node scripts/check-write-protection.mjs [options]
 *     --paths <json>   SSoT JSON 경로 (default: scripts/write-protected-paths.json)
 *     --base <commit>  비교 기준 (default: HEAD)
 *     --head <commit>  검사 대상 (default: working tree)
 *
 * 동작:
 *   - 기본: working tree 의 변경 (staged + unstaged + commit 된 변경) 을 HEAD 기준 검사
 *   - --base / --head 명시 시 두 commit 사이 diff 검사
 *
 * 종료 코드: 0 PASS, 1 FAIL, 2 usage error.
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    paths: "scripts/write-protected-paths.json",
    base: "HEAD",
    head: null,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--paths") opts.paths = args[++i];
    else if (args[i] === "--base") opts.base = args[++i];
    else if (args[i] === "--head") opts.head = args[++i];
    else if (args[i] === "-h" || args[i] === "--help") {
      console.error("usage: check-write-protection.mjs [--paths <json>] [--base <commit>] [--head <commit>]");
      process.exit(2);
    } else {
      console.error(`ERROR: unknown arg: ${args[i]}`);
      process.exit(2);
    }
  }
  return opts;
}

function loadProtected(jsonPath) {
  let data;
  try {
    data = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch (e) {
    console.error(`ERROR: cannot read SSoT JSON ${jsonPath}: ${e.message}`);
    process.exit(2);
  }
  if (!Array.isArray(data.paths)) {
    console.error(`ERROR: invalid SSoT — 'paths' must be array`);
    process.exit(2);
  }
  return new Set(data.paths.map(p => p.replace(/\\/g, "/")));
}

function git(args) {
  try {
    return execSync(`git ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    return "";
  }
}

function changedFiles(base, head) {
  let lines;
  if (head) {
    // 두 commit 사이 diff
    lines = git(`diff ${base} ${head} --name-only`).split("\n");
  } else {
    // base..working tree (staged + unstaged + commit since base)
    const a = git(`diff ${base} --name-only`).split("\n");
    const b = git(`diff --name-only`).split("\n");
    const c = git(`diff --cached --name-only`).split("\n");
    lines = [...a, ...b, ...c];
  }
  return new Set(lines.map(s => s.trim().replace(/\\/g, "/")).filter(Boolean));
}

function main() {
  const opts = parseArgs();
  const protectedSet = loadProtected(opts.paths);
  const changed = changedFiles(opts.base, opts.head);

  const violations = [...protectedSet].filter(p => changed.has(p));
  const report = {
    base: opts.base,
    head: opts.head ?? "WORKING_TREE",
    protected_count: protectedSet.size,
    changed_count: changed.size,
    violations,
    status: violations.length === 0 ? "PASS" : "FAIL",
  };
  console.log(JSON.stringify(report, null, 2));

  if (violations.length > 0) {
    console.error(
      `\n❌ G10 FAIL — write-protected paths 변경 발견 (${violations.length}):\n` +
        violations.map(v => `  - ${v}`).join("\n") +
        `\n워커 §금지 위반. 정당한 변경이면 오케스트레이터 직접 수정.`
    );
    process.exit(1);
  }
  console.error(`✓ G10 PASS — write-protected paths 변경 없음`);
  process.exit(0);
}

main();
```

- [ ] **Step 2: chmod**

Run: `chmod +x scripts/check-write-protection.mjs`

- [ ] **Step 3: PASS fixture — 임시 git repo 에서 보호 외 파일만 변경**

```bash
TMP="$(mktemp -d)" && cd "$TMP" && git init -q && \
  cp "$OLDPWD/scripts/write-protected-paths.json" . && \
  echo "hello" > foo.txt && git add . && git commit -q -m "init" && \
  echo "world" > bar.txt && git add bar.txt && \
  node "$OLDPWD/scripts/check-write-protection.mjs" --paths write-protected-paths.json
echo "exit=$?"
cd "$OLDPWD"; rm -rf "$TMP"
```

Expected: `✓ G10 PASS`, exit 0.

- [ ] **Step 4: FAIL fixture — protected 파일 변경**

```bash
TMP="$(mktemp -d)" && cd "$TMP" && git init -q && \
  cp "$OLDPWD/scripts/write-protected-paths.json" . && \
  mkdir -p public/css && echo "/* tokens */" > public/css/tokens.css && \
  git add . && git commit -q -m "init" && \
  echo "/* hacked */" >> public/css/tokens.css && \
  node "$OLDPWD/scripts/check-write-protection.mjs" --paths write-protected-paths.json
echo "exit=$?"
cd "$OLDPWD"; rm -rf "$TMP"
```

Expected: `❌ G10 FAIL`, exit 1, violations 에 `public/css/tokens.css`.

- [ ] **Step 5: Commit**

```bash
git add scripts/write-protected-paths.json scripts/check-write-protection.mjs
git commit -m "feat(G10): SSoT JSON + check-write-protection.mjs 게이트 스크립트"
```

---

### Task 3: measure-quality.sh G10 블록 통합

- [ ] **Step 1: G10 변수 초기화 추가**

기존 변수 초기화 (`G7_STATUS="SKIP"` 부근) 다음에:

```bash
G10_STATUS="SKIP"
```

- [ ] **Step 2: G10 블록 추가**

G7 (Lighthouse) 블록 직후에:

```bash
# ---------- G10 write-protected paths ----------
echo ""
echo "[G10] write-protected paths"
G10_PATHS_JSON="${SCRIPT_DIR}/write-protected-paths.json"
if [ ! -f "$G10_PATHS_JSON" ]; then
  echo "  ⚠ G10 SKIP — SSoT JSON 없음 ($G10_PATHS_JSON)"
elif node "${SCRIPT_DIR}/check-write-protection.mjs" --paths "$G10_PATHS_JSON" 2>/tmp/g10.err; then
  G10_STATUS="PASS"
  echo "  ✓ G10 PASS"
else
  G10_STATUS="FAIL"
  FAIL=1
  cat /tmp/g10.err
  echo "  ❌ G10 FAIL"
fi
```

- [ ] **Step 3: JSON 결과에 G10 필드 추가**

기존 JSON 출력의 `G8_i18n` 다음 라인 (마지막 닫는 `}` 직전) 에:

```bash
  "G8_i18n": "$G8_STATUS",
  "G10_write_protection": "$G10_STATUS"
}
```

(기존 `"G8_i18n": "$G8_STATUS"` 끝에 콤마 추가 필요 — 마지막 줄이었으면 수정)

- [ ] **Step 4: PASS 메시지 갱신**

```bash
echo "✓ G4/G5/G6/G8/G10 PASS (G1/G7 환경별)"
```

- [ ] **Step 5: 검증 — 정상 commit 후 G10 PASS**

```bash
# publish-harness 자체에서 dummy 검증
cd "$(mktemp -d)" && git init -q && \
  cp -r ~/workspace/publish-harness/templates/html-static/. . && \
  cp ~/workspace/publish-harness/scripts/check-write-protection.mjs scripts/ 2>/dev/null || mkdir -p scripts && cp ~/workspace/publish-harness/scripts/check-write-protection.mjs scripts/
cp ~/workspace/publish-harness/scripts/write-protected-paths.json scripts/
git add . && git commit -q -m "init"
mkdir -p public/__preview/dummy && echo '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>x</title></head><body><section><h1>안녕</h1><p>본문 텍스트가 적정합니다.</p></section></body></html>' > public/__preview/dummy/index.html
node ~/workspace/publish-harness/scripts/check-write-protection.mjs --paths scripts/write-protected-paths.json
echo "exit=$?"
```

Expected: `✓ G10 PASS`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/measure-quality.sh
git commit -m "feat(G10): measure-quality.sh 에 G10 블록 통합"
```

---

### Task 4: bootstrap.sh 가 신규 2 파일 복사

- [ ] **Step 1: scripts 복사 블록에 추가**

`scripts/bootstrap.sh` 의 `# ---------- 4. scripts/ 복사 ----------` 블록에서 기존 `cp` 라인들 사이에 추가:

```bash
cp "$HARNESS_DIR/scripts/check-write-protection.mjs" scripts/
cp "$HARNESS_DIR/scripts/write-protected-paths.json" scripts/
```

- [ ] **Step 2: 검증 — bootstrap 후 두 파일 존재**

```bash
TMP="$(mktemp -d)" && cd "$TMP" && \
  bash ~/workspace/publish-harness/scripts/bootstrap.sh --mode figma --template html-static \
    https://www.figma.com/design/DUMMY/X >/dev/null 2>&1 && \
  ls scripts/check-write-protection.mjs scripts/write-protected-paths.json
cd "$OLDPWD"; rm -rf "$TMP"
```

Expected: 두 파일 출력.

- [ ] **Step 3: Commit**

```bash
git add scripts/bootstrap.sh
git commit -m "feat(G10): bootstrap.sh 가 G10 게이트 스크립트 + SSoT JSON 복사"
```

---

### Task 5: section-worker.md §금지 머신리더블 인용

- [ ] **Step 1: §금지 절 첫 항목 변경**

기존:
```markdown
- ❌ tokens.css / fonts.css / tailwind.config.js|ts 수정 (figma 모드는 extract-tokens.sh, spec 모드는 bootstrap 이 씀)
```

다음으로 교체:
```markdown
- ❌ **`scripts/write-protected-paths.json` 에 명시된 모든 path 수정** (G10 게이트가 차단)
  - 현재 보호: tokens.css / fonts.css / tailwind.config.{js,ts} / components-spec.md / handoff-README.md / public/css/main.css
  - 정당한 작성자만 수정: extract-tokens.sh (figma 모드 토큰) / bootstrap.sh (spec 모드 handoff 복사 또는 템플릿 default)
  - **누락된 토큰 발견 시**: tokens.css 수정 X, 가장 가까운 기존 토큰 사용 + 반환 JSON 의 notes 에 기록 → 오케스트레이터가 extract-tokens 재실행 결정
```

- [ ] **Step 2: §게이트 표에 G10 추가**

§4. 품질 게이트 의 게이트 리스트에 추가:

```markdown
- **G10** write-protected paths 차단 (`check-write-protection.mjs`) — 워커가 tokens.css 등 SSoT 파일 수정했으면 FAIL
```

- [ ] **Step 3: §feedback-loop 카테고리 표에 추가**

§feedback-loop — 실패 카테고리 표에 한 행:

```markdown
| `WRITE_PROTECTION` | G10 | tokens.css / fonts.css / tailwind.config / components-spec.md 등 SSoT 수정 | 변경분 revert (`git checkout HEAD -- <path>`), notes 에 사유 기록, 가장 가까운 기존 토큰 사용 |
```

- [ ] **Step 4: 검증 — 키워드 검색**

```bash
grep -c "write-protected-paths.json\|WRITE_PROTECTION\|G10" .claude/agents/section-worker.md
```

Expected: 3+ (§금지 1 + §게이트 1 + §feedback-loop 1)

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/section-worker.md
git commit -m "feat(G10): section-worker.md §금지/§게이트/§feedback-loop 에 G10 추가"
```

---

### Task 6: 회귀 검증 — home-flavors commit

- [ ] **Step 1: smoke-modern-retro 에 신규 스크립트 동기화**

```bash
cp ~/workspace/publish-harness/scripts/check-write-protection.mjs ~/workspace/smoke-modern-retro/scripts/
cp ~/workspace/publish-harness/scripts/write-protected-paths.json ~/workspace/smoke-modern-retro/scripts/
```

- [ ] **Step 2: home-flavors commit (cebf92c) 의 변경에 G10 적용**

```bash
cd ~/workspace/smoke-modern-retro
node scripts/check-write-protection.mjs --base cebf92c~1 --head cebf92c
echo "exit=$?"
```

Expected: `❌ G10 FAIL`, exit 1, violations 에 `public/css/tokens.css`. (이게 핵심 회귀 — 게이트가 의도대로 작동했다면 home-flavors 시점에 차단됐을 것)

- [ ] **Step 3: 다른 home-* commit 들은 G10 PASS 인지 확인**

```bash
for c in aac17c1 ed5b0c5 e19ab72 7c97e4f aeffaec 899c706 4112f2f; do
  echo -n "$c: "
  node scripts/check-write-protection.mjs --base $c~1 --head $c 2>&1 | grep -E "PASS|FAIL" | tail -1
done
```

Expected: 모두 PASS (cebf92c 만 FAIL).

- [ ] **Step 4: 검증 결과를 publish-harness 매트릭스 §변경 이력에 추가** (Task 7 와 함께)

---

### Task 7: 매트릭스 + README + CLAUDE.md 갱신 + push

- [ ] **Step 1: docs/template-support-matrix.md §변경 이력에 추가**

```markdown
- 2026-04-27: G10 write-protected paths 게이트 신설. SSoT (`scripts/write-protected-paths.json`) + `check-write-protection.mjs` + `measure-quality.sh` G10 블록. `section-worker.md` §금지 절을 SSoT 직접 인용으로 머신리더블화. 회귀 검증: `home-flavors` commit (`cebf92c`) 의 `public/css/tokens.css` 변경이 G10 FAIL 로 잡힘 ✓. 다른 home-* 7 commit 은 모두 G10 PASS.
```

- [ ] **Step 2: README 게이트 표에 G10 추가**

§게이트 표:

```markdown
| G10 | write-protected paths | `check-write-protection.mjs` | 차단 (tokens.css 등 SSoT 수정 차단) |
```

- [ ] **Step 3: CLAUDE.md §게이트 차단 게이트 표에 G10 추가**

```markdown
| G10 | `check-write-protection.mjs` | tokens.css / fonts.css / tailwind.config / components-spec.md 등 SSoT 수정 차단 |
```

- [ ] **Step 4: Commit + push**

```bash
git add README.md docs/template-support-matrix.md CLAUDE.md
git commit -m "docs(G10): 게이트 표에 G10 추가, 매트릭스 §변경 이력 갱신"
git push origin main
```

---

## Self-Review

**1. Spec coverage:**
- §3 보호 대상 → T1 ✓
- §4 SSoT → T1 ✓
- §5 검출 메커니즘 → T2 ✓
- §6 measure-quality 통합 → T3 ✓
- §7 bootstrap 확장 → T4 ✓
- §8 section-worker 변경 → T5 ✓
- §11 첫 회귀 검증 → T6 ✓

**2. Placeholder 스캔:** 모든 step 코드/명령 명시. fixture 도 임시 git repo 로 자체 완결.

**3. Type 일관성:** `--paths` / `--base` / `--head` CLI 옵션 T2 와 T6 에서 동일 사용.

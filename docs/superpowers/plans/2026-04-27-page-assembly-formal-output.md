# 페이지 통합본 정식 산출 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** D1 보강 — `public/{page}.html` 을 정식 산출물로 격상. 섹션 단독 preview 는 G1/G7 측정·디버그용으로 유지.

**Architecture:** `assemble-page-preview.mjs` CLI 를 `--page/--sections/--out` 으로 변경 + default 경로 자동 결정. SKILL.md Phase 4 에서 자동 호출. 기존 게이트·워커 모델 무수정.

**Tech Stack:** Node 18+, ES modules, `node-html-parser`.

**Spec:** [`docs/superpowers/specs/2026-04-27-page-assembly-formal-output.md`](../specs/2026-04-27-page-assembly-formal-output.md)

---

## Tasks

### T1 — `assemble-page-preview.mjs` CLI + default 경로

**Files:** `scripts/assemble-page-preview.mjs`

- [ ] **Step 1: 신규 인자 파싱**

기존 positional `(page, sectionsCsv)` 방식을 `--page` / `--sections` / `--out` 으로. positional 도 받되 stderr 경고.

코드 핵심부 교체:
```javascript
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { page: null, sections: null, out: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--page") opts.page = args[++i];
    else if (args[i] === "--sections") opts.sections = args[++i];
    else if (args[i] === "--out") opts.out = args[++i];
    else if (args[i] === "-h" || args[i] === "--help") {
      console.error("usage: assemble-page-preview.mjs --page <name> --sections <s1,s2,...> [--out <path>]");
      process.exit(2);
    } else if (!args[i].startsWith("--")) {
      // legacy positional — deprecation 경고
      if (opts.page === null) {
        opts.page = args[i];
        console.error("⚠ DEPRECATION: positional <page> arg. Use --page <name>");
      } else if (opts.sections === null) {
        opts.sections = args[i];
        console.error("⚠ DEPRECATION: positional <sections> arg. Use --sections <s1,s2,...>");
      } else {
        console.error(`ERROR: too many positional args: ${args[i]}`);
        process.exit(2);
      }
    } else {
      console.error(`ERROR: unknown arg: ${args[i]}`);
      process.exit(2);
    }
  }
  if (!opts.page || !opts.sections) {
    console.error("usage: assemble-page-preview.mjs --page <name> --sections <s1,s2,...> [--out <path>]");
    process.exit(2);
  }
  if (!opts.out) {
    opts.out = opts.page === "home" ? "public/index.html" : `public/${opts.page}.html`;
  }
  return opts;
}
```

- [ ] **Step 2: main 함수에서 신규 출력 경로 사용**

기존:
```javascript
mkdirSync("public/__assembled", { recursive: true });
const outPath = `public/__assembled/${page}.html`;
writeFileSync(outPath, out);
```

신규:
```javascript
import { dirname } from "node:path";
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, out);
```

(`outPath = opts.out`, dirname 으로 디렉토리 자동 생성)

- [ ] **Step 3: 검증**

```bash
TMP="$(mktemp -d)" && cd "$TMP" && \
  mkdir -p public/__preview/foo public/__preview/bar && \
  echo '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>foo</title></head><body><section id="foo"><h1>Foo</h1></section></body></html>' > public/__preview/foo/index.html && \
  echo '<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>bar</title></head><body><section id="bar"><h1>Bar</h1></section></body></html>' > public/__preview/bar/index.html && \
  npm init -y >/dev/null && npm install --silent --no-audit --no-fund node-html-parser >/dev/null && \
  node "$OLDPWD/scripts/assemble-page-preview.mjs" --page home --sections foo,bar && \
  ls public/index.html && \
  node "$OLDPWD/scripts/assemble-page-preview.mjs" --page about --sections foo,bar && \
  ls public/about.html
cd "$OLDPWD"; rm -rf "$TMP"
```

Expected: `public/index.html` (home → root) + `public/about.html` (그 외).

- [ ] **Step 4: Commit**

```bash
git add scripts/assemble-page-preview.mjs
git commit -m "feat(C-M1): assemble-page-preview --page/--sections/--out + default 경로 (home→index.html)"
```

---

### T2 — `templates/html-static/.gitignore` 부수 fix

**Files:** `templates/html-static/.gitignore`

- [ ] **Step 1: .gitignore 작성**

```
node_modules/
dist/
build/
.DS_Store
Thumbs.db
*.log
.env
.env.local
coverage/

# 워커 임시
figma-screenshots/
/tmp/
.lighthouseci/

# IDE
.idea/
.vscode/
*.swp
```

- [ ] **Step 2: bootstrap dry-run 으로 부트 후 .gitignore 존재 확인**

```bash
TMP="$(mktemp -d)" && cd "$TMP" && \
  bash C:/Users/softpuzzle/workspace/publish-harness/scripts/bootstrap.sh --mode figma --template html-static \
    https://www.figma.com/design/DUMMY/X >/dev/null 2>&1 && \
  cat .gitignore | head -3
cd C:/Users/softpuzzle/workspace/publish-harness; rm -rf "$TMP"
```

Expected: `node_modules/` 가 첫 줄.

- [ ] **Step 3: Commit**

```bash
git add templates/html-static/.gitignore
git commit -m "feat(C-M2 fix): templates/html-static/.gitignore 누락 보강"
```

---

### T3 — SKILL.md / section-worker.md / workflow.md 갱신

**Files:** `.claude/skills/publish-harness/SKILL.md`, `.claude/agents/section-worker.md`, `docs/workflow.md`

- [ ] **Step 1: SKILL.md Phase 4 에 어셈블리 단계 추가**

`Phase 4 — 통합 검증` 절에 template: html-static 한정 sub-step 추가 (실제 위치는 SKILL.md 의 Phase 4 절 안 — Read 후 적절한 위치에 Edit):

```markdown
### template: html-static — 페이지 어셈블리 (Phase 4 추가 단계)

페이지의 모든 섹션 G4-G8 PASS 후, 페이지 통합본 생성:

```bash
node scripts/assemble-page-preview.mjs \
  --page <page-name> \
  --sections <section1,section2,...>
```

기본 출력: `public/index.html` (home) 또는 `public/<page>.html`.
사용자 가시 페이지 + 배포 산출물. 섹션 단독 preview (`public/__preview/<section>/`)
는 게이트 측정·디버그·retry 단위로 유지.

자동 commit: `feat(<page>): 페이지 통합본 어셈블리 (X 섹션)`
```

- [ ] **Step 2: section-worker.md §template: html-static §게이트 끝에 한 줄 추가**

```markdown
**참고**: 워커는 섹션 단위 게이트만 책임. 페이지 통합본 (`public/{page}.html`) 은
페이지 마지막 섹션 완료 후 오케스트레이터가 `assemble-page-preview.mjs` 직접 호출 — 워커는 어셈블리 호출 안 함.
```

- [ ] **Step 3: workflow.md 의 §Template 분기 끝에 한 줄 추가**

```markdown
**html-static 추가 빌드 단계**: 페이지의 모든 섹션 PASS 후
`node scripts/assemble-page-preview.mjs --page <name> --sections <list>` 로
정식 페이지 산출물 (`public/<name>.html`) 생성. 섹션 preview 는 G1/G7 측정 및
디버그 단위로 유지.
```

- [ ] **Step 4: 검증**

```bash
grep -c "assemble-page-preview" .claude/skills/publish-harness/SKILL.md \
  .claude/agents/section-worker.md docs/workflow.md
```

Expected: 3 파일 모두 1+ 출현.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/publish-harness/SKILL.md .claude/agents/section-worker.md docs/workflow.md
git commit -m "feat(C-M3): SKILL/section-worker/workflow 에 페이지 어셈블리 단계 명시"
```

---

### T4 — smoke-modern-retro 회귀 검증

**Files:** smoke-modern-retro/scripts/assemble-page-preview.mjs (재동기화)

- [ ] **Step 1: smoke 에 신규 스크립트 동기화**

```bash
cp C:/Users/softpuzzle/workspace/publish-harness/scripts/assemble-page-preview.mjs $HOME/workspace/smoke-modern-retro/scripts/
```

- [ ] **Step 2: 정식 페이지 어셈블리 실행**

```bash
cd $HOME/workspace/smoke-modern-retro
node scripts/assemble-page-preview.mjs \
  --page home \
  --sections home-header,home-cta,home-about,home-featured,home-product-grid,home-flavors,home-stocklist,home-footer
ls public/index.html
```

Expected: `public/index.html` 생성됨.

- [ ] **Step 3: 기존 임시 어셈블리 정리**

```bash
rm -rf public/__assembled
```

- [ ] **Step 4: 서버 응답 검증**

(서버 5176 이미 돌고 있음)

```bash
curl -sf -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:5176/
```

Expected: HTTP 200 (home → public/index.html 자동 매핑).

- [ ] **Step 5: smoke commit**

```bash
cd $HOME/workspace/smoke-modern-retro
git add scripts/assemble-page-preview.mjs public/index.html
git rm -r public/__assembled 2>/dev/null || true
git commit -m "feat(home): 페이지 통합본 정식 산출 (public/index.html, 8 섹션)"
```

---

### T5 — 매트릭스 / README / CLAUDE.md 갱신 + push

**Files:** `README.md`, `docs/template-support-matrix.md`, `CLAUDE.md`

- [ ] **Step 1: 매트릭스 §변경 이력 추가**

```markdown
- 2026-04-27: **D1 결정 보강 (옵션 C)** — 페이지 통합본 (`public/{page}.html`)
  을 정식 산출물로 격상. assemble-page-preview.mjs CLI 가 `--page/--sections/--out`
  옵션, default 경로 자동 결정 (home→`public/index.html`). 섹션 단독 preview 는
  G1/G7 측정·디버그 단위로 유지. SKILL.md Phase 4 에 어셈블리 단계 명시. 회귀
  검증: smoke-modern-retro 의 Home 8 섹션이 `public/index.html` 한 파일로 통합 ✓.
- 2026-04-27: 부수 fix — `templates/html-static/.gitignore` 누락 보강.
```

- [ ] **Step 2: README 게이트 표 아래 "산출물" 절 추가** (또는 기존 게이트 표에 한 줄)

```markdown
### 산출물 (template: html-static)

- 섹션 단독 preview: `public/__preview/<section>/index.html` — G1/G7 측정 + 디버그 + retry 단위
- **페이지 통합본 (정식)**: `public/index.html` (home) / `public/<page>.html` (그 외) — 사용자 시각 + 배포
- 두 산출 모두 자동 생성. 어셈블리는 페이지 모든 섹션 PASS 후 `assemble-page-preview.mjs` 가 책임.
```

- [ ] **Step 3: CLAUDE.md 의 출력 템플릿 판별 절에 한 줄 추가**

```markdown
**html-static 추가**: 섹션 산출물 외에 페이지 통합본도 정식 — `public/<page>.html`
(home 만 `public/index.html`). 어셈블리는 Phase 4 에서 `assemble-page-preview.mjs` 호출.
```

- [ ] **Step 4: Commit + push**

```bash
git add README.md docs/template-support-matrix.md CLAUDE.md
git commit -m "docs(C-M4): D1 보강 — 페이지 통합본 정식 산출, 매트릭스/README/CLAUDE.md 갱신"
git push origin main
```

---

## Self-Review

- 모든 step 코드/명령 명시 ✓
- 호환성: positional 인자 deprecation 경고로 기존 호출도 동작 ✓
- 회귀 검증: smoke-modern-retro 8 섹션 → `public/index.html` 200 ✓
- type 일관성: `--page` / `--sections` / `--out` 모든 단계 동일 사용

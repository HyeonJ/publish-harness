# `figma × html-static` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `templates/html-static/` 출력 템플릿과 그에 맞는 게이트/스크립트/문서를 추가해 publish-harness 가 `figma × html-static` 조합을 지원하게 한다.

**Architecture:** 기존 `figma × vite-react-ts` 워크플로 무수정 보존. 신규 템플릿은 정적 HTML/CSS 산출물(`public/__preview/{section}/index.html` 단위) 을 만들고, `node-html-parser` 기반 G4/G6/G8 게이트 스크립트와 `@html-eslint` G5 설정을 추가. `bootstrap.sh` / `measure-quality.sh` / `section-worker.md` 는 `docs/project-context.md` 의 `template:` 필드로 분기.

**Tech Stack:** Node 18+, ES modules, `node-html-parser`, `@html-eslint/parser` + `@html-eslint/eslint-plugin`, `serve`, ESLint v8.57 (현 템플릿과 동일).

**Spec:** [`docs/superpowers/specs/2026-04-27-figma-html-static-design.md`](../specs/2026-04-27-figma-html-static-design.md)

---

## File Structure

새로 만들거나 수정하는 파일을 한 표로:

| 파일 | 책임 | Task |
|---|---|---|
| `templates/html-static/package.json` | devDeps + dev script | T1 |
| `templates/html-static/.eslintrc.json` | @html-eslint config (G5) | T1 |
| `templates/html-static/.gitattributes` | LF/CRLF 통일 | T1 |
| `templates/html-static/PROGRESS.md.tmpl` | bootstrap 진행 추적 템플릿 | T1 |
| `templates/html-static/public/css/main.css` | 글로벌 reset/타이포 | T1 |
| `templates/html-static/public/index.html` | 섹션 인덱스 placeholder | T1 |
| `templates/html-static/public/__preview/.gitkeep` | 마운트 지점 | T1 |
| `scripts/check-token-usage-html.mjs` | G4 (HTML/CSS hex 검출) | T2 |
| `scripts/check-text-ratio-html.mjs` | G6+G8 (text/alt ratio + i18n) | T3 |
| `tests/fixtures/html-static/*` | 게이트 스크립트 단위 fixture | T2, T3 |
| `scripts/bootstrap.sh` | `--template` 플래그 분기 | T4 |
| `scripts/measure-quality.sh` | `template:` 필드 자동 조회 + 분기 | T5 |
| `docs/project-context.md.tmpl` | `template:` / `preview_base_url:` 신규 필드 | T6 |
| `.claude/agents/section-worker.md` | html-static 서브섹션 추가 | T7 |
| `docs/workflow.md` | template 분기 한 줄 추가 | T8 |
| `README.md`, `docs/template-support-matrix.md` | Stage 2 완료 표시 | T11 (Phase 5) |
| `CLAUDE.md` | template 분기 명시 | T11 (Phase 5) |

---

### Task 1: `templates/html-static/` 골격 생성 (M1)

**Files:**
- Create: `templates/html-static/package.json`
- Create: `templates/html-static/.eslintrc.json`
- Create: `templates/html-static/.gitattributes`
- Create: `templates/html-static/PROGRESS.md.tmpl`
- Create: `templates/html-static/public/css/main.css`
- Create: `templates/html-static/public/index.html`
- Create: `templates/html-static/public/__preview/.gitkeep`

- [ ] **Step 1: package.json 작성**

```json
{
  "name": "publish-harness-html-static-template",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "serve -l 5173 public",
    "lint": "eslint public",
    "lint:fix": "eslint public --fix"
  },
  "devDependencies": {
    "serve": "^14.2.4",
    "eslint": "^8.57.0",
    "@html-eslint/parser": "^0.25.0",
    "@html-eslint/eslint-plugin": "^0.25.0",
    "node-html-parser": "^6.1.13"
  }
}
```

- [ ] **Step 2: .eslintrc.json 작성**

```json
{
  "parser": "@html-eslint/parser",
  "plugins": ["@html-eslint"],
  "rules": {
    "@html-eslint/require-img-alt": "error",
    "@html-eslint/require-button-type": "error",
    "@html-eslint/require-lang": "error",
    "@html-eslint/no-inline-styles": "warn",
    "@html-eslint/require-meta-charset": "error",
    "@html-eslint/require-meta-viewport": "error",
    "@html-eslint/no-duplicate-id": "error",
    "@html-eslint/require-doctype": "error"
  },
  "overrides": [
    { "files": ["*.html"], "parser": "@html-eslint/parser" }
  ]
}
```

- [ ] **Step 3: .gitattributes 작성**

```
* text=auto
*.sh text eol=lf
*.html text eol=lf
*.css text eol=lf
*.js text eol=lf
*.json text eol=lf
*.md text eol=lf
*.png binary
*.jpg binary
*.svg text eol=lf
```

- [ ] **Step 4: PROGRESS.md.tmpl 작성**

```markdown
# {PROJECT_NAME} — Progress

**Source**: {SOURCE_INFO}
**Mode**: {MODE}
**Template**: html-static
**Bootstrapped**: $(date '+%Y-%m-%d')

## Sections

(섹션 워커가 완료할 때마다 체크박스 추가)

- [ ] (예시) home-hero
```

- [ ] **Step 5: public/css/main.css 작성**

```css
/* 글로벌 reset + 타이포. 워커는 read-only.
 * 디자인 토큰은 tokens.css 가 담당, 섹션별 스타일은 {section}.css 가 담당.
 */

*, *::before, *::after { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  font-family: var(--font-sans, system-ui, -apple-system, sans-serif);
  color: var(--text, currentColor);
  background: var(--bg, transparent);
}

img, svg { display: block; max-width: 100%; height: auto; }

button { font: inherit; cursor: pointer; }

a { color: inherit; }
```

- [ ] **Step 6: public/index.html 작성**

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="/css/tokens.css">
  <link rel="stylesheet" href="/css/main.css">
  <title>{PROJECT_NAME} — Section Index</title>
</head>
<body>
  <main>
    <h1>Section Index</h1>
    <p>섹션 워커가 완료한 미리보기 목록은 <code>public/__preview/&lt;section&gt;/</code> 에서 직접 접근하세요.</p>
  </main>
</body>
</html>
```

- [ ] **Step 7: public/__preview/.gitkeep 빈 파일 생성**

```bash
touch templates/html-static/public/__preview/.gitkeep
```

- [ ] **Step 8: M1 검증 — 골격이 부트 가능한지**

```bash
TMP="$(mktemp -d)" && cp -r templates/html-static/. "$TMP/" && cd "$TMP" \
  && npm install --silent --no-audit --no-fund \
  && (npx serve -l 5173 public >/dev/null 2>&1 &) \
  && sleep 1 \
  && curl -sf http://127.0.0.1:5173/ -o /dev/null \
  && echo "M1 PASS"
pkill -f "serve -l 5173" || true
```

Expected: `M1 PASS` 출력. curl 200.

- [ ] **Step 9: Commit M1**

```bash
git add templates/html-static
git commit -m "feat(M1): templates/html-static 골격 — package.json + eslint + main.css + index.html"
```

---

### Task 2: G4 게이트 — `check-token-usage-html.mjs` (M2)

**Files:**
- Create: `scripts/check-token-usage-html.mjs`
- Create: `tests/fixtures/html-static/g4-pass.html`
- Create: `tests/fixtures/html-static/g4-pass.css`
- Create: `tests/fixtures/html-static/g4-fail-inline.html`
- Create: `tests/fixtures/html-static/g4-fail-style-block.html`
- Create: `tests/fixtures/html-static/g4-fail.css`

- [ ] **Step 1: PASS fixture (HTML, var(--*) 만)**

`tests/fixtures/html-static/g4-pass.html`:
```html
<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>g4-pass</title></head>
<body>
  <section style="color: var(--text); background: var(--bg);">
    <h1>OK</h1>
  </section>
</body>
</html>
```

- [ ] **Step 2: PASS fixture (CSS, var(--*) + 화이트리스트)**

`tests/fixtures/html-static/g4-pass.css`:
```css
.hero { color: var(--text); background: #fff; border-color: currentColor; }
```

- [ ] **Step 3: FAIL fixture (HTML inline style hex)**

`tests/fixtures/html-static/g4-fail-inline.html`:
```html
<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>g4-fail-inline</title></head>
<body>
  <section style="color: #B84A32;">FAIL</section>
</body>
</html>
```

- [ ] **Step 4: FAIL fixture (HTML <style> 블록 hex)**

`tests/fixtures/html-static/g4-fail-style-block.html`:
```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>g4-fail-style-block</title>
  <style>.x { background: rgb(184, 74, 50); }</style>
</head>
<body><section>FAIL</section></body>
</html>
```

- [ ] **Step 5: FAIL fixture (CSS hex)**

`tests/fixtures/html-static/g4-fail.css`:
```css
.broken { color: #B84A32; }
```

- [ ] **Step 6: 단위 테스트 — PASS 케이스 실패 확인 (스크립트 없음)**

Run: `node scripts/check-token-usage-html.mjs tests/fixtures/html-static/g4-pass.html`
Expected: `Cannot find module` 에러 (스크립트 미작성).

- [ ] **Step 7: 스크립트 작성**

`scripts/check-token-usage-html.mjs`:
```javascript
#!/usr/bin/env node
/**
 * G4 게이트 (html-static 변형) — HTML 파일의 inline style/<style> 블록과 CSS 파일에서
 * 토큰 외 hex/rgb literal 검출.
 *
 * Usage:
 *   node scripts/check-token-usage-html.mjs <path> [<path> ...]
 *     path: .html 또는 .css 파일 또는 디렉토리. 여러 개 허용 (섹션 격리용).
 *
 * 종료 코드: 0 PASS, 1 FAIL, 2 usage error.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { parse as parseHtml } from "node-html-parser";

const HEX_PATTERN = /#[0-9A-Fa-f]{3,8}\b/g;
const RGB_PATTERN = /rgba?\(\s*\d+[\s,]/g;
const ALLOWED = new Set(["#fff", "#ffffff", "#FFF", "#FFFFFF", "#000", "#000000"]);

function walk(target, out = []) {
  const st = statSync(target);
  if (st.isFile()) {
    const ext = extname(target);
    if (ext === ".html" || ext === ".css") out.push(target);
    return out;
  }
  for (const entry of readdirSync(target)) {
    const full = join(target, entry);
    const st2 = statSync(full);
    if (st2.isDirectory()) walk(full, out);
    else {
      const ext = extname(full);
      if (ext === ".html" || ext === ".css") out.push(full);
    }
  }
  return out;
}

function scanCssText(text) {
  const failures = [];
  const hexes = text.match(HEX_PATTERN) || [];
  for (const h of hexes) if (!ALLOWED.has(h)) failures.push({ type: "hex-literal", value: h });
  const rgbs = text.match(RGB_PATTERN) || [];
  for (const r of rgbs) failures.push({ type: "rgb-literal", value: r.trim() });
  return failures;
}

function scanFile(file) {
  const code = readFileSync(file, "utf8");
  const ext = extname(file);
  if (ext === ".css") return scanCssText(code);
  // .html
  const failures = [];
  const root = parseHtml(code, { lowerCaseTagName: true });
  for (const styleEl of root.querySelectorAll("style")) {
    failures.push(...scanCssText(styleEl.text || ""));
  }
  for (const el of root.querySelectorAll("[style]")) {
    const s = el.getAttribute("style");
    if (s) failures.push(...scanCssText(s));
  }
  return failures;
}

function main() {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    console.error("usage: check-token-usage-html.mjs <path> [<path> ...]");
    process.exit(2);
  }
  const files = [];
  for (const t of targets) walk(t, files);
  if (files.length === 0) {
    console.error(`no .html/.css in: ${targets.join(", ")}`);
    process.exit(2);
  }
  const report = { files: files.length, failures: [] };
  let totalFail = 0;
  for (const f of files) {
    const fails = scanFile(f);
    totalFail += fails.length;
    for (const x of fails) report.failures.push({ file: relative(process.cwd(), f), ...x });
  }
  console.log(JSON.stringify(report, null, 2));
  if (totalFail > 0) {
    console.error(`\n❌ G4 FAIL — ${totalFail} hex/rgb literal 발견. tokens.css 의 var(--*) 로 치환.`);
    process.exit(1);
  }
  console.error(`✓ G4 PASS (${files.length} files)`);
  process.exit(0);
}

main();
```

- [ ] **Step 8: chmod + dependencies 확인 (root package.json 에 node-html-parser 추가)**

```bash
chmod +x scripts/check-token-usage-html.mjs
node -e "require('node-html-parser')" 2>&1 | head -3
```

`Cannot find module` 이면 root `package.json` devDeps 에 추가:

```bash
node -e "
const fs=require('fs');
const p=JSON.parse(fs.readFileSync('package.json','utf8'));
p.devDependencies = p.devDependencies || {};
if (!p.devDependencies['node-html-parser']) {
  p.devDependencies['node-html-parser'] = '^6.1.13';
  fs.writeFileSync('package.json', JSON.stringify(p,null,2)+'\n');
  console.log('added node-html-parser');
}
"
npm install --silent --no-audit --no-fund
```

- [ ] **Step 9: PASS fixture 단위 검증**

Run: `node scripts/check-token-usage-html.mjs tests/fixtures/html-static/g4-pass.html tests/fixtures/html-static/g4-pass.css`
Expected: `✓ G4 PASS` exit 0.

- [ ] **Step 10: FAIL fixture 단위 검증 (HTML inline)**

Run: `node scripts/check-token-usage-html.mjs tests/fixtures/html-static/g4-fail-inline.html; echo "exit=$?"`
Expected: `❌ G4 FAIL` + `exit=1`. report 에 `#B84A32` 항목.

- [ ] **Step 11: FAIL fixture 단위 검증 (HTML <style> 블록)**

Run: `node scripts/check-token-usage-html.mjs tests/fixtures/html-static/g4-fail-style-block.html; echo "exit=$?"`
Expected: `exit=1`, report 에 `rgb(` 항목.

- [ ] **Step 12: FAIL fixture 단위 검증 (CSS)**

Run: `node scripts/check-token-usage-html.mjs tests/fixtures/html-static/g4-fail.css; echo "exit=$?"`
Expected: `exit=1`.

- [ ] **Step 13: Commit (G4 part)**

```bash
git add scripts/check-token-usage-html.mjs tests/fixtures/html-static/g4-* package.json package-lock.json
git commit -m "feat(M2): G4 html-static — check-token-usage-html.mjs + fixtures"
```

---

### Task 3: G6/G8 게이트 — `check-text-ratio-html.mjs` (M2 cont.)

**Files:**
- Create: `scripts/check-text-ratio-html.mjs`
- Create: `tests/fixtures/html-static/g6-pass.html` (text 풍부, alt 짧음)
- Create: `tests/fixtures/html-static/g6-fail-raster.html` (img + 텍스트 < 10)
- Create: `tests/fixtures/html-static/g8-fail.html` (alt 만 있고 innerText 없음)

- [ ] **Step 1: g6-pass fixture**

`tests/fixtures/html-static/g6-pass.html`:
```html
<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>g6-pass</title></head>
<body>
  <section>
    <h1>안녕하세요. 이것은 의미있는 헤드라인입니다.</h1>
    <p>본문 텍스트가 충분히 길어서 ratio 가 통과해야 합니다. 더 길게 만들기 위해 한 문장 더 추가합니다.</p>
    <img src="bg.png" alt="logo">
  </section>
</body>
</html>
```

- [ ] **Step 2: g6-fail-raster fixture**

`tests/fixtures/html-static/g6-fail-raster.html`:
```html
<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>g6-fail-raster</title></head>
<body><section><img src="hero.png" alt="hi"></section></body>
</html>
```

- [ ] **Step 3: g8-fail fixture (alt 에만 텍스트)**

`tests/fixtures/html-static/g8-fail.html`:
```html
<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>g8-fail</title></head>
<body><section><img src="hero.png" alt="이 alt 에 모든 사용자 가시 텍스트가 있어요. 이것은 매우 긴 alt 입니다. 사용자에게 전달되어야 할 정보를 alt 에 밀어넣은 안티패턴입니다."></section></body>
</html>
```

- [ ] **Step 4: 스크립트 작성**

`scripts/check-text-ratio-html.mjs`:
```javascript
#!/usr/bin/env node
/**
 * G6 (text:image ratio + raster-heavy 휴리스틱) + G8 (i18n 가능성) 게이트
 * — html-static 변형. node-html-parser 로 .html 파싱.
 *
 * Usage: node scripts/check-text-ratio-html.mjs <path> [<path> ...]
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { parse as parseHtml } from "node-html-parser";

const RATIO_THRESHOLD = 3;
const ALT_FLOOR_CHARS = 80;
const RASTER_HEAVY_IMG_COUNT = 1;
const RASTER_HEAVY_TEXT_MIN = 10;

function walk(target, out = []) {
  const st = statSync(target);
  if (st.isFile()) {
    if (extname(target) === ".html") out.push(target);
    return out;
  }
  for (const entry of readdirSync(target)) {
    const full = join(target, entry);
    const st2 = statSync(full);
    if (st2.isDirectory()) walk(full, out);
    else if (extname(full) === ".html") out.push(full);
  }
  return out;
}

function analyzeFile(file) {
  const code = readFileSync(file, "utf8");
  const root = parseHtml(code, { lowerCaseTagName: true });

  // body 만 대상으로 — head 의 <title> 등은 사용자 가시 본문 아님
  const body = root.querySelector("body") || root;

  let textChars = 0;
  let altChars = 0;
  let imgCount = 0;
  let hasLiteralText = false;

  // <img> 카운트
  for (const img of body.querySelectorAll("img")) imgCount++;

  // alt / aria-label / title 집계 (alt chars)
  for (const el of body.querySelectorAll("*")) {
    for (const attr of ["alt", "aria-label", "title"]) {
      const v = el.getAttribute(attr);
      if (typeof v === "string" && v.trim().length > 0) altChars += v.trim().length;
    }
  }

  // innerText (textNode 만, attr 제외)
  function collect(node) {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      const t = (node.text || "").trim();
      if (t.length > 0) {
        textChars += t.length;
        if (/[가-힣a-zA-Z]/.test(t)) hasLiteralText = true;
      }
      return;
    }
    if (node.childNodes) for (const c of node.childNodes) collect(c);
  }
  collect(body);

  return { file, textChars, altChars, imgCount, hasLiteralText };
}

function main() {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    console.error("usage: check-text-ratio-html.mjs <path> [<path> ...]");
    process.exit(2);
  }
  const files = [];
  for (const t of targets) walk(t, files);
  if (files.length === 0) {
    console.error(`no .html in: ${targets.join(", ")}`);
    process.exit(2);
  }
  let totalText = 0, totalAlt = 0, totalImg = 0, anyLiteral = false;
  for (const f of files) {
    const r = analyzeFile(f);
    totalText += r.textChars;
    totalAlt += r.altChars;
    totalImg += r.imgCount;
    if (r.hasLiteralText) anyLiteral = true;
  }
  const ratio = totalAlt === 0 ? Infinity : totalText / totalAlt;
  const rasterHeavy = totalImg >= RASTER_HEAVY_IMG_COUNT && totalText < RASTER_HEAVY_TEXT_MIN;
  const g6 = rasterHeavy
    ? false
    : totalAlt === 0 || totalAlt < ALT_FLOOR_CHARS || ratio >= RATIO_THRESHOLD;
  const g8 = anyLiteral || totalAlt < ALT_FLOOR_CHARS;
  const report = {
    section: targets.length === 1 ? targets[0] : "multi",
    files: files.length,
    textChars: totalText,
    altChars: totalAlt,
    imgCount: totalImg,
    ratio: totalAlt === 0 ? "∞ (no alt)" : ratio.toFixed(2),
    rasterHeavy,
    g6: g6 ? "PASS" : "FAIL",
    g8: g8 ? "PASS" : "FAIL",
    threshold: RATIO_THRESHOLD,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!g6 || !g8) {
    const reason = rasterHeavy
      ? `raster-heavy (img ${totalImg} + text ${totalText}자 < ${RASTER_HEAVY_TEXT_MIN})`
      : `text/alt=${report.ratio}, 임계 ${RATIO_THRESHOLD}:1`;
    console.error(`\n❌ G6/G8 FAIL — ${reason}.`);
    process.exit(1);
  }
  console.error(`✓ G6/G8 PASS (ratio ${report.ratio})`);
  process.exit(0);
}

main();
```

- [ ] **Step 5: chmod**

```bash
chmod +x scripts/check-text-ratio-html.mjs
```

- [ ] **Step 6: PASS fixture 검증**

Run: `node scripts/check-text-ratio-html.mjs tests/fixtures/html-static/g6-pass.html`
Expected: `✓ G6/G8 PASS`, exit 0.

- [ ] **Step 7: g6 raster-heavy FAIL 검증**

Run: `node scripts/check-text-ratio-html.mjs tests/fixtures/html-static/g6-fail-raster.html; echo "exit=$?"`
Expected: `exit=1`, report 의 `rasterHeavy: true`.

- [ ] **Step 8: g8 FAIL 검증**

Run: `node scripts/check-text-ratio-html.mjs tests/fixtures/html-static/g8-fail.html; echo "exit=$?"`
Expected: `exit=1`, report 의 `g8: "FAIL"`.

- [ ] **Step 9: Commit (G6/G8 part)**

```bash
git add scripts/check-text-ratio-html.mjs tests/fixtures/html-static/g6-* tests/fixtures/html-static/g8-*
git commit -m "feat(M2): G6/G8 html-static — check-text-ratio-html.mjs + fixtures"
```

---

### Task 4: `bootstrap.sh` `--template` 분기 (M3)

**Files:**
- Modify: `scripts/bootstrap.sh`

- [ ] **Step 1: `--template` 인자 파싱 추가**

`scripts/bootstrap.sh:31` 부근의 변수 초기화 블록에 `TEMPLATE="vite-react-ts"` 추가하고 인자 파싱 케이스에 `--template` 추가:

기존 (인자 파싱 case 내부):
```bash
    --from-handoff)
      HANDOFF_DIR="$2"
      shift 2
      ;;
```

위에 같은 패턴으로 추가:
```bash
    --template)
      TEMPLATE="$2"
      shift 2
      ;;
```

그리고 변수 초기화 (`MODE="figma"` 부근) 에:
```bash
TEMPLATE="vite-react-ts"
```

- [ ] **Step 2: 모드×템플릿 검증 추가**

`# ---------- 모드별 검증 ----------` 블록 끝에 추가:

```bash
# ---------- template × mode 조합 검증 ----------
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
```

- [ ] **Step 3: 템플릿 디렉토리 검증 분기**

기존:
```bash
if [ ! -d "$HARNESS_DIR/templates/vite-react-ts" ]; then
  echo "ERROR: HARNESS_DIR 에 templates/vite-react-ts 없음: $HARNESS_DIR" >&2
  exit 3
fi
```

다음으로 교체:
```bash
if [ ! -d "$HARNESS_DIR/templates/$TEMPLATE" ]; then
  echo "ERROR: HARNESS_DIR 에 templates/$TEMPLATE 없음: $HARNESS_DIR" >&2
  exit 3
fi
```

- [ ] **Step 4: 템플릿 복사 분기**

기존:
```bash
echo "[bootstrap] 1/9 템플릿 복사"
cp -r "$HARNESS_DIR/templates/vite-react-ts/." .
```

다음으로 교체:
```bash
echo "[bootstrap] 1/9 템플릿 복사 ($TEMPLATE)"
cp -r "$HARNESS_DIR/templates/$TEMPLATE/." .
```

- [ ] **Step 5: extract-tokens 출력 경로 분기 (figma 모드 + html-static)**

`# ---------- 8. 토큰 소스 주입 (모드별 분기) ----------` 블록 안 figma 모드 부분의 `bash scripts/extract-tokens.sh "$FILE_KEY"` 호출 직후, **html-static 인 경우 tokens.css 를 옳은 경로로 이동**:

`figma 모드` 의 extract-tokens 호출 라인들 다음에 추가:
```bash
    # html-static 의 경우 extract-tokens 가 만든 src/styles/tokens.css 를
    # public/css/tokens.css 로 이동 (vite 와 다른 위치).
    if [ "$TEMPLATE" = "html-static" ] && [ -f "src/styles/tokens.css" ]; then
      mkdir -p public/css
      mv src/styles/tokens.css public/css/tokens.css
      rmdir src/styles 2>/dev/null || true
      rmdir src 2>/dev/null || true
      echo "  ✓ public/css/tokens.css (html-static 위치로 이동)"
    fi
```

- [ ] **Step 6: 진행 표시 메시지 + bootstrap 시작 echo 에 template 표시**

기존:
```bash
echo "[bootstrap] mode=${MODE} project=${PROJECT_NAME}"
```

다음으로 교체:
```bash
echo "[bootstrap] mode=${MODE} template=${TEMPLATE} project=${PROJECT_NAME}"
```

- [ ] **Step 7: 사용법 문구 갱신**

스크립트 도입부 주석 (`# Usage:` 섹션) 에 한 줄 추가:

```
#   --template <name>        출력 템플릿: vite-react-ts (default) | html-static
```

- [ ] **Step 8: dry-run 검증 — figma + html-static**

```bash
TMP="$(mktemp -d)" && cd "$TMP" \
  && bash "$OLDPWD/scripts/bootstrap.sh" --mode figma --template html-static \
       https://www.figma.com/design/DUMMY123/Dummy 2>&1 | head -30 \
  ; cd "$OLDPWD"
```

Expected: 처음 6줄 안에 `mode=figma template=html-static` 메시지. doctor.sh 통과 후 진행. (FIGMA_TOKEN 없으면 토큰 추출 skip 메시지.) 끝까지 완주 OK.

- [ ] **Step 9: dry-run 검증 — spec + html-static (에러 기대)**

```bash
TMP="$(mktemp -d)" && cd "$TMP" \
  && bash "$OLDPWD/scripts/bootstrap.sh" --mode spec --template html-static \
       --from-handoff /tmp/dummy 2>&1 | head -10 \
  ; echo "exit=$?" ; cd "$OLDPWD"
```

Expected: `ERROR: spec × html-static 조합은 지원하지 않음`, `exit=2`.

- [ ] **Step 10: dry-run 검증 — 기존 default 무수정 (회귀)**

```bash
TMP="$(mktemp -d)" && cd "$TMP" \
  && bash "$OLDPWD/scripts/bootstrap.sh" --mode figma \
       https://www.figma.com/design/DUMMY123/Dummy 2>&1 | head -10 \
  ; cd "$OLDPWD"
```

Expected: `mode=figma template=vite-react-ts` (기본값). 기존 동작 유지.

- [ ] **Step 11: Commit**

```bash
git add scripts/bootstrap.sh
git commit -m "feat(M3): bootstrap.sh --template 분기 (vite-react-ts | html-static)"
```

---

### Task 5: `measure-quality.sh` template 분기 (M4)

**Files:**
- Modify: `scripts/measure-quality.sh`

- [ ] **Step 1: 도입부에 template 자동 조회 블록 추가**

`set -u` 직후, 인자 파싱 전에 추가:

```bash
# template 자동 조회 (project-context.md 우선, env override 가능)
if [ -z "${TEMPLATE:-}" ]; then
  if [ -f "docs/project-context.md" ]; then
    TEMPLATE=$(grep -E "^template:" docs/project-context.md | head -1 | awk '{print $2}' | tr -d '#"')
  fi
  TEMPLATE="${TEMPLATE:-vite-react-ts}"
fi

if [ -z "${PREVIEW_BASE_URL:-}" ]; then
  if [ -f "docs/project-context.md" ]; then
    PREVIEW_BASE_URL=$(grep -E "^preview_base_url:" docs/project-context.md | head -1 | awk '{print $2}' | tr -d '#"')
  fi
  PREVIEW_BASE_URL="${PREVIEW_BASE_URL:-http://127.0.0.1:5173}"
fi

# template 별 게이트 명령 분기
case "$TEMPLATE" in
  vite-react-ts)
    G4_SCRIPT="${SCRIPT_DIR:-$(cd "$(dirname "$0")" && pwd)}/check-token-usage.mjs"
    G6_SCRIPT="${SCRIPT_DIR:-$(cd "$(dirname "$0")" && pwd)}/check-text-ratio.mjs"
    G7_URL_FMT="%s/__preview/%s"
    ;;
  html-static)
    G4_SCRIPT="${SCRIPT_DIR:-$(cd "$(dirname "$0")" && pwd)}/check-token-usage-html.mjs"
    G6_SCRIPT="${SCRIPT_DIR:-$(cd "$(dirname "$0")" && pwd)}/check-text-ratio-html.mjs"
    G7_URL_FMT="%s/__preview/%s/"
    ;;
  *)
    echo "ERROR: 알 수 없는 template: $TEMPLATE" >&2
    exit 2
    ;;
esac
```

- [ ] **Step 2: G4 호출 라인 교체**

기존:
```bash
if node "${SCRIPT_DIR}/check-token-usage.mjs" $TARGET_SET 2>/tmp/g4.err; then
```

다음으로 교체:
```bash
if node "$G4_SCRIPT" $TARGET_SET 2>/tmp/g4.err; then
```

- [ ] **Step 3: G6/G8 호출 라인 교체**

기존:
```bash
G68_JSON=$(node "${SCRIPT_DIR}/check-text-ratio.mjs" $TARGET_SET 2>/tmp/g68.err || true)
```

다음으로 교체:
```bash
G68_JSON=$(node "$G6_SCRIPT" $TARGET_SET 2>/tmp/g68.err || true)
```

- [ ] **Step 4: G7 URL 라인 교체**

기존:
```bash
    url="http://127.0.0.1:5173/__preview/${section}"
```

다음으로 교체:
```bash
    url="$(printf "$G7_URL_FMT" "$PREVIEW_BASE_URL" "$section")"
```

- [ ] **Step 5: G5 동작 확인 (변경 없음)**

eslint 는 config 파일 자동 적용되므로 변경 없음. 단 `.eslintrc.json` 이 프로젝트 루트에 있어야 동작 — bootstrap.sh 가 templates/<template>/ 에서 복사하므로 자동 보장.

- [ ] **Step 6: 회귀 테스트 — 기존 vite-react-ts 프로젝트에서 동작 변화 없음**

기존 테스트 fixture (vite 의 `src/components/`) 가 있다면:
```bash
# (옵션) 기존 vite 프로젝트 디렉토리에서:
# bash scripts/measure-quality.sh dummy src/some-section
```
project-context.md 의 template 필드 없을 때 default `vite-react-ts` 동작 확인 — `echo $TEMPLATE` 출력으로 검증.

- [ ] **Step 7: 인라인 검증 — TEMPLATE 환경변수 override**

```bash
TEMPLATE=html-static bash -c '
SCRIPT_DIR="$(pwd)/scripts"
. /dev/stdin <<<"$(sed -n "/# template 자동 조회/,/^esac$/p" scripts/measure-quality.sh)"
echo "template=$TEMPLATE g4=$G4_SCRIPT g6=$G6_SCRIPT url_fmt=$G7_URL_FMT"
'
```

Expected: `template=html-static g4=...check-token-usage-html.mjs g6=...check-text-ratio-html.mjs url_fmt=%s/__preview/%s/`.

- [ ] **Step 8: Commit**

```bash
git add scripts/measure-quality.sh
git commit -m "feat(M4): measure-quality.sh template 분기 — project-context.md 자동 조회"
```

---

### Task 6: `docs/project-context.md.tmpl` 신규 필드 (M6 일부)

**Files:**
- Modify: `docs/project-context.md.tmpl`

- [ ] **Step 1: 현 파일 확인**

```bash
head -30 docs/project-context.md.tmpl
```

- [ ] **Step 2: top section 에 신규 필드 추가**

기존 첫 페이지 메타 블록 다음에 추가:

```markdown
template: {TEMPLATE}
preview_base_url: {PREVIEW_URL}
```

(정확한 삽입 지점은 파일 구조에 따라 결정 — 통상 mode/source 줄 다음.)

- [ ] **Step 3: bootstrap.sh sed 치환에 신규 필드 추가**

`scripts/bootstrap.sh` 의 project-context.md.tmpl 치환 블록:

기존:
```bash
  sed -e "s|{PROJECT_NAME}|${PROJECT_NAME}|g" \
      -e "s|{FIGMA_URL}|${FIGMA_URL_DISPLAY}|g" \
      -e "s|{FILE_KEY}|${FILE_KEY_DISPLAY}|g" \
      -e "s|{MODE}|${MODE}|g" \
      -e "s|{SOURCE_INFO}|${SOURCE_INFO}|g" \
      "$HARNESS_DIR/docs/project-context.md.tmpl" > docs/project-context.md
```

다음으로 교체:
```bash
  PREVIEW_URL_DISPLAY="http://127.0.0.1:5173"
  sed -e "s|{PROJECT_NAME}|${PROJECT_NAME}|g" \
      -e "s|{FIGMA_URL}|${FIGMA_URL_DISPLAY}|g" \
      -e "s|{FILE_KEY}|${FILE_KEY_DISPLAY}|g" \
      -e "s|{MODE}|${MODE}|g" \
      -e "s|{SOURCE_INFO}|${SOURCE_INFO}|g" \
      -e "s|{TEMPLATE}|${TEMPLATE}|g" \
      -e "s|{PREVIEW_URL}|${PREVIEW_URL_DISPLAY}|g" \
      "$HARNESS_DIR/docs/project-context.md.tmpl" > docs/project-context.md
```

- [ ] **Step 4: PROGRESS.md 치환에도 동일 적용**

기존:
```bash
if [ -f PROGRESS.md.tmpl ]; then
  sed -e "s|{PROJECT_NAME}|${PROJECT_NAME}|g" \
      -e "s|{FIGMA_URL}|${FIGMA_URL_DISPLAY}|g" \
      -e "s|{FILE_KEY}|${FILE_KEY_DISPLAY}|g" \
      -e "s|{MODE}|${MODE}|g" \
      -e "s|{SOURCE_INFO}|${SOURCE_INFO}|g" \
      PROGRESS.md.tmpl > PROGRESS.md
  rm -f PROGRESS.md.tmpl
fi
```

다음으로 교체:
```bash
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
```

- [ ] **Step 5: 검증 — bootstrap dry-run 결과의 project-context.md 확인**

```bash
TMP="$(mktemp -d)" && cd "$TMP" \
  && bash "$OLDPWD/scripts/bootstrap.sh" --mode figma --template html-static \
       https://www.figma.com/design/DUMMY123/Dummy >/dev/null 2>&1 \
  && grep -E "^(template|preview_base_url):" docs/project-context.md \
  ; cd "$OLDPWD"
```

Expected:
```
template: html-static
preview_base_url: http://127.0.0.1:5173
```

- [ ] **Step 6: Commit**

```bash
git add docs/project-context.md.tmpl scripts/bootstrap.sh
git commit -m "feat(M6): project-context.md.tmpl 에 template/preview_base_url 신규 필드"
```

---

### Task 7: `.claude/agents/section-worker.md` html-static 서브섹션 추가 (M5)

**Files:**
- Modify: `.claude/agents/section-worker.md`

- [ ] **Step 1: 도입부에 template 분기 인지 명시 추가**

`## 4단계 (중단 없이 연속 실행)` 직전에 추가:

```markdown
## Template 분기 인지

작업 시작 시 `docs/project-context.md` 의 `template:` 필드를 읽어 vite-react-ts / html-static 중 어느 출력 형식인지 결정한다. 필드가 없으면 vite-react-ts default. 이 결정이 **에셋 base path · 산출물 경로 · 게이트 호출 디렉토리** 모두에 영향을 준다.
```

- [ ] **Step 2: §리서치 figma 모드 끝에 html-static 추가 노트**

`#### figma 모드` 블록 끝(`#### spec 모드` 직전) 에 한 줄 추가:

```markdown
- (template: html-static 일 때) baseline / figma-screenshots 경로 규약은 동일. 차이는 §에셋·§구현 단계.
```

- [ ] **Step 3: §에셋 figma 모드 끝에 template 분기 추가**

`#### figma 모드` 의 에셋 다운로드 라인들 직후에 추가:

```markdown
**Template 분기 — 에셋 base path**:
- `vite-react-ts` → `src/assets/{section}/{name}.{ext}` (기존)
- `html-static`   → `public/assets/{section}/{name}.{ext}` (Stage 2 신규)

워커는 `docs/project-context.md` 의 `template:` 필드를 보고 둘 중 하나를 사용. base path 만 다르고 다운로드 도구(`figma-rest-image.sh`) · leaf nodeId 사용 원칙은 모두 동일.
```

- [ ] **Step 4: §구현 끝에 #### template: html-static 서브섹션 추가**

`### §반응형 규칙` 직전 (즉 §구현 의 마지막 부분) 에 추가:

```markdown
#### template: html-static (Stage 2 신규)

산출물: 섹션당 최대 3 파일.
- `public/__preview/{section}/index.html` — 풀 HTML 문서 (head + body + 섹션 1개)
- `public/css/{section}.css` — 섹션 전용 스타일 (50+ lines 면 분리, 짧으면 `<style>` 인라인 가능)
- `public/js/{section}.js` — vanilla JS 인터랙션 (필요 시만)

규칙 (lite 하네스 html-static 절대 규칙):
1. 스타일 소스: `var(--*)` 토큰만. inline `style="..."` 또는 섹션 CSS 의 hex literal 금지 → G4 FAIL
2. 시맨틱 HTML: `<section id="{section}">`, `<h1>~<h3>`, `<button>`. `<div onclick>` 금지 → G5 FAIL
3. 텍스트는 element innerText 로. alt 에 문장 밀어넣기 금지 → G6 FAIL
4. 이미지 alt 필수 (`@html-eslint/require-img-alt`)
5. `<button type="button|submit|reset">` 명시 (`@html-eslint/require-button-type`)
6. 공통 head boilerplate:
   ```html
   <!DOCTYPE html>
   <html lang="ko">
   <head>
     <meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <link rel="stylesheet" href="/css/tokens.css">
     <link rel="stylesheet" href="/css/main.css">
     <link rel="stylesheet" href="/css/{section}.css">
     <title>{section} preview</title>
   </head>
   <body>
     <section id="{section}">...</section>
   </body>
   </html>
   ```
7. JS 프레임워크 추가 금지 (jQuery / htmx / Alpine 모두 금지)
8. JSX → HTML 속성 변환 (reference 가 React CDN 형태인 경우): `className` → `class`, `htmlFor` → `for`, self-closing `<img />` → `<img>`, `style={{...}}` 객체 → `style="..."` 문자열
9. 반응형은 CSS 미디어쿼리로. Tailwind breakpoint 없음
```

- [ ] **Step 5: §게이트 끝에 호출 패턴 추가**

`### 4. 품질 게이트` 의 4.2 게이트 실행 블록에 추가 (template: html-static 케이스):

```markdown
**template: html-static 호출 패턴**:

```bash
# CSS/JS 파일을 생성한 경우만 --files 에 포함 (없는 path 넘기면 script error)
FILES="public/__preview/{section}/index.html"
[ -f "public/css/{section}.css" ] && FILES="$FILES public/css/{section}.css"
[ -f "public/js/{section}.js" ]  && FILES="$FILES public/js/{section}.js"

bash scripts/measure-quality.sh {section} public/__preview/{section} --files "$FILES"
```

`measure-quality.sh` 가 `docs/project-context.md` 의 `template:` 필드를 보고 G4/G6/G8 자동 분기. 호출자는 template 신경 안 써도 된다.
```

- [ ] **Step 6: 검증 — 키워드 검색**

```bash
grep -c "html-static" .claude/agents/section-worker.md
```

Expected: 5 이상 (Template 분기 / §리서치 / §에셋 / §구현 / §게이트 5 곳).

- [ ] **Step 7: Commit**

```bash
git add .claude/agents/section-worker.md
git commit -m "feat(M5): section-worker.md 에 template: html-static 서브섹션 추가"
```

---

### Task 8: `docs/workflow.md` 갱신 (M6 일부)

**Files:**
- Modify: `docs/workflow.md`

- [ ] **Step 1: workflow.md 도입부 또는 §게이트 절에 한 단락 추가**

```markdown
### Template 분기

`docs/project-context.md` 의 `template:` 필드가 출력 템플릿을 결정한다 (`vite-react-ts` | `html-static`). bootstrap 단계에서 자동 기록. `measure-quality.sh` 와 section-worker 가 이 필드를 보고 게이트 명령 / 산출물 경로를 분기. 환경변수 `TEMPLATE` 로 일회성 override 가능.
```

- [ ] **Step 2: Commit**

```bash
git add docs/workflow.md
git commit -m "docs(workflow): template 분기 한 절 추가"
```

---

### Task 9: `scripts/bootstrap.sh` 의 추가 스크립트 복사 라인 갱신 (M3 cont.)

**Files:**
- Modify: `scripts/bootstrap.sh` (스크립트 복사 블록)

- [ ] **Step 1: 게이트 스크립트 2개 추가 복사**

`# ---------- 4. scripts/ 복사 ----------` 블록에 추가:

기존 복사 라인들 다음에:
```bash
cp "$HARNESS_DIR/scripts/check-token-usage-html.mjs" scripts/
cp "$HARNESS_DIR/scripts/check-text-ratio-html.mjs" scripts/
```

- [ ] **Step 2: 검증 — bootstrap 후 신규 스크립트 존재 확인**

```bash
TMP="$(mktemp -d)" && cd "$TMP" \
  && bash "$OLDPWD/scripts/bootstrap.sh" --mode figma --template html-static \
       https://www.figma.com/design/DUMMY123/Dummy >/dev/null 2>&1 \
  && ls scripts/check-token-usage-html.mjs scripts/check-text-ratio-html.mjs \
  ; cd "$OLDPWD"
```

Expected: 두 파일 모두 표시.

- [ ] **Step 3: Commit**

```bash
git add scripts/bootstrap.sh
git commit -m "feat(M3): bootstrap.sh 가 html-static 게이트 스크립트도 복사"
```

---

### Task 10: end-to-end 게이트 자기검증 (M4 cont.)

**Files:**
- (테스트 only)

- [ ] **Step 1: html-static 골격을 임시 디렉토리에 부트하고 dummy 섹션 1개로 G4/G5/G6/G8 모두 PASS 확인**

```bash
TMP="$(mktemp -d)" && cd "$TMP" \
  && bash "$OLDPWD/scripts/bootstrap.sh" --mode figma --template html-static \
       https://www.figma.com/design/DUMMY123/Dummy >/dev/null 2>&1
# project-context.md 에 template 필드 확인
grep -E "^template:" docs/project-context.md

# dummy 섹션 생성
mkdir -p public/__preview/dummy
cat > public/__preview/dummy/index.html <<'HTML'
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="/css/tokens.css">
  <link rel="stylesheet" href="/css/main.css">
  <title>dummy preview</title>
</head>
<body>
  <section id="dummy">
    <h1>안녕하세요. 이것은 더미 섹션입니다.</h1>
    <p>본문 텍스트가 충분히 길어 ratio 가 통과합니다.</p>
  </section>
</body>
</html>
HTML

# 게이트 실행
npm install --silent --no-audit --no-fund
bash scripts/measure-quality.sh dummy public/__preview/dummy \
  --files "public/__preview/dummy/index.html"
echo "exit=$?"
cd "$OLDPWD"
```

Expected: `exit=0`. tests/quality/dummy.json 에 G4=PASS, G5=PASS, G6=PASS, G8=PASS.

- [ ] **Step 2: 추가 negative 검증 — hex literal 있으면 FAIL 인지**

위 스크립트의 dummy 섹션 HTML 에 `style="color: #B84A32"` 추가하고 재실행:

```bash
# (위 디렉토리에서)
sed -i 's|<h1>|<h1 style="color: #B84A32">|' public/__preview/dummy/index.html
bash scripts/measure-quality.sh dummy public/__preview/dummy \
  --files "public/__preview/dummy/index.html"
echo "exit=$?"
```

Expected: `exit=1`, G4=FAIL.

- [ ] **Step 3: 검증 결과를 plan 의 검증 로그에 기록 (커밋 없이 정신적 확인)**

이 단계 자체는 코드 변경 없음. 검증만 하고 진행.

---

### Task 11: 첫 스모크 (M7) — Phase 4

**Files:**
- (사용자 figma URL 필요)

- [ ] **Step 1: figma URL 확보**

사용자가 실제 figma URL 1개 제공 (작은 섹션 1개 분량). 없으면 이 task 는 **보류** — Phase 5 만 먼저 완료.

- [ ] **Step 2: 신규 프로젝트 디렉토리에서 부트**

```bash
mkdir -p $HOME/workspace/smoke-figma-html-static
cd $HOME/workspace/smoke-figma-html-static
bash $HOME/workspace/publish-harness/scripts/bootstrap.sh \
  --mode figma --template html-static <FIGMA_URL>
```

- [ ] **Step 3: 세션 재시작 후 섹션 1개를 publish-harness 스킬로 진행**

(`/exit` 후 같은 디렉토리에서 `claude --dangerously-skip-permissions` 재시작.)

```
publish-harness 스킬로 첫 섹션 1개를 figma × html-static 으로 진행해줘.
```

- [ ] **Step 4: G4/G5/G6/G8 PASS + preview 가동 확인**

```bash
npm run dev &
sleep 1
curl -sf http://127.0.0.1:5173/__preview/<section>/ | head -5
```

- [ ] **Step 5: 결과 PROGRESS.md 에 기록 + 스모크 종료**

(워커가 자동 커밋. 스모크 자체는 별도 커밋 없음.)

---

### Task 12: 로드맵·매트릭스·CLAUDE.md 갱신 (Phase 5)

**Files:**
- Modify: `README.md`
- Modify: `docs/template-support-matrix.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: README 로드맵 — Stage 2 → 완료 이동**

`### Stage 2 (진행 예정)` 의 첫 항목 (`figma × html-static`) 을 `### 완료` 블록으로 옮긴다. (G9 brand-guardrails 는 미완이니 Stage 2 에 남겨둠 또는 Stage 3 로 이동.)

- [ ] **Step 2: 매트릭스 — figma × html-static 상태 ✅**

`docs/template-support-matrix.md` 의 표:
```
| `figma` | `html-static` | 🎯 **Stage 2** | 다음 작업 대상. 정적 랜딩/마케팅 페이지 용 |
```

다음으로 교체:
```
| `figma` | `html-static` | ✅ 지원 | 정적 랜딩/마케팅 페이지 용 (Stage 2 완료) |
```

§변경 이력 끝에 한 줄 추가:
```
- 2026-04-27: Stage 2 (`figma × html-static`) 구현 완료. 마일스톤 M1~M7 통과.
```

- [ ] **Step 3: CLAUDE.md — 소스 모드 판별 절에 template 한 줄 추가**

기존 `## 소스 모드 판별` 절 끝에:
```markdown
## 출력 템플릿 판별

`docs/project-context.md` 의 `template:` 필드 (`vite-react-ts` | `html-static`) 확인. 없으면 `vite-react-ts` default. bootstrap 시 `--template html-static` 으로 명시 가능 (단 `--mode figma` 만, spec×html-static 은 지원 안 함).
```

- [ ] **Step 4: Commit**

```bash
git add README.md docs/template-support-matrix.md CLAUDE.md
git commit -m "docs(roadmap): Stage 2 (figma × html-static) 완료 표시"
```

- [ ] **Step 5: Push**

```bash
git push origin main
```

---

## Self-Review

**1. Spec coverage:**
- §3 디렉토리 → T1 ✓
- §6.1 G4 → T2 ✓
- §6.2 G6/G8 → T3 ✓
- §6.3 G5 eslintrc → T1 ✓ (.eslintrc.json 작성)
- §7 bootstrap → T4, T9 ✓
- §8 project-context.md.tmpl → T6 ✓
- §9 measure-quality → T5 ✓
- §10 section-worker → T7 ✓
- §11 마일스톤 M1~M7 → T1, T2/T3, T4/T9, T5, T7, T6, T11 ✓
- §13 호환성 (회귀) → T4 Step 10, T5 Step 6 ✓

**2. Placeholder scan:** 없음. 모든 step 에 코드/명령/파일 경로 명시.

**3. Type consistency:** `G4_SCRIPT` / `G6_SCRIPT` / `G7_URL_FMT` 변수명 T5 내부에서만 정의·사용. 기존 measure-quality.sh 의 `SCRIPT_DIR` 변수와 충돌 없음.

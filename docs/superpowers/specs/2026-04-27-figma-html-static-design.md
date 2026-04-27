# `figma × html-static` 템플릿 — Stage 2 설계

**작성일**: 2026-04-27
**상태**: Draft (Phase 1 산출물)
**선행**: [`docs/template-support-matrix.md`](../../template-support-matrix.md) §Stage 2

## 1. 목표

publish-harness 의 두 번째 출력 템플릿으로 `templates/html-static/` 을 추가한다. 이 템플릿은 **Figma 디자인 → 정적 HTML/CSS 페이지** 변환에 사용된다 — 마케팅 랜딩, 캠페인 페이지, 이메일 미리보기 등 컴포넌트 재사용 고민이 적은 use case 가 대상이다.

## 2. 비목표 (out of scope)

- `spec × html-static` 조합 — 매트릭스에서 명시적 제외 (mismatch)
- 페이지 통합 산출물 (`public/{page}.html`) — 사용자가 Astro/11ty 등으로 직접 조립
- 컴포넌트 재사용 시스템 (partial include / SSI / template engine)
- JS 프레임워크 (jQuery / Alpine / htmx 등)
- Tailwind CSS 빌드
- Stage 3 server-side templates (Thymeleaf 등)

## 3. 디렉토리 구조

```
templates/html-static/
  package.json              # devDeps: serve, @html-eslint/parser,
                            #          @html-eslint/eslint-plugin,
                            #          node-html-parser
  .eslintrc.json            # @html-eslint config
  .gitattributes            # *.html eol=lf
  PROGRESS.md.tmpl
  public/
    index.html              # 섹션 인덱스 (선택, bootstrap 가 placeholder 만)
    css/
      tokens.css            # bootstrap 가 figma extract-tokens 로 생성
      main.css              # 글로벌 reset/타이포 (하네스 제공, 워커 read-only)
    js/                     # 섹션 워커가 필요 시 생성 (vanilla)
    assets/                 # 섹션 워커가 figma-rest-image.sh 로 생성
    __preview/
      .gitkeep              # 섹션 워커 산출물 마운트 지점
```

bootstrap 후 첫 섹션 작업 결과 예시:

```
public/
  __preview/
    home-hero/
      index.html            # 섹션 워커 산출물 (preview 가능 풀 HTML)
  css/
    home-hero.css           # 섹션 워커 산출물 (선택)
  assets/
    home-hero/
      bg.png                # figma-rest-image.sh 결과
  js/
    home-hero.js            # 워커가 인터랙션 필요 시 (선택)
```

## 4. 핵심 결정사항 (요약)

| # | 항목 | 결정 |
|---|---|---|
| D1 | 산출물 단위 | **섹션 단위만**. `public/__preview/{section}/index.html` 한 파일이 풀 HTML 문서. 페이지 통합은 사용자 책임 |
| D2 | CSS 분리 | **섹션별 `public/css/{section}.css`** + 글로벌 `public/css/main.css` (read-only) + `tokens.css` (bootstrap 생성, read-only) |
| D3 | 공통 헤더/푸터 | **partial include 시스템 없음**. 헤더가 별도 섹션이면 그 자체로 워커 산출물 |
| D4 | 에셋 경로 | **`public/assets/{section}/{name}.{ext}`** — `figma-rest-image.sh` 출력을 `public/assets/...` 로 기록 |
| D5 | JS 인터랙션 | **vanilla JS only**, 섹션별 `public/js/{section}.js` 선택. 글로벌 framework 금지 |
| D6 | G1 baseline | 기존 `fetch-figma-baseline.sh` + `baselines/{section}/{viewport}.png` 규약 그대로 |
| Q4 | 토큰 | CSS 커스텀 프로퍼티만 (`tokens.css`), Tailwind 미사용 |
| Q5 | HTML 파서 | `node-html-parser` 기반 게이트 스크립트 |
| Q6 | G5 도구 | `@html-eslint/parser` + `@html-eslint/eslint-plugin` (기존 eslint 파이프라인 재사용) |
| Q7 | bootstrap 플래그 | `--template html-static`. default `vite-react-ts` 유지. `--mode spec --template html-static` 은 명시적 에러 |
| Q8 | template 분기 | `docs/project-context.md` 의 `template:` 필드 자동 조회 |
| Q8b | preview URL | `preview_base_url:` 필드 (default `http://127.0.0.1:5173`). env `PREVIEW_BASE_URL` override |
| Q10 | preview 런타임 | `npx serve -l 5173 public/` (정적 서빙) |

## 5. 게이트 매트릭스

| Gate | vite-react-ts | html-static |
|---|---|---|
| G1 visual regression | `check-visual-regression.mjs` (Playwright) — **공통** | 동일 공통 |
| G4 token usage | `check-token-usage.mjs` (.tsx/.jsx) | **`check-token-usage-html.mjs`** (.html + .css) |
| G5 semantic/a11y | `npx eslint` (jsx-a11y config) | `npx eslint` **(`@html-eslint` config)** |
| G6 text:image ratio | `check-text-ratio.mjs` | **`check-text-ratio-html.mjs`** |
| G7 Lighthouse | `@lhci/cli` @ preview URL | 동일 |
| G8 i18n | `check-text-ratio.mjs` g8 필드 | `check-text-ratio-html.mjs` g8 필드 |

template 분기는 `docs/project-context.md` 의 `template:` 필드를 `measure-quality.sh` 가 자동 조회.

## 6. 게이트 스크립트 명세

### 6.1 `scripts/check-token-usage-html.mjs` (G4)

**입력**: `.html` 또는 `.css` 파일 경로 리스트 (또는 디렉토리).

**검사**:

1. `.html` 파일에서:
   - `<style>...</style>` 블록 내부 CSS — hex/rgb literal 검출
   - 모든 element 의 `style="..."` 속성 — hex/rgb literal 검출
2. `.css` 파일 전체 — hex/rgb literal 검출
3. 화이트리스트: `#fff` / `#000` / `transparent` / `currentColor` / `inherit`

**파서**: `node-html-parser` 로 HTML 파싱, `<style>` block 과 `style` attr 추출. CSS 내부 hex 검출은 정규식 (기존 React 게이트와 동일 패턴).

**종료 코드**: 0 PASS, 1 FAIL, 2 usage error.

### 6.2 `scripts/check-text-ratio-html.mjs` (G6 + G8)

**입력**: `.html` 파일 경로 리스트 (또는 디렉토리).

**텍스트 집계**:
- element 의 inner text (innerText)
- `aria-label` / `title` / `alt` 는 alt chars 로 집계 (텍스트 chars 와 분리)

**G6 판정**:
- `text/alt >= 3` PASS, 그 외 FAIL
- `alt < 80` (ALT_FLOOR_CHARS) 인 경우 ratio 검사 skip
- raster-heavy 휴리스틱: `<img>` 1+ + textChars < 10 → FAIL

**G8 판정**:
- HTML body 내 user-visible 텍스트가 **innerText** 로 존재 → PASS
- 모든 텍스트가 `alt` / `aria-label` 에만 있음 → FAIL

### 6.3 `templates/html-static/.eslintrc.json` (G5)

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

`measure-quality.sh` 의 G5 블록은 **변경 없이** `npx eslint <files>` 호출 — config 파일이 alone 다른 파서 자동 적용.

## 7. `bootstrap.sh` 변경

**플래그 추가**: `--template vite-react-ts|html-static` (default `vite-react-ts`).

**검증 매트릭스**:
- `--mode figma` + `--template vite-react-ts` ✅ 기존 동작
- `--mode figma` + `--template html-static` ✅ 신규 (Stage 2)
- `--mode spec` + `--template vite-react-ts` ✅ 기존 동작
- `--mode spec` + `--template html-static` ❌ 명시적 에러 (매트릭스 §제외)

**figma + html-static 분기**:
1. `templates/html-static/.` 복사
2. `extract-tokens.sh` 실행 — output path: `public/css/tokens.css` (vite 의 `src/styles/tokens.css` 와 다름)
3. `figma-rest-image.sh` 출력 기본 경로를 `public/assets/...` 로 (env or arg 로 control)
4. `docs/project-context.md` 에 `template: html-static` + `preview_base_url: http://127.0.0.1:5173` 자동 기록
5. `package.json` 의 dev script = `serve -l 5173 public`

## 8. `docs/project-context.md.tmpl` 변경

신규 필드 추가 (top section):

```yaml
template: {TEMPLATE}            # vite-react-ts | html-static
preview_base_url: {PREVIEW_URL} # http://127.0.0.1:5173 (default)
```

bootstrap 시 placeholder 치환. 기존 figma×react 프로젝트에는 backwards-compatible default (`vite-react-ts` / `:5173`).

## 9. `scripts/measure-quality.sh` 변경

도입부에 template 자동 조회 블록 추가:

```bash
# template 자동 조회 (project-context.md 우선, env override 가능)
if [ -z "${TEMPLATE:-}" ]; then
  if [ -f "docs/project-context.md" ]; then
    TEMPLATE=$(grep -E "^template:" docs/project-context.md | head -1 | awk '{print $2}')
  fi
  TEMPLATE="${TEMPLATE:-vite-react-ts}"
fi

if [ -z "${PREVIEW_BASE_URL:-}" ]; then
  if [ -f "docs/project-context.md" ]; then
    PREVIEW_BASE_URL=$(grep -E "^preview_base_url:" docs/project-context.md | head -1 | awk '{print $2}')
  fi
  PREVIEW_BASE_URL="${PREVIEW_BASE_URL:-http://127.0.0.1:5173}"
fi
```

이후 G4/G6/G8 호출 부분에서 template 별 분기:

```bash
case "$TEMPLATE" in
  vite-react-ts)
    G4_CMD="check-token-usage.mjs"
    G6_CMD="check-text-ratio.mjs"
    ;;
  html-static)
    G4_CMD="check-token-usage-html.mjs"
    G6_CMD="check-text-ratio-html.mjs"
    ;;
  *)
    echo "ERROR: unknown template: $TEMPLATE" >&2; exit 2 ;;
esac
```

G7 Lighthouse 의 URL 은 template 별로 다음과 같이 구성:
- `vite-react-ts`: `$PREVIEW_BASE_URL/__preview/$section` (trailing slash 없음, vite 라우터)
- `html-static`: `$PREVIEW_BASE_URL/__preview/$section/` (trailing slash 필요, `serve` 디렉토리 인덱스)

## 10. `.claude/agents/section-worker.md` 변경

`### 1. 리서치 / 2. 에셋 / 3. 구현` 각 단계에 `#### template: html-static` 서브섹션 추가. 골격:

**Template 분기 인지**: 워커는 작업 시작 시 `docs/project-context.md` 의 `template:` 필드를 읽어 vite-react-ts / html-static 어느 쪽인지 결정. 필드 없으면 vite-react-ts default.

### 1. 리서치 — html-static 추가
- `figma-rest-image.sh` 출력 경로: `figma-screenshots/{page}-{section}.png` (변경 없음)
- baseline 확보 경로: `baselines/{section}/desktop.png` (변경 없음)

### 2. 에셋 — html-static 추가
- 정적 에셋: `public/assets/{section}/{name}.{ext}` 로 다운로드 (vite 의 `src/assets/...` 와 다름)
- 워커는 template 필드를 보고 두 base path 중 하나를 선택:
  - `vite-react-ts` → `src/assets/{section}/...`
  - `html-static` → `public/assets/{section}/...`

### 3. 구현 — html-static 추가
산출물: 섹션당 최대 3 파일.
- `public/__preview/{section}/index.html` — 풀 HTML 문서 (head + body + 섹션)
- `public/css/{section}.css` — 섹션 전용 스타일 (선택, 인라인 `<style>` 도 가능하나 50+ lines 면 분리 권장)
- `public/js/{section}.js` — vanilla JS 인터랙션 (필요 시만)

규칙 (lite 하네스 html-static 절대 규칙):
1. 스타일 소스: `var(--*)` 토큰만. inline `style="..."` 또는 섹션 CSS hex literal 금지 → G4 FAIL
2. 시맨틱 HTML: `<section id="{section}">`, `<h1>~<h3>`, `<button>`. `<div onclick>` 금지 → G5 FAIL
3. 텍스트는 element innerText 로. alt 에 문장 밀어넣기 금지 → G6 FAIL
4. 이미지 alt 필수 (`@html-eslint/require-img-alt`)
5. `<button type="...">` 명시 (`@html-eslint/require-button-type`)
6. 공통 head boilerplate 포함:
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
7. JS 프레임워크 추가 금지 (jQuery/htmx/Alpine 모두 금지)
8. JSX → HTML 속성 변환: reference HTML 이 React CDN 형태면 `className` → `class`, `htmlFor` → `for`, self-closing `<img />` → `<img>` 등 (HTML5 적합)

### 4. 게이트 — html-static 추가
호출 패턴 변경 없음 — `measure-quality.sh` 가 template 자동 분기.

```bash
# CSS/JS 파일을 생성한 경우만 --files 에 포함 (없는 path 넘기면 script error)
FILES="public/__preview/{section}/index.html"
[ -f "public/css/{section}.css" ] && FILES="$FILES public/css/{section}.css"
[ -f "public/js/{section}.js" ]  && FILES="$FILES public/js/{section}.js"

bash scripts/measure-quality.sh {section} public/__preview/{section} --files "$FILES"
```

## 11. 마일스톤

| M | 산출물 | 검증 |
|---|---|---|
| M1 | `templates/html-static/` 골격 + package.json + .gitattributes + .eslintrc | `cp -r templates/html-static/. /tmp/x && cd /tmp/x && npm install && (npx serve -l 5173 public/ &) && sleep 1 && curl -sf http://127.0.0.1:5173/ -o /dev/null` (200 응답 확인) |
| M2 | `scripts/check-token-usage-html.mjs` + `check-text-ratio-html.mjs` + 단위 fixture | 양/음성 fixture 로 PASS/FAIL 모두 검증 |
| M3 | `bootstrap.sh --template` 분기 | dummy figma URL 로 dry-run, 디렉토리 트리 검증 |
| M4 | `measure-quality.sh` template 분기 | M1 골격 + dummy 섹션으로 G4/G5/G6/G8 PASS |
| M5 | `.claude/agents/section-worker.md` html-static 서브섹션 | 문서 정합성 (해당 단어가 모든 단계에 존재) |
| M6 | `docs/project-context.md.tmpl` 신규 필드 + workflow 갱신 | bootstrap 후 project-context.md 에 placeholder 치환 OK |
| M7 (Phase 4) | 첫 스모크 — 실 figma URL 1 섹션 | 세션 단계 모두 통과 (figma URL 사용자 제공 필요) |

## 12. 리스크 & 대응

| 리스크 | 대응 |
|---|---|
| `@html-eslint/parser` 가 `eslint` v8 호환성 — 현 템플릿 eslint ^8.57 | M2 시작 전 호환 버전 lock. 비호환이면 eslint v9 + flat config 로 html-static 만 분기 |
| `node-html-parser` 의 `<style>` 블록 추출 정확도 | 양성 fixture (`<style>` 내 hex) + 음성 fixture (var(--*)) 로 단위 검증 |
| measure-quality 의 grep `^template:` 가 YAML 앵커/들여쓰기 변형에 약함 | project-context.md.tmpl 에 top-level 단순 라인으로 강제. `awk` 보다 robust 한 파싱은 후속 |
| figma-rest-image.sh 의 출력 경로가 vite 와 html-static 에서 갈림 | 워커가 template 별 base path 하드코딩 (D4 결정에 따라). 현재 vite 워커는 `src/assets/` 하드코딩되어 있어 html-static 워커는 `public/assets/` 하드코딩 |

## 13. 변경되지 않는 부분 (호환성)

- 기존 `figma × vite-react-ts` / `spec × vite-react-ts` 워크플로 100% 무수정 동작
- `bootstrap.sh` default = `vite-react-ts` 이므로 기존 호출 그대로
- `measure-quality.sh` 는 template 필드 없으면 vite-react-ts default → 기존 프로젝트 backwards-compatible
- 게이트 스크립트 (G1/G7) 는 template 무관하게 공통 동작

## 14. 후속 (Stage 3+)

매트릭스 §Stage 3+ 후보 그대로 유지. server-side templates 는 use case 나올 때 결정.

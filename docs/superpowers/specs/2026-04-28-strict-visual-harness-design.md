# Strict Visual Harness — 설계

**작성일**: 2026-04-28
**상태**: Draft v2 (codex 1차 리뷰 반영)
**브랜치**: `feat/strict-visual-harness`
**트리거**: 사용자 요청 — "diff <5%" 차단 게이트 복원. 단, 옛날 heavy 가 폐기된 이유(absolute 회귀 + 운영 비용)를 동시에 해결.

## 변경 이력

- **v1 → v2 (2026-04-28, codex 리뷰 반영)**:
  - HIGH: G11 을 "absolute 차단" → **layout escape budget** 으로 확장 (transform/negative margin/매직 px/fixed/sticky 포함)
  - HIGH: 호환 룰 reverse — 신규 프로젝트 anchor json 부재 = FAIL, `legacy.json` manifest 있을 때만 SKIP
  - HIGH: L1 5% 의 text-heavy 시나리오 정책 추가, Playwright 안정화 조건 명시
  - HIGH: anchor manifest 에 `required/optional/role/figmaNodeId/selector` 분리, 필수 set 100% / 비율 아닌 개수별 룰
  - MEDIUM: L2 tolerance `max(4px, 1%)` 혼합
  - MEDIUM: `data-allow-absolute` 우회 차단 강화 (text node / span / custom Text / ::before content / SVG text / bg image)
  - MEDIUM: JSON 출력에 `strictEffective: true|false`
  - MEDIUM: `LITE=1` 사용 정책 명시
  - MEDIUM: §13 baseline 갱신 프로토콜 신설

## 1. 목표

`pixel diff ≤ 5%` 약속을 차단 게이트로 복원하되, **AI 가 absolute 로 도망가지 못하게** 다축 합산으로 차단. 옛날 heavy 가 폐기된 두 압력을 다음으로 해체:

- **(a) AI 의 diff 좁히려는 압력 → 픽셀 맞추기 escape**: pixel + 코드 escape budget + 구조 매칭의 다축 게이트로 차단. pixel 통과해도 escape 사용 초과면 FAIL.
- **(c) flex 코드의 1~3px 자연 오차**: pixel diff 단독 평가가 아니라 element bounding-box 매칭(L2) 으로 폰트 렌더링 차이 분리.

## 2. 비목표

- 픽셀 1px 정확도 보장 — L1 5% / L2 max(4px, 1%) 가 합리적 상한.
- spec 모드의 L2 매칭 (Figma 노드 좌표 부재) — figma 모드만 L2, spec 모드는 L1 + escape budget + 멀티뷰포트 강제 (δ).
- 옛 baseline png 만 있는 기존 프로젝트의 즉시 strict 적용 — `baselines/<section>/legacy.json` manifest 로 옵트인 점진 동작.
- 워커가 아닌 사용자가 attribute 수동 박는 흐름 — 모든 자동화 워커 안에서.

## 3. 핵심 결정

| Q | 결정 | 핵심 |
|---|---|---|
| Q2 | (B) 다축 합산 차단 | pixel + 코드 escape budget + 구조 모두 PASS 시에만 PASS |
| Q3 | (α)+(δ) 하이브리드 | section escape budget 정적 차단 + 멀티뷰포트 강제 |
| Q4 | (D) 2단계 측정 | L1 pixel diff(≤5%) + L2 DOM bbox(`max(4px, 1%)`) |
| Q5 | (B)+절감 기법 | 정직한 헤비, 섹션당 ~30~50초 |
| Q6 | (R) 모드별 차등 | figma=L1+L2, spec=L1+escape+(δ) |
| Q7 | (M2)+`data-anchor` manifest | 워커가 박음 + 자동검증 게이트, manifest 에 required/optional/role/nodeId |
| **신** | strict default + legacy 옵트인 | 신규 프로젝트는 anchor 부재 = FAIL. `baselines/<section>/legacy.json` 만 SKIP |
| **신** | layout escape budget | absolute 외 fixed/sticky/transform/negative margin/매직 px 카운트 |

## 4. 게이트 구성

### 차단 게이트 표

| G | 도구 | 의미 | 양 모드 |
|---|---|---|---|
| G1 (strict) | `check-visual-regression.mjs` 확장 | L1 pixel ≤5% + L2 bbox `max(4px, 1%)` + 3 viewport 통과 | figma: 풀세트 / spec: L1 + multi-viewport, L2 SKIP |
| G4 | `check-token-usage.mjs` | hex literal 금지 | 동일 |
| G5 | eslint jsx-a11y | 시맨틱 / a11y | 동일 |
| G6 | `check-text-ratio.mjs` | 텍스트 raster 차단 | 동일 |
| G8 | `check-text-ratio.mjs` | JSX literal text | 동일 |
| G10 | `check-write-protection.mjs` | SSoT 수정 차단 | 동일 |
| **G11 (신규)** | `check-layout-escapes.mjs` | section 의 layout escape budget 차단 (absolute/fixed/sticky/transform/negative margin/매직 px) | 동일 |

선택적 게이트 G7 (Lighthouse) 변경 없음.

## 5. G1 (strict) 상세 동작

### 입력

```bash
node scripts/check-visual-regression.mjs \
  --section <id> \
  --baseline-dir baselines/<section>/ \
  --viewports desktop,tablet,mobile \
  --threshold-l1 5 \
  --threshold-l2-px 4 \
  --threshold-l2-pct 1 \
  --strict
```

### Playwright 안정화 조건 (필수)

L1/L2 측정 안정성을 위해 매 측정 직전 보장:

```javascript
await page.goto(url, { waitUntil: "networkidle", timeout: opts.timeout });
await page.evaluate(() => document.fonts.ready);  // 웹폰트 로딩 완료
await page.addStyleTag({ content: `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
  }
`});  // 애니메이션 / 트랜지션 frozen
await page.waitForFunction(() => !document.querySelector("img:not([complete])")); // 이미지 로딩
```

브라우저 컨텍스트:
- `deviceScaleFactor: 1` 고정
- `colorScheme: "light"` 고정 (별도 dark 측정은 future scope)
- Chromium 버전은 `package.json` 의 playwright 버전으로 고정 (semver 허용 안 함, 정확한 minor)

### 측정 흐름

```
launch chromium (1회)
  └─ 3 viewport 병렬 (Promise.all):
       ├─ L1: 풀페이지 PNG 캡처 → baseline pixel diff (≤ threshold-l1%)
       │       text-heavy 섹션 예외: anchor role="text-block" 인 영역은 L1 만 ±50%
       │       완화 (L2 가 본질, L1 은 "큰 drift" 만 차단)
       └─ L2: page.evaluate() 로 [data-anchor] 모두 getBoundingClientRect()
              → baselines/<section>/anchors-<viewport>.json 의 좌표와 매칭
              → 절대오차 ≤ max(threshold-l2-px, threshold-l2-pct% × element 변)
```

### L1 — text-heavy 정책

`anchors-*.json` 의 anchor 중 `role: "text-block"` 으로 표시된 element 의 bbox 영역은 L1 비교에서 **mask 처리** (해당 픽셀 범위 무시). 이유:
- 큰 텍스트 / CJK 헤드라인 / 웹폰트 fallback 으로 1px AA 차이가 면적 크게 발생
- L1 은 "큰 drift 차단" 으로만, 텍스트 영역의 시각적 일치는 **L2 의 bbox 위치/크기** 로 검증

이렇게 하면 큰 텍스트 섹션도 L1 5% 안에 들어옴 — 진짜 layout 회귀 (큰 background/이미지 변경) 만 잡힘.

### L2 — mixed tolerance

```
delta_x_max = max(threshold-l2-px, threshold-l2-pct% × element.width)
delta_y_max = max(threshold-l2-px, threshold-l2-pct% × element.height)
```

작은 element (예: 24px 아이콘) 는 4px 정밀도. 큰 element (예: 800px wide hero) 는 8px (= 1%) 까지 허용. 멀티라인 텍스트 height 는 별도 tolerance:

```
text_block 의 height: max(threshold-l2-px × 2, threshold-l2-pct% × element.height)
```

= 한 줄 누락/추가 정도의 변화는 잡지만, 줄 간격 미세 변화는 통과.

### 출력 (단일 JSON 줄)

```json
{
  "section": "hero",
  "status": "PASS|FAIL|SKIPPED|NO_BASELINE",
  "strictEffective": true,
  "reason": null,
  "viewports": {
    "desktop": {
      "l1": { "diffPercent": 2.1, "maskedAreas": ["hero/title", "hero/subtitle"], "pass": true },
      "l2": {
        "anchorsMatched": 7,
        "anchorsTotal": 7,
        "requiredMatched": 4,
        "requiredTotal": 4,
        "maxDeltaPx": 2,
        "pass": true
      }
    },
    "tablet": { ... },
    "mobile": { ... }
  }
}
```

`strictEffective`:
- `true`: L1 + L2 + 모든 viewport 가 본격 평가됨
- `false`: 어떤 축이든 SKIP 됨 (anchor json 부재 / viewport baseline 부재 / `LITE=1`). `reason` 에 사유 명시. PR/CI summary 가시화.

### FAIL 조건

하나라도 해당 시 FAIL:
- 어떤 viewport 의 L1 diffPercent > threshold-l1
- 어떤 viewport 의 L2 maxDelta > tolerance
- **필수 anchor (required:true) 미매칭** (개수 룰은 §7 anchor manifest 참조)
- baseline 의 anchor 중 코드에 매칭된 비율이 §7 룰 미달

### SKIP / FAIL 분기 (호환성 reverse)

| 상황 | 동작 |
|---|---|
| `baselines/<section>/legacy.json` 존재 + anchor json 부재 | L2 SKIP, L1 만 평가, `strictEffective: false` |
| `legacy.json` 부재 + anchor json 부재 | **FAIL** (`reason: "missing anchor manifest"` — strict 강제) |
| `<viewport>.png` 부재 + `legacy.json` 에 viewport 명시 누락 | 해당 viewport NO_BASELINE (FAIL) |
| `<viewport>.png` 부재 + `legacy.json` 에 viewport opt-out | 해당 viewport SKIP, `strictEffective: false` |
| Playwright/dev서버 미비 | `SKIPPED` (env 문제, 사용자 개입 필요) |
| `LITE=1` env | 모든 strict 기능 옵트아웃, `strictEffective: false`, `reason: "LITE env"` |

`legacy.json` 형식:
```json
{
  "version": 1,
  "reason": "기존 프로젝트, strict 점진 도입 중",
  "skipL2": true,
  "skipViewports": ["tablet", "mobile"],
  "createdAt": "2026-04-28"
}
```

## 6. G11 — `check-layout-escapes.mjs` (escape budget)

absolute 만 막는 게 아니라 **layout escape 행위 전체를 카운트**. AI 가 absolute 외 다른 escape 로 도망가는 우회 차단.

**카운트 단위**: section root subtree 1개 = `data-anchor="<id>/root"` 의 자손 트리 (whitelist 디렉터리 import 한 컴포넌트의 dependency closure 포함). 한 파일에 여러 section 이 있으면 각 root subtree 별로 카운트.

### 검사 대상 (모두 카운트)

| 카테고리 | 패턴 | 차단 임계 |
|---|---|---|
| **A. positioning escape** | `absolute`, `fixed`, `sticky`, inline `position:*` | section 당 0 (root 제외) |
| **B. transform escape** | `transform: translate(*)`, Tailwind `translate-x-*`/`translate-y-*` (px 값) | section 당 ≤2 |
| **C. negative margin** | `margin: -*`, Tailwind `-m*`, `-mt-*`, `-ml-*` 등 | section 당 ≤2 |
| **D. arbitrary px** | Tailwind `[<n>px]`, `w-[37px]`, `h-[42px]`, `gap-[7px]`, inline `style={{ width: '37px' }}` 등 (토큰 외 매직 px) | section 당 ≤3 |
| **E. breakpoint divergence** | `md:left-[37px]`, `lg:translate-x-[18px]` 등 viewport별 매직 px | section 당 ≤2 (A~D 합산이 아닌 추가 카운트) |
| **F. positioning helpers** | Tailwind `inset-*` / `top-*` / `left-*` (px 값, root 의 `relative` 제외) | A 와 함께 카운트 |

### `data-allow-escape` 예외 메커니즘

absolute 외 다른 escape 도 정당한 케이스 있음 (decorative shadow, sticky nav, animation transform 등). 통합 예외:

```tsx
<div data-allow-escape="connector-line">
  ...
</div>
```

룰 (남용 5중 보강):
1. **사유 필수** + reason enum 제한:
   - `decorative-overlap` (장식 도형이 다른 element 와 겹침)
   - `connector-line` (SVG 연결선)
   - `badge-offset` (작은 badge 가 카드 모서리에 살짝 걸침)
   - `sticky-nav` (sticky positioning)
   - `animation-anchor` (transform 애니메이션 앵커)
   - 그 외 자유 텍스트는 FAIL
2. **카운트 상한**: section root subtree 당 사용 ≤ 2회 (= section root 의 자손 트리에서 카운트)
3. **자식 텍스트 차단**: subtree 안에 다음 중 하나라도 있으면 FAIL:
   - element 자식 (`<h*>`, `<p>`, `<button>`, `<a>`, `<span>`, custom Component)
   - text node (직접 text content)
   - i18n 컴포넌트 (`<Trans>`, `<FormattedMessage>` 등 — 컴포넌트 이름 휴리스틱)
   - SVG `<text>`
   - CSS `::before { content: "..." }`, `::after { content: "..." }` (해당 element 의 computed style 검사)
   - background image url 안의 text (별도 검출 어려움 — G6 의 raster 텍스트 검사로 보강)
4. **JSON artifact**: 모든 사용처와 사유를 `tests/quality/escape-report.json` 에 남김. PR/CI summary 에서 diff 가능
5. **stdout 가시화**: `data-allow-escape` 사용량 + 카테고리별 escape 카운트 출력

### 검사 범위 (template 별)

| Template | 차단 | 허용 (whitelist) |
|---|---|---|
| `vite-react-ts` | `src/components/sections/**/*.{tsx,jsx}` | `src/components/{ui,brand,foundation}/**` |
| `html-static` | `public/**/*.html`, `public/css/**/*.css` (단 `tokens.css`/`fonts.css`/`main.css` 는 G10) | `public/_components/**` (있으면) |
| `nextjs-app-router` | `src/app/**/*.{tsx,jsx}`, `src/components/sections/**` | `src/components/{ui,brand,foundation}/**` |

**dependency closure 검사**: section 파일이 import 한 컴포넌트 (whitelist 디렉터리 밖) 도 재귀 검사. 우회로 차단 — "section 에선 깨끗한데 import 한 wrapper 가 absolute 사용" 막음.
- import 그래프는 `@swc/parse` 또는 단순 정규식으로 추출 (성능 우선)
- 외부 패키지 (`node_modules`) 는 검사 안 함 — `react`, `next/image` 등 정상 사용 가정

### 출력

```json
{
  "section": "hero",
  "status": "PASS|FAIL",
  "escapeCounts": {
    "positioning": 0,
    "transform": 1,
    "negativeMargin": 0,
    "arbitraryPx": 2,
    "breakpointDivergence": 0
  },
  "violations": [
    { "file": "Hero.tsx", "line": 42, "category": "arbitraryPx", "pattern": "w-[37px]" }
  ],
  "allowedEscapes": [
    { "file": "Hero.tsx", "line": 18, "reason": "connector-line", "valid": true }
  ],
  "dependencyClosure": ["IconArrow", "BrandLogo"]
}
```

## 7. anchor manifest

기존 단순 `{anchor: bbox}` 매핑이 아닌 **manifest** 로 확장. 필수/선택 분리, 노드 ID 기반 매칭.

### 형식 (`baselines/<section>/anchors-<viewport>.json`)

```json
{
  "version": 2,
  "section": "hero",
  "viewport": "desktop",
  "anchors": [
    {
      "id": "hero/root",
      "role": "section-root",
      "required": true,
      "figmaNodeId": "10:23",
      "bbox": { "x": 0, "y": 0, "w": 1440, "h": 720 }
    },
    {
      "id": "hero/title",
      "role": "primary-heading",
      "required": true,
      "figmaNodeId": "10:24",
      "bbox": { "x": 80, "y": 200, "w": 800, "h": 96 }
    },
    {
      "id": "hero/cta",
      "role": "primary-cta",
      "required": true,
      "figmaNodeId": "10:25",
      "bbox": { "x": 80, "y": 380, "w": 200, "h": 48 }
    },
    {
      "id": "hero/image",
      "role": "primary-media",
      "required": true,
      "figmaNodeId": "10:26",
      "bbox": { "x": 760, "y": 100, "w": 600, "h": 520 }
    },
    {
      "id": "hero/badge",
      "role": "decorative",
      "required": false,
      "figmaNodeId": "10:27",
      "bbox": { ... }
    }
  ]
}
```

### Role 카탈로그

| role | 의미 | 자동 required | 비고 |
|---|---|---|---|
| `section-root` | 섹션 최외곽 컨테이너 | ✅ | 한 섹션에 정확히 1개 |
| `primary-heading` | h1/h2 메인 타이틀 | ✅ | 있으면 반드시 |
| `primary-cta` | 메인 행동 유도 (button/link) | ✅ | 있으면 반드시 |
| `primary-media` | 메인 이미지/일러스트/비디오 | ✅ | 있으면 반드시 |
| `text-block` | 본문 텍스트 영역 | ❌ | L1 mask 적용 (§5) |
| `decorative` | 장식 요소 (badge, divider, connector) | ❌ | escape budget 후보 |
| `secondary-*` | 보조 element (secondary-heading, secondary-cta) | ❌ | optional |

### 매칭 룰 (개수별)

| 필수 anchor | required 100% 강제 | optional 룰 |
|---|---|---|
| 항상 | required role 의 모든 anchor 가 코드에 존재 + bbox 통과 | — |
| optional ≤ 5개 | — | all required (= ≤5는 다 박아야 함) |
| optional 6~10개 | — | 1개 missing 까지 OK |
| optional > 10개 | — | 2개 missing 까지 OK + 중요도 가중치 (`role: secondary-*` 가 missing 인 경우만 허용) |

이렇게 하면 codex 가 짚은 비대칭 (anchor 4개 = 4/4 vs 20개 = 95%) 해결.

### 매칭 메커니즘

코드 측: `data-anchor="hero/title"` (id 그대로) + 옵션 `data-anchor-figma-node="10:24"` (워커가 가능하면 박음)

매칭 우선순위:
1. `data-anchor-figma-node` 일치 우선 — 노드 ID 는 Figma 이름 변경에 강인
2. fallback: `data-anchor` id 일치
3. 둘 다 없으면 매칭 실패 → `strictEffective: false` reason 에 명시

### 추출 측: `extract-figma-anchors.mjs`

Figma REST `/v1/files/<key>/nodes?ids=<sectionId>` 응답에서:
- 노드 트리 traverse, 명명된 노드 (이름이 `Frame N` / `Group` / 빈 문자열 아닌 것) 만 후보
- role 자동 추론:
  - 노드 이름 `Hero/Title` 또는 `Title` + `type=TEXT` + `style.fontSize ≥ 32` → `primary-heading`
  - `type=INSTANCE` 이름이 `Button` / `CTA` 포함 → `primary-cta`
  - `type=RECTANGLE/IMAGE` 가장 큰 면적 → `primary-media`
  - 그 외 텍스트 노드 → `text-block`
  - 그 외 → `decorative`
- 휴리스틱 실패 시 `role: "unknown"` + `required: false` — 워커가 plan 단계에서 manifest 보고 명시 수정 가능

추출된 manifest 는 사람이 읽고 수정 가능 — 자동 추론이 잘못된 role 은 plan 단계에서 워커가 PR 의 코드 리뷰처럼 수정.

## 8. 워커 파이프라인 변경

### 단계 1 — 리서치
**추가**: figma 모드에서 `extract-figma-anchors.mjs` 실행 후 결과 manifest 를 `plan/{section}.md` 에 첨부. 워커가 role 자동 추론 결과 검토 + 필요 시 수정 (예: `unknown` → `primary-cta`).

### 단계 3 — 구현

워커 가이드 (`section-worker.md`) 룰:
- manifest 의 모든 `required: true` anchor 에 대해 `data-anchor="<id>"` 박을 것 (필수)
- `data-anchor-figma-node="<nodeId>"` 도 가능하면 함께 박음 (선택, 매칭 강인성 ↑)
- optional anchor 는 §7 룰 따라 박을 만큼 (≤5는 all, 6-10은 1 missing OK)
- escape budget 카테고리 위반 금지 (§6)

### 단계 4.1 — baseline 준비

```bash
node scripts/prepare-baseline.mjs \
  --mode {figma|spec} \
  --section hero \
  --viewports desktop,tablet,mobile \
  [--file-key <key> --section-node <id>]   # figma
  [--reference-html <path>]                 # spec
  [--force]
```

생성: `baselines/<section>/{viewport}.png` + `anchors-{viewport}.json` (manifest 형식)

### 단계 4.2 — 게이트 (`measure-quality.sh`)

실행 순서 fail-fast:
```
G10 (write-protection)        ← 가장 싸고 즉시 차단
G4  (token usage)
G11 (layout escape budget)    ← 신규, 정적
G5  (eslint a11y)
G6/G8 (text ratio)
G1  (visual regression strict) ← Playwright, 가장 비싼 거 마지막
G7  (Lighthouse, 선택)
```

`measure-quality.sh` CLI 가 변경됨 (기존: G1 단일 viewport 옵셔널 호출 → 새: G1 strict default + viewport 자동 감지). 호출자 인터페이스:

```bash
bash scripts/measure-quality.sh hero src/components/sections/Hero.tsx
# baselines/hero/ 의 viewport 자동 감지 후 G1 strict 실행
```

### retry 가이드

| FAIL | 워커 행동 |
|---|---|
| G11 escape budget 초과 | 카테고리별 룰 따라 재구성. transform → flex/grid, negative margin → 상위 wrapper, 매직 px → 토큰 사용 |
| G1 L1 pixel diff | diff PNG 확인 → spacing/typography 토큰 재점검. text-heavy 영역이면 anchor 의 `role: "text-block"` 표시 누락 가능성 |
| G1 L2 required anchor missing | manifest 의 required 리스트 확인, 정확히 그 element 에 박기 |
| G1 L2 bbox delta | 해당 anchor element 의 width/height/margin 점검. **escape budget 남발 금지** (G11 으로 재차단) |
| G1 NO_BASELINE | `prepare-baseline.mjs` 자동 호출 후 한 번 더 |
| G1 anchor manifest missing (신규 프로젝트) | `prepare-baseline.mjs` 자동 호출. `legacy.json` 옵션은 사용자 개입 분기 |

자체 retry 1회 후도 FAIL → 사용자 개입 분기 (Opus 승격 / 수동 / 스킵 / 재분할 / **baseline 갱신** / **legacy.json 추가**).

## 9. 신규 / 변경 / Deprecated 매트릭스

| 종류 | 파일 | 비고 |
|---|---|---|
| 신규 | `scripts/prepare-baseline.mjs` | png + anchor manifest 통합 생성 |
| 신규 | `scripts/extract-figma-anchors.mjs` | figma 노드 트리 → manifest (role 자동 추론) |
| 신규 | `scripts/check-layout-escapes.mjs` | G11 escape budget 차단 (정적 + dependency closure) |
| 신규 | `scripts/migrate-baselines.mjs` | 기존 프로젝트 1회 마이그레이션 (legacy.json 자동 생성 + 가능하면 manifest 추출) |
| 변경 | `scripts/check-visual-regression.mjs` | strict 옵션 + L2 mixed tolerance + multi-viewport 병렬 + Playwright 안정화 + manifest v2 + L1 mask + strictEffective |
| 변경 | `scripts/measure-quality.sh` | G11 추가, G1 strict default, fail-fast 순서, viewport 자동 감지 |
| 변경 | `.claude/agents/section-worker.md` | anchor manifest 룰 + retry 카테고리 가이드 + escape budget |
| 변경 | `docs/workflow.md` | 4.1/4.2 단계 갱신, baseline 갱신 프로토콜 (§13) 추가 |
| 변경 | `CLAUDE.md` (프로젝트) | 차단 게이트 표 + G11 추가 |
| Deprecated → 삭제 | `scripts/fetch-figma-baseline.sh` / `scripts/render-spec-baseline.mjs` | `prepare-baseline.mjs` 로 흡수 |

## 10. 호환성

`baselines/<section>/legacy.json` manifest 도입으로 기존 프로젝트 옵트인 분리.

| 상황 | 동작 |
|---|---|
| 신규 프로젝트, anchor json 부재 | **FAIL** (strict 강제, `legacy.json` 없으면 SKIP 못 함) |
| 기존 프로젝트, `legacy.json` 만 추가 | L2 SKIP, L1 만 평가, `strictEffective: false` (가시화) |
| 기존 프로젝트, `migrate-baselines.mjs` 실행 후 manifest 추출 성공 | 자동 strict 진입 |
| 기존 프로젝트, manifest 추출 부분 성공 | 가능한 viewport 만 strict, 나머지 `legacy.json` 의 `skipViewports` 로 명시 |
| `LITE=1` env | 전체 strict 옵트아웃, `strictEffective: false`, `reason: "LITE env"` 가시화 |

### `LITE=1` 사용 정책

- **개발 로컬 긴급 우회만 허용**. CI 에서는 차단 (`LITE=1` 감지 시 measure-quality.sh 가 즉시 FAIL)
- 결과 JSON 의 `strictEffective: false` + `reason` 으로 항상 가시화
- 사용 시 commit 메시지에 사유 명시 권장 (관례, 강제 X)

## 11. 출시 전략

**default strict + legacy 옵트인**. 별도 phase 없음.

이유:
- `legacy.json` manifest 가 명시적 옵트인 표기 — 워커가 우연히 SKIP 으로 빠지지 않음
- "<5% diff 차단" 즉시 실현
- 검증은 publish-harness 본 리포 fixture + 사용자 dogfooding

## 12. 테스트 전략

`fixtures/strict-gate/`:

```
fixtures/strict-gate/
  pass/
    src/components/sections/Hero.tsx           ← 정직한 flex + manifest 통과
    baselines/hero/{desktop,tablet,mobile}.png + anchors-{viewport}.json
  fail-positioning/                            ← G11 absolute/fixed/sticky FAIL 기대
  fail-transform-overflow/                     ← G11 transform escape 초과 FAIL 기대
  fail-arbitrary-px/                           ← G11 매직 px > 3 FAIL 기대
  fail-anchor-required-missing/                ← G1 L2 required missing FAIL 기대
  fail-anchor-bbox-delta/                      ← G1 L2 bbox delta 초과 FAIL 기대
  fail-pixel-diff-no-mask/                     ← L1 5% 초과 (text-heavy mask 없이) FAIL 기대
  pass-text-heavy-with-mask/                   ← L1 ~12% 지만 text-block mask 로 PASS
  pass-legacy-skip/                            ← legacy.json 으로 L2 SKIP, strictEffective: false
  fail-no-anchor-manifest/                     ← legacy.json 없는데 anchor json 부재 → FAIL
  fail-data-allow-escape-text-child/           ← data-allow-escape subtree 에 텍스트 → FAIL
  pass-data-allow-escape-decorative/           ← decorative SVG 에 정당 사용 → PASS
```

검증 스크립트:
```bash
bash scripts/test-strict-gates.sh
# → 각 fixture 에서 measure-quality.sh 실행
# → 정확히 그 게이트만 PASS/FAIL 검증
```

multi-viewport fixture 필수 — desktop only 로는 `δ` 강제 검증 안 됨.

## 13. baseline 갱신 프로토콜

옛 heavy 폐기 원인 중 하나: "Figma 가 변경됐는지 코드가 회귀했는지 구분 안 됨". 이 spec 에서 명시.

### 갱신 흐름 (디자인 PR vs 구현 PR 분리)

| 시나리오 | 처리 |
|---|---|
| Figma 디자인 변경됨 (디자이너가 알림) | "디자인 변경 PR" — `prepare-baseline.mjs --force --section <id>` 실행, 새 baseline + 새 manifest 가 commit. 코드 변경 없으면 PASS 유지 |
| 구현 회귀 (코드 변경으로 FAIL) | "구현 PR" — baseline 갱신 금지. 코드 수정해서 PASS. baseline 갱신은 디자인 PR 으로만 |
| 둘 다 (Figma 변경 + 구현 변경) | 두 PR 분리 권장. 같은 PR 이면 commit 분리 + 검토자가 각각 리뷰 |

### `prepare-baseline.mjs --force` 출력

baseline 갱신 시 stdout 에 **anchor diff report** 출력:
```
Anchor changes:
  hero/title:    bbox (80, 200, 800, 96) → (80, 180, 800, 110)  [delta: y=20, h=14]
  hero/cta:      role "primary-cta" → "secondary-cta"
  hero/badge:    REMOVED
  hero/social:   ADDED (role=decorative)
```

리뷰어가 "디자인 의도된 변경" 인지 확인 가능. 단순 `--force` 만 두면 silent 갱신 위험 — 강제 출력으로 가시화.

### 캐싱

`prepare-baseline.mjs` 의 mtime 캐싱 (figma `lastModified` / spec mtime) 은 그대로. 단:
- Figma `lastModified` 는 **파일 전체** 변경일 — section node 만 변경됐는지 불명
- 따라서 mtime 일치하면 SKIP, 불일치하면 강제 재추출 + 위 anchor diff report 로 검증

## 14. 리스크 & 대응

| 리스크 | 대응 |
|---|---|
| Figma 노드 이름 모호 → role 자동 추론 실패 | `role: "unknown"` 으로 표기, 워커가 plan 단계에서 수정. fallback 으로 매칭 가능 |
| 워커가 anchor 빠뜨림 | 1차 자체 retry, 그 후 사용자 개입 분기 |
| flex 코드도 L1 5% 못 넘는 텍스트 케이스 | `role: "text-block"` mask 로 텍스트 영역 제외, L2 의 bbox 만 검증 |
| baseline mtime 캐시 stale | `--force` + figma `lastModified` 비교 + 갱신 시 anchor diff report 강제 출력 |
| `data-allow-escape` 남용 | 5중 보강 (사유 enum / ≤2회 / 텍스트 자식 차단 / artifact 기록 / stdout 가시화) |
| 섹션당 ~50초 시간 부담 | Playwright 캐싱 + 3 viewport 병렬 + baseline 캐시. 첫 실행 50초, 재실행 30초 |
| 호환 룰이 우회 경로화 | `legacy.json` 명시 manifest 만 SKIP 허용, `strictEffective: false` 항상 가시화, CI 에서 `LITE=1` 차단 |
| Whitelist 디렉터리 (`ui/brand`) 에 absolute 숨겨서 import | Dependency closure 검사로 wrapper 컴포넌트도 escape budget 적용 |
| Pseudo-element / SVG text / 동적 className | static 검사 한계. G11 은 명시적 패턴만 잡음. dynamic className (`clsx("ab" + "solute")`) 같은 케이스는 휴리스틱 (단순 정규식) 외 검사 어려움 — 알려진 한계 |
| Chromium / Skia 버전 변경으로 baseline 깨짐 | Playwright minor 버전 고정. CI 에서 `npx playwright install --with-deps` 정확한 버전 |
| 디버깅 비용 (어느 anchor / DOM 회귀인지 추적 어려움) | failure artifact: current/baseline/diff PNG + anchor delta table + DOM selector + screenshot crop |
| 운영 SLO 부재 | dogfooding M10 에 false-positive < 5% 외 평균 runtime / retry율 / SKIP율도 기록 |

## 15. 마일스톤

| M | 산출물 | 검증 |
|---|---|---|
| M1 | `prepare-baseline.mjs` (figma + spec 통합, 캐싱, anchor diff report) | png + manifest 동시 생성, --force 시 diff report 출력 |
| M2 | `extract-figma-anchors.mjs` (role 자동 추론) | 노드 트리 → manifest (required/optional/role/figmaNodeId 포함) |
| M3 | `check-visual-regression.mjs` strict 확장 (Playwright 안정화 + L1 mask + L2 mixed tolerance + manifest v2) | fixture pass/ PASS, fail-pixel-diff-no-mask FAIL, pass-text-heavy-with-mask PASS |
| M4 | `check-layout-escapes.mjs` (G11) | fixture fail-positioning / fail-transform-overflow / fail-arbitrary-px FAIL, pass/ PASS, dependency closure 검사 |
| M5 | `measure-quality.sh` G11 추가 + fail-fast 순서 + viewport 자동 감지 + LITE=1 처리 | 통합 PASS/FAIL 일관성, LITE=1 시 strictEffective=false |
| M6 | `section-worker.md` anchor manifest 룰 + retry 카테고리 + escape budget | 워커가 신규 룰 따라 박음 |
| M7 | `migrate-baselines.mjs` + `bootstrap.sh` 신규 스크립트 복사 | 기존 프로젝트 1회 마이그레이션 (legacy.json 자동 생성 또는 manifest 추출) |
| M8 | fixture 11종 + `test-strict-gates.sh` (multi-viewport 포함) | 모든 fixture 의도대로 PASS/FAIL |
| M9 | `docs/workflow.md` / `CLAUDE.md` 게이트 표 갱신 + §13 baseline 갱신 프로토콜 | G11 + G1 strict 명시, 디자인/구현 PR 분리 |
| M10 | dogfooding 1개 페이지 (publish-harness 본 리포 또는 사용자 운영 프로젝트) | 실제 페이지 strict 통과, false-positive < 5%, 평균 runtime / retry율 / SKIP율 기록 |

### 의존성 그래프

```
M1 (baseline + manifest 포맷)
 └─ M2 (figma anchor 추출)  ←  manifest 형식 의존
     └─ M3 (G1 strict)         ←  manifest v2 의존
M4 (G11) — 독립
M3 + M4 ─┐
         └─ M5 (measure-quality 통합)
            └─ M6 (워커 가이드)
            └─ M8 (fixture 검증)
M5 ─┐
    └─ M7 (migrate-baselines)
       └─ M9 (docs)
          └─ M10 (dogfooding)
```

## 16. 다음 단계

이 spec 승인 → `superpowers:writing-plans` 스킬로 구현 플랜 작성. 마일스톤 M1~M10 을 실행 가능한 작은 단위로 분해.

LOW priority 처리 (codex 1차 리뷰 중 plan 단계 위임):
- G1 CLI 인터페이스 변경의 정확한 마이그레이션 단계
- `measure-quality.sh` fail-fast 순서 변경의 backward compat 처리
- multi-viewport fixture 의 정확한 baseline 데이터 (실제 PNG 생성)
- 운영 시나리오 추가 케이스 (Figma node rename / partial viewport 갱신)

# Strict Visual Harness — 설계

**작성일**: 2026-04-28
**상태**: Draft v5 (modern-retro-strict 1차 dogfooding 회고 반영)
**브랜치**: `feat/strict-visual-harness`
**트리거**: 사용자 요청 — "diff <5%" 차단 게이트 복원. 단, 옛날 heavy 가 폐기된 이유(absolute 회귀 + 운영 비용)를 동시에 해결.

## 변경 이력

- **v4 → v5 (2026-04-30, modern-retro-strict 1차 dogfooding 회고 반영)**:
  - **명칭 vs 보장 갭 명시 (§명세 보강)**: "G1 strict 는 **coherence 게이트**지 **design fidelity 게이트가 아님**" — 회고 §3.1 직격
  - 회고 §2.2 M1+M2 메커니즘 ("잘못된 환경 baseline → strict 영원히 PASS") 차단:
    - §5 G1 strict 의 "Playwright 안정화 조건" 을 **"환경 무결성 sanity check"** 로 격상
    - 콘솔 에러 0건 검증 (woff2 OTS / 404 / decode) — 신규
    - 사용 폰트 family ↔ document.fonts 등록 cross-check — 신규
  - 회고 §5.1 B1 (tsconfig noEmit) / B3 (prepare-baseline Windows async crash) — spec 외부 운영 fix, plan 후속 PR 로 처리 (별도 commit b5c82e1 / 54578f5)
  - 회고 §4.2 N3 (extract-tokens named color 빈도 무관 전수) / §4.2 N7 (woff2 무결성 검증) / §4.3 G13 (DS variant 매트릭스) — §16 알려진 한계 추가
  - "환경 무결성" 별도 게이트 G12 신설 X — G1 strict 의 일부로 통합 (게이트 수 늘리는 비용 > 분리 이득)
- **v3 → v4 (2026-04-28, 목적 검증 인터뷰 반영)**:
  - 사각지대 #1 보강: 사용자 환경에 mobile/tablet figma 디자인 거의 없음 발견 → (δ) 무력화 위험
  - 해결: Phase 2 분해 단계에서 **figma `use_figma` MCP 도구로 mobile/tablet frame 자동 생성**
  - 디자이너 부재 회사 시나리오: Claude 가 디자이너 역할 (use_figma 로 figma 안에서 처리, 사용자 승인 1회)
  - figma 가 진실의 원천 그대로 — node ID 생성됨 → 우리 figma 모드 변경 0
  - 추가 비용 0 (Anthropic 토큰만)
  - fallback 옵션 (Nano Banana Pro / Gemini chat 수동 / Gemini CLI OAuth) 은 §16 알려진 한계로 메모
- **v2 → v3 (2026-04-28, codex 2차 리뷰 반영)**:
  - HIGH: G11 whitelist 의미 모순 해결 — `ui/brand/foundation` 은 "직접 스캔 안 함" 이지만 section root 의 dependency closure 에 포함되면 escape budget 에 카운트
  - HIGH: `legacy.json` 거버넌스 — `createdBy`/`sourceCommit`/`expiresAt` 필수 필드, `migrate-baselines` 만 생성 가능, CI 에서 구현 PR 의 신규 legacy 추가 FAIL
  - HIGH: text-block mask 총면적 상한 (section area 의 35%), 실제 text-bearing element 에만 허용
  - HIGH: G11 에 Playwright runtime computed-style sweep 추가 — 동적 class / CSS module / runtime style object 우회 차단
  - 보강: section-root 의 L2 tolerance 일반보다 엄격 (1% → 0.5%)
  - 보강: unknown role 비율 30% 초과 시 manifest review required 분기
  - 보강: `data-allow-escape` 가 escape budget 카운트에서 제외 명시 (별도 allowedEscapes 보고)
- **v1 → v2 (2026-04-28, codex 1차 리뷰 반영)**:
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

### 1.1 명칭 vs 보장 갭 — coherence 게이트 (v5 명시)

**G1 strict 는 "디자인 원본 vs 구현" 이 아니라 "내 baseline vs 내 코드" 만 본다.** baseline 자체가 잘못된 상태에서 박히면 strict 는 영원히 PASS 한다 (modern-retro-strict §retro-phase1-4 M1/M2/M3).

→ G1 strict 는 **coherence 게이트** (회귀 detection): "한 번 박힌 상태에서 코드가 그 상태를 깨뜨리지 않는가". design fidelity 보장이 아님.

**design fidelity 의 책임 분담**:
- **워커**: figma 노드 → 코드 변환 시 의도된 디자인 결정 (폰트 family 등록 / 토큰 정확 매핑 / DS variant 사용)
- **프로젝트 단위 dogfooding**: 사람이 figma 와 결과 페이지를 시각 비교 (하네스 자동화 영역 외)
- **G1 strict**: 박힌 baseline 의 회귀 차단 — 환경 무결성 sanity check (§5) 로 baseline 자체가 잘못 박히는 것만 차단

이걸 명시하지 않으면 사용자가 "G1 strict PASS = figma 와 일치" 로 오해. 회고 §3.1 핵심 지적.

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
| **신 (v4)** | (ε) figma `use_figma` 자동 multi-viewport | desktop only figma 에서 Phase 2 분해 시 자동으로 mobile/tablet frame 생성 (Claude = 디자이너 역할) |

## 4. 게이트 구성

### 차단 게이트 표

| G | 도구 | 의미 | 양 모드 |
|---|---|---|---|
| G1 (strict) | `check-visual-regression.mjs` 확장 | L1 pixel ≤5% + L2 bbox `max(4px, 1%)` + 3 viewport 통과 + **환경 무결성 sanity check** (v5: 콘솔 에러 0건 + 폰트 family cross-check) | figma: 풀세트 / spec: L1 + multi-viewport, L2 SKIP |
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

### 환경 무결성 sanity check (필수, v5 격상)

dev 서버 캡처 직전 환경 검증 — **박힌 baseline 자체가 잘못된 환경 (폰트 fallback / 콘솔 에러) 으로 캡처되어 strict 가 영원히 PASS 하는 회로 차단**. modern-retro-strict §retro-phase1-4 M1+M2 직격.

**검증 항목** (`_lib/playwright-stable.mjs` 의 `assertEnvironmentClean`):

1. **콘솔 에러 0건** — `attachConsoleErrorCollector(page)` 가 `console`/`pageerror` 수집. 캡처 직전 에러 0 검증.
   - 자주 보이는 패턴: `Failed to decode downloaded font`, `OTS parsing error`, 404 (fonts/assets)
   - 1건이라도 있으면 캡처 abort + FAIL
2. **사용 폰트 family ↔ `document.fonts` 등록 cross-check** — 페이지 안 모든 element 의 `getComputedStyle().fontFamily` 추출 vs `document.fonts` 의 `loaded` 상태 비교
   - missing family 있으면 캡처 abort + FAIL
   - generic family (`serif`, `sans-serif`, `monospace`, `system-ui` 등) 는 제외
3. **`document.fonts.ready` 대기** + 애니메이션 frozen + 이미지 load 완료 (기존 `stabilizePage` 동작 유지)

호출 위치 (`check-visual-regression.mjs`):
- lite 모드 `--update-baseline` (워커 우회 경로) + 일반 비교
- strict 모드 각 viewport 캡처 직전

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

**mask 무력화 방지 (codex v2 리뷰 반영)**:

워커가 큰 영역을 `text-block` 으로 잡으면 hero 대부분이 mask 되어 이미지/배경 drift 도 숨길 위험. 두 가지 안전장치:

1. **mask 총면적 상한**: 한 viewport 의 mask 처리된 픽셀 합계가 **section bbox 의 35% 초과** 시 FAIL (`reason: "text-block mask 면적 초과"`). 35% 는 hero 같이 텍스트 비중 높은 섹션도 통과 가능한 합리적 상한.
2. **text-bearing element 만 허용**: extract-figma-anchors 가 Figma `type=TEXT` 노드만 `role: "text-block"` 후보로 식별. 일반 컨테이너 (`type=FRAME/GROUP`) 는 거부. 코드 측 `data-anchor` 도 게이트가 `getComputedStyle().display === "inline"` 또는 element 가 `<h*>/<p>/<span>/<li>/<dt>/<dd>` 등 텍스트 시맨틱 element 인지 검사 — 일반 `<div>` 는 거부.

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

**section-root 별도 tolerance (codex v2 리뷰)**:

`role: "section-root"` anchor 는 일반 1% 보다 엄격하게 — `0.5% × element 변` 또는 `4px` 중 큰 값. section root 가 흔들리면 모든 자식 좌표가 함께 흔들리므로 가장 안정적이어야 함.

```
section_root 의 delta_max = max(threshold-l2-px, 0.5% × element 변)
```

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

`legacy.json` 형식 (v3 — 거버넌스 필드 강제):
```json
{
  "version": 2,
  "reason": "기존 프로젝트, strict 점진 도입 중",
  "skipL2": true,
  "skipViewports": ["tablet", "mobile"],
  "createdAt": "2026-04-28",
  "createdBy": "migrate-baselines",
  "sourceCommit": "ccbbdf8",
  "expiresAt": "2026-07-28"
}
```

**거버넌스 룰 (codex v2 리뷰)**:

1. **`createdBy` 화이트리스트**: `migrate-baselines` 또는 `bootstrap` 만 허용. 그 외 (워커/사용자 수동) 는 게이트가 invalid 로 취급 → FAIL. 게이트가 file 내용에 더해 git blame 검증도 가능 (`git log --diff-filter=A -- baselines/<section>/legacy.json` 의 작성자 ≠ 워커 commit 패턴이면 의심)
2. **`sourceCommit` 필수**: legacy 발급 시점의 commit hash. legacy 가 그 commit 이후 다른 변경에 묻어가지 않도록 추적 가능
3. **`expiresAt` 강제**: 발급 후 90일 자동 만료. 만료 후 게이트 FAIL (`reason: "legacy expired YYYY-MM-DD"`). expiresAt 갱신은 `migrate-baselines.mjs --renew` 만 가능
4. **CI 차단**: `scripts/check-legacy-additions.mjs` 가 PR diff 검사 — 새 legacy.json 추가가 있고 그 PR 이 코드 변경 (구현 PR) 도 함께 포함하면 FAIL. `--migration-only` 플래그가 있는 commit (= migrate-baselines 단독 PR) 만 허용
5. **사용자 개입 분기에서 직접 생성 금지**: spec v2 의 "사용자 개입 분기 / legacy.json 추가" 옵션 삭제. 워커 retry 실패 시 사용자가 할 수 있는 건 "migrate-baselines 호출" 또는 "Opus 승격 / 수동 / 스킵" 뿐. legacy 직접 작성 옵션 없음

이렇게 하면 "실패한 strict 를 legacy 로 덮는" 운영 패턴 차단.

## 6. G11 — `check-layout-escapes.mjs` (escape budget)

absolute 만 막는 게 아니라 **layout escape 행위 전체를 카운트**. AI 가 absolute 외 다른 escape 로 도망가는 우회 차단.

**카운트 단위**: section root subtree 1개 = `data-anchor="<id>/root"` 의 자손 트리 + dependency closure. 한 파일에 여러 section 이 있으면 각 root subtree 별로 카운트.

### 검사 두 축 (정적 + runtime)

**정적 축** — 코드 파일 정규식/AST 검사. JSX className / inline style / Tailwind 패턴 잡음. 빠르고 결정적. 단, 동적 합성(`clsx("ab" + "solute")`) / CSS module / runtime style object / CSS custom property 같은 우회는 못 잡음.

**runtime 축 (codex v2 리뷰 신규)** — Playwright 가 어차피 G1 strict 측정 차원에서 dev 서버에 접속하는 시점에, section root subtree 의 모든 element 의 `getComputedStyle()` sweep. 진짜 적용된 스타일을 검사하므로 정적 우회 모두 차단. G1 과 같은 Playwright 세션 안에서 호출 — 추가 비용 작음.

```javascript
// runtime sweep 로직 개요
const violations = await page.evaluate((sectionRootSelector) => {
  const root = document.querySelector(sectionRootSelector);
  const all = root.querySelectorAll("*");
  const result = { positioning: [], transform: [], negativeMargin: [], offset: [] };
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (["absolute", "fixed", "sticky"].includes(cs.position)) {
      result.positioning.push({ tag: el.tagName, pos: cs.position });
    }
    if (cs.transform && cs.transform !== "none") {
      result.transform.push({ tag: el.tagName, value: cs.transform });
    }
    for (const side of ["marginTop", "marginRight", "marginBottom", "marginLeft"]) {
      if (parseFloat(cs[side]) < 0) result.negativeMargin.push({ tag: el.tagName, side, value: cs[side] });
    }
    if (cs.position !== "static") {
      for (const side of ["top", "right", "bottom", "left"]) {
        const v = parseFloat(cs[side]);
        if (!Number.isNaN(v) && v !== 0) result.offset.push({ tag: el.tagName, side, value: cs[side] });
      }
    }
  }
  return result;
}, sectionRootSelector);
```

정적 + runtime 결과를 합산해 budget 검사 (중복 제거 후). 각 카테고리 임계 동일.

### 검사 대상 (모두 카운트)

| 카테고리 | 패턴 (정적) | runtime 등가 | 차단 임계 |
|---|---|---|---|
| **A. positioning escape** | `absolute`/`fixed`/`sticky`, inline `position:*` | computed `position` ∈ {absolute,fixed,sticky} | section 당 0 (root 제외) |
| **B. transform escape** | `transform: translate(*)`, Tailwind `translate-x-*`/`-y-*` (px 값) | computed `transform` !== "none" | section 당 ≤2 |
| **C. negative margin** | `margin: -*`, Tailwind `-m*` 등 | computed margin* < 0 | section 당 ≤2 |
| **D. arbitrary px** | Tailwind `[<n>px]`, inline `style={{ width: '37px' }}` (토큰 외) | (정적만 — runtime 에선 토큰 vs 매직 구분 어려움) | section 당 ≤3 |
| **E. breakpoint divergence** | `md:left-[37px]`, `lg:translate-x-[18px]` | (정적만 — 한 viewport 측정으로는 분기 못 봄. 3 viewport 측정 시 좌표 차이로 간접 검출) | section 당 ≤2 |
| **F. positioning helpers** | Tailwind `inset-*` / `top-*` / `left-*` (px 값) | computed `top/right/bottom/left` !== 0 (position !== static 일 때) | A 와 함께 카운트 |

**중요**: `data-allow-escape` 의 subtree 는 정적/runtime 양 축 모두 카운트에서 **제외**. 별도 `allowedEscapes` 배열로만 보고 (남용 가시화).

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

**원칙 (codex v2 리뷰 명확화)**:
- "직접 스캔" = 게이트가 단독으로 검사하는 파일 (= 그 안 escape 발견 시 즉시 violation)
- "dependency closure 포함" = section 에서 import 되어 section root subtree 의 렌더 트리에 포함되면 budget 에 카운트되는 컴포넌트. 단독으로는 검사하지 않음 (= 어디서도 import 안 된 ui/brand 컴포넌트는 escape 가 있어도 violation 아님)

| Template | 직접 스캔 (section files) | dependency closure 검사 (section 에서 import 시 포함) | 검사 안 함 |
|---|---|---|---|
| `vite-react-ts` | `src/components/sections/**/*.{tsx,jsx}` | `src/components/{ui,brand,foundation}/**`, 그 외 first-party 컴포넌트 | `node_modules/**`, react, next/image 등 외부 패키지 |
| `html-static` | `public/**/*.html`, `public/css/**/*.css` (단 G10 보호 대상 제외) | `public/_components/**` (있으면), 그 외 first-party 부분 템플릿 | 외부 CDN |
| `nextjs-app-router` | `src/app/**/*.{tsx,jsx}`, `src/components/sections/**` | `src/components/{ui,brand,foundation}/**`, 그 외 first-party | `node_modules/**` |

**dependency closure 추출**:
- React/Next: `import` 문 정규식 또는 `@swc/parse` AST 로 first-party import path 추적, 재귀 (depth 제한 없음 단 cycle detection)
- HTML: `<link>`, `<script src>`, `<include>` 등 (template engine 별)
- runtime 축은 자동으로 closure 포함 — 실제 렌더된 DOM 트리 기준

**구체 시나리오** (codex 의 우회 우려 해결):
- `ui/Button.tsx` 안에 `position:absolute` 있고 단독 — **violation 아님** (어디서도 import 안 됨)
- `ui/Button.tsx` 안에 `position:absolute` 있고 `sections/Hero.tsx` 가 import — **Hero 의 budget 에 카운트** (positioning escape +1 → 임계 0 초과 → FAIL)
- `ui/IconArrow.tsx` 가 `relative+absolute` 패턴으로 작은 chevron 위치 보정 — sections 에서 import 시 budget 카운트. 정당한 경우 `data-allow-escape="decorative-overlap"` 으로 mark

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

**unknown role 비율 룰 (codex v2 리뷰)**:

`role: "unknown"` 인 anchor 가 manifest 의 **30% 초과** 시 → `extract-figma-anchors.mjs` 가 stdout 에 `MANIFEST_REVIEW_REQUIRED` 출력 + exit code 0 (= 자동 진행 차단 안 함, 신호만). 워커가 plan 단계에서 manifest review:
- unknown anchor 의 Figma 노드 이름/타입 보고 적절한 role 부여 (또는 `required: false` 유지)
- unknown 비율 ≤ 30% 가 될 때까지 manual 수정

이렇게 하면 자동 추론 휴리스틱이 약한 디자인 (Figma 노드 이름 모호) 도 strict 진입 가능 — 단 워커의 manual 검토 비용 1회 발생.

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

자체 retry 1회 후도 FAIL → 사용자 개입 분기 (Opus 승격 / 수동 / 스킵 / 재분할 / **baseline 갱신** / **migrate-baselines 호출**). `legacy.json` 직접 작성은 허용 안 함 — `migrate-baselines.mjs` 만이 거버넌스 필드 (createdBy/sourceCommit/expiresAt) 를 정확히 채워 작성 가능.

## 9. 신규 / 변경 / Deprecated 매트릭스

| 종류 | 파일 | 비고 |
|---|---|---|
| 신규 | `scripts/prepare-baseline.mjs` | png + anchor manifest 통합 생성 |
| 신규 | `scripts/extract-figma-anchors.mjs` | figma 노드 트리 → manifest (role 자동 추론) |
| 신규 | `scripts/check-layout-escapes.mjs` | G11 escape budget 차단 (정적 + dependency closure + Playwright runtime sweep) |
| 신규 | `scripts/migrate-baselines.mjs` | 기존 프로젝트 1회 마이그레이션 (legacy.json 거버넌스 필드 자동 작성 + 가능하면 manifest 추출). `--renew` 플래그로 expiresAt 갱신 |
| 신규 | `scripts/check-legacy-additions.mjs` | CI 용 — PR diff 검사, 구현 PR 의 신규 legacy.json 추가 차단 |
| 변경 | `scripts/check-visual-regression.mjs` | strict 옵션 + L2 mixed tolerance + section-root 별도 tolerance + multi-viewport 병렬 + Playwright 안정화 + manifest v2 + L1 mask (35% 상한) + strictEffective + G11 runtime sweep 통합 |
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
| 기존 프로젝트, `migrate-baselines.mjs` 가 발급한 valid `legacy.json` (createdBy/sourceCommit/expiresAt 포함, 미만료) | L2 SKIP, L1 + G11 만 평가, `strictEffective: false` (가시화) |
| 기존 프로젝트, `migrate-baselines.mjs` 실행 후 manifest 추출 성공 | 자동 strict 진입 (legacy.json 발급 안 됨) |
| 기존 프로젝트, manifest 추출 부분 성공 | 가능한 viewport 만 strict, 나머지 `legacy.json` 의 `skipViewports` 로 명시 |
| `legacy.json` 거버넌스 필드 누락/위조 (createdBy 비화이트리스트, expiresAt 도과) | **FAIL** (`reason: "invalid legacy manifest"` 또는 `"legacy expired"`) |
| 구현 PR 에서 새 `legacy.json` 추가 | CI 의 `check-legacy-additions.mjs` 가 차단 |
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
  fail-dynamic-classname/                      ← clsx("ab"+"solute") 정적엔 통과, runtime sweep FAIL
  fail-css-module-position/                    ← .module.css 의 position:absolute, runtime sweep FAIL
  fail-anchor-required-missing/                ← G1 L2 required missing FAIL 기대
  fail-anchor-bbox-delta/                      ← G1 L2 bbox delta 초과 FAIL 기대
  fail-pixel-diff-no-mask/                     ← L1 5% 초과 (text-heavy mask 없이) FAIL 기대
  pass-text-heavy-with-mask/                   ← L1 ~12% 지만 text-block mask 로 PASS
  fail-mask-area-exceeded/                     ← text-block mask 면적 35% 초과 FAIL
  fail-text-block-on-non-text-element/         ← role:text-block 가 div 에 박힘 FAIL
  pass-legacy-valid/                           ← legacy.json (createdBy:migrate-baselines) 정상 SKIP
  fail-legacy-invalid-creator/                 ← createdBy:worker 등 → invalid FAIL
  fail-legacy-expired/                         ← expiresAt 도과 → FAIL
  fail-no-anchor-manifest/                     ← legacy.json 없는데 anchor json 부재 → FAIL
  fail-data-allow-escape-text-child/           ← data-allow-escape subtree 에 텍스트 → FAIL
  pass-data-allow-escape-decorative/           ← decorative SVG 에 정당 사용 → PASS
  pass-import-clean-ui-component/              ← ui/ 단독 absolute 있어도 section import 안 함 → PASS
  fail-import-dirty-ui-component/              ← ui/Wrapper.tsx 에 absolute, sections/Hero 가 import → FAIL (closure 검사)
```

검증 스크립트:
```bash
bash scripts/test-strict-gates.sh
# → 각 fixture 에서 measure-quality.sh 실행
# → 정확히 그 게이트만 PASS/FAIL 검증
```

multi-viewport fixture 필수 — desktop only 로는 `δ` 강제 검증 안 됨.

## 12.5. (δ) 보강 — figma `use_figma` 로 multi-viewport 자동 생성 (v4 신규)

### 배경

검증 인터뷰에서 발견: 사용자 figma 파일에 mobile/tablet 디자인이 보통 없음 (회사에 디자이너 부재). 이 상태로 (δ) 멀티뷰포트 강제는 사실상 비활성화.

### 해결

Phase 2 분해 단계에서 **자동으로 mobile/tablet frame 을 figma 안에 생성**. figma `use_figma` MCP 도구가 Plugin API JS 실행 가능 → 새 frame 생성 + Auto Layout 적용 가능.

### 흐름 (4분기 처리)

기존 `workflow.md` 의 "반응형 프레임 감지" 절을 확장. **이미 있는 frame 은 use_figma 호출 안 함**.

```
Phase 2 (분해) — 오케스트레이터가 직접 수행:
  1. 페이지 Node ID 확인 (`docs/project-context.md`)
  2. get_metadata 또는 REST 노드 조회 (페이지 단위)
  3. **자동 감지** (기존 workflow.md 의 4종 단서 그대로):
     - 프레임 이름 키워드: "Mobile"/"Tablet"/"-Mobile"/"(Mobile)"/"Desktop"/"-Desktop" 등
     - 프레임 너비: 1920/1440/1280=Desktop · 768/1024=Tablet · 375/390/360=Mobile
     - Figma 페이지 분리: "Desktop Pages"/"Mobile Pages"
     - 섹션 변종: 같은 섹션의 viewport별 복제
  4. **분기 처리** (이게 v4 의 핵심):

     | desktop | tablet | mobile | 동작 |
     |---|---|---|---|
     | ✅ | ✅ | ✅ | use_figma **호출 X**. 기존 흐름 그대로 (Tier 2 multi-viewport) |
     | ✅ | ✅ | ❌ | mobile 만 use_figma 로 생성. tablet 은 figma 디자이너 의도 그대로 |
     | ✅ | ❌ | ✅ | tablet 만 use_figma 로 생성 |
     | ✅ | ❌ | ❌ | tablet + mobile 둘 다 use_figma 로 생성 |
     | ❌ | * | * | desktop 부재는 errror — bootstrap 단계에서 차단되어야 함 |

  5. use_figma 호출 단계 (4의 b/c/d 케이스에만):
     a. desktop frame 의 자식 element 트리 분석 (get_design_context 결과 활용)
     b. Claude 가 부재 viewport 의 레이아웃 추론:
        - mobile (375px): 자식들 stack (column), font-size -10~-15%, padding 축소
        - tablet (768px): 2-col 또는 wider hero, font-size 거의 그대로
     c. use_figma 호출 — Plugin API JS 코드:
        - 새 frame 생성 (375 / 768 width) at desktop 옆 적당한 위치
        - Auto Layout 적용 (direction=column / row)
        - desktop 자식 노드들을 새 frame 에 복사 + 재배치
        - 텍스트 / 이미지 / 컴포넌트 node 유지
     d. 결과 frame 의 node ID 를 `docs/project-context.md` 의 페이지 테이블 해당 컬럼에 기록
  6. **사용자 승인 1회** — 생성한 viewport 만 보여줌:
     - "Desktop 은 디자이너 figma 의도 그대로. {Mobile/Tablet} 은 자동 생성됨. figma 에서 확인. OK 면 Phase 3 진행"
     - 모든 viewport 가 이미 있었으면 (4-1 케이스) 승인 단계 스킵 — 별도 메시지 없이 진행
  7. PROGRESS.md 에 섹션 목록 추가 (multi-viewport 활성화 + 자동 생성 viewport 표기)
```

### 핵심 원칙

- **figma 디자이너 의도는 절대 덮어쓰지 않음**. 이미 있는 frame 은 그대로 사용
- 자동 생성은 **부재한 viewport 에만** 적용
- `docs/project-context.md` 의 페이지 테이블에 "**source**" 컬럼 추가 권장 — `figma-original` vs `auto-generated` 구분 (자동 생성된 viewport 는 사용자가 추후 figma 에서 수정 가능)

### 디자인 책임 명시

- **figma 가 진실의 원천 그대로** — 단 mobile/tablet 의 디자이너는 Claude
- 사용자가 figma 안에서 결과를 다듬을 수 있음 (Auto Layout 그대로)
- 다음번 동일 페이지 작업 시: 이미 frame 있으면 재사용 (자동 감지 → 기존 변종 흐름)

### 구현 가이드

오케스트레이터의 Phase 2 단계에서 use_figma 호출 — 워커 위임 X. 페이지 단위 한 번. plugin API 코드는 `docs/responsive-figma-generator.md` 참조 (M11 신규).

### 한계 / 책임

- Claude 가 만든 mobile/tablet 디자인은 **추론**. 실제 사용자/디자이너 의도와 다를 수 있음
- 사용자 승인 단계가 필수 (자동 진행 X)
- 결과 품질이 미흡하면 사용자가 figma 에서 직접 수정 또는 §16 fallback 옵션 사용

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

### `legacy.json` 갱신 (codex v2 리뷰)

legacy 의 `expiresAt` 갱신은 `migrate-baselines.mjs --renew --section <id>` 만 가능:
- 새 expiresAt = 현재 + 90일
- `sourceCommit` 갱신
- "renewed" log 가 stdout 에 출력 (가시화)
- `--renew` 는 단독 commit 으로 — 코드 변경 동반 시 CI 의 `check-legacy-additions.mjs` 가 차단

만료된 legacy 가 있는 섹션은 다음 중 하나:
1. `prepare-baseline.mjs` 로 manifest 추출 시도 → 성공하면 legacy 제거 + strict 진입
2. `migrate-baselines.mjs --renew` 로 90일 연장 (실패한 strict 를 영구 회피하는 패턴 차단 — sourceCommit 추적 + 갱신 로그로 가시화)

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
| Pseudo-element / SVG text / 동적 className / CSS module | G11 의 **runtime sweep** 으로 차단 (codex v2 리뷰). 정적 검사로 못 잡는 동적 합성도 실제 적용된 computed style 로 검출 |
| 워커가 큰 영역을 text-block 으로 잡아 mask 무력화 | mask 총면적 35% 상한 + text-bearing element 만 허용 (codex v2 리뷰) |
| 실패한 strict 를 legacy.json 으로 덮는 운영 패턴 | createdBy 화이트리스트 + sourceCommit + 90일 expiresAt + CI 차단 (codex v2 리뷰) |
| Chromium / Skia 버전 변경으로 baseline 깨짐 | Playwright minor 버전 고정. CI 에서 `npx playwright install --with-deps` 정확한 버전 |
| 디버깅 비용 (어느 anchor / DOM 회귀인지 추적 어려움) | failure artifact: current/baseline/diff PNG + anchor delta table + DOM selector + screenshot crop |
| 운영 SLO 부재 | dogfooding M10 에 false-positive < 5% 외 평균 runtime / retry율 / SKIP율도 기록 |

## 15. 마일스톤

| M | 산출물 | 검증 |
|---|---|---|
| M1 | `prepare-baseline.mjs` (figma + spec 통합, 캐싱, anchor diff report) | png + manifest 동시 생성, --force 시 diff report 출력 |
| M2 | `extract-figma-anchors.mjs` (role 자동 추론) | 노드 트리 → manifest (required/optional/role/figmaNodeId 포함) |
| M3 | `check-visual-regression.mjs` strict 확장 (Playwright 안정화 + L1 mask + 35% 상한 + L2 mixed tolerance + section-root 별도 tolerance + manifest v2) | fixture pass/ PASS, fail-pixel-diff-no-mask FAIL, pass-text-heavy-with-mask PASS, fail-mask-area-exceeded FAIL |
| M4 | `check-layout-escapes.mjs` (G11 정적 + runtime sweep + dependency closure) | fixture fail-positioning / fail-transform-overflow / fail-arbitrary-px FAIL, fail-dynamic-classname FAIL (runtime sweep 검출), pass/ PASS |
| M5 | `measure-quality.sh` G11 추가 + fail-fast 순서 + viewport 자동 감지 + LITE=1 처리 | 통합 PASS/FAIL 일관성, LITE=1 시 strictEffective=false |
| M6 | `section-worker.md` anchor manifest 룰 + retry 카테고리 + escape budget | 워커가 신규 룰 따라 박음 |
| M7 | `migrate-baselines.mjs` + `check-legacy-additions.mjs` + `bootstrap.sh` 신규 스크립트 복사 | 기존 프로젝트 1회 마이그레이션 (legacy.json 거버넌스 필드 자동 작성). CI 검사로 구현 PR 의 신규 legacy 추가 차단 |
| M8 | fixture 18종 + `test-strict-gates.sh` (multi-viewport 포함) | 모든 fixture 의도대로 PASS/FAIL (positioning/transform/arbitrary-px/dynamic-classname/css-module/anchor-missing/bbox-delta/pixel-diff/mask-overflow/text-block-on-div/legacy-valid/legacy-invalid-creator/legacy-expired/no-manifest/escape-text-child/escape-decorative/import-clean/import-dirty) |
| M9 | `docs/workflow.md` / `CLAUDE.md` 게이트 표 갱신 + §13 baseline 갱신 프로토콜 | G11 + G1 strict 명시, 디자인/구현 PR 분리 |
| M10 | dogfooding 1개 페이지 (publish-harness 본 리포 또는 사용자 운영 프로젝트) | 실제 페이지 strict 통과, false-positive < 5%, 평균 runtime / retry율 / SKIP율 기록 |
| M11 (v4 신규) | `docs/responsive-figma-generator.md` — 오케스트레이터용 use_figma plugin API 코드 가이드 + workflow.md Phase 2 분해 단계에 자동 multi-viewport 생성 흐름 추가 | 가상 desktop figma 에서 mobile/tablet frame 자동 생성 → figma 에 node 추가 확인 → 사용자 승인 |

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

## 16. 알려진 한계 (의도된 제외)

codex 2차 리뷰 + 검증 인터뷰 중 plan 단계로 미룬 항목:

- **#3 spec 모드 L2 공백** — reference HTML 기반 DOM anchor manifest 자동 생성. spec 모드는 보조 모드라 plan 단계에서 다룸. 현재는 spec 모드 = "partial strict" 로 명시 (L2 SKIP, L1 + escape budget + 멀티뷰포트만)
- **#5 escape budget 가중치** — 현재 단순 카운트 (transform ≤2 등). implementation 시 false-positive/negative 데이터 보고 가중치 도입 검토. v3 의 단순 룰로 시작하고 dogfooding 결과로 조정.
- **G1 CLI 인터페이스 변경 마이그레이션** (LOW) — 기존 호출자 영향 plan 단계에서 정리
- **measure-quality.sh fail-fast 순서 backward compat** (LOW) — JSON 출력 키 호환성
- **multi-viewport fixture 정확한 baseline PNG 생성** (LOW) — fixture 구축은 implementation 작업

### v5 추가 — modern-retro-strict 1차 dogfooding 회고 (2026-04-30)

`workspace/modern-retro-strict/docs/retro-phase1-4.md` 인용. 20 단위 / 16 commit / 3h 32min 진행 후 회고.

**작동한 것** (회고 §1):
- 사이클 견고 (13/20 단위가 retry 0)
- 게이트가 진짜 결함 1건 잡음 (Footer: tsconfig emit → 빈 baseline → G1 L1 FAIL)
- 반복 카드 컴포넌트화 Phase 2 에서 미리 잡힘

**v5 에 박힌 fix** (B1/B2/B3):
- B1: `templates/vite-react-ts/tsconfig.json` noEmit + `.gitignore` 잔재 패턴 (commit b5c82e1)
- B2: `_lib/playwright-stable.mjs` + `check-visual-regression.mjs` 환경 sanity check (commit 1bc1507)
- B3: `prepare-baseline.mjs` Windows async crash 핸들링 (commit 54578f5)

**v5 에 미반영 — 별도 트랙 (회고 §5.2 N1~N8)**:

| 항목 | 트리거 | 우선순위 |
|---|---|---|
| N1 | `workflow.md` Component 페이지 키워드에 `Styles` 추가 (F10) | 낮음, 1줄 |
| N2 | `extract-figma-anchors.mjs` 가드 3종 (text-block role 가드 / 0-size 제외 / sibling collision suffix) (F3) | 중간, 별도 PR |
| **N3** | `extract-tokens.sh` named color style 빈도 무관 전수 + organism 내부 폰트 강제 포함 (F5/M3) | **높음 — M3 미스매핑 직격** |
| N4 | G4 opacity 토큰 패밀리 (`--overlay-*` 또는 Tailwind `/20`) (F6) | 중간 |
| N5 | G11 주석 strip / AST 처리 (F8) | 낮음 |
| N6 | Phase 2 분해에 "단독 baseline 가능 여부" 체크 + Wordmark 패턴 (F9) | 낮음 |
| **N7** | `extract-tokens.sh` 후 woff2 무결성 검증 (M2 백업 가드, B2 가 박혀서 후순위) | 중간 |
| N8 | `figma-rest-image.sh` 의 `imageRef` UUID 다운로드 모드 (F7) | 낮음 |
| **G13** | DS variant 매트릭스 — Phase 2 산출로 사용처별 variant 표 + 워커 prompt 강제 (M4) | **높음 — M4 인라인 재구현 직격, but 게이트화 X 워커 가이드로 처리 가능** |

**여전히 미해결 사각지대** (회고 §2.2 M3/M4):
- **M3 (`#613B0F` → `#000000` 미스매핑)**: extract-tokens 가 빈도 기반이라 named color 누락. N3 박혀야 차단.
- **M4 (home-cta 인라인 재구현)**: IMPORT_MISSING 게이트는 "import 안 씀" 만 차단. variant 부족으로 인라인 재구현 미검출. G13 박혀야 차단.

→ M3/M4 는 **coherence 게이트로는 본질적으로 못 잡음** (§1.1). design fidelity 영역. 별도 트랙으로 처리.

### v4 추가 — multi-viewport fallback 옵션 (use_figma 부족 시)

§12.5 의 figma `use_figma` 자동 생성이 잘 안 되는 경우 (figma plugin API 한계, 복잡한 디자인) 의 fallback. **현재 spec 본진엔 미포함** — dogfooding 으로 use_figma 품질 평가 후 결정:

| 옵션 | 자동화 | 비용 | 노트 |
|---|---|---|---|
| (β) Gemini chat 수동 | ❌ 수동 | $0 (구독 활용, $20/월) | 사용자가 figma desktop 이미지 업로드 → "make this mobile" prompt → 결과 다운로드 → baseline 으로 사용. 단 figma 안 안 들어감 |
| (γ-OAuth) Gemini CLI OAuth | ✅ 자동 | $0 (무료 tier, quota 제약) | 개인 Google 계정 OAuth → Nano Banana Flash. Pro 는 2026.3 부터 유료. quota 도달 시 차단 |
| (γ) Gemini API (Nano Banana Pro MCP) | ✅ 자동 | 사용량 ($0.04~$0.15/장, 월 $5~$30 정도) | API key 별도. 안정성 ↑. 품질 ↑ |
| (3) Google Stitch SDK | ✅ 자동 | API 비용 | TypeScript SDK, HTML+screenshot 출력 |
| (4) Codia DesignGen API | ✅ 자동 | API 비용 | Figma JSON 반환 가능 |

도입 트리거: dogfooding M10 단계에서 use_figma 자동 생성의 품질이 낮거나 실패율 > 30% 일 때 (β) 부터 도입 검토. 그 외엔 (α) figma `use_figma` 만으로 충분.

## 17. 다음 단계

이 spec 승인 → `superpowers:writing-plans` 스킬로 구현 플랜 작성. 마일스톤 M1~M10 을 실행 가능한 작은 단위로 분해.

§16 의 알려진 한계 항목들도 plan 단계에서 위임 처리.

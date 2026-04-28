# Strict Visual Harness — 설계

**작성일**: 2026-04-28
**상태**: Draft
**브랜치**: `feat/strict-visual-harness`
**트리거**: 사용자 요청 — "diff <5%" 차단 게이트 복원. 단, 옛날 heavy 가 폐기된 이유(absolute 회귀 + 운영 비용)를 동시에 해결.

## 1. 목표

`pixel diff ≤ 5%` 약속을 차단 게이트로 복원하되, **AI 가 absolute 로 도망가지 못하게** 다축 합산으로 차단. 옛날 heavy 가 폐기된 두 압력을 다음으로 해체:

- **(a) AI 의 diff 좁히려는 압력 → absolute 회귀**: pixel + 코드 lint + 구조 매칭의 다축 게이트로 차단. pixel 통과해도 absolute 면 FAIL.
- **(c) flex 코드의 1~3px 자연 오차**: pixel diff 단독 평가가 아니라 element bounding-box 매칭(L2) 으로 폰트 렌더링 차이 분리.

## 2. 비목표

- 픽셀 1px 정확도 보장 — L1 5% / L2 ±4px 가 합리적 상한.
- spec 모드의 L2 매칭 (Figma 노드 좌표 부재) — figma 모드만 L2, spec 모드는 L1 + (α) + (δ) 로 보강.
- 기존 모든 프로젝트의 즉시 strict 적용 — 호환 룰로 점진 동작 (anchor json 없으면 L2 SKIP).
- 워커가 아닌 사용자가 attribute 수동 박는 흐름 — 모든 자동화 워커 안에서.

## 3. 핵심 결정 (Q2~Q7 합의)

| Q | 결정 | 핵심 |
|---|---|---|
| Q2 | (B) 다축 합산 차단 | pixel + 코드 + 구조 모두 PASS 시에만 PASS |
| Q3 | (α)+(δ) 하이브리드 | section absolute 정적 차단 + 멀티뷰포트 강제 |
| Q4 | (D) 2단계 측정 | L1 pixel diff(느슨, ≤5%) + L2 DOM bbox(엄격, ±4px) |
| Q5 | (B)+절감 기법 | 정직한 헤비, 섹션당 ~30~50초 |
| Q6 | (R) 모드별 차등 | figma=L1+L2, spec=L1+(α)+(δ) |
| Q7 | (M2)+`data-anchor` | 워커가 박음 + 자동검증 게이트 |

## 4. 게이트 구성

### 차단 게이트 표 (갱신)

| G | 도구 | 의미 | 양 모드 |
|---|---|---|---|
| G1 (strict) | `check-visual-regression.mjs` 확장 | L1 pixel ≤5% + L2 bbox ±4px + 3 viewport 통과 | figma: 풀세트 / spec: L1 + multi-viewport, L2 SKIP |
| G4 | `check-token-usage.mjs` | hex literal 금지 | 동일 |
| G5 | eslint jsx-a11y | 시맨틱 / a11y | 동일 |
| G6 | `check-text-ratio.mjs` | 텍스트 raster 차단 | 동일 |
| G8 | `check-text-ratio.mjs` | JSX literal text | 동일 |
| G10 | `check-write-protection.mjs` | SSoT 수정 차단 | 동일 |
| **G11 (신규)** | `check-no-absolute.mjs` | section 파일 absolute 정적 차단 | 동일 |

선택적 게이트 G7 (Lighthouse) 변경 없음.

## 5. G1 (strict) 상세 동작

### 입력

```bash
node scripts/check-visual-regression.mjs \
  --section <id> \
  --baseline-dir baselines/<section>/ \
  --viewports desktop,tablet,mobile \
  --threshold-l1 5 \
  --threshold-l2 4 \
  --strict
```

### 측정 흐름

한 번의 Playwright 세션 안에서:

```
launch chromium (1회)
  └─ 3 viewport 병렬 (Promise.all):
       ├─ L1: 풀페이지 PNG 캡처 → baseline pixel diff (≤ threshold-l1%)
       └─ L2: page.evaluate() 로 [data-anchor] 모두 getBoundingClientRect()
              → baselines/<section>/anchors-<viewport>.json 의 좌표와 매칭
              → 절대오차 ≤ threshold-l2 px
```

### 출력 (단일 JSON 줄)

```json
{
  "section": "hero",
  "status": "PASS|FAIL|SKIPPED|NO_BASELINE",
  "viewports": {
    "desktop": {
      "l1": { "diffPercent": 2.1, "pass": true },
      "l2": { "anchorsMatched": 7, "anchorsTotal": 7, "maxDeltaPx": 2, "pass": true }
    },
    "tablet": { ... },
    "mobile": { ... }
  }
}
```

### FAIL 조건

하나라도 해당 시 FAIL:
- 어떤 viewport 의 L1 diffPercent > threshold-l1
- 어떤 viewport 의 L2 maxDeltaPx > threshold-l2
- section root anchor 부재 (필수)
- baseline 의 anchor 중 코드에 매칭된 비율 < 90% (floor)

### SKIP 조건 (lite 호환)

- baseline png 부재 → `NO_BASELINE` (차단 안 함, 첫 구현 시점)
- anchors-*.json 부재 → L2 SKIP, L1 만 평가 (기존 baseline 만 있는 프로젝트 호환)
- Playwright/dev서버 미비 → `SKIPPED` (env 문제)

### baseline 디렉토리 구조

```
baselines/hero/
  desktop.png          ← L1 baseline
  tablet.png
  mobile.png
  anchors-desktop.json ← L2 baseline. {"hero/title": {x, y, w, h}, ...}
  anchors-tablet.json
  anchors-mobile.json
```

## 6. G11 — `check-no-absolute.mjs` 상세

### 검사 규칙

| 패턴 | 동작 |
|---|---|
| Tailwind `absolute` (단독) | FAIL |
| Tailwind `inset-*` / `top-*` / `left-*` / `right-*` / `bottom-*` (px 값) | FAIL |
| inline `style={{ position: 'absolute' }}` | FAIL |
| inline `style={{ left: ..., top: ... }}` (px 값) | FAIL |
| `relative` + 자식 `absolute` (정상 stacking) | 허용 |
| `data-allow-absolute="<reason>"` 부모 서브트리 | 허용 (제한 룰 적용) |

### 적용 범위

- 차단: `src/components/sections/**/*.{tsx,jsx,html}`
- 허용 (whitelist): `src/components/{ui,brand,foundation}/**`

### `data-allow-absolute` 예외 룰

남용 방지 4중 보강:
1. **사유 필수**: `data-allow-absolute=""` 빈값 → FAIL
2. **카운트 상한**: section 당 사용 ≤ 2회 (운영 통계로 조정 가능)
3. **자식 검사**: 자식이 `<h*>` / `<p>` / `<button>` (텍스트성 element) 면 FAIL — "텍스트 layout 에 absolute" 우회 차단
4. **stdout 리포트**: 모든 사용처와 사유 출력 → PR 리뷰 시 가시화

### 출력

```json
{
  "section": "hero",
  "status": "PASS|FAIL",
  "violations": [
    { "file": "src/components/sections/Hero.tsx", "line": 42, "pattern": "absolute" }
  ],
  "allowExceptions": [
    { "file": "Hero.tsx", "line": 18, "reason": "connector-line", "valid": true }
  ]
}
```

## 7. 워커 파이프라인 변경

기존 4단계 (리서치 → 에셋 → 구현 → 게이트). 단계 골격 유지, 안의 행위 추가.

### 단계 1 — 리서치
**추가**: figma 모드에서 노드 트리에서 anchor 후보 식별 → `plan/{section}.md` 에 anchor 명세 작성 (어떤 element 에 어떤 anchor 박을지).

### 단계 3 — 구현
워커 가이드 (`section-worker.md`) 에 anchor 룰 명시:
- section 루트: `data-anchor="<section-id>/root"` 필수
- 텍스트 헤딩 (h1/h2/h3): `<section-id>/heading` 또는 의미명
- 주요 CTA: `<section-id>/cta`
- 메인 이미지: `<section-id>/image`
- 디자인이 명명한 element (Figma 노드 이름 → kebab-case)
- 6~10개 권장, kebab-case, `<section-id>/` prefix 필수

### 단계 4.1 — baseline 준비 (확장)

신규 통합 스크립트:

```bash
node scripts/prepare-baseline.mjs \
  --mode {figma|spec} \
  --section hero \
  --viewports desktop,tablet,mobile \
  [--file-key <key> --section-node <id>]   # figma
  [--reference-html <path>]                 # spec
  [--force]
```

생성: `baselines/<section>/{viewport}.png` + `anchors-{viewport}.json` 동시.

**모드별 anchor 추출**:

| 모드 | baseline png | anchors json |
|---|---|---|
| figma | `figma-rest-image.sh` (기존 흡수) | `extract-figma-anchors.mjs` — REST 노드 트리 → 좌표 정규화 |
| spec | reference HTML Playwright 렌더 | 동일 렌더에서 `[data-anchor].getBoundingClientRect()` 추출 |

**캐싱**: figma 측은 `lastModified` REST 응답, spec 측은 reference HTML mtime 비교. 변화 없으면 SKIP. `--force` 로 우회.

### 단계 4.2 — 게이트 (`measure-quality.sh` 확장)

실행 순서 fail-fast (싼 게이트 먼저):
```
G10 (write-protection)
G4  (token usage)
G11 (no-absolute)         ← 신규
G5  (eslint a11y)
G6/G8 (text ratio)
G1  (visual regression strict)  ← Playwright, 마지막
G7  (Lighthouse, 선택)
```

### retry 가이드 (워커 자체 1회 재시도)

| FAIL | 워커 행동 |
|---|---|
| G11 absolute 사용 | `relative+absolute` 패턴 재구성. 데코 SVG 만 `data-allow-absolute="..."` (≤2회) |
| G1 L1 pixel diff | diff PNG 확인 → spacing/typography 토큰 재점검 |
| G1 L2 anchor missing | stdout 의 missing anchor 리스트 따라 정확히 박기 |
| G1 L2 bbox delta | 해당 anchor element 의 width/height/margin 점검. **absolute/매직 px 추가 금지** (G11 으로 재차단) |
| G1 NO_BASELINE | `prepare-baseline.mjs` 자동 호출 후 한 번 더 |

자체 retry 1회 후도 FAIL → 기존 사용자 개입 분기 (Opus 승격 / 수동 / 스킵 / 재분할 / **baseline 갱신**).

## 8. 신규 / 변경 / Deprecated 매트릭스

| 종류 | 파일 | 비고 |
|---|---|---|
| 신규 | `scripts/prepare-baseline.mjs` | png + anchors 통합 생성 |
| 신규 | `scripts/extract-figma-anchors.mjs` | figma 노드 트리 → anchors json |
| 신규 | `scripts/check-no-absolute.mjs` | G11 정적 차단 |
| 신규 | `scripts/migrate-baselines.mjs` | 기존 프로젝트 1회 마이그레이션 헬퍼 |
| 변경 | `scripts/check-visual-regression.mjs` | strict 옵션 + L2 bbox + multi-viewport 병렬 |
| 변경 | `scripts/measure-quality.sh` | G11 추가, G1 strict 호출, fail-fast 순서 |
| 변경 | `.claude/agents/section-worker.md` | anchor 룰 + retry 카테고리 가이드 |
| 변경 | `docs/workflow.md` | 4.1/4.2 단계 갱신 |
| 변경 | `CLAUDE.md` (프로젝트) | 차단 게이트 표 + G11 추가 |
| Deprecated → 삭제 | `scripts/fetch-figma-baseline.sh` / `scripts/render-spec-baseline.mjs` | `prepare-baseline.mjs` 로 흡수 |

## 9. 호환성

기존 프로젝트는 다음 상태:
- `baselines/<section>/<viewport>.png` 만 있음 (anchor json 없음)
- G1 옵셔널 (lite)
- G11 모름

자동 호환 룰 (스크립트에 내장):

| 상황 | 동작 |
|---|---|
| anchors-`<viewport>`.json 부재 | G1 L2 SKIP, L1 만 평가 |
| `<viewport>`.png 부재 (예: tablet/mobile) | 해당 viewport NO_BASELINE |
| 기존 baseline 차원 mismatch | 기존 lite 동일 FAIL — `prepare-baseline.mjs --force` 안내 |
| `data-anchor` 미박힘 + `anchors-*.json` 존재 | "anchor missing" FAIL → 워커 retry 또는 사용자 개입 |
| `LITE=1` env | 모든 strict 기능 옵트아웃 (긴급 우회) |

→ anchor json 없는 기존 프로젝트는 strict 켜져도 **L1 + G11 만 작동**. 자연 점진 동작.

## 10. 출시 전략

**default strict + 호환 룰**. 별도 옵트인 phase 없음.

이유:
- 호환 룰 (anchor json 없으면 L2 SKIP) 이 사실상 옵트인 효과를 자동 제공
- "<5% diff 차단" 즉시 실현
- 검증은 publish-harness 본 리포 fixture + 사용자 dogfooding 으로 충분

`LITE=1` env 로 긴급 옵트아웃 가능. 운영 안정 후 제거 검토.

## 11. 테스트 전략

`fixtures/strict-gate/` 신규:

```
fixtures/strict-gate/
  pass/
    src/components/sections/Hero.tsx       ← 정직한 flex + data-anchor
    baselines/hero/desktop.png + anchors-desktop.json
  fail-absolute/
    src/components/sections/BadHero.tsx    ← absolute 박힘 → G11 FAIL 기대
  fail-anchor-missing/
    src/components/sections/Hero.tsx       ← anchor 빠짐 → G1 L2 FAIL 기대
  fail-pixel-diff/
    src/components/sections/Hero.tsx       ← 의도적 spacing 어긋남 → L1 FAIL 기대
```

검증 스크립트:
```bash
bash scripts/test-strict-gates.sh
# → 각 fixture 에서 measure-quality.sh 실행
# → pass/ 는 PASS, fail-*/ 는 정확히 그 게이트만 FAIL 검증
```

## 12. 마일스톤

| M | 산출물 | 검증 |
|---|---|---|
| M1 | `prepare-baseline.mjs` (figma + spec 통합, 캐싱) | desktop.png + anchors-desktop.json 동시 생성 |
| M2 | `extract-figma-anchors.mjs` | 노드 트리 → 좌표 정규화 anchors json |
| M3 | `check-visual-regression.mjs` strict 확장 (L2 + multi-viewport) | fixture pass/ 에서 PASS, fail-pixel-diff/ FAIL |
| M4 | `check-no-absolute.mjs` (G11) | fixture fail-absolute/ FAIL, pass/ PASS, `data-allow-absolute` 룰 |
| M5 | `measure-quality.sh` G11 추가 + fail-fast 순서 | 통합 PASS/FAIL 일관성 |
| M6 | `section-worker.md` anchor 룰 + retry 카테고리 | 워커가 신규 룰 따라 박음 |
| M7 | `migrate-baselines.mjs` + `bootstrap.sh` 신규 스크립트 복사 | 기존 프로젝트 1회 마이그레이션 동작 |
| M8 | fixture 4종 + `test-strict-gates.sh` | 모든 fixture 의도대로 PASS/FAIL |
| M9 | `docs/workflow.md` / `CLAUDE.md` 게이트 표 갱신 | G11 + G1 strict 명시 |
| M10 | dogfooding 1개 페이지 | 실제 페이지에서 strict 통과, false-positive < 5% |

## 13. 리스크 & 대응

| 리스크 | 대응 |
|---|---|
| Figma 노드 이름 모호 → anchor 추출 실패 | extract-figma-anchors 가 명명된 노드만 후보 (이름 없는 자식 제외). 실패 시 stdout 가이드 |
| 워커가 anchor 빠뜨림 | 1차 자체 retry, 그 후 사용자 개입 분기 (현재 패턴) |
| flex 코드도 L1 5% 못 넘는 케이스 | L2 가 핵심 — 폰트 미세차이는 L1 에선 크게 잡혀도 L2 에선 통과. L1 단독 차단 아님 |
| baseline mtime 캐시 stale | figma `lastModified` + spec mtime 비교. `--force` 로 항상 우회 |
| `data-allow-absolute` 남용 | 사유 필수 + ≤2회 + 텍스트 자식 차단 + stdout 가시화 |
| 섹션당 ~50초 시간 부담 | Playwright 캐싱 + 3 viewport 병렬 + baseline 캐시. 첫 실행 50초, 재실행 30초 |
| 기존 프로젝트 일괄 갱신 | 호환 룰로 anchor json 없으면 자동 SKIP. `migrate-baselines.mjs` 1회 헬퍼 |
| spec 모드 reference HTML 부재 | spec 모드 baseline 자체 SKIP — 기존 lite 동작 유지 |

## 14. 다음 단계

이 spec 승인 → `superpowers:writing-plans` 스킬로 구현 플랜 작성. 마일스톤 M1~M10 을 실행 가능한 작은 단위로 분해.

# Home G1 Dogfooding: publish-harness 변경 정리

이 문서는 `beverage-codex-3`의 Home G1 dogfooding 과정에서
`publish-harness`에 어떤 수정과 진단 보강이 들어갔는지 정리한 기록이다.

이번 dogfooding의 목표는 beverage 페이지를 완료하는 것이 아니었다. 실제
Figma-to-React 퍼블리싱 작업을 이용해 G1 진단이 어디서 너무 거칠거나,
오해를 만들거나, 다음 작업을 충분히 안내하지 못하는지 확인하는 것이
목표였다.

## 1. Optional anchor는 blocker가 아니라 diagnostic으로 변경

### 관찰된 문제

required anchor가 모두 매핑된 뒤에도 optional anchor가 많이 남아 있었다.

- `requiredMatched=72/72`
- optional missing 다수

기존 정책에서는 optional missing이 G1의 blocking reason이 될 수 있었다.
그 결과 실제 다음 작업인 visual drift 분석이 가려졌다.

### 하네스 수정

`scripts/_lib/anchor-manifest.mjs`의 매칭 정책을 조정했다.

- required anchor는 계속 blocking
- optional anchor missing은 warning/diagnostic
- required coverage가 완료되면 optional missing만으로 G1을 막지 않음

### 효과

G1의 첫 실패 이유가 optional coverage noise에서 실제 bbox drift로 바뀌었다.

```text
Home/section-12 delta x=0 y=394
```

이후 worker는 optional anchor를 세는 대신 section drift를 분석할 수 있었다.

## 2. `data-anchors` 다중 anchor 매핑 지원

### 관찰된 문제

Figma manifest에는 같은 visible bbox를 가리키는 중복 anchor가 자주 있었다.

- section root
- background rectangle
- decorative frame/fill variant

반면 React DOM에는 실제 visible section/background box가 하나뿐인 경우가
많았다.

### 하네스 수정

G1 DOM matching이 다음 형식을 인식하도록 바뀌었다.

```html
<section data-anchors="Home/section-4 Home/rectangle-170 Home/rectangle-170-2">
```

report도 duplicate full-bbox group과 `data-anchors` 제안을 출력하도록 보강했다.

### 효과

숨김/dummy node 없이 여러 Figma anchor를 하나의 실제 visible DOM box에
매핑할 수 있게 됐다. footer gallery, bundle background, full-bbox duplicate
variant를 처리하는 데 효과가 있었다.

## 3. Section stack/gap 진단 추가

### 관찰된 문제

G1 첫 L2 reason은 종종 downstream section을 가리켰다.

```text
Home/section-12 delta y=394
```

하지만 footer anchor target 자체는 맞았다. 실제 원인은 위쪽 section들의
height/gap drift가 누적된 것이었다.

대표 사례:

- reviews section height `+310px`
- flavor row 3개가 각각 `+120px`
- section pair gap 누락 또는 offset

### 하네스 수정

`scripts/check-visual-regression.mjs`,
`scripts/report-anchor-mapping.mjs`에 다음 진단을 추가했다.

- `sectionDeltas`
- `sectionGapDeltas`
- `sectionOffsetPropagation`
- `nonActionableRootResiduals`
- `sharedResidualOffsetSources`

CLI report에는 다음 섹션이 추가됐다.

- `Section / Root Deltas`
- `Section Gap Deltas`
- offset propagation 관련 요약
- target section을 움직이면 안 되는 root residual 안내

### 효과

다음 문제들을 분리해서 볼 수 있게 됐다.

- section 자체 height drift
- section pair gap drift
- downstream y drift
- target section을 움직이면 안 되는 propagated residual

특히 `Home/section-12`를 직접 움직이는 잘못된 수정 대신, upstream section
height/gap 원인을 찾도록 유도할 수 있었다.

## 4. 반복 section/row height drift 감지

### 관찰된 문제

flavor row 3개가 같은 height drift를 가지고 있었다.

- `Home/section-6 h=622`, Figma `502`
- `Home/section-7 h=622`, Figma `502`
- `Home/section-8 h=622`, Figma `502`

기존 report에서는 세 개의 개별 delta처럼 보였고, 반복 컴포넌트 문제라는
신호가 약했다.

### 하네스 수정

비슷한 sibling section height delta를 그룹으로 묶도록 했다.

추가 category:

- `repeated-section-height-drift`
- `repeated-row-height-drift`

CLI report에는 `Repeated Height Drift` 섹션을 추가했다.

### 효과

개별 anchor를 튜닝하기 전에 반복 row/component의 공통 height 문제를 먼저
볼 수 있게 됐다.

## 5. Repeated slot/card sequence drift 진단

### 관찰된 문제

footer gallery와 review/card slot처럼 반복되는 visual item에서 Figma duplicate
rectangle variant와 실제 DOM slot이 섞이면서 report가 혼란스러웠다.

### 하네스 수정

다음 진단을 추가했다.

- repeated slot sequence grouping
- duplicate slot variant grouping
- 같은 visible slot이면 `data-anchors` 사용 제안
- 개별 card anchor 튜닝 전에 count/order/gap을 맞추라는 안내

추가 category:

- `repeated-slot-sequence-drift`
- `repeated-card-layout-model-mismatch`
- `duplicate-slot-variant-group`
- `repeated-slot-duplicates-collapsed`

### 효과

report가 상황에 따라 다음처럼 더 구체적으로 안내할 수 있게 됐다.

```text
match repeated card/item count, order, and slot spacing
```

또는 중복 variant가 원인일 때:

```text
map duplicate slot variants with data-anchors
```

## 6. Anchor target mismatch 진단

### 관찰된 문제

일부 text anchor가 실제 텍스트가 아니라 넓은 block/wrapper에 붙어 있었다.

예:

- Figma bbox: `50x40`
- measured bbox: `609x40`

이것은 text metric drift가 아니라 anchor target 문제였다.

### 하네스 수정

anchor delta에 ratio 기반 category를 추가했다.

- `anchor-target-too-wide`
- `text-anchor-wrapper-mismatch`
- `wrapper-target-too-large`
- `possible-wrong-wrapper-target`

CLI report에는 다음 섹션을 추가했다.

- `Anchor Target Mismatches`
- `Wrapper Target Mismatches`

### 효과

font-size/line-height를 고치기 전에 anchor를 visible inner text/span으로 옮겨야
한다는 판단이 가능해졌다. anchor target이 정리된 뒤 남는 dx/dy는 실제
internal layout drift로 해석할 수 있었다.

## 7. Text content mismatch confidence 분리

### 관찰된 문제

Figma layer name은 실제 content처럼 보이지만 신뢰하기 어려운 경우가 많았다.

예:

- `a paragraph or two...` 같은 generic layer name
- `logoname` 같은 semantic layer name
- `watermellon mania` 같은 spelling typo
- expected text가 없는 optional duplicate text layer

기존 report는 이런 항목을 actionable content mismatch처럼 취급할 수 있었다.

### 하네스 수정

text diagnostic에 다음 필드를 추가했다.

- `expectedText`
- `actualText`
- `anchorNameText`
- `textMatchesExpected`
- `textMatchesAnchorName`
- confidence / reviewOnly 구분

CLI report도 다음처럼 분리했다.

- `Text Content / Anchor Mismatch`
- `Low Confidence Text Mismatches`

### 효과

`watermellon mania`, `logoname` 같은 항목은 app code 수정 대상으로 보지 않고,
review-only diagnostic으로 남길 수 있게 됐다.

## 8. Text metric, placement, shared offset 진단

### 관찰된 문제

anchor/content 문제가 정리된 뒤 남은 text drift는 원인이 서로 달랐다.

- 실제 font/wrapping/line-height mismatch
- micro placement residual
- upstream wrapper/section 때문에 생긴 shared y offset
- wrapper target mismatch

### 하네스 수정

text delta category를 더 세분화했다.

- `text-metric-drift`
- `text-wrapping-width-drift`
- `text-line-height-drift`
- `text-placement-drift`
- `text-micro-placement-drift`
- `text-placement-residual`
- `shared-text-y-offset`
- `downstream-text-placement-drift`
- `text-flow-offset-propagation`

CLI report에는 `Shared Text Y Offset` 섹션을 추가했다.

### 효과

여러 text에 같은 y offset이 있을 때 개별 transform을 추가하지 않고, 공통
wrapper/section offset을 먼저 의심할 수 있게 됐다.

## 9. Internal section layout drift와 rewrite 판단

### 관찰된 문제

`Home/section-3`은 anchor target을 inner span으로 좁힌 뒤에도 section-relative
좌표가 Figma와 크게 달랐다.

원인은 구조적이었다.

- Figma: freeform/staggered layout
- DOM: semantic grid/card layout

이 상태에서는 margin/padding 소규모 튜닝으로 해결하기 어려웠다.

### 하네스 수정

다음 진단을 추가했다.

- `internalSectionDriftGroups`
- `layoutModelMismatches`
- `semantic-grid-vs-figma-freeform`
- `internal-section-layout-drift`
- `section-internal-placement-drift`
- `rewrite-required`
- `rewrite-effective-residual-offset`

### 효과

report가 small tuning 대신 다음 판단으로 넘어갈 수 있게 됐다.

- section rewrite 필요
- human decision 필요
- rewrite가 효과를 냈고 이제 남은 것은 shared residual offset

## 10. Section L1 Diff Hotspots

### 관찰된 문제

L2 actionable issue가 대부분 정리된 뒤에도 L1 pixel diff는 계속 컸다. 이때
기존 L2 report만으로는 어느 section이 L1을 크게 만들고 있는지 알기 어려웠다.

### 하네스 수정

G1에 `sectionL1Diffs`를 추가했고, CLI에는 `Section L1 Diff Hotspots`를 출력했다.

각 hotspot은 다음 정보를 가진다.

- `sectionId`
- `diffPercent`
- `diffPixels`
- current/baseline average color
- `colorDistance`
- background sample:
  - `backgroundSampleCurrent`
  - `backgroundSampleBaseline`
  - `backgroundColorDistance`
- hotspot categories

추가 category:

- `section-l1-diff-hotspot`
- `solid-background-color-drift`
- `image-content-mismatch-candidate`
- `asset-order-mismatch-candidate`

### 효과

anchor tuning이 아니라 L1-dominant visual 원인을 보게 만들 수 있었다.

dogfooding 중 실제로 다음 원인을 찾는 데 사용됐다.

- footer background color drift
- bundle background color drift
- benefit image order mismatch
- sale banner overlay content/order

## 11. Hotspot text signal 분리

### 관찰된 문제

초기 Section L1 hotspot은 text signal 하나 때문에 section 전체를 overlay text
문제로 과분류할 수 있었다.

예:

- `Home/section-3`은 `Home/immunity-support` text metric signal 하나가 있었지만,
  실제 주요 원인은 image/content/order 쪽이었다.
- `Home/section-12`는 `logoname` review-only signal noise가 있었다.

### 하네스 수정

hotspot 안의 text signal을 분리했다.

- `textSignals`
- `actionableTextSignals`
- `reviewOnlyTextSignals`

actionable text evidence가 충분하지 않으면 overlay text category를 붙이지 않고,
대신 다음 category로 남긴다.

- `text-signal-present-nonblocking`

### 효과

low-confidence text signal이 `Next Best Action`을 app text 수정 쪽으로 끌고
가지 않게 됐다.

## 12. Hotspot imageSignals

### 관찰된 문제

최신 report는 `Home/section-3`에 대해 image/content/order/crop mismatch를
의심하라고 올바르게 안내했다. 하지만 구체적인 image anchor 후보는 출력하지
못했다.

### 하네스 수정

`sectionL1Diffs`에 `imageSignals` 필드를 추가했고,
`report-anchor-mapping.mjs`가 image signal을 출력하도록 했다.

현재 구현은 기존 image-like delta와 관련 diagnostics에서 image signal을 가져온다.

### 현재 한계

`Home/section-3`은 여전히 top image/content/order hotspot이었지만
`imageSignals`가 비어 있었다.

가능한 이유:

- section 내부 image anchor의 bbox 자체는 이미 꽤 맞음
- 그래서 top delta에는 안 잡힘
- 하지만 L1은 이미지 content/crop/order 차이를 계속 감지함

### 후속 필요

imageSignals는 top delta뿐 아니라 다음 기준으로도 수집해야 한다.

- section membership
- hotspot section과 bbox overlap
- image/media role
- asset src/filename
- object-fit/object-position
- image box별 crop diff estimate

`Next Best Action`도 가능하면 대표 image signal id를 포함해야 한다.

## 13. Report ordering과 Next Best Action

### 관찰된 문제

dogfooding 과정에서 가장 큰 raw delta가 항상 다음 작업은 아니었다. 더 중요한
것은 가장 신뢰도 높은 actionable category였다.

### 하네스 수정

`scripts/report-anchor-mapping.mjs`에 `Next Best Action` heuristic을 추가했다.

대략적인 우선순위:

1. required anchor coverage
2. high-confidence content/anchor mismatch
3. section/background target mismatch
4. section gap / normal-flow spacing
5. repeated height
6. anchor/wrapper target mismatch
7. true text metric drift
8. repeated slot/card sequence drift
9. internal section layout drift
10. non-actionable root residual
11. L1 hotspot investigation

### 효과

report가 단순 요약이 아니라 iterative worker guide 역할을 하게 됐다. 동시에
image/crop hotspot처럼 아직 recommendation이 모호한 영역도 명확히 드러났다.

## 14. Worker guide 보강

`docs/codex-section-worker.md`에 G1 실패 시 읽는 순서를 보강했다.

현재 권장 순서:

1. required coverage
2. section stack/gap
3. repeated height / repeated slot
4. anchor target mismatch
5. section/background target mismatch
6. text content/anchor mismatch
7. text metric/placement drift
8. wrapper target mismatch
9. duplicate text bbox groups
10. logo/brand scale drift
11. internal layout drift / rewrite 또는 waiver 판단
12. media/text metrics
13. L1 residual hotspot investigation

또한 `data-anchors` 사용법과 hidden/dummy anchor 금지 규칙을 문서화했다.

## publish-harness에서 주로 수정된 파일

G1 diagnostics 관련 핵심 수정 파일:

- `scripts/_lib/anchor-manifest.mjs`
- `scripts/_lib/playwright-stable.mjs`
- `scripts/check-visual-regression.mjs`
- `scripts/report-anchor-mapping.mjs`
- `docs/codex-section-worker.md`

작업 트리에는 다른 workflow/template 관련 수정도 있지만, Home G1 dogfooding에서
직접 파생된 핵심 진단 변경은 위 파일들에 집중되어 있다.

## 아직 남은 하네스 개선점

최신 dogfooding 기준으로 다음 개선이 가장 가치 있어 보인다.

1. L1 hotspot의 section-local image signal 수집
2. hotspot별 crop artifact path 출력
3. measured anchor의 DOM selector/tag/class 캡처
4. image order, crop/object-position, asset content mismatch, size ratio 구분 강화
5. product image에 희석되지 않는 region-aware background sampling
6. `Next Best Action` confidence score
7. background/fill/media/CTA rectangle role inference 개선
8. optional duplicate text layer의 expectedText 추출 개선

## 전체 결론

이번 dogfooding을 통해 G1은 단순한 "visual regression failed"에서 다음과 같은
계층적 진단 흐름으로 발전했다.

- required anchor mapping
- target correctness
- section stack/gap propagation
- repeated layout pattern
- text/content confidence
- internal layout model mismatch
- L1 section hotspot triage

beverage 페이지 자체는 여전히 completion contract를 통과하지 못했다. 하지만
그 미완료 상태가 하네스 개발에는 유용했다. 각 unresolved stage가 빠진
diagnostic이나 과신한 recommendation을 드러냈고, 그 결과가
`publish-harness`의 G1 진단과 worker guide에 반영됐다.

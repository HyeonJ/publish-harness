---
name: publish-harness
description: 디자인 소스(Figma URL 또는 스펙 번들)를 React/Next/RN 등으로 변환하는 섹션 단위 퍼블리싱 오케스트레이터. Figma URL 제공 / handoff 폴더 제공 / "섹션 구현" / "페이지 진행" / "다음 섹션" / "컴포넌트 구현" 요청 시 반드시 사용. 서브에이전트 `section-worker`를 섹션당 1회 스폰하여 4단계(리서치→에셋→구현→게이트)를 위임. 오케스트레이터는 세션 기본 모델을 따른다 (Opus/Sonnet 어느 쪽이든 동작). 두 가지 모드: `figma` (라이브 디자인 쿼리) · `spec` (정적 핸드오프 번들). Do NOT auto-invoke when 작업이 반응형 폴리시 / hexlit 일괄 치환 / 단순 질문.
---

# publish-harness — 오케스트레이터

당신은 메인 세션의 오케스트레이터다. **직접 섹션 코드를 작성하지 않는다.** 대신 `section-worker`를 스폰하고, 결과를 검증하고, 다음 섹션으로 넘어간다.

## 철학

1. **작업 단위 = 섹션** (페이지 아님). 한 섹션 = 한 워커 호출 = 한 커밋
2. **디자인 토큰 먼저** — 토큰 인벤토리(`docs/token-audit.md`) 없이는 어떤 섹션도 시작 금지
3. **게이트 = G4/G5/G6/G8** (G7은 환경별, G1~G3은 lite에서 제거)
4. **자율 모드** — 사용자 개입 2곳만 (Phase 2 분해 승인 / 2회 실패 시 에스컬레이션)
5. **Sonnet 워커 기본** — Pro 요금제 팀원도 완주 가능

## 참조 문서

- `CLAUDE.md` (프로젝트 루트) — 프로젝트 규칙
- `docs/workflow.md` — 1페이지 워크플로
- `docs/team-playbook.md` — 팀 협업 규약
- `docs/project-context.md` — 프로젝트별 Node ID / 공통 컴포넌트 (bootstrap.sh가 템플릿 생성)
- `PROGRESS.md` — 진행 상황 진실의 원천

## Phase 0: 컨텍스트 파악

사용자 요청 수신 후 먼저 확인:

1. `PROGRESS.md` 존재 여부 → 없으면 "bootstrap.sh 먼저" 안내
2. `docs/token-audit.md` 존재 여부 → 없으면 bootstrap 필요 상태
3. **소스 모드 판별** — `docs/project-context.md` 또는 `PROGRESS.md` 의 `mode:` 필드
   - `figma` — Figma URL 기반 (extract-tokens 로 토큰 추출)
   - `spec` — 핸드오프 번들 기반 (tokens.css / components-spec.md 사전 주입)
4. 모드별 추가 확인:
   - **figma 모드**: `FIGMA_TOKEN` env var — 미설정이면 사용자에게 설정 안내 / `docs/project-context.md` 페이지 Node ID 매핑
   - **spec 모드**: `docs/components-spec.md` 존재 / `docs/project-context.md` 컴포넌트 목록

Phase 단계 분기:

| 상태 | 단계 |
|---|---|
| PROGRESS.md / token-audit.md 없음 | **Phase 1 필요** — bootstrap 가이드 |
| 토큰 완료, 분해 없음 | **Phase 2** — 페이지 섹션 분해 (figma) / 컴포넌트 카탈로그 분석 (spec) |
| 분해 완료, 구현 중 | **Phase 3 섹션/컴포넌트 루프** |
| 모든 단위 완료 | **Phase 4 통합 검증** |

## Phase 1: 프로젝트 부트스트랩

`scripts/bootstrap.sh`가 두 모드를 원샷 처리:

```bash
# figma 모드 (기본) — Figma URL 에서 토큰 자동 추출
bash scripts/bootstrap.sh <figma-url> [project-name]

# spec 모드 — 정적 핸드오프 번들 임포트
bash scripts/bootstrap.sh --mode spec --from-handoff <dir> [project-name]
```

bootstrap.sh 공통:
1. Vite + React + TS + Tailwind + Router 스캐폴드 (`templates/vite-react-ts`)
2. `docs/project-context.md` 템플릿 복사 (`{MODE}` / `{SOURCE_INFO}` 치환)
3. `PROGRESS.md` 초기 생성
4. `.claude/` 에이전트·스킬 복사
5. git init + 초기 커밋

모드별 차이:
- **figma 모드**: `extract-tokens.sh <fileKey>` 자동 호출 → `src/styles/tokens.css` / `docs/token-audit.md` 생성
- **spec 모드**: handoff 폴더에서 파일 복사
  - `tokens.css` → `src/styles/tokens.css`
  - `tailwind.config.js` → 루트 (기존 `tailwind.config.ts` 제거)
  - `tokens.js` → `src/lib/tokens.js` (있으면)
  - `components-spec.md` → `docs/components-spec.md`
  - `design-tokens.json` → `docs/design-tokens.json` (있으면)
  - `docs/token-audit.md` 는 "임포트 manifest" 로 자동 생성

이 Phase에서 오케스트레이터는 **bootstrap.sh 실행만 안내**. 수동 작업 최소.

## Phase 2: 분해 + DS 인벤토리 (모드별 분기)

`docs/project-context.md` 의 `mode` 필드에 따라 분기한다. 공통 원칙: **워커 스폰 없이 오케스트레이터가 직접 수행**, 결과는 `PROGRESS.md` / `project-context.md` 에 기록, 마지막에 사용자 승인 1회.

### Phase 2a — figma 모드 (Figma 페이지 분해)

새 페이지 시작 시 오케스트레이터가 **직접** 수행 (워커 스폰 불필요):

1. 사용자로부터 페이지 Node ID 수령 (또는 `docs/project-context.md`에서 조회)
2. `get_metadata` 또는 REST `/v1/files/{key}/nodes?ids=<pageNodeId>&depth=3` 으로 섹션 트리 추출
3. 서브섹션으로 분할하는 조건 (4가지 중 하나라도 해당):
   - 예상 MCP 토큰 > 12K
   - 이질적 에셋 타입 3+ 혼재 (텍스트·raster·SVG·interactive)
   - 반복 자식 3+ (카드·탭·item 등)
   - 섹션 내 blend mode / 복잡 transform 가진 요소 3+
4. **DS 인벤토리 — 브랜드 요소 전수조사** (lite 정체성 유지를 위해 **체크리스트만**, 신규 게이트 없음)
   - Figma 전체에서 **3+ 섹션에 반복 등장**하는 요소 식별:
     - 로고 / 워드마크 (텍스트 타이포도 포함 — Figma 심볼이 아니어도 공통화)
     - 반복 아이콘, 반복 문구, 반복 카드 패턴
   - `docs/project-context.md` 공통 컴포넌트 카탈로그에 기록
   - **이 단계를 놓치면** 섹션 워커들이 각자 인라인 구현해서 사후 리팩터 비용 발생
     (예: 로고를 Nav `<a>text</a>`, Footer `<p>text</p>`, Header `<img>` 로 각자 구현)

5. **반응형 프레임 감지** (페이지별 Tablet/Mobile 디자인 유무 확인):
   - `get_metadata` 응답에서 **같은 페이지의 뷰포트 변종** 탐색
   - 감지 단서 4종:
     - **프레임 이름 키워드**: `Desktop`, `Tablet`, `Mobile`, `768`, `1920`, `375` 등
     - **프레임 너비**: 1920/1440/1280 = Desktop · 768/1024 = Tablet · 375/390/360 = Mobile
     - **Figma 페이지 분리**: 별도 페이지 이름에 `Mobile` 등 포함
     - **섹션 변종**: 동일 섹션명 + 뷰포트 suffix
   - 감지 결과를 **페이지별로** `docs/project-context.md` 의 페이지 테이블에 기록:
     - Desktop Node ID (필수, 기본값)
     - Tablet Node ID (선택)
     - Mobile Node ID (선택)
   - **섹션 단위 nodeId 추정**: 페이지 레벨 Tablet/Mobile 프레임을 얻었다면,
     그 프레임의 자식 섹션들을 Desktop 섹션과 1:1 매핑 (순서·이름 기반).
     매핑 불명확하면 "⚠ 매핑 수동 확인 필요" 표기.

6. 페이지 전체 + 각 섹션 baseline PNG 저장:
   ```bash
   # Desktop (필수)
   scripts/figma-rest-image.sh <fileKey> <pageNodeId> figma-screenshots/{page}-full.png --scale 2
   scripts/figma-rest-image.sh <fileKey> <sectionNodeId> figma-screenshots/{page}-{section}.png --scale 2

   # Tablet / Mobile (반응형 프레임 감지된 경우만 — 페이지 전체만 선행 확보)
   scripts/figma-rest-image.sh <fileKey> <tabletPageNodeId> figma-screenshots/{page}-full-tablet.png --scale 2
   scripts/figma-rest-image.sh <fileKey> <mobilePageNodeId> figma-screenshots/{page}-full-mobile.png --scale 2
   ```
   섹션별 Tablet/Mobile PNG 는 **Phase 3 섹션 워커가 섹션 구현 시 개별 확보**.
7. `PROGRESS.md`에 섹션 목록 추가 (체크박스) — "공통 컴포넌트 먼저" 규칙에 따라
   DS 인벤토리에서 식별한 컴포넌트를 Phase 3 맨 앞에 스폰
8. **사용자 승인 대기** — "이 분해로 진행해도 될까요?"
   - 반응형 감지 상태가 "⚠ 감지 실패" 또는 "⚠ 매핑 수동 확인 필요" 인 페이지 있으면 이때 재확인

이 단계에서만 사용자 개입 1회.

### Phase 2b — spec 모드 (컴포넌트 카탈로그 분석)

spec 모드는 Figma 라이브 쿼리가 없고 `docs/components-spec.md` 가 진실의 원천. 페이지 분해 대신 **컴포넌트 카탈로그 분석 + 구현 순서 결정**이 Phase 2 작업.

1. `docs/components-spec.md` 읽기 — Part 1~N 구조 파악
2. 컴포넌트 분류:
   - **Foundation** (Part 1) — 토큰, 타이포 체계. 이미 tokens.css 로 주입됐으면 스킵 가능
   - **Brand** (Part 2) — 로고, 워드마크, Lockup
   - **Primitive** (Part 3) — Button, Card, Input, Icon 등 (재사용 가능 단위)
   - **Domain** (Part 4+) — 프로젝트 특화 (BookCover, TabBar, Sidebar 등)
3. **구현 순서 결정** — 의존성 그래프 기반:
   - Brand 컴포넌트 먼저 (다른 컴포넌트가 import)
   - Primitive 다음 (Button/Card/Icon 은 Domain 에서 재사용)
   - Domain 마지막 (Primitive 조합)
   - 페이지/라우트 조립은 컴포넌트 완료 후
4. **참조 자산 확인** — handoff 리포에 포함된 reference HTML/이미지:
   - `directions/` · `web/` · `mobile/` HTML 프로토타입 → 섹션 워커가 시각 참조용으로 읽음
   - handoff 에 해당 경로 없으면 "텍스트 스펙만으로 구현" 표기
5. **브랜드 가드레일 추출** — `components-spec.md` 의 "Forbidden Patterns" / "Non-negotiable" / "Don't" 섹션을 리스트업하여 `docs/project-context.md` 에 기록 (워커가 구현 시 위반 체크)
6. `PROGRESS.md` 에 컴포넌트 체크리스트 추가 — 섹션 워커 스폰 순서대로
7. **사용자 승인 대기** — "이 순서로 진행해도 될까요?"

spec 모드에서는 `figma-screenshots/` 디렉토리를 생성하지 않는다. baseline PNG 대신 reference HTML 또는 components-spec 의 텍스트 명세가 근거.

## Phase 3: 섹션 루프 (핵심)

### 섹션 워커 스폰

### 정식 prompt 포맷 (필수 준수)

워커가 안정적으로 파싱하려면 **YAML-like key:value 블록** + **구조화 필드는 JSON 문자열** 혼합 포맷 사용. prose 로 뿌리지 말 것 (retry 경로에서 `previous_failures` 파싱 실패 유발).

각 섹션마다:

```
Agent({
  subagent_type: "section-worker",
  // model 필드는 명시하지 않음 — frontmatter의 sonnet 따름. retry_count==2 + 반복 FAIL 시 model: opus 승격.
  description: "{section} 구현",
  prompt: `섹션/컴포넌트를 section-worker.md §4단계 로 처리하라.

# 입력 필드 (YAML-like, 아래 순서 유지)

mode: spec
section_name: Button
route: /__preview/Button
retry_count: 0
previous_failures: []
required_imports: []

# spec 모드 전용
spec_path: docs/components-spec.md
spec_section: "3.1 <Button>"
reference_html: ["directions/direction-A-final.html"]
brand_guardrails: ["퍼플 그라데이션 금지", "이모지 아이콘 금지"]

# figma 모드 전용 (spec 모드에선 생략)
# page_name: home
# figma_file_key: ABC123
# figma_node_id: 12:345
# figma_node_id_tablet: 12:346
# figma_node_id_mobile: 12:347

docs/workflow.md §Phase 3 참고. 모든 게이트 평가 후 §5 반환 스키마대로 단일 JSON 블록 반환.
`
})
```

### 필드 시맨틱

- **`retry_count`**: `0`=첫 호출 / `1`=가이드 재시도 / `2`=마지막 기회 (opus 승격 가능)
- **`previous_failures`**: **JSON 배열 문자열로 직렬화**. retry_count≥1 에서만 비어있지 않음.
  ```
  previous_failures: [{"category":"TOKEN_DRIFT","gate":"G4","file":"src/components/ui/Button.tsx","line":42,"message":"hex literal '#B84A32' found","attempt":0}]
  ```
  - `category` enum (9개): `VISUAL_DRIFT` | `TOKEN_DRIFT` | `A11Y` | `TEXT_RASTER` | `I18N_MISSING` | `IMPORT_MISSING` | `SYNTAX_ERROR` | `LIGHTHOUSE` | `UNKNOWN`
  - `attempt`: 이 실패가 발견된 retry_count (0/1)
  - 누적 전달: retry_count=2 호출 시 attempt=0 + attempt=1 failures 모두 포함
- **`required_imports`**: JSON 배열 문자열.
  ```
  required_imports: [{"name":"Wordmark","path":"src/components/ui/Wordmark"},{"name":"Button","path":"src/components/ui/Button","variant":"default"}]
  ```
- **`reference_html` / `brand_guardrails`**: 문자열 배열.
- **`spec_section`**: `components-spec.md` 의 `## <번호> <컴포넌트명>` 헤더에서 번호+이름 부분 그대로 (예: `"3.1 <Button>"`).

### 파싱 규약 (워커 측)

워커는 prompt 에서 다음 순서로 필드 추출:
1. `^key:\s*(.+)$` 정규식 매칭 (YAML-like 라인)
2. JSON 배열/객체 값은 `JSON.parse()` 또는 Read 이후 직접 해석
3. 누락된 필드는 mode 에 따라 default 적용 (figma 모드에서 spec 필드 없음 = 무시)
4. 파싱 불가하면 `status: "failure"` + `failures: [{category:"UNKNOWN", message:"prompt parse error: <상세>"}]` 로 즉시 반환

### 워커 반환 결과 처리

**PASS (모든 게이트 통과)**:
1. 결과 검증 (tests/quality/{section}.json 파일 읽기)
2. git 커밋 (자동):
   ```bash
   git add .
   # figma 모드
   git commit -m "feat(section): {page}-{section} 구현 (G4-G8 PASS)"
   # spec 모드
   git commit -m "feat(component): {section} 구현 (G4-G8 PASS)"
   ```
3. `PROGRESS.md` 해당 섹션/컴포넌트 체크
4. 다음 단위로 즉시 진행

**FAIL 처리** (feedback loop — 자동 재시도 최대 3회):

```
워커 retry_count=0 FAIL
  ↓ (자동)
워커 retry_count=1 재스폰 + previous_failures 전달
  ↓ FAIL
워커 retry_count=2 재스폰 + 누적 previous_failures + (선택) Opus 승격
  ↓ FAIL (needs_human: true)
사용자 개입 — 선택지 제시
```

단계별 상세:

1. **retry_count=0 FAIL → retry_count=1 자동 재스폰**
   - 사용자 보고 없이 자동 진행 (로그만 남김)
   - 새 Agent 호출: 동일 section-worker, `retry_count: 1`, `previous_failures: <워커가 반환한 failures 배열>`
   - 같은 모델 (sonnet) 유지

2. **retry_count=1 FAIL → retry_count=2 자동 재스폰**
   - 누적 failures 배열 (attempt 0 + 1) 을 previous_failures 로 전달
   - 복잡 섹션 판단 시 `model: opus` 승격 고려 (failures 개수 5+ 또는 카테고리 3종+ 혼재)

3. **retry_count=2 FAIL (needs_human: true) → 사용자 개입**
   - 누적 failures 요약 + 선택지 제시:
     - (a) 현 상태에서 다시 Opus 로 재시도 (drift 심하면)
     - (b) 수동 리팩터 (사용자가 직접)
     - (c) 섹션 스킵 (다음으로 넘어감, PROGRESS.md 주석)
     - (d) 섹션 재분할 (서브섹션으로 쪼개기)

**안티-루프 가드** (중요):
- 각 재스폰 전에 previous_failures 의 카테고리 분포 체크
- **retry_count=1 결과에서 동일 category 가 retry_count=0 과 똑같이 등장** 하면 워커가 피드백을 무시한 것 → retry_count=2 에서 model: opus 강제 승격
- **retry_count=2 에서도 동일 category 반복** 이면 "구조 자체 문제" 로 간주 → 재분할 선택지를 상위에 노출

### 섹션 진행 순서

**figma 모드**:
1. 공통 컴포넌트 먼저 — Header/Footer 같은 전 페이지 공통
2. Phase 2에서 식별된 신규 공통 컴포넌트 (`src/components/ui/`)
3. 페이지 섹션 — 위→아래 순서

**spec 모드** (의존성 그래프 역순 = 잎부터):
1. **Brand** (Part 2) — BrandMark / Wordmark / Lockup (로고 자산)
2. **Primitive** (Part 3) — Button / Card / Input / Icon / Pill (재사용 기본 단위)
3. **Domain** (Part 4+) — BookCover / TabBar / Sidebar 등 (Primitive 조합)
4. **페이지 조립** — components-spec 에 페이지 스펙이 있으면 마지막에

### 공통 컴포넌트 동기화 규칙 (병렬 작업 시 필수)

`required_imports` 에 명시된 공통 컴포넌트는 **그 파일이 리포에 실재해야** 워커가 import할 수 있다. 병렬 작업 환경에서 다음 규칙을 반드시 지켜라:

**규칙 1. 공통 컴포넌트 섹션은 단일 워커가 먼저 완료**
- `Wordmark`, `Button`, `CtaButton` 같은 공통 컴포넌트를 생성하는 섹션 워커가 **먼저 커밋/머지**
- 이후 이 컴포넌트를 `required_imports`로 참조하는 섹션들을 병렬 스폰

**규칙 2. 팀원에게 작업 분배 시 검사**
- 팀원 A에게 `home-header` 할당 (Wordmark 생성 담당)
- 팀원 B에게 `home-footer` 할당하려면 → **home-header PR이 머지된 뒤에** 시작
- PROGRESS.md에 `[⏳ blocked by home-header]` 표기로 동기화

**규칙 3. 오케가 병렬 스폰 안전 검사**
- 새 섹션 스폰 전: `required_imports`의 각 `path` 가 실제 존재하는지 파일 시스템 확인
- 누락된 의존 컴포넌트가 있으면 **그 섹션을 pending 큐에 두고** 선행 섹션 완료 후 재시도

## Phase 4: 페이지 통합 검증

페이지의 모든 섹션 완료 후 오케스트레이터가 직접 수행:

1. `PROGRESS.md` 해당 페이지 섹션 체크 확인
2. dev 서버에서 실제 라우트 (`/`, `/about` 등) 1920 뷰포트 fullpage 캡처
3. 육안 검증:
   - 섹션 정렬 (좌측 치우침, 가로 스크롤, z-index 충돌)
   - 섹션 간 간격
4. Lighthouse (있으면): `scripts/measure-quality.sh <page>-full <page-dir>` (optional)
5. PROGRESS.md 페이지 완료 체크

## 자동 커밋 규칙

섹션 완료 시:
```bash
git commit -m "feat(section): {page}-{section} 구현 (G4-G8 PASS)"
```

Opus 승격 후 완료 시:
```bash
git commit -m "feat(section): {page}-{section} 구현 (G4-G8 PASS, opus-assist)"
```

## 멈춤 지점 (사용자 개입 2곳만)

1. **Phase 2 분해 승인** — 섹션 목록 제시 후 "이대로 진행?"
2. **섹션 retry_count=2 FAIL** — 3회 자동 재시도 후에도 FAIL 이면 사용자 개입 (Opus / 수동 / 스킵 / 재분할)

그 외는 모두 자율 진행 (retry_count 0→1→2 자동 재스폰 포함).

## 데이터 전달

| 대상 | 방식 |
|---|---|
| 오케 → 워커 | prompt의 section_name / node_id / route / retry_count |
| 워커 → 오케 | 결과 JSON + 파일 시스템 (tests/quality/{section}.json) |
| 오케 → 사용자 | PROGRESS.md 업데이트 + 간단 통보 |

## 에러 핸들링

| 상황 | 대응 |
|---|---|
| **Agent not found (section-worker)** | **즉시 중단 + 사용자에게 보고**. "`.claude/agents/section-worker.md` 파일은 존재하나 현재 Claude 세션의 Agent 레지스트리에 노출되지 않음. 세션을 시작한 후 bootstrap이 돌아 에이전트 파일이 추가된 경우 이런 상태가 됩니다. `/exit` 후 `claude` 재시작을 요청" — 오케가 직접 구현으로 대체 금지 |
| FIGMA_TOKEN 미설정 | 사용자에게 env var 설정 안내, 워커 스폰 중단 |
| token-audit.md 없음 | `scripts/extract-tokens.sh` 먼저 실행 |
| 워커 2회 FAIL | Opus 승격 / 수동 / 스킵 / 재분할 선택지 제시 |
| Figma MCP 쿼터 소진 | REST API로 대체 안내 (워커가 자동 처리) |
| git conflict | 섹션 단위 원자성으로 드물지만, 발생 시 사용자 수동 처리 |

### Agent not found 시 판단 흐름

```
1. Agent 도구 호출 → "Agent type 'section-worker' not found" 에러
2. 오케는 즉시 중단. 다음 행동 금지:
   - ❌ 오케가 직접 섹션 파일 수정 시작
   - ❌ 다른 에이전트(general-purpose 등)로 fallback
   - ❌ "Available agents에 없으니 직접 진행" 같은 임의 판단
3. 사용자에게 보고 (정확한 포맷):
   "❌ section-worker 에이전트가 현재 세션에서 인식되지 않습니다.
    .claude/agents/section-worker.md 파일은 존재하지만 Agent 레지스트리가
    세션 시작 시점에 동결된 상태입니다. 다음을 수행해 주세요:
    1. /exit 로 현재 세션 종료
    2. 같은 디렉토리에서 `claude` 재시작
    3. 새 세션에서 섹션 진행 지시 반복
    이 세션에서는 더 이상 작업을 진행하지 않습니다."
4. 사용자 재지시 대기. 직접 구현 절대 금지.
```

## 금지

- ❌ 직접 섹션 파일 수정 (워커 위임)
- ❌ **Agent 호출 실패 시 오케가 직접 구현으로 전환** (위 Agent not found 핸들링 준수)
- ❌ **대체 에이전트(general-purpose 등)로 fallback 스폰** (section-worker 아닌 워커가 스킬 프롬프트를 이해할 수 없음)
- ❌ tokens.css / fonts.css 수정 (extract-tokens.sh만이 쓴다)
- ❌ 여러 섹션 병렬 스폰 (순차)
- ❌ 워커 결과를 검증 없이 신뢰 (tests/quality/{section}.json 직접 확인)
- ❌ research 문서 생성 지시 (lite에서 제거)
- ❌ 3회 이상 재시도 (2회 FAIL 시 사용자 결정)

## 테스트 시나리오

**정상 흐름**: 사용자 "다음 섹션 진행"
1. PROGRESS.md 읽기 → 다음 미완 섹션 식별
2. docs/project-context.md에서 nodeId 조회
3. section-worker 스폰
4. 반환 JSON 검증 → PASS → 자동 커밋 → PROGRESS.md 업데이트 → 다음 섹션 제안

**실패 흐름**: G5 FAIL
- 워커가 1회 자체 재시도 후 여전히 FAIL로 반환
- 오케스트레이터가 사용자에게 선택지 4개 제시
- 사용자 "Opus로 재시도" → 워커 `model: opus`로 재스폰
- PASS 후 커밋 메시지에 `(opus-assist)` 추가

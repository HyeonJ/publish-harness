# workflow.md — publish-harness 1페이지 워크플로

## 4 Phase

```
[Phase 1] 부트스트랩        (1회, bootstrap.sh 한 줄, 모드 선택)
[Phase 2] 분해              (페이지/컴포넌트 카탈로그 시작 시, 오케 직접)
[Phase 3] 섹션/컴포넌트 루프 (단위마다 워커 1회)
[Phase 4] 통합 검증         (완료 시, 오케 직접)
```

## Phase 1 — 부트스트랩

두 가지 모드 중 하나 선택:

```bash
# figma 모드 (기본) — Figma URL 에서 토큰 자동 추출 + 라이브 쿼리
bash scripts/bootstrap.sh <figma-url> [project-name]

# Component/Design System 페이지가 따로 있는 경우 (권장)
bash scripts/bootstrap.sh <figma-url> [project-name] \
  --component-url <figma-component-page-url>

# spec 모드 — 정적 핸드오프 번들 임포트
bash scripts/bootstrap.sh --mode spec --from-handoff <dir> [project-name]

# 출력 템플릿을 html-static 으로 (figma 모드만 지원)
bash scripts/bootstrap.sh --mode figma --template html-static <figma-url>
```

### Template 분기

`docs/project-context.md` 의 `template:` 필드가 출력 템플릿을 결정한다 (`vite-react-ts` | `html-static`). bootstrap 단계에서 `--template` 인자에 따라 자동 기록. `measure-quality.sh` 와 section-worker 가 이 필드를 보고 게이트 명령 / 산출물 경로를 분기한다. 환경변수 `TEMPLATE` / `PREVIEW_BASE_URL` 로 일회성 override 가능.

지원 매트릭스: [`docs/template-support-matrix.md`](./template-support-matrix.md). `spec × html-static` 은 mismatch — bootstrap.sh 가 명시적으로 차단.

**html-static 추가 빌드 단계**: 페이지의 모든 섹션 PASS 후 Phase 4 통합 검증 단계에서 `node scripts/assemble-page-preview.mjs --page <name> --sections <list>` 호출 → `public/<name>.html` (home 만 `public/index.html`) 정식 페이지 산출. 섹션 단독 preview (`public/__preview/<section>/`) 는 게이트 측정·디버그·retry 단위로 유지.

자동 수행 (공통):
1. Vite + React + TS + Tailwind + Router 스캐폴드
2. `docs/project-context.md` 템플릿 (`{MODE}` / `{SOURCE_INFO}` 치환)
3. `PROGRESS.md` 초기화
4. `.claude/agents/` + `.claude/skills/` 복사
5. git init + 초기 커밋

모드별 추가 수행:

**figma 모드**:
- `scripts/extract-tokens.sh <fileKey> [--component-page <nodeId>]` 호출
  - Component URL 있으면 그 페이지만 스캔 + 레이어명 기반 네이밍 (품질 ↑)
  - 없으면 전체 파일 빈도 스캔 + 휴리스틱 네이밍 (fallback)
- `tokens.css` / `fonts.css` / `tailwind.config.ts` 자동 생성
- `docs/token-audit.md` 리포트 (mode: `component` / `full` 명시)

**spec 모드**:
- handoff 폴더에서 복사:
  - `tokens.css` → `src/styles/tokens.css`
  - `tailwind.config.js` → 루트 (기존 `tailwind.config.ts` 제거)
  - `tokens.js` → `src/lib/tokens.js` (있으면)
  - `components-spec.md` → `docs/components-spec.md`
  - `design-tokens.json` → `docs/design-tokens.json` (있으면)
- `docs/token-audit.md` 를 "임포트 manifest" 로 자동 생성 (소스 경로·모드·날짜 기록)

**종료 조건**: `docs/token-audit.md` 존재 + `src/styles/tokens.css` 존재 + dev 서버 기동 확인.

### Component 페이지 모드 식별법

Figma 파일의 **페이지 목록** (왼쪽 사이드바)을 보고 다음 이름 중 하나가 있으면 Component 페이지일 확률 높음:
- `Components`, `Design System`, `Tokens`, `DS`, `UI Kit`, `Styles`, `Foundations`

해당 페이지를 클릭한 상태에서 URL의 `node-id=10-5282` 부분을 복사 (또는 그 URL 전체를 `--component-url` 로 전달). 없으면 생략 가능 — fallback 모드로 작동.

**bootstrap 후 새 클로드 세션 시작 필수** — section-worker subagent 레지스트리는 세션 시작 시점에만 reload 됨. 같은 세션에서 Phase 3 워커 spawn 시 general-purpose 우회로 떨어져 section-worker 의 frontmatter / retry 메커니즘 검증 불가.

## Phase 2 — 분해 (모드 분기)

공통: 오케스트레이터가 직접 수행. 워커 스폰 불필요. 마지막에 사용자 승인 1회.

### Phase 2a — figma 모드 (페이지 분해)

오케스트레이터가 직접 수행:
1. 페이지 Node ID 확인 (`docs/project-context.md`)
2. `get_metadata` 또는 REST `/v1/files/{key}/nodes?ids=<pageNodeId>&depth=3`
3. 12K 초과 / 이질 에셋 3+ / 반복 자식 3+ / blend transform 3+ 조건이면 서브섹션 분할
4. **반응형 프레임 감지** (페이지별로 Tablet/Mobile 디자인이 따로 있는지 확인):

   **감지 단서 4종**:
   - **프레임 이름 키워드**: `Home / Desktop`, `Home-Mobile`, `Home (Tablet)`, `About Desktop 1920`
   - **프레임 너비**: 1920/1440/1280 = Desktop · 768/1024 = Tablet · 375/390/360 = Mobile
   - **Figma 페이지 분리**: `Desktop Pages` / `Mobile Pages` 같은 별도 페이지
   - **섹션 변종**: 같은 섹션명의 뷰포트별 복제 (예: `Home Hero (Desktop)` + `Home Hero (Mobile)`)

   감지 결과를 `docs/project-context.md` 의 페이지 테이블 3개 컬럼에 기록:
   - Desktop Node ID (필수)
   - Tablet Node ID (선택)
   - Mobile Node ID (선택)

   감지 실패 시 "⚠ 감지 실패 — 수동 확인 필요" 표기. 사용자 승인 시 명시적으로 재확인.

   ### 4분기 자동 처리 (v2)

   감지 결과에 따라 자동 분기 — 부재한 viewport 만 figma `use_figma` MCP 도구로 자동 생성:

   | desktop | tablet | mobile | 동작 |
   |---|---|---|---|
   | ✅ | ✅ | ✅ | use_figma 호출 X. 기존 흐름 (Tier 2 multi-viewport) |
   | ✅ | ✅ | ❌ | mobile 만 use_figma 로 생성 |
   | ✅ | ❌ | ✅ | tablet 만 use_figma 로 생성 |
   | ✅ | ❌ | ❌ | tablet + mobile 둘 다 use_figma 로 생성 |
   | ❌ | * | * | error — bootstrap 단계 차단 |

   **핵심 원칙**:
   - figma 디자이너 의도는 **절대 덮어쓰지 않음** — 이미 있는 frame 그대로 사용
   - 자동 생성은 **부재한 viewport 에만** 적용
   - 자동 생성한 viewport 는 `docs/project-context.md` 의 page 테이블에 `source: auto-generated` 표기 (figma-original 과 구분)

   **use_figma 호출 가이드**: `docs/responsive-figma-generator.md` 의 plugin API 코드 패턴 참조 (Task 22).

   **사용자 승인 분기**:
   - 모든 viewport 가 이미 있던 경우 (4-1) → 별도 메시지 없이 진행
   - 자동 생성한 viewport 가 있는 경우 → "Mobile/Tablet 자동 생성됨, figma 에서 확인. OK 면 Phase 3 진행"

### Phase 2a 자동 분석 (B-3 + B-7, beverage-product §retro-phase1-4)

오케스트레이터가 페이지 분해 단계에서 **자동 분석 스크립트 1회 호출**. 산출물 2종:

```bash
# B-3 + B-7: 섹션별 layout topology + 4분기 추천 + Tier 1 desktop 보존 신호
node scripts/analyze-page-structure.mjs \
  --file-key <fileKey> \
  --page-node <pageNodeId> \
  --out docs/page-structure.md

# B-6: figma 실제 텍스트 콘텐츠 일괄 추출 (placeholder 차단)
node scripts/extract-text-content.mjs \
  --file-key <fileKey> \
  --page-node <pageNodeId> \
  --out docs/text-content.md
```

**산출물**:
- `docs/page-structure.md` — 섹션별 `autoLayoutRatio` / `layoutTopology` (linear/scattered) /
  `phase2Recommendation` (use_figma / tier1 / tier1-scattered)
- `docs/text-content.md` — 모든 TEXT 노드의 `characters` + fontFamily/fontSize 메타

**워커 통합**:
- 섹션 워커 prompt 에 `docs/page-structure.md` + `docs/text-content.md` Read 명시
- `phase2Recommendation: tier1-scattered` 인 섹션은 brand_guardrails 자동 추가:
  > scattered layout — flex column 단순화 금지. CSS Grid template areas / absolute
  > positioning 으로 figma 좌표 비율 보존. `data-allow-escape="figma-scattered-layout"` 사용.
- 워커가 `get_design_context` 호출 default 금지 (B-4) — text/좌표/layout 모두 위 산출물에서

5. 섹션 + 페이지 전체 baseline PNG:
   ```bash
   # Desktop (기본, 필수)
   scripts/figma-rest-image.sh <fileKey> <pageNodeId> figma-screenshots/{page}-full.png --scale 2
   scripts/figma-rest-image.sh <fileKey> <sectionNodeId> figma-screenshots/{page}-{section}.png --scale 2

   # Tablet / Mobile (반응형 프레임 감지된 경우만, 페이지 전체만 선행 확보)
   scripts/figma-rest-image.sh <fileKey> <tabletPageNodeId> figma-screenshots/{page}-full-tablet.png --scale 2
   scripts/figma-rest-image.sh <fileKey> <mobilePageNodeId> figma-screenshots/{page}-full-mobile.png --scale 2
   ```
   섹션별 Tablet/Mobile PNG는 **Phase 3 워커가 섹션 구현 시 확보** (오케는 페이지 전체만).

6. `PROGRESS.md`에 섹션 목록 추가 (반응형 감지 상태 표기 포함)
7. **사용자 승인 대기**: "이대로 진행?"

### Phase 2b — spec 모드 (컴포넌트 카탈로그 분석)

오케스트레이터가 직접 수행:

1. `docs/components-spec.md` 읽기 — Part 1~N 구조 파악
2. **컴포넌트 분류**:
   - Foundation (Part 1) — 토큰 체계 (이미 주입됐으면 스킵 가능)
   - Brand (Part 2) — 로고 · 워드마크 · Lockup
   - Primitive (Part 3) — Button / Card / Input / Icon / Pill
   - Domain (Part 4+) — 프로젝트 특화 (BookCover / TabBar / Sidebar 등)
3. **구현 순서 결정** (의존성 그래프 역순 = 잎부터):
   - Brand 먼저 → Primitive → Domain → 페이지 조립
4. **참조 자산 확인** — handoff 리포 내 reference HTML:
   - 예: `directions/direction-A-final.html`, `mobile/mobile-prototype.html`, `web/web-prototype.html`
   - 없으면 "텍스트 스펙만으로 구현" 표기
5. **브랜드 가드레일 추출** — `components-spec.md` 의 "Forbidden Patterns" / "Non-negotiable" / "Don't" 섹션을 리스트업해 `docs/project-context.md` 의 `brand_guardrails` 에 기록
6. `PROGRESS.md` 에 컴포넌트 체크리스트 추가 — 구현 순서대로
7. **사용자 승인 대기**: "이 순서로 진행?"

spec 모드에서는 `figma-screenshots/` 디렉토리를 생성하지 않는다. baseline PNG 대신 reference HTML + components-spec 텍스트 명세가 근거.

## Phase 3 — 섹션/컴포넌트 루프

각 섹션/컴포넌트마다 `section-worker` 1회 호출. 워커가 4단계를 자체 완료:

```
1. 리서치        → plan/{section}.md (컴포넌트 트리 + 에셋 표 + 사용 토큰)
                   · figma 모드: figma-rest-image + get_design_context
                   · spec 모드: components-spec.md 파트 Read + reference HTML Read
2. 에셋 수집     → src/assets/{section}/
                   · figma 모드: nodeId 기반 REST export
                   · spec 모드: handoff 리포 아이콘 복사 또는 inline SVG
3. 구현          → src/components/{sections|ui|brand}/{Name}.tsx + preview route
4.1 G1 baseline 준비 → baselines/<section>/<viewport>.png + anchors-<viewport>.json (필수, strict)
                   · 통합: prepare-baseline.mjs (모드 자동 분기)
                   · figma 모드: figma-rest-image + extract-figma-anchors
                   · spec 모드: reference HTML 렌더 (anchor 자동 추출 LOW — partial strict)
                   · --force 시 anchor diff report 출력
                   · 캐싱: figma lastModified / spec mtime
4.2 품질 게이트   → scripts/measure-quality.sh
                   · 실행 순서 fail-fast: G10 → G4 → G11 → G5 → G6/G8 → G1 → G7
                   · G1 strict default + viewport 자동 감지
                   · G11 escape budget (정적 + Playwright runtime sweep + dependency closure)
                   · LITE=1 env 로 옵트아웃 (개발 로컬만)
```

**워커 반환 처리**:
- PASS → 자동 커밋 + PROGRESS.md 체크 + 다음 섹션
- FAIL (워커 자체 1회 재시도 후) → 사용자 개입: Opus 승격 / 수동 / 스킵 / 재분할

### 섹션 진행 순서

1. 공통 레이아웃 (Header / Footer)
2. Phase 2 식별 신규 공통 컴포넌트
3. 페이지 섹션 (위→아래)

## Phase 4 — 페이지 통합

페이지 섹션 모두 완료 후:
1. 실제 라우트 (`/`, `/about` 등) **1920 fullpage** 캡처 (Desktop pixel-perfect 검증)
2. Desktop 육안 검증: 섹션 정렬 / 가로 스크롤 / 섹션 간 간격 / z-index
3. **375px Mobile / 768px Tablet 뷰포트로도 훑어봄** (육안 — pixel-perfect 아님, 깨짐 확인):
   - 가로 스크롤 유발 요소 없음 (`body.scrollWidth > viewport.width` 체크)
   - 큰 타이포 overflow 없음
   - 이미지 비율 왜곡 없음
   - Nav 햄버거 동작 (Mobile)
   - 버튼/링크 터치 타겟 44px 이상
4. Tier 2 (Figma Mobile/Tablet 디자인 있는 페이지):
   - 해당 뷰포트 캡처를 Figma baseline 과 비교 (육안, 측정 대상 아님)
   - 디자인 의도 벗어나는 부분 발견 시 해당 섹션 수정
5. (선택) Lighthouse: `bash scripts/measure-quality.sh {page}-full {page-dir}`
6. PROGRESS.md 페이지 완료 체크

## baseline 갱신 프로토콜

옛 heavy 폐기 원인 중 하나: "Figma 가 변경됐는지 코드가 회귀했는지 구분 안 됨". 명시적 분리:

| 시나리오 | 처리 |
|---|---|
| Figma 디자인 변경 (디자이너 알림) | "디자인 변경 PR" — `prepare-baseline.mjs --force --section <id>` 실행, 새 baseline + manifest commit |
| 구현 회귀 (코드 변경으로 FAIL) | "구현 PR" — baseline 갱신 금지. 코드 수정으로 PASS |
| 둘 다 | 두 PR 분리 권장 |

`prepare-baseline.mjs --force` 는 stdout 에 **anchor diff report** 출력 — 리뷰어가 디자인 의도된 변경 여부 검토.

### legacy.json 운영

기존 프로젝트는 `migrate-baselines.mjs --section <id>` 로 1회 발급. 90일 만료.

- 만료된 legacy: 다음 중 하나
  1. `prepare-baseline.mjs` 로 manifest 추출 → 자동 strict 진입 (legacy 제거)
  2. `migrate-baselines.mjs --renew --section <id>` (90일 연장, 단독 commit)
- 워커/사용자 직접 작성 금지 — `migrate-baselines.mjs` 만 거버넌스 필드 정확히 채움
- CI: `check-legacy-additions.mjs` 가 구현 PR 의 신규 legacy 추가 차단

## 섹션 작성 규칙 (절대)

| 규칙 | 위반 시 |
|---|---|
| hex literal 금지 (`#2D5A27` 직접 기입) | G4 FAIL |
| `<div onClick>` 금지 → `<button>` | G5 FAIL |
| 텍스트를 `<img alt="긴 문장">`에 밀어넣기 금지 | G6 FAIL |
| JSX에 literal text 있어야 함 (alt/aria 제외) | G8 FAIL |
| SVG 패턴: 부모 div + 원본 사이즈 img | (관례) |
| Figma REST PNG에 CSS rotate/blend/bg 재적용 금지 | (관례, 이중 효과) |
| 플러그인 덤프 absolute 그대로 이식 금지 | (관례, flex/grid 재구성) |
| section root subtree 에 `position: absolute/fixed/sticky` 사용 (root 제외) | G11 FAIL |
| 토큰 외 매직 px (`w-[37px]` 등) > 3개 | G11 FAIL |
| transform px / negative margin / breakpoint divergence 임계 초과 | G11 FAIL |

## 커밋 메시지

성공:
```
feat(section): {page}-{section} 구현 (G4-G8 PASS)
```

Opus 승격 후:
```
feat(section): {page}-{section} 구현 (G4-G8 PASS, opus-assist)
```

## 멈춤 지점 (사용자 개입)

1. Phase 2 분해 승인
2. 섹션 2회 FAIL 후 선택지

그 외는 모두 자율.

## Figma 쿼터

- Figma REST Images API: 분당 수천 req — 실질 무제한
- Figma MCP `get_design_context`: 섹션당 1회
- Figma MCP `get_variable_defs`: 페이지당 1회 이하 (Enterprise 전용 제약)

## 실패 대응

| 증상 | 원인 | 대응 |
|---|---|---|
| G4 FAIL | hex literal 섞임 | tokens.css의 `var(--*)` 또는 Tailwind 토큰 클래스로 치환 |
| G5 FAIL | `<div onClick>` | `<button>`, `<a>` 시맨틱 요소로 교체 |
| G6 FAIL | 텍스트 raster 안티패턴 | `<img alt="긴 텍스트">` 대신 `<h2>`/`<p>`/`<li>` |
| G8 FAIL | JSX에 텍스트 없음 | 사용자 가시 텍스트를 JSX 트리에 |
| Figma MCP 쿼터 소진 | 월 한도 초과 | REST `/v1/files/{key}/nodes` 로 대체 |
| FIGMA_TOKEN 미설정 | env var 없음 | Windows PowerShell User scope / Unix export |
| G11 FAIL | layout escape 남발 | flex/grid 재구성. 데코는 `data-allow-escape="<enum>"` (≤2회) |
| G1 L2 anchor missing | manifest required 박지 않음 | stdout missing 리스트 따라 추가 |
| G1 L2 bbox delta | element 위치/크기 어긋남 | width/height/margin 점검 (escape budget 추가는 G11 으로 차단) |

# publish-harness

디자인 소스를 프론트엔드 코드로 변환하는 **섹션 단위 퍼블리싱 하네스**.
Claude Code 또는 Codex에서 같은 게이트/진행 상태를 공유해 동작.

## 특징

- **섹션 단위 워커**: 섹션/컴포넌트당 평균 15~20분, 한 단위 = 한 커밋
- **두 가지 소스 모드**:
  - **`figma`** — Figma URL 에서 토큰 자동 추출 + 라이브 쿼리
  - **`spec`** — 정적 핸드오프 번들 (tokens.css + components-spec.md) 임포트
- **차단형 게이트 4개 (G4/G5/G6/G8)** — 접근성·토큰 드리프트·텍스트 raster·i18n 가능성 보장
- **Sonnet 워커 기본** — Pro $20 요금제도 완주 가능 (오케스트레이터 Opus/Sonnet 양쪽)
- **앞으로 확장**: 출력 타겟(html/Next.js/React Native) · 입력 소스(Storybook · DSL) 점진 추가 예정

## 요구 사항

최소: **Node 18+ · bash · git** · (figma 모드만) **FIGMA_TOKEN**

에이전트별 추가:
- Claude 사용: **Claude Code CLI**
- Codex 사용: Codex 세션에서 `AGENTS.md` 지원

설치 상세는 **[docs/SETUP.md](./docs/SETUP.md)** 참고 (소요 15~25분).

환경 확인:
```bash
bash scripts/doctor.sh                    # figma 모드 체크
bash scripts/doctor.sh --skip-figma       # spec 모드 체크 (FIGMA_TOKEN 불필요)
```

---

## 사용 흐름

```
1. 이 하네스 리포 clone
2. 신규 프로젝트 디렉토리 생성 → cd
3. 사용할 에이전트 선택 (`--agent claude|codex|both`)
4. 모드에 맞게 §1 (figma) 또는 §2 (spec) 부트스트랩
5. Claude는 세션 재시작 후, Codex는 `AGENTS.md` 기준으로 §3/§4 진행
6. 필요 시 §5 에스컬레이션 / §6 유지보수 프롬프트
```

---

## §1. 부트스트랩 — figma 모드

Figma URL 이 소스. 토큰은 `extract-tokens.sh` 가 Figma REST API 로 자동 추출.

```bash
# 0. 환경 셋업 (최초 1회) — docs/SETUP.md
# 1. 하네스 clone
git clone https://github.com/<your>/publish-harness.git "$HOME/workspace/publish-harness"
# 2. (최초 1회) FIGMA_TOKEN 등록
bash "$HOME/workspace/publish-harness/scripts/setup-figma-token.sh"
# 3. 환경 확인
bash "$HOME/workspace/publish-harness/scripts/doctor.sh"
# 4. 신규 프로젝트
mkdir "$HOME/workspace/my-new-project"
cd "$HOME/workspace/my-new-project"
claude --dangerously-skip-permissions
```

Claude 세션에 복붙:

```
하네스 리포의 README.md를 읽고
(경로 예시: $HOME/workspace/publish-harness/README.md —
 본인이 clone한 경로로 교체),
아래 Figma URL로 bootstrap.sh --mode figma 를 실행해서 이 디렉토리에 프로젝트를 초기화해줘.

Figma URL: https://www.figma.com/design/ABC123XYZ/MyProject

# (선택) Component/Design System 페이지가 별도로 있으면 함께 전달.
# Component URL: https://www.figma.com/design/ABC123XYZ/MyProject?node-id=10-5282

완료 조건:
- Vite + React + TS + Tailwind + Router 스캐폴드
- extract-tokens.sh 자동 실행 → src/styles/tokens.css 생성
- docs/token-audit.md 생성 후 요약 보고
- PROGRESS.md 초기화
- git init + 초기 커밋

완료 후 docs/token-audit.md 요약만 보여줘.
```

Codex로 직접 실행할 때:

```bash
bash "$HOME/workspace/publish-harness/scripts/bootstrap.sh" \
  --agent codex --mode figma \
  https://www.figma.com/design/ABC123XYZ/MyProject
```

Claude와 Codex를 모두 지원하는 프로젝트로 만들 때:

```bash
bash "$HOME/workspace/publish-harness/scripts/bootstrap.sh" \
  --agent both --mode figma \
  https://www.figma.com/design/ABC123XYZ/MyProject
```

---

## §2. 부트스트랩 — spec 모드

핸드오프 폴더 (`tokens.css` + `tailwind.config.js` + `components-spec.md` 포함) 가 소스. Figma 쿼리 없음.

```bash
# Figma 토큰 불필요. Node / Claude Code CLI 만 필요.
mkdir "$HOME/workspace/my-new-project"
cd "$HOME/workspace/my-new-project"
claude --dangerously-skip-permissions
```

Claude 세션에 복붙:

```
하네스 리포의 README.md를 읽고
(경로 예시: $HOME/workspace/publish-harness/README.md),
아래 핸드오프 폴더로 bootstrap.sh --mode spec --from-handoff 를 실행해서
이 디렉토리에 프로젝트를 초기화해줘.

핸드오프 폴더: $HOME/workspace/chapter/handoff

완료 조건:
- Vite + React + TS + Tailwind 스캐폴드
- handoff/tokens.css → src/styles/tokens.css (덮어쓰기)
- handoff/tailwind.config.js → 루트 (기존 tailwind.config.ts 제거)
- handoff/tokens.js → src/lib/tokens.js
- handoff/components-spec.md → docs/components-spec.md
- docs/token-audit.md 자동 생성 (임포트 manifest)
- PROGRESS.md 에 mode: spec 기록
- git init + 초기 커밋

완료 후 docs/components-spec.md 의 파트 구조를 요약해줘 —
Foundation / Brand / Primitive / Domain 컴포넌트 몇 개씩인지.
```

Codex로 직접 실행할 때:

```bash
bash "$HOME/workspace/publish-harness/scripts/bootstrap.sh" \
  --agent codex --mode spec --from-handoff "$HOME/workspace/chapter/handoff"
```

필수 파일이 handoff 폴더에 있어야 bootstrap 이 진행됨:
- `tokens.css`
- `tailwind.config.js`
- `components-spec.md`

선택 파일 (있으면 자동 복사):
- `tokens.js` · `design-tokens.json` · `README.md`

---

### ⚠ Claude 사용 시 — 부트스트랩 직후 Claude 세션 재시작

bootstrap.sh 가 `.claude/agents/` 와 `.claude/skills/` 를 프로젝트에 복사하지만, Claude Code는 **세션 시작 시점**에만 에이전트/스킬 레지스트리를 스캔. 같은 세션에서 바로 진행하면 `Agent type 'section-worker' not found` 에러 발생.

```bash
/exit
# 같은 디렉토리에서 재시작
claude --dangerously-skip-permissions
```

재시작 후 새 세션에서 §3 또는 §4 프롬프트로 진입.

Codex 사용 시에는 세션 재시작이 필수는 아니지만, 생성된 프로젝트 루트의
`AGENTS.md`, `docs/codex-section-worker.md`, `docs/codex-model-policy.md` 를 기준으로
진행한다.

---

## §3. 페이지 진행 모드 (figma 주로 사용)

```
publish-harness 스킬로 /home 페이지를 구현해줘.

1. docs/project-context.md 에서 Home 페이지 Node ID 확인
   (없으면 내게 URL 달라고 해)
2. Phase 2 페이지 분해 → 분해 결과를 PROGRESS.md에 반영하고 나에게 보여줘 (승인 대기)
3. 내가 승인하면 섹션들을 위에서 아래 순서로 section-worker로 스폰
4. 섹션마다 G4/G5/G6/G8 PASS 확인 후 자동 커밋
5. Home의 모든 섹션 완료 시 Phase 4 통합 검증
```

### 전체 자율 (모든 페이지 한 번에)

```
publish-harness 스킬로 이 Figma 파일의 전체 페이지를 끝까지 구현해줘.

진행 규칙:
1. docs/project-context.md 에 페이지 Node ID가 비어있으면 먼저 Figma에서
   페이지 트리를 get_metadata로 가져와 채워라
2. 각 페이지마다 Phase 2(섹션 분해)를 수행하고, 분해 결과만 한 번 내게 보여줘
3. 사용자 승인 받은 후엔 섹션들을 자율적으로 section-worker로 하나씩 구현
4. 각 섹션 완료 시 자동 커밋
5. 섹션 2회 FAIL 시에만 멈추고 선택지 4개 제시 (Opus / 스킵 / 재분할 / 수동)
6. 페이지 완료 시 Phase 4 통합 검증 실행 후 다음 페이지로
7. 전체 완주 후 PROGRESS.md 최종 상태 요약

중간 확인은 Phase 2 분해 승인만 받고 나머지는 자율.
```

---

## §4. 컴포넌트 진행 모드 (spec 주로 사용)

```
publish-harness 스킬로 Foundation 컴포넌트부터 시작해줘.

1. docs/components-spec.md 를 파싱해서 Part 구조 확인
2. Phase 2b — 컴포넌트 분류 (Foundation / Brand / Primitive / Domain) +
   의존성 그래프 기반 구현 순서 결정
3. PROGRESS.md 에 체크리스트로 기록하고 내게 순서 승인 요청
4. 승인되면 Brand → Primitive → Domain 순서로 section-worker 스폰
5. 각 컴포넌트마다 G4/G5/G6/G8 PASS 확인 후 자동 커밋
6. brand_guardrails 입력으로 components-spec.md 의 "Forbidden" / "Don't" 절 강제
```

### 단일 컴포넌트만

```
publish-harness 스킬로 <Button> 컴포넌트만 구현해줘.

- spec_section: "3.1 <Button>" (components-spec.md 내 파트 번호)
- reference_html: directions/direction-A-final.html (있으면)
- section-worker 1회 스폰
- G4-G8 PASS 확인 후 자동 커밋
```

---

## §5. 에스컬레이션 / 실패 처리

### 섹션 2회 FAIL 후 Opus 승격

```
방금 FAIL 난 {section-name} 을 Opus로 재시도해줘.

section-worker를 model: opus 로 오버라이드하여 스폰.
retry_count: 1 로 명시 (지난 실패 원인을 prompt에 포함).
PASS 후 자동 커밋 메시지에 (opus-assist) 포함.
```

### 섹션 스킵

```
{section-name} 은 일단 스킵하고 다음으로 넘어가줘.

- PROGRESS.md 에 해당 섹션을 [~] (보류) + 사유 주석
- 다음 섹션 계속 진행
```

### 섹션 재분할

```
{section-name} 을 서브섹션으로 재분할해줘.

- 서브섹션 2~3개로 쪼개기
- 각각 section-worker로 개별 스폰
- 원래 섹션은 wrapper 로 imports + layout div 만 남김
```

---

## §6. 유지보수

### 토큰 재임포트 (디자인 변경 시)

**figma 모드**:
```
Figma 디자인이 업데이트됐어. 토큰을 재추출하고 영향 분석해줘.

1. cp src/styles/tokens.css /tmp/tokens-before.css
2. bash scripts/extract-tokens.sh <fileKey> (Component URL 있으면 --component-page)
3. diff 출력 + G4 --diff 모드로 영향 섹션 식별
4. docs/token-audit.md 갱신
5. chore(tokens): Figma 업데이트 반영 (영향 N개 섹션) 커밋
```

**spec 모드**:
```
handoff 번들이 업데이트됐어. 다시 임포트해줘.

1. cp src/styles/tokens.css /tmp/tokens-before.css
2. bash scripts/bootstrap.sh --mode spec --from-handoff <dir>  # 재실행
   (주의: 루트의 tailwind.config.js / docs/components-spec.md 도 덮어쓴다)
3. diff 출력 + 영향 컴포넌트 리스트
4. chore(handoff): v1.2 재임포트 커밋
```

### 품질 게이트 일괄 재검증

```
완성된 모든 섹션에 대해 measure-quality.sh 를 일괄 실행하고 결과 요약해줘.

대상: src/components/sections/ 하위 모든 디렉토리
출력: 섹션별 G4/G5/G6/G8 PASS/FAIL 표
```

---

## 모델 정책

### Claude

| 역할 | 모델 |
|------|------|
| 오케스트레이터 (메인 세션) | 세션 기본 모델 (Opus 또는 Sonnet) |
| `section-worker` | `sonnet` 고정 (frontmatter) |

- 팀 리드(Max $200) → 세션을 Opus로 오픈하면 판단 품질 ↑
- 팀원(Max $100 / Pro $20) → Sonnet 기본으로 완주 가능
- 세션 중 `/model opus` ↔ `/model sonnet` 전환 가능

### Codex

| 역할 | 모델 |
|------|------|
| 오케스트레이터 | GPT-5.5 medium 권장 |
| 일반 section worker | GPT-5.4 medium 권장 |
| explorer | GPT-5.4-Mini medium 권장 |
| retry reviewer | GPT-5.4 medium 권장 |
| 반복 실패/복잡 레이아웃 | GPT-5.5 high 승격 |

상세 정책은 `docs/codex-model-policy.md` 참조. 모든 작업을 처음부터 GPT-5.5로
시작하지 않고, 분해/판단/실패 복구에 집중 사용한다.

---

## 디렉토리

```
.claude/
  skills/publish-harness/SKILL.md    — 오케스트레이터 (figma/spec 모드 분기)
  agents/section-worker.md           — 워커 (양 모드 지원, Sonnet)
AGENTS.md                            — Codex 루트 작업 규칙 (--agent codex|both)
scripts/
  bootstrap.sh                       — 원샷 프로젝트 셋업 (--mode figma|spec, --agent claude|codex|both)
  doctor.sh                          — 환경 점검 (--skip-figma, --skip-claude, --agent)
  setup-figma-token.sh               — PAT 대화형 등록 (figma 모드 전용)
  discover-figma-pages.mjs           — Figma top-level route page 자동 발견
  extract-tokens.sh                  — Figma 토큰 추출 (figma 모드 전용)
  _extract-tokens-analyze.mjs        — 토큰 분석 로직
  figma-rest-image.sh                — Figma REST Images API 래퍼 (figma 모드)
  check-react-reusability.mjs        — G12 React 재사용성 구조 검사
  check-token-usage.mjs              — G4 (hex literal 차단)
  check-text-ratio.mjs               — G6 + G8
  measure-quality.sh                 — G4/G5/G6/G7/G8 통합 실행
  _lib/load-figma-token.sh           — FIGMA_TOKEN 로드 헬퍼
docs/
  SETUP.md                           — 환경 셋업 가이드
  workflow.md                        — 4 Phase 상세 워크플로
  team-playbook.md                   — 팀 협업 규약
  reusable-react-publishing.md       — 재사용 가능한 React 산출물 구조 가이드
  publishing-log.md.tmpl             — 작업 로그 템플릿
  codex-section-worker.md            — Codex 섹션/컴포넌트 작업 절차
  codex-model-policy.md              — Codex 모델/승격 정책
  project-context.md.tmpl            — 프로젝트별 컨텍스트 템플릿
templates/vite-react-ts/             — 스캐폴드 베이스 (bootstrap.sh 가 복사)
CLAUDE.md                            — bootstrap.sh 가 프로젝트 루트에 복사
```

## 게이트

| G | 항목 | 도구 | 차단/참고 |
|---|---|---|---|
| G1 | Visual regression | `check-visual-regression.mjs` (Playwright + pixelmatch) | **선택적 차단** — baseline 있고 diff > 2% 일 때만 FAIL |
| G4 | 디자인 토큰 사용 | `check-token-usage.mjs` | 차단 (hex literal) |
| G5 | 시맨틱 HTML | eslint jsx-a11y | 차단 |
| G6 | 텍스트:이미지 비율 | `check-text-ratio.mjs` | 차단 |
| G7 | Lighthouse a11y/SEO | `@lhci/cli` | 환경별 |
| G8 | i18n 가능성 | `check-text-ratio.mjs` | 차단 |
| G10 | Write-protected paths | `check-write-protection.mjs` | 차단 (tokens.css / fonts.css / tailwind.config / components-spec.md 등 SSoT 수정) |
| G12 | React reusability | `check-react-reusability.mjs` | 차단 (multi-page no-router / missing layout / monolithic App) |

### G1 visual regression 가이드

"선택적" 의미 — 다음 경우 **SKIP (차단 아님)**:
- `playwright` / `pixelmatch` / `pngjs` devDep 미설치
- `npx playwright install chromium` 미실행
- `baselines/<section>/<viewport>.png` 파일 없음 (NO_BASELINE)
- dev 서버 미기동 (`http://127.0.0.1:5173/__preview/<section>` 미접근)

Baseline 확보 (모드별):

**figma 모드**:
```bash
node scripts/prepare-baseline.mjs --mode figma --section <section> --viewports desktop --file-key <fileKey> --section-node <nodeId>
# 반응형: --viewports desktop,tablet,mobile
```

**spec 모드**:

spec 모드 baseline 자동 생성은 LOW 위임 — 수동으로 `baselines/<section>/<viewport>.png` 준비 필요.

구현 결과 스크린샷을 baseline 으로 고정하지 않는다. `--update-baseline` 은
`UPDATE_BASELINE_ALLOWED=1` 없이는 실패하며, 구현 워커가 직접 호출하는 경로가 아니다.
spec 모드에서 시각 baseline 이 필요하면 handoff/reference 산출물을 사람이 검토해
`baselines/<section>/<viewport>.png` 로 넣고 별도 커밋한다.

### End-to-end 테스트 (Figma 파일 1개로 수동 검증)

최초 G1 셋업이 제대로 동작하는지 확인하는 순서:

```bash
# 1. 의존성 + chromium 설치
npm install
npx playwright install chromium

# 2. 섹션 하나 구현 (Phase 3 완료된 섹션 예: home-hero)

# 3. Figma baseline 확보
node scripts/prepare-baseline.mjs --mode figma --section home-hero --viewports desktop --file-key $FILE_KEY --section-node $NODE_ID

# 4. dev 서버 기동 (별도 터미널)
npm run dev

# 5. G1 실행 (preview route 준비 후)
node scripts/check-visual-regression.mjs \
  --section home-hero \
  --baseline-dir baselines/home-hero \
  --viewports desktop \
  --strict

# 결과 예: { status: "PASS", diffPercent: 0.42, threshold: 2, ... }
# FAIL 시 tests/quality/diffs/home-hero-desktop.diff.png 열어 drift 영역 확인
```

향후 게이트 (로드맵):
- **G9 (brand-guardrails)** — spec 모드에서 `brand_guardrails` 위반 검출 (퍼플 그라데이션 / 이모지 아이콘 / 좌측 컬러 보더 카드 등). MVP 는 워커 자체 점검, 자동화는 후속.

---

## 로드맵

지원 조합 매트릭스: [`docs/template-support-matrix.md`](./docs/template-support-matrix.md)

### 완료
- [x] `figma × vite-react-ts` (기존 figma-react-lite 계승)
- [x] `spec × vite-react-ts` (핸드오프 번들 임포트)
- [x] **G1 visual regression** (선택적 실행, Playwright + pixelmatch)
- [x] **Feedback loop** — 3단계 자동 재시도 + 9개 실패 카테고리 분류
- [x] 첫 스모크 (Chapter BrandMark, spec 모드) 통과 + G5 eslint 버그 발견·수정
- [x] **`figma × html-static`** (`templates/html-static/`) — Figma 디자인을 정적 랜딩/마케팅 HTML 로 변환 (Stage 2 M1~M7 완료, 종단 스모크 통과)
- [x] **`figma × html-static` Home 1 페이지 종단** — Modern Retro Beverage Brand 의 Home 페이지 8 섹션(Header/CTA/About/Featured/Product Grid/Flavors/Stocklist/Footer) 모두 G4-G8 PASS, retry 평균 0.4 회
- [x] **G10 write-protected paths 게이트** — tokens.css / fonts.css / tailwind.config / components-spec.md 등 SSoT 수정을 결정적으로 차단. SSoT (`scripts/write-protected-paths.json`) + `check-write-protection.mjs` + `measure-quality.sh` 통합. 회귀 검증: home-flavors 의 tokens.css 변경이 G10 FAIL 로 정확히 잡힘 ✓ (다른 7 commit 은 모두 PASS)
- [x] **D1 보강 — 페이지 통합본 정식 산출** — `public/{page}.html` (home → `public/index.html`) 정식 산출. 섹션 단독 preview 는 G1/G7 측정·디버그 단위로 유지. `assemble-page-preview.mjs` CLI 가 Phase 4 통합 검증 단계에서 자동 호출.

### 다음 후보
- [ ] G9 brand-guardrails 자동 게이트 (spec 모드에서 Forbidden Patterns 위반 검출)

### Stage 3+ (실제 use case 기반)
- [ ] `figma × server-side templates` (Thymeleaf · JSP · Blade · Django template — 실제 사용 환경 나올 때 결정)
- [ ] `{figma, spec} × next-app-router` (`templates/next-app-router/`)
- [ ] `{figma, spec} × rn-expo` (`templates/rn-expo/`)
- [ ] Storybook 소스 모드 (`--mode storybook`)

### 명시적 제외
- `spec × html-static` — 의미 mismatch (`components-spec.md` 의 Props/Variants/States 를 static HTML 이 표현 못함). 상세: [매트릭스 §제외](./docs/template-support-matrix.md#제외--spec--html-static-이-mismatch-인-이유).

---

## 참고 문서

- `CLAUDE.md` — 프로젝트 규칙 (bootstrap 후 프로젝트 루트에 복사됨)
- `docs/workflow.md` — 4 Phase 상세 워크플로
- `docs/team-playbook.md` — 브랜치/PR/리뷰 규약
- `docs/project-context.md` — 프로젝트별 컨텍스트

## 라이선스

내부 템플릿.

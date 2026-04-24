# publish-harness

디자인 소스를 프론트엔드 코드로 변환하는 **섹션 단위 퍼블리싱 하네스**. Claude Code CLI 위에서 동작.

## 특징

- **섹션 단위 워커**: 섹션/컴포넌트당 평균 15~20분, 한 단위 = 한 커밋
- **두 가지 소스 모드**:
  - **`figma`** — Figma URL 에서 토큰 자동 추출 + 라이브 쿼리
  - **`spec`** — 정적 핸드오프 번들 (tokens.css + components-spec.md) 임포트
- **차단형 게이트 4개 (G4/G5/G6/G8)** — 접근성·토큰 드리프트·텍스트 raster·i18n 가능성 보장
- **Sonnet 워커 기본** — Pro $20 요금제도 완주 가능 (오케스트레이터 Opus/Sonnet 양쪽)
- **앞으로 확장**: 출력 타겟(html/Next.js/React Native) · 입력 소스(Storybook · DSL) 점진 추가 예정

## 요구 사항

최소: **Node 18+ · Claude Code CLI** · (figma 모드만) **FIGMA_TOKEN**

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
3. Claude Code 세션 오픈
4. 모드에 맞게 §1 (figma) 또는 §2 (spec) 부트스트랩 프롬프트 복붙
5. 세션 재시작 후 §3 (페이지 진행) 또는 §4 (컴포넌트 진행)
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

필수 파일이 handoff 폴더에 있어야 bootstrap 이 진행됨:
- `tokens.css`
- `tailwind.config.js`
- `components-spec.md`

선택 파일 (있으면 자동 복사):
- `tokens.js` · `design-tokens.json` · `README.md`

---

### ⚠ 두 모드 공통 — 부트스트랩 직후 Claude 세션 재시작

bootstrap.sh 가 `.claude/agents/` 와 `.claude/skills/` 를 프로젝트에 복사하지만, Claude Code는 **세션 시작 시점**에만 에이전트/스킬 레지스트리를 스캔. 같은 세션에서 바로 진행하면 `Agent type 'section-worker' not found` 에러 발생.

```bash
/exit
# 같은 디렉토리에서 재시작
claude --dangerously-skip-permissions
```

재시작 후 새 세션에서 §3 또는 §4 프롬프트로 진입.

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

| 역할 | 모델 |
|------|------|
| 오케스트레이터 (메인 세션) | 세션 기본 모델 (Opus 또는 Sonnet) |
| `section-worker` | `sonnet` 고정 (frontmatter) |

- 팀 리드(Max $200) → 세션을 Opus로 오픈하면 판단 품질 ↑
- 팀원(Max $100 / Pro $20) → Sonnet 기본으로 완주 가능
- 세션 중 `/model opus` ↔ `/model sonnet` 전환 가능

---

## 디렉토리

```
.claude/
  skills/publish-harness/SKILL.md    — 오케스트레이터 (figma/spec 모드 분기)
  agents/section-worker.md           — 워커 (양 모드 지원, Sonnet)
scripts/
  bootstrap.sh                       — 원샷 프로젝트 셋업 (--mode figma|spec)
  doctor.sh                          — 환경 점검 (--skip-figma 로 spec 모드 대응)
  setup-figma-token.sh               — PAT 대화형 등록 (figma 모드 전용)
  extract-tokens.sh                  — Figma 토큰 추출 (figma 모드 전용)
  _extract-tokens-analyze.mjs        — 토큰 분석 로직
  figma-rest-image.sh                — Figma REST Images API 래퍼 (figma 모드)
  check-token-usage.mjs              — G4 (hex literal 차단)
  check-text-ratio.mjs               — G6 + G8
  measure-quality.sh                 — G4/G5/G6/G7/G8 통합 실행
  _lib/load-figma-token.sh           — FIGMA_TOKEN 로드 헬퍼
docs/
  SETUP.md                           — 환경 셋업 가이드
  workflow.md                        — 4 Phase 상세 워크플로
  team-playbook.md                   — 팀 협업 규약
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

### G1 visual regression 가이드

"선택적" 의미 — 다음 경우 **SKIP (차단 아님)**:
- `playwright` / `pixelmatch` / `pngjs` devDep 미설치
- `npx playwright install chromium` 미실행
- `baselines/<section>/<viewport>.png` 파일 없음 (NO_BASELINE)
- dev 서버 미기동 (`http://127.0.0.1:5173/__preview/<section>` 미접근)

Baseline 확보 (모드별):

**figma 모드**:
```bash
bash scripts/fetch-figma-baseline.sh <fileKey> <nodeId> <section> desktop
# 반응형: tablet/mobile 추가
```

**spec 모드** (두 경로):
```bash
# A) reference HTML 로부터 자동 렌더
node scripts/render-spec-baseline.mjs \
  --html directions/direction-A-final.html \
  --section home-hero \
  --viewport desktop \
  --selector "section.hero"

# B) 구현 후 현 상태를 baseline 으로 고정
node scripts/check-visual-regression.mjs \
  --section home-hero \
  --baseline baselines/home-hero/desktop.png \
  --update-baseline
```

### End-to-end 테스트 (Figma 파일 1개로 수동 검증)

최초 G1 셋업이 제대로 동작하는지 확인하는 순서:

```bash
# 1. 의존성 + chromium 설치
npm install
npx playwright install chromium

# 2. 섹션 하나 구현 (Phase 3 완료된 섹션 예: home-hero)

# 3. Figma baseline 확보
bash scripts/fetch-figma-baseline.sh $FILE_KEY $NODE_ID home-hero desktop

# 4. dev 서버 기동 (별도 터미널)
npm run dev

# 5. G1 실행 (preview route 준비 후)
node scripts/check-visual-regression.mjs \
  --section home-hero \
  --baseline baselines/home-hero/desktop.png

# 결과 예: { status: "PASS", diffPercent: 0.42, threshold: 2, ... }
# FAIL 시 tests/quality/diffs/home-hero-desktop.diff.png 열어 drift 영역 확인
```

향후 게이트 (로드맵):
- **G9 (brand-guardrails)** — spec 모드에서 `brand_guardrails` 위반 검출 (퍼플 그라데이션 / 이모지 아이콘 / 좌측 컬러 보더 카드 등). MVP 는 워커 자체 점검, 자동화는 후속.

---

## 로드맵

### 완료
- [x] figma 모드 (기존 figma-react-lite 계승)
- [x] spec 모드 (핸드오프 번들 임포트)
- [x] **G1 visual regression** (선택적 실행, Playwright + pixelmatch)
- [x] **Feedback loop** — 3단계 자동 재시도 + 9개 실패 카테고리 분류
- [x] 첫 스모크 (Chapter BrandMark, spec 모드) 통과 + G5 eslint 버그 발견·수정

### 예정
- [ ] Next.js 템플릿 (`templates/next-app-router/`)
- [ ] React Native + Expo 템플릿 (`templates/rn-expo/`)
- [ ] 정적 HTML 템플릿 (`templates/html-static/`)
- [ ] G9 brand-guardrails 자동 게이트 (spec 모드에서 Forbidden Patterns 위반 검출)
- [ ] Storybook 소스 모드 (`--mode storybook`)

---

## 참고 문서

- `CLAUDE.md` — 프로젝트 규칙 (bootstrap 후 프로젝트 루트에 복사됨)
- `docs/workflow.md` — 4 Phase 상세 워크플로
- `docs/team-playbook.md` — 브랜치/PR/리뷰 규약
- `docs/project-context.md` — 프로젝트별 컨텍스트

## 라이선스

내부 템플릿.

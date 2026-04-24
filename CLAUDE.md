# CLAUDE.md — publish-harness 프로젝트 규칙

이 파일은 **bootstrap.sh로 생성된 실제 프로젝트 루트에 복사**되어 Claude Code가 읽는다.

## 핵심 원칙

1. **작업 단위 = 섹션/컴포넌트.** 한 단위 = 한 브랜치 = 한 커밋
2. **디자인 토큰이 진실의 원천.** `src/styles/tokens.css`를 쓰고, hex literal 직접 기입 금지 (예외: `#fff`/`#000` 중립값 허용 — G4 화이트리스트 참조)
3. **게이트 PASS 없이 커밋 금지.** G4/G5/G6/G8 전부 통과 필요
4. **소스 채널 고정** (모드별):
   - figma 모드: Figma 에셋은 **REST API로 다운로드** (`scripts/figma-rest-image.sh`)
   - spec 모드: **`docs/components-spec.md` + `src/styles/tokens.css`** 가 진실의 원천. Figma REST/MCP 호출 금지
5. **Framelink MCP 호출 금지** (영구 폐기)

## 하네스 트리거

다음 조건에서 **`publish-harness` 스킬을 반드시 사용**하라:

- Figma URL 제공
- 핸드오프 폴더 경로 제공 (tokens.css + components-spec.md 포함)
- "섹션 구현" / "페이지 진행" / "다음 섹션" 요청
- "컴포넌트 구현" / "Foundation 진행" 요청 (spec 모드)
- "bootstrap" / "프로젝트 초기화" 요청

## 소스 모드 판별

1. 사용자 입력에 Figma URL 있음 → **figma 모드**
2. 사용자 입력에 핸드오프 폴더 경로 + `--from-handoff` 지시 → **spec 모드**
3. 이미 부트스트랩된 프로젝트 → `docs/project-context.md` 의 `mode` 필드 또는 `PROGRESS.md` 에서 판별
4. 판별 불가 → 사용자에게 모드 질문
5. 그 외 일반 프론트 작업 → 하네스 사용 안 함, 일반 React/Tailwind 규칙 적용

## 섹션/컴포넌트 파일 편집 규칙

- `src/components/sections/**` 또는 `src/components/{ui,brand,foundation}/**` 파일 수정은 `section-worker` 워커에 위임. 오케스트레이터 직접 편집 금지
- 예외 (직접 편집 OK):
  - `src/components/layout/` (공통 Header/Footer)
  - `src/styles/` (global CSS, 단 `tokens.css` 는 extract-tokens.sh 또는 bootstrap spec 모드만이 쓴다)
  - `src/App.tsx`, `src/routes/`, `tests/`, `scripts/`
  - `docs/components-spec.md` 수정 금지 (handoff 원본, 재임포트 경로로만 갱신)

## 소스 채널

### figma 모드

| 용도 | 도구 |
|---|---|
| baseline PNG / 에셋 | `scripts/figma-rest-image.sh` (필수 채널) |
| 노드 구조 | `get_design_context` 섹션당 1회 또는 REST `/v1/files/.../nodes` |
| 토큰 | `docs/token-audit.md` (extract-tokens.sh 결과) |
| Component 페이지 | `docs/project-context.md` 의 `Component Page Node ID` 필드 |

### spec 모드

| 용도 | 도구 |
|---|---|
| 컴포넌트 명세 | `docs/components-spec.md` (파트 번호 + 섹션명으로 Read) |
| 시각 참조 | handoff 리포 내 reference HTML (경로는 `docs/project-context.md` 또는 `docs/handoff-README.md`) |
| 토큰 | `docs/token-audit.md` + `src/styles/tokens.css` + `tailwind.config.js` |
| 브랜드 가드레일 | `docs/project-context.md` 의 `brand_guardrails` 섹션 |

## 게이트

### 차단 게이트 (반드시 PASS)

| G | 도구 | 의미 |
|---|---|---|
| G4 | `check-token-usage.mjs` | hex literal / 토큰 외 색상 금지 |
| G5 | `eslint` (jsx-a11y) | 시맨틱 HTML, a11y |
| G6 | `check-text-ratio.mjs` | 텍스트 baked-in raster 차단 |
| G8 | `check-text-ratio.mjs` | JSX에 literal text 존재 (i18n 가능) |

### 선택적 게이트 (환경/baseline 있을 때만 평가)

| G | 도구 | SKIP 조건 | FAIL 조건 |
|---|---|---|---|
| G1 | `check-visual-regression.mjs` (playwright + pixelmatch) | deps 미설치 / chromium 미설치 / baseline 없음 / dev 서버 미기동 | diff > 2% (또는 치수 불일치) |
| G7 | `@lhci/cli` | `@lhci/cli` 미설치 / preview 라우트 미접근 | a11y < 95 또는 seo < 90 |

**G1 원칙**: baseline 없음 (`NO_BASELINE`) 이나 환경 미비 (`SKIPPED`) 는 차단하지 않음. diff 가 threshold 초과할 때만 FAIL. baseline 은 `baselines/<section>/<viewport>.png` 규약.

실행: `bash scripts/measure-quality.sh <section> <section-dir> [--viewport desktop|tablet|mobile]`

## 참조 문서

- `docs/workflow.md` — 1페이지 워크플로 (양 모드)
- `docs/team-playbook.md` — 팀 협업
- `docs/project-context.md` — 프로젝트별 Node ID / 컴포넌트 카탈로그 / 모드 필드
- `docs/components-spec.md` — (spec 모드만) 컴포넌트 API 명세
- `docs/token-audit.md` — 토큰 인벤토리
- `PROGRESS.md` — 진행 상황 진실의 원천

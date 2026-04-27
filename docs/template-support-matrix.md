# 템플릿 지원 매트릭스

publish-harness 가 어떤 **(소스 모드 × 출력 템플릿)** 조합을 지원하는지 정리한 문서. 새로운 조합을 추가하기 전에 먼저 이 매트릭스에 등재하고 의미성을 검토한다.

## 현재 상태

| 소스 모드 | 출력 템플릿 | 상태 | 비고 |
|---|---|---|---|
| `figma` | `vite-react-ts` | ✅ 지원 | 기존 (figma-react-lite 계승) |
| `spec`  | `vite-react-ts` | ✅ 지원 | 기존 (핸드오프 번들 임포트) |
| `figma` | `html-static` | ✅ 지원 (M1~M7 통과) | 정적 랜딩/마케팅 페이지 용 (Stage 2 완료). 첫 스모크: Modern Retro Beverage Brand 의 Home > About 섹션 |
| `spec`  | `html-static` | ❌ 제외 | 의미 mismatch — §제외 절 참조 |
| `figma` | `nextjs-app-router` | 🟡 코드 추가 / 검증 미완 | 분기 코드(bootstrap/measure-quality/section-worker)는 동일하지만 figma 모드 실증 보류. 다음 figma 신규 프로젝트 도래 시 검증 |
| `spec`  | `nextjs-app-router` | ✅ 지원 (Stage 3) | SEO/SSR 필요한 commerce/store 용. 첫 스모크: chapter store (예정) |
| `figma` | `rn-expo` | 🔜 로드맵 | 모바일 |
| `spec`  | `rn-expo` | 🔜 로드맵 | 모바일 컴포넌트 라이브러리 |
| `figma` | server-side templates (Thymeleaf · JSP · Blade · Django template) | 🔜 Stage 3+ | 실제 사용 환경 나올 때 결정 |
| `spec`  | server-side templates | △ 부분적 | fragment 는 컴포넌트 반쪽 — 유효성 재검토 필요 |

## 조합 선택 원칙

publish-harness 는 "디자인 소스 → 프론트엔드 코드" 변환 하네스다. 의미있는 조합은 **소스 모드의 입력 구조** 와 **출력 템플릿의 표현력** 이 맞아야 한다.

- **figma 모드 입력** = Figma 디자인 (레이아웃 · 비주얼 · 토큰). "렌더링되는 화면" 그 자체
  - → 페이지/섹션 위주의 출력(static HTML / Next.js / RN) 과 정합
  - → 컴포넌트 라이브러리 출력과도 정합 (섹션이 곧 컴포넌트)
- **spec 모드 입력** = `components-spec.md` (Props · Variants · States API 명세) + tokens
  - → **컴포넌트 시스템이 있는 출력** 과만 정합 (React · Vue · RN · Next)
  - → 컴포넌트 시스템이 없는 출력(정적 HTML / 이메일 HTML)에는 **표현력 부족**

## §제외 — `spec × html-static` 이 mismatch 인 이유

spec 모드의 `docs/components-spec.md` 가 기술하는 3 가지 축은 runtime 표현을 전제한다:

- **Props** — runtime 동적 치환 (예: `<Button label="Save">`)
- **Variants** — 타입 단일화된 선택지 (예: `variant="primary"|"secondary"|"ghost"`)
- **States** — 인스턴스별 runtime 상태 (hover/focus/disabled/loading)

html-static 에는 이 세 축을 표현할 런타임이 없다:

| 축 | html-static 에서 표현 가능한가 |
|---|---|
| Props | ❌ 변수 치환 없음 → 인스턴스마다 HTML 복붙 |
| Variants | ❌ 타입 시스템 없음 → primary/secondary 각 HTML 파일 |
| States | △ `:hover` 같은 CSS pseudo 외 runtime 없음 |

결과적으로 `spec × html-static` 변환은 `components-spec.md` 의 절반(Props/Variants/States)을 버리고 나머지(Purpose/Tokens/Don't)만 HTML 로 옮기는 꼴이라 **디자인 시스템 핸드오프의 본질이 희석**된다. spec 모드의 출력은 컴포넌트 시스템이 있는 타겟으로만 가는 것이 옳다.

## §다음 Stage 계획

### Stage 2 — `figma × html-static`

**실제 use case**: Figma 디자인을 정적 랜딩/마케팅 페이지 HTML 로 변환. 컴포넌트 재사용 고민이 적은 "페이지 단위" 출력에 적합.

구현 시 재활용 가능한 잠정 결정 (다음 세션에서 재 brainstorming 시 재활용):

- **파서**: `node-html-parser` 기반 `check-token-usage-html.mjs` / `check-text-ratio-html.mjs`
- **G5 (시맨틱/a11y)**: `@html-eslint/parser` + `@html-eslint/eslint-plugin` (기존 eslint 파이프라인 재사용)
- **Preview 런타임**: `npx serve -l 5173 public/` (정적 서빙, port 5173 재사용)
- **토큰**: CSS 커스텀 프로퍼티만 (`tokens.css`), Tailwind 미사용
- **bootstrap 플래그**: `--template html-static` (default `vite-react-ts` 유지 → 기존 호출부 무수정)
- **project-context.md** 신규 필드: `template:` / `preview_base_url:`
- **산출물 단위**: `public/__preview/{section}/index.html` 한 파일 (fragment + preview 라우팅 동시 해결)

### Stage 3 — `{spec, figma} × nextjs-app-router` (진행 중)

**실제 use case**: SEO/SSR 이 매출에 직결되는 상점/마케팅 페이지. 검색 노출 + OG 미리보기 + 서버 렌더 + 이미지 최적화가 필요한 곳.

구현된 분기 (Stage 3 — 2026-04-27):

- **템플릿**: `templates/nextjs-app-router/` — App Router 표준 (`src/app/{layout,page,globals.css}.tsx`)
- **bootstrap.sh**: `--template nextjs-app-router` 옵션 추가, 양 모드 호환
- **measure-quality.sh**: vite-react-ts 의 G4/G6 게이트 재사용 (JSX 산출이라 동일 파서 작동)
- **section-worker.md**: `template: nextjs-app-router` 서브섹션 (`'use client'` 가이드, `next/image`/`next/link` 강제, `generateMetadata` SEO, `transpilePackages` monorepo 지원)
- **검증 매트릭스**: spec 모드는 chapter store 로 실증 예정. figma 모드는 코드만 작성, 다음 figma 프로젝트로 미룸 (YAGNI 원칙)

### Stage 4+ — 실제 use case 기반 (TBD)

현재 후보:

- `figma × server-side templates` (Thymeleaf · JSP · Blade · Django template) — 서버사이드 페이지 fragment
- `{figma, spec} × rn-expo` — 모바일 React Native
- `figma × nextjs-app-router` — 검증 보류분 회수

우선순위는 **실제 팀/프로젝트 use case 가 확정될 때** 결정한다. "확장 가능성" 만으로 구현하지 않는다 (YAGNI).

## 변경 이력

- 2026-04-24: 초기 작성. `spec × html-static` 제외 확정. Stage 2 방향을 `figma × html-static` 으로 전환. Stage 3 server-side templates 이름 TBD.
- 2026-04-27: Stage 2 (`figma × html-static`) M1~M6 구현 완료. 게이트 스크립트 2개(`check-token-usage-html.mjs` / `check-text-ratio-html.mjs`), `@html-eslint` 기반 G5, `bootstrap.sh --template` 분기, `measure-quality.sh` 자동 분기, `section-worker.md` 서브섹션 추가. dummy 섹션으로 G4/G5/G6/G8 PASS + G4 FAIL 검증까지 통과.
- 2026-04-27: M7 종단 스모크 통과 — Modern Retro Beverage Brand (`pJM7yrpPrjb9roV0lNAbKK`) 의 Home > About 섹션을 section-worker 1회 호출로 구현. retry 0 회. G4/G5/G6/G8 모두 PASS, Tier 2 반응형 (Desktop/Tablet/Mobile 3 baseline 모두 반영). 부수 발견: bootstrap.sh 가 extract-tokens 의 fonts.css 를 public/css 로 안 옮겨 워커가 수동 보정 — 후속 commit 으로 fix.
- 2026-04-27: **Home 1 페이지 종단 통과** — 8 섹션 (Header/CTA/About/Featured/Product Grid/Flavors/Stocklist/Footer) 모두 G4/G5/G6/G8 PASS. 워커 spawn 8회 (직렬), retry 평균 0.4 회 (대부분 1차 PASS, G6 raster-heavy 휴리스틱에 두 섹션이 1회 자체 수정 후 PASS). 부수 발견: home-flavors 워커가 `tokens.css` 에 `--brand-3` 직접 추가 — 워커 §금지 위반 (figma 모드는 extract-tokens.sh 만 tokens.css 수정 가능). 후속 fix-and-promote 후보.
- 2026-04-27: **D1 결정 보강 (옵션 C)** — 페이지 통합본 (`public/{page}.html`, home 만 `public/index.html`) 을 정식 산출물로 격상. `assemble-page-preview.mjs` CLI 가 `--page/--sections/--out` 옵션 + default 경로 자동 결정. 섹션 단독 preview (`public/__preview/<section>/`) 는 G1/G7 측정·디버그·retry 단위로 유지. SKILL.md Phase 4 에 어셈블리 단계 명시. 회귀 검증: smoke-modern-retro 의 Home 8 섹션이 `public/index.html` 한 파일로 통합, http://127.0.0.1:5176/ 200 응답 ✓.
- 2026-04-27: 부수 fix — `templates/html-static/.gitignore` 누락 보강 (figma-screenshots/ 같은 임시 파일이 부트한 프로젝트마다 git 추적되던 버그).
- 2026-04-27: **Simplify 회고 — high ROI 7건 정리**. 3 에이전트 (reuse / quality / efficiency) 병렬 review 결과:
  - R1-R3: `scripts/_lib/` SSoT 도입 (`walk.mjs` / `color-tokens.mjs` / `text-ratio-judge.mjs`) — 게이트 4종이 공유. html/react 변형 표류 차단, 약 36줄 순감.
  - Q1: bootstrap.sh 의 `rm -rf src tmp` 사고 위험 → `cleanup_html_static_post_extract()` 함수 + `rmdir` 안전화 (빈 디렉토리만).
  - Q2: bootstrap.sh sed placeholder 7개 중복 → `render_template()` 함수 통합. 새 placeholder 추가 시 1곳만.
  - Q6: `assemble-page-preview.mjs` legacy positional 부채 제거 (신규 스크립트인데 미리 짊어진 deprecation).
  - E1: `check-write-protection.mjs` 의 working tree 케이스에서 `git diff` 3회 → `git status --porcelain` 1회 (Windows fork 비용 절감).
  - bootstrap.sh 의 _lib/ 복사를 명시 1파일 → `cp -r` 디렉토리 통째로 (R1-R3 자동 포함).
  회귀 검증: G4/G6/G8 fixture 4종 + G10 회귀 (cebf92c) + 신규 working tree 케이스 모두 동일 결과 PASS/FAIL 보존.
- 2026-04-27: **G10 write-protected paths 게이트 구현 + 회귀 검증 통과**. SSoT (`scripts/write-protected-paths.json`) + `check-write-protection.mjs` + `measure-quality.sh` 통합. `section-worker.md` §금지 절을 SSoT 직접 인용으로 머신리더블화 + §feedback-loop 에 `WRITE_PROTECTION` 카테고리 추가. 회귀 검증: home-flavors commit (`cebf92c`) 의 `public/css/tokens.css` 변경이 G10 FAIL 로 정확히 잡힘. 다른 home-* 7 commit 모두 G10 PASS. 향후 같은 패턴(tokens.css/fonts.css/tailwind.config/components-spec.md SSoT 변경) 자동 차단 보장.
- 2026-04-27: **Stage 3 — `nextjs-app-router` 템플릿 추가 (코드 완료 / 검증 분리)**. `templates/nextjs-app-router/` 스캐폴드 (App Router + Tailwind + tokens.css), `bootstrap.sh --template nextjs-app-router` 분기 (양 모드 호환), `measure-quality.sh` 분기 (vite-react-ts 게이트 재사용), `section-worker.md` 에 Next.js 가이드라인 (RSC/'use client'/next/image/metadata) 추가. 검증 매트릭스: spec 은 chapter store 로 실증 예정, figma 는 다음 figma 프로젝트 도래 시 (YAGNI).

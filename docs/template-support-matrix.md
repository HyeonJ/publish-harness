# 템플릿 지원 매트릭스

publish-harness 가 어떤 **(소스 모드 × 출력 템플릿)** 조합을 지원하는지 정리한 문서. 새로운 조합을 추가하기 전에 먼저 이 매트릭스에 등재하고 의미성을 검토한다.

## 현재 상태

| 소스 모드 | 출력 템플릿 | 상태 | 비고 |
|---|---|---|---|
| `figma` | `vite-react-ts` | ✅ 지원 | 기존 (figma-react-lite 계승) |
| `spec`  | `vite-react-ts` | ✅ 지원 | 기존 (핸드오프 번들 임포트) |
| `figma` | `html-static` | ✅ 지원 (M1~M6) | 정적 랜딩/마케팅 페이지 용 (Stage 2). 종단 스모크(M7)는 figma URL 제공 시 |
| `spec`  | `html-static` | ❌ 제외 | 의미 mismatch — §제외 절 참조 |
| `figma` | `next-app-router` | 🔜 로드맵 | SSR/ISR 필요할 때 |
| `spec`  | `next-app-router` | 🔜 로드맵 | 컴포넌트 라이브러리 + SSR |
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

### Stage 3+ — 실제 use case 기반 (TBD)

현재 후보:

- `figma × server-side templates` (Thymeleaf · JSP · Blade · Django template) — 서버사이드 페이지 fragment
- `{figma, spec} × next-app-router` — SSR/ISR 지원 React
- `{figma, spec} × rn-expo` — 모바일

우선순위는 **실제 팀/프로젝트 use case 가 확정될 때** 결정한다. "확장 가능성" 만으로 구현하지 않는다 (YAGNI).

## 변경 이력

- 2026-04-24: 초기 작성. `spec × html-static` 제외 확정. Stage 2 방향을 `figma × html-static` 으로 전환. Stage 3 server-side templates 이름 TBD.
- 2026-04-27: Stage 2 (`figma × html-static`) M1~M6 구현 완료. 게이트 스크립트 2개(`check-token-usage-html.mjs` / `check-text-ratio-html.mjs`), `@html-eslint` 기반 G5, `bootstrap.sh --template` 분기, `measure-quality.sh` 자동 분기, `section-worker.md` 서브섹션 추가. dummy 섹션으로 G4/G5/G6/G8 PASS + G4 FAIL 검증까지 통과. M7 종단 스모크는 사용자 figma URL 제공 시 진행.

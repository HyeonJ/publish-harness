# 바이브코딩 매뉴얼 — 프론트엔드 (Figma → React)

> 작성자: **@Hyeonin** (프론트엔드 구현 파트)
> 최종 수정일: 2026-04-24
> 문서 위치: `docs/vibe-coding-manual-frontend.md`

---

## 0. 통일 규격 제안 (전 파트 공통 템플릿)

각 파트 담당자가 본인 섹션만 채워서 **하나의 공유 문서**로 병합하기 위한 공통 틀입니다. 각 파트는 아래 8개 항목을 동일 순서·동일 제목으로 작성해 주세요.

```
1. 개요              — 파트가 무엇을 책임지는가 (2~3줄)
2. 산출물            — 다른 파트가 받아가는 결과물 (파일/URL/API 형태)
3. 전제 조건 (Input) — 작업 시작에 필요한 상류 산출물 / 환경
4. 작업 흐름 (Phase) — 실제 작업 단계 (번호 목록, 각 단계 산출물 명시)
5. 품질 기준         — 통과 기준 / 게이트 / 검증 방법
6. 리스크 & 이슈     — 블로커 / 의존성 / 가정
7. 진행 현황         — 체크리스트 형태 (완료 / 진행 / 대기)
8. 시작 가능 일정    — 즉시 / 특정 조건 충족 시 / 예정일
```

> **병합 방침**: 공유 문서 상단에 목차 + 파트별 섹션. 각 파트는 `## {파트명}`으로 시작, 내부는 `###`부터 사용.

---

## 1. 개요

**Figma 디자인을 React(+ TypeScript + Tailwind + Vite) 코드로 변환**하는 파트. 섹션 단위 자동화 하네스(`figma-react-lite-harness`)를 사용해 *디자인 토큰 추출 → 페이지 분해 → 섹션별 구현 → 품질 게이트 → 자동 커밋*을 반복한다.

- **작업 단위**: 섹션 1개 = 브랜치 1개 = 커밋 1개
- **평균 소요**: 섹션당 15~20분 (자동화 포함)
- **담당 범위**: 라우팅, 컴포넌트, 토큰, 반응형 폴리싱, 접근성. **API 연동은 포함하지 않음** (백엔드 파트 산출물 수신 후 별도 스프린트)

---

## 2. 산출물 (다른 파트에 제공)

| 산출물 | 형태 | 수신 파트 |
|---|---|---|
| 배포 가능한 정적 빌드 | `dist/` (Vite) | DevOps / 배포 |
| 컴포넌트 + 페이지 소스 | `src/components/**`, `src/routes/**` | QA / 후속 개발 |
| 디자인 토큰 감사 | `docs/token-audit.md` | 디자인 / QA |
| 섹션별 품질 리포트 | `tests/quality/{section}.json` (G4/G5/G6/G8) | QA / PM |
| API 연동 포인트 목록 | `docs/api-binding-points.md` (TBD) | 백엔드 |
| 진행 현황 | `PROGRESS.md` | PM |

---

## 3. 전제 조건 (Input)

### 3.1 상류 산출물 (타 파트 → 프론트엔드)

| 항목 | 제공 주체 | 필수/선택 | 비고 |
|---|---|---|---|
| 최종 Figma URL (페이지 확정) | 디자인 | **필수** | URL 고정 후 시작. 변경 시 토큰 재추출 필요 |
| Component/Design System 페이지 Node ID | 디자인 | 권장 | 있으면 토큰 네이밍 품질 ↑ (레이어명 기반) |
| 반응형 프레임 (Desktop/Tablet/Mobile) | 디자인 | 선택 | 없으면 Desktop 기준 + 휴리스틱 반응형 |
| 페이지/라우트 목록 확정 | PM | **필수** | `/home`, `/about` 등 경로 합의 |
| API 스펙 초안 | 백엔드 | 선택 | 연동 스프린트 진입 전까지 |
| 카피/다국어 정책 | 기획 | 선택 | i18n 사용 여부 결정 |

### 3.2 환경 / 도구

- Node 18+
- Claude Code CLI (`--dangerously-skip-permissions` 로컬 사용 권장)
- Figma Personal Access Token (`FIGMA_TOKEN` env var)
- Git + GitHub
- (선택) Figma MCP — 쿼터 소진 시 REST 폴백

**환경 점검**: `bash scripts/doctor.sh`

---

## 4. 작업 흐름 (Phase)

하네스 기준 4단계. 상세는 `docs/workflow.md` 참조.

### Phase 1 — 부트스트랩 (프로젝트당 1회, 약 5분)

```bash
bash scripts/bootstrap.sh <figma-url> [project-name] \
  --component-url <figma-component-page-url>   # 선택
```

**산출물**: Vite 스캐폴드, `src/styles/tokens.css`, `fonts.css`, `tailwind.config.ts`, `docs/token-audit.md`, `docs/project-context.md`, `PROGRESS.md`
**종료 조건**: `npm run dev` 기동 확인.

> ⚠ 부트스트랩 완료 후 **반드시 Claude 세션 재시작** (에이전트/스킬 레지스트리 재스캔).

### Phase 2 — 페이지 분해 (페이지당 1회, 약 5~10분)

- Figma 페이지 구조를 `get_metadata` / REST로 가져와 섹션 목록 생성
- 반응형 프레임 감지 (프레임명 키워드·너비·페이지 분리·변종)
- 페이지 전체 + 섹션 baseline PNG 확보 (`scripts/figma-rest-image.sh`)
- `PROGRESS.md`에 섹션 추가
- **사용자 승인 대기** (한 번만 멈춤)

### Phase 3 — 섹션 루프 (섹션당 15~20분, 자동화)

각 섹션마다 `section-worker` 1회 스폰. 워커가 4단계 자체 완료:

1. **리서치** → `plan/{section}.md` (컴포넌트 트리 + 에셋 표 + 사용 토큰)
2. **에셋 수집** → `src/assets/{section}/`
3. **구현** → `src/components/sections/{page}/{Section}.tsx` + preview 라우트
4. **품질 게이트** → `scripts/measure-quality.sh`

**PASS** → 자동 커밋 + `PROGRESS.md` 체크 + 다음 섹션
**FAIL** (워커 1회 재시도 후) → 사용자 개입 (Opus 승격 / 수동 / 스킵 / 재분할)

### Phase 4 — 페이지 통합 (페이지 완료 시, 약 10분)

- 실제 라우트 1920 fullpage 캡처 (Desktop pixel-perfect)
- 375 / 768 뷰포트 육안 점검 (가로 스크롤·타이포 overflow·터치 타겟)
- (선택) Lighthouse
- `PROGRESS.md` 페이지 완료 체크

---

## 5. 품질 기준

### 5.1 섹션 커밋 차단 게이트

| G | 항목 | 도구 | 실패 시 |
|---|---|---|---|
| G4 | 디자인 토큰 사용 (hex literal 금지) | `check-token-usage.mjs` | 커밋 차단 |
| G5 | 시맨틱 HTML / a11y | eslint jsx-a11y | 커밋 차단 |
| G6 | 텍스트 raster 금지 (이미지에 텍스트 X) | `check-text-ratio.mjs` | 커밋 차단 |
| G8 | JSX literal text 존재 (i18n 가능성) | `check-text-ratio.mjs` | 커밋 차단 |
| G7 | (선택) Lighthouse a11y/SEO | `@lhci/cli` | 환경별 |

### 5.2 리뷰어 체크리스트 (PR 기준, 섹션당 5분)

- [ ] `tests/quality/{section}.json` 전부 PASS
- [ ] 섹션 파일만 수정됨 (다른 섹션 건드리지 않음)
- [ ] 에셋은 `src/assets/{section}/` 네임스페이스
- [ ] 커밋 메시지 `feat(section): {page}-{section} 구현 (G4-G8 PASS)`

---

## 6. 리스크 & 이슈

| 리스크 | 영향도 | 대응 |
|---|---|---|
| Figma 디자인이 프로젝트 중간에 변경 | 높음 | 토큰 재추출 + 영향 섹션 재검증 (별도 PR) |
| Component/Design System 페이지 부재 | 중간 | fallback 휴리스틱 모드 — 네이밍 품질만 저하 |
| Figma MCP 월 쿼터 소진 | 중간 | REST `/v1/files/.../nodes` 폴백 (코드 힌트 없음) |
| 플러그인 덤프를 그대로 이식 | 높음 | absolute positioning 금지 — flex/grid 재구성 |
| 공통 컴포넌트 조기 추출 | 중간 | Rule of Three — 3번째 등장 시 승격 |
| 백엔드 API 스펙 미확정 | 낮음 | 정적 페이지 우선 완료, 연동은 별도 스프린트 |
| 반응형 Figma 디자인 누락 | 낮음 | Desktop 기준 구현 + 육안 폴리싱 (Tier 1 휴리스틱) |

### 가정

- 초기 구현은 **정적 페이지** 기준. 상태 관리·API 연동은 페이지 완료 후 스프린트.
- i18n은 **구조 유지** (JSX literal text 허용) — 실제 다국어 번들은 별도 태스크.
- CMS 연동 여부 미정 — 있으면 별도 섹션 스프린트 추가.

---

## 7. 진행 현황 (2026-04-24 기준)

### 하네스 인프라 (작업자 준비도)

- [x] Vite + React + TS + Tailwind 템플릿 준비
- [x] 토큰 추출 스크립트 (`extract-tokens.sh`)
- [x] Figma Component 페이지 기반 토큰 추출 (ba90b35)
- [x] 섹션 워커 + 오케스트레이터 스킬
- [x] 품질 게이트 G4/G5/G6/G8
- [x] Tier 1 휴리스틱 반응형 + Tier 2 Figma 반응형 감지 통합 (1801cea)
- [x] 환경 점검 (`doctor.sh`) · FIGMA_TOKEN 셋업 (`setup-figma-token.sh`)
- [x] 팀 협업 규약 (`team-playbook.md`)

### 실제 프로젝트 작업 (프로젝트 착수 전)

- [ ] 최종 Figma URL 확정 수신 (디자인)
- [ ] Component 페이지 Node ID 확정 수신 (디자인)
- [ ] 페이지/라우트 목록 확정 수신 (PM)
- [ ] 부트스트랩 실행
- [ ] 페이지별 Phase 2~4 루프
- [ ] 통합 빌드 전달

---

## 8. 시작 가능 일정

### 결론: **Figma URL 확정 즉시 당일 착수 가능**

현재 하네스 측 준비는 완료 상태이며, 다음 **3가지 상류 산출물**만 확정되면 곧바로 진입합니다.

| 조건 | 담당 | 필수/권장 | 대기 상태 |
|---|---|---|---|
| 최종 Figma URL | 디자인 | **필수** | ⏳ 대기 중 |
| Component 페이지 Node ID | 디자인 | 권장 | ⏳ 대기 중 |
| 페이지/라우트 목록 | PM | **필수** | ⏳ 대기 중 |

### 착수 후 마일스톤 (페이지 수 N 기준, 페이지당 평균 5~8 섹션 가정)

| 단계 | 소요 | 비고 |
|---|---|---|
| Phase 1 부트스트랩 | 5~10분 | 1회 |
| Phase 2 페이지 분해 | 페이지당 5~10분 | 승인 1회/페이지 |
| Phase 3 섹션 구현 | 섹션당 15~20분 | 자동화, 병렬 가능 |
| Phase 4 페이지 통합 | 페이지당 10~15분 | |

**예시 — 5 페이지 / 페이지당 6 섹션 / 총 30 섹션**
- 최단 (단독, 자동화 순항): 약 **10~12시간** (주간 2일 집중)
- 실측 (FAIL·검수 포함 1.3x): 약 **13~16시간** (주간 2~3일)
- 병렬 2명: 약 **7~9시간** (공통 컴포넌트 의존 제외)

> 최종 일정은 **페이지/섹션 수 확정 후** 업데이트 예정. Phase 2 승인 대기 시간은 PM 리뷰 속도에 종속.

### 일정 리스크

- **Figma 미확정** → 착수 불가 (토큰 재추출 시 기존 작업 영향도 분석 필요)
- **API 스펙 지연** → 정적 페이지만 완주 후 연동 스프린트 분리

---

## 부록 — 참고 문서

- `docs/workflow.md` — 4 Phase 상세
- `docs/team-playbook.md` — 브랜치/PR/리뷰/모델 정책
- `docs/SETUP.md` — 환경 셋업 가이드
- `CLAUDE.md` — 프로젝트 핵심 규칙 (하네스 트리거·게이트·섹션 편집 범위)
- `README.md` — 하네스 개요 + 프롬프트 템플릿 (§1~§5)

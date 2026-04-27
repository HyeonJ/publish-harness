# 페이지 통합본 정식 산출 — D1 보강 (옵션 C)

**작성일**: 2026-04-27
**상태**: Draft
**선행**: [`docs/template-support-matrix.md`](../../template-support-matrix.md) §Stage 2 D1
**트리거**: 사용자 검증 — html-static 산업 표준은 페이지당 1 HTML 파일이 산출물. 우리 D1 의 "섹션 단위만, 페이지 통합은 사용자 책임" 은 React 워크플로 모델을 그대로 옮긴 실수.

## 1. 목표

`assemble-page-preview.mjs` 를 **임시 디버그 도구 → html-static 의 정식 빌드 단계** 로 격상. 페이지 산출물에 **두 종류** 가 공존:

| 산출물 | 위치 | 역할 |
|---|---|---|
| **섹션 단독 preview** (기존) | `public/__preview/{section}/index.html` | G1 visual regression / G7 Lighthouse 측정 단위, 디버그 / review / retry 단위 |
| **페이지 통합본** (신규 정식) | `public/index.html` (home) / `public/{page}.html` (그 외) | 사용자 시각 확인 + 배포 산출물. html-static 본질에 맞는 한 페이지 = 한 파일 |

D1 의 "섹션 = 워커 단위 = 한 커밋" 모델은 보존. "페이지 통합은 사용자 책임" 만 폐기.

## 2. 비목표

- SSG (Astro/11ty) 수준의 빌드 파이프라인 — 사용자가 정식 빌드 도구 원하면 별도
- 페이지 단위 게이트 (G1/G7) — 섹션 단위 측정 정확도 보존
- 자동 deploy / 압축 / minify — html-static 출력은 vanilla, 사용자가 후속 처리

## 3. 산출물 명명 규칙

| 페이지 | 출력 경로 |
|---|---|
| `home` | `public/index.html` (root, web 표준) |
| `about` | `public/about.html` |
| `find-us` | `public/find-us.html` |
| (그 외) | `public/{page}.html` |

CLI:
```bash
node scripts/assemble-page-preview.mjs --page <page> --sections <s1,s2,...> [--out <path>]
```

`--out` 명시 안 하면 위 규칙대로 자동 결정 (home 만 special case, 나머지는 `public/{page}.html`).

## 4. 페이지 어셈블리 트리거

세 가지 경로 모두 지원:

1. **오케스트레이터 (메인 세션) 가 직접 호출** — 페이지의 마지막 섹션 워커 완료 직후 (publish-harness 스킬 Phase 4 통합 검증 단계의 일부로 SKILL.md 에 명시)
2. **사용자 수동 호출** — 어느 시점이든 `node scripts/assemble-page-preview.mjs ...`
3. **section-worker 자체 호출 안 함** — 워커는 자기 섹션만 책임. 어셈블리는 페이지 전체 컨텍스트 필요

→ **(1) 이 정식 흐름**, (2) 가 escape hatch.

## 5. `assemble-page-preview.mjs` 변경

기존:
```bash
node scripts/assemble-page-preview.mjs <page> <s1,s2,...>
# 출력: public/__assembled/<page>.html
```

신규:
```bash
node scripts/assemble-page-preview.mjs --page <page> --sections <s1,s2,...> [--out <path>]
# default 출력: public/index.html (home) 또는 public/<page>.html (그 외)
# --out 으로 override 가능
```

**호환성**: 기존 positional 인자 형태도 받되 deprecation 경고 (한 minor 후 제거).

`public/__assembled/` 디렉토리는 폐기. 기존 smoke 의 `public/__assembled/home.html` 은 정식 `public/index.html` 로 이동.

## 6. `.claude/skills/publish-harness/SKILL.md` Phase 4 변경

Phase 4 통합 검증 단계에 신규 sub-step 추가 (template: html-static 한정):

```markdown
### Phase 4 — 통합 검증 (template: html-static 추가 단계)

페이지의 모든 섹션 G4-G8 PASS 후:

1. 페이지 어셈블리 호출:
   ```bash
   node scripts/assemble-page-preview.mjs \
     --page <page-name> \
     --sections <section1,section2,...>
   ```
2. 정식 페이지 URL (`http://127.0.0.1:5173/` for home) 응답 200 확인
3. PROGRESS.md 페이지 분해 표 끝에 "✓ 통합본 생성 — public/<page>.html" 기록
4. 자동 commit: `feat(<page>): 페이지 통합본 어셈블리 (X 섹션)`
```

template: vite-react-ts 의 Phase 4 흐름은 변경 없음 (React 는 import 트리로 자동 통합).

## 7. `.claude/agents/section-worker.md` 변경

§template: html-static 서브섹션의 §게이트 부분에 한 줄 추가:

```markdown
### 4. 게이트 — html-static 추가
... (기존)

**참고**: 워커는 섹션 단위 게이트만 책임. 페이지 통합본 (`public/{page}.html`) 은 페이지 마지막 섹션 완료 후 오케스트레이터가 별도 호출 — 워커는 호출 안 함.
```

## 8. `templates/html-static/.gitignore` 신규 (부수 fix)

발견: 부트한 프로젝트가 figma-screenshots/, tmp/, node_modules/ 등을 git 추적. templates/html-static/ 에 .gitignore 가 없어서.

신규 파일:
```
node_modules/
dist/
build/
.DS_Store
Thumbs.db
*.log
.env
.env.local
coverage/

# 워커 임시
figma-screenshots/
/tmp/
.lighthouseci/

# IDE
.idea/
.vscode/
*.swp
```

bootstrap 시 자동 복사 (`templates/html-static/.` cp 가 이미 처리).

## 9. 매트릭스 §변경 이력 갱신

```markdown
- 2026-04-27: D1 결정 보강 (옵션 C) — 페이지 통합본 (`public/{page}.html`)
  을 정식 산출물로 격상. 섹션 단독 preview (`public/__preview/{section}/`)
  는 G1/G7 측정·디버그·retry 단위로 유지. assemble-page-preview.mjs 가
  Phase 4 통합 검증 단계에서 자동 호출.
- 2026-04-27: templates/html-static/.gitignore 누락 fix (figma-screenshots/
  같은 임시 파일이 부트한 프로젝트마다 git 추적되던 버그).
```

## 10. 회귀 검증 (M5)

`smoke-modern-retro` 에서:

1. 신규 어셈블리 스크립트 동기화 (publish-harness → smoke 복사)
2. `node scripts/assemble-page-preview.mjs --page home --sections home-header,home-cta,home-about,home-featured,home-product-grid,home-flavors,home-stocklist,home-footer`
3. 출력: `public/index.html`
4. http://127.0.0.1:5176/ 응답 200 + 8 섹션 모두 stack 으로 보임
5. 기존 `public/__assembled/home.html` 삭제 (마이그레이션)

## 11. 마일스톤

| M | 산출물 | 검증 |
|---|---|---|
| M1 | `assemble-page-preview.mjs` 신규 CLI (`--page` / `--sections` / `--out`) + default 경로 자동 결정 + 기존 positional deprecation | dummy 페이지로 `public/{page}.html` 생성 |
| M2 | `templates/html-static/.gitignore` | bootstrap 후 figma-screenshots/ untracked 안 됨 |
| M3 | `SKILL.md` Phase 4 어셈블리 단계 추가, `section-worker.md` 어셈블리 책임 분리 한 줄, `workflow.md` 보강 | 키워드 검색: "assemble-page-preview" 3 곳 이상 |
| M4 | smoke-modern-retro 회귀 검증 — `public/index.html` 200 + 8 섹션 통합 | curl 200 |
| M5 | README / 매트릭스 §변경 이력 / CLAUDE.md 갱신 + push | git log 에 옵션 C commit 표시 |

## 12. 호환성

- 기존 figma × vite-react-ts 워크플로 무영향
- 기존 figma × html-static 부트한 프로젝트 — 어셈블리 호출은 사용자가 직접 (smoke-modern-retro 가 첫 마이그레이션 사례)
- `public/__assembled/` 디렉토리는 deprecation. 제거 시점: 매트릭스 다음 마이너 변경

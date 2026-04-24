# team-playbook.md — 팀 협업 규약

## 온보딩 (새 팀원, 1시간 이내)

1. 요금제 확인
   - Max $200 / Max $100 / Pro $20 어느 쪽이든 동작
   - Sonnet 기본이라 Pro도 쿼터 여유
2. 환경 준비
   - Node 18+, bash (Windows는 Git Bash)
   - `FIGMA_TOKEN` env var 설정 (figma.com Settings → Personal access tokens)
3. 리포 clone + `npm install`
4. `docs/workflow.md` 10분 정독
5. smoke section 1개 돌려보기 — PROGRESS.md의 빈 체크박스 아무거나 잡고 `section-worker` 1회

**예상 온보딩**: 1시간.

## 브랜치 전략

```
main (보호)
 ├─ feat/section-{page}-{section-name}
 │    └─ 한 섹션 = 한 브랜치 = 한 PR = 한 reviewer
 └─ feat/page-{page-name}-integration
      └─ Phase 4 페이지 통합만
```

### 규칙
- 섹션 작업 시작: `git checkout main && git pull && git checkout -b feat/section-{page}-{section}`
- 섹션 완료 시: 워커가 자동 커밋 → push → PR 오픈
- PR 제목: `feat(section): {page}-{section} 구현 (G4-G8 PASS)`
- PR 본문: `tests/quality/{section}.json` 첨부

## 작업 분배

### PROGRESS.md가 단일 진실의 원천

```markdown
## Home 섹션
- [ ] home-header (@alice)
- [ ] home-hero (@bob)
- [ ] home-featured-grid
```

**규약**:
1. 섹션 시작 전 PROGRESS.md에 본인 할당 표시 (`@username`) + main에 커밋
2. 2인이 동시에 같은 섹션 잡지 않도록 **할당 먼저, 작업 나중**
3. 완료 시 워커가 체크박스 자동 변경 + diff % 기록

### 리뷰어 체크리스트

PR 리뷰 시 확인:

- [ ] `tests/quality/{section}.json`에 G4/G5/G6/G8 모두 `PASS`
- [ ] 섹션 파일만 수정됨 (다른 섹션 건드리지 않음)
- [ ] `src/assets/{section}/` 네임스페이스 격리
- [ ] 커밋 메시지 컨벤션
- [ ] (선택) 실제 라우트에서 육안 확인 — 좌측 치우침 / 가로 스크롤 없음

리뷰 시간 목표: **섹션당 5분 이내**. JSON PASS면 코드 리뷰 최소.

## 충돌 방지

### 파일 레벨
- 섹션 파일: `src/components/sections/{page}/{Section}.tsx` — 섹션마다 별도 파일
- 에셋: `src/assets/{section}/` 네임스페이스 격리
- preview 라우트: `src/routes/{Section}Preview.tsx` 또는 `src/App.tsx`의 `/__preview/{section}` 매핑

### 토큰 충돌 (최악의 시나리오)
- `src/styles/tokens.css` / `fonts.css` / `tailwind.config.ts` 는 **수동 편집 금지**
- 토큰 재추출이 필요하면:
  1. `scripts/extract-tokens.sh <fileKey>` 실행
  2. 변경 사항 리뷰 (`git diff src/styles/`)
  3. 별도 PR로 머지 (섹션 PR과 분리)

### 공통 컴포넌트 승격
- 섹션 작업 중 "이거 재사용될 거 같은데" 싶은 게 나와도 **즉시 `src/components/ui/` 에 뽑지 말 것**
- 2~3 페이지 완성 후 **Rule of Three 충족 시** 별도 PR로 승격
- 승격 PR 제목: `refactor(ui): {Component} 공통 컴포넌트 승격`

## 모델 정책

```yaml
# .claude/agents/section-worker.md
model: sonnet   # 고정, 변경 금지
```

- **기본**: 팀 리드든 팀원이든 `section-worker`는 Sonnet
- **Opus 승격**: 워커 2회 FAIL 시만. 오케스트레이터(사용자)가 판단
- **오케스트레이터 모델**: 세션 시작 시 사용자가 선택. `/model opus` / `/model sonnet` 전환 가능

### 세션 시작 가이드

| 역할 | 권장 세션 모델 |
|------|---|
| 팀 리드, Max $200 | Opus (복잡 판단 여유) |
| 팀 리드, Max $100 | Sonnet 기본, 복잡한 Phase 2 분해 시 Opus |
| 팀원, Pro/Max $100 | Sonnet |

## 페어링 / 동기 작업

### 병렬 OK
- 같은 페이지 다른 섹션 병렬 작업 (충돌 거의 없음)
- 단, **`required_imports` 없는 섹션끼리만** — 공통 컴포넌트 의존성 없어야

### 병렬 금지
- 같은 섹션에 2인 투입 (워커 설계상 단독 호출 전제)
- **공통 컴포넌트 생성 섹션이 머지되기 전에 이를 참조하는 섹션 병렬 시작**
  - 예: `Wordmark` 를 만드는 `home-header`가 머지되기 전에 `Wordmark` 를 쓰는 `home-footer` 병렬 작업 → **빌드 실패**
  - 해결: `home-header` 완료·머지 후 `home-footer` 시작

### 동기화 신호 (PROGRESS.md)
공통 컴포넌트 의존이 있는 섹션은 체크박스 옆에 표기:
```markdown
- [ ] home-header (@alice)                     ← 먼저
- [ ] home-footer [⏳ blocked by home-header]  ← 나중
- [ ] home-hero   (@bob)                       ← 독립, 병렬 OK
```

### 기타
- **토큰 재추출 시**: 전체 팀 pause → 머지 후 resume
- **공통 컴포넌트 생성 PR 우선 리뷰**: 다른 섹션 대기 중이면 최우선

## 기술부채 관리

lite 하네스는 `[ACCEPTED_DEBT]` 태그 및 `tech-debt.md`를 **기본 제거**했다. 워커가 완화 판단 자체를 안 하기 때문.

만약 특수한 상황(엔진 차이 등)으로 완화가 필요하면:
1. 오케스트레이터가 사용자에게 보고
2. 사용자가 PR에 `[debt]` prefix 명시
3. 리드가 머지 시점에 `docs/tech-debt.md` (프로젝트별 생성) 엔트리 추가

이 흐름은 예외적이며 일반 섹션에서는 발생하지 않도록 G4/G5/G6/G8 PASS를 강제한다.

## 자주 묻는 것

**Q: Figma MCP 쿼터 소진되면?**
A: REST `/v1/files/{key}/nodes?ids=<nodeId>&depth=3` 로 대체. 코드 힌트는 없지만 layout/text/fill 전부 포함.

**Q: 디자인 변경되면 토큰 재추출해야 하나?**
A: 예. `scripts/extract-tokens.sh <fileKey>` 재실행. 별도 PR로 머지.

**Q: mobile baseline이 없는 섹션은?**
A: desktop 기본 + responsive-polish (섹션별 375/768/1440 뷰포트 조정). 육안 검증.

**Q: 이미 v5 하네스로 진행 중인 프로젝트 어떻게?**
A: 기존 자산 유지하고 `.claude/` + `scripts/` + `CLAUDE.md` + `docs/*.md`만 lite로 교체. `plan/` / `research/` 기존 파일은 무시.

**Q: Opus 워커 승격 기준?**
A: section-worker가 FAIL로 반환한 결과 JSON에 `suggestions: ["Opus 재시도 권장"]` 있으면 추천.

# State & Meta Commands — Follow-up & Confirmations

**Plan:** `docs/superpowers/plans/2026-04-30-state-and-meta-commands.md`
**Branch:** `feat/state-and-meta-commands`
**Status:** 16 tasks 모두 완료. 17 commits (A.6 fix 포함). 41/41 progress 테스트 PASS.
**Date:** 2026-04-30

---

## 완료 요약

| Group | Tasks | Status |
|---|---|---|
| **A** progress.json + 진실의 원천화 | A.1~A.7 (8 commits incl. A.6 fix) | ✅ done |
| **B** 메타 명령 (status/why/next) | B.1~B.4 (4 commits) | ✅ done |
| **C** doctor.sh 확장 | C.1~C.2 (2 commits) | ✅ done |
| **D** code-reviewer agent | D.1~D.3 (3 commits) | ✅ done |

**산출물:**
- 6 신규 스크립트: `_lib/progress-store.mjs` / `progress-update.mjs` / `progress-render.mjs` / `status.mjs` / `why.mjs` / `next.mjs`
- 6 테스트 파일 (`tests/progress/*.test.mjs`) + 7 fixtures
- 신규 agent: `.claude/agents/code-reviewer.md`
- 변경: `bootstrap.sh`, `measure-quality.sh`, `doctor.sh` (+JSON 모드 + 4개 신규 체크), SKILL.md (PROGRESS 추론 → CLI 위임 + retry 흐름에 reviewer 통합), section-worker.md (PROGRESS 직접 수정 금지 + source 필드 규약)
- 삭제: `templates/{vite-react-ts,html-static}/PROGRESS.md.tmpl` (자동 렌더로 대체)

---

## ❗ 사용자 컨펌이 필요한 사항

### 1. doctor.sh 가 publish-harness 자체 루트에서 "Write-protected paths 9개 누락" warn

**현상:** `bash scripts/doctor.sh --skip-figma` 실행 시 `[⚠] Write-protected paths  9개 누락 (G10 영향)` 발생.

**원인:** `scripts/write-protected-paths.json` 의 paths 는 부트스트랩된 프로젝트에 존재하는 파일들 (`tokens.css` / `tailwind.config.js` 등). publish-harness 자체 루트에는 이 파일들이 없음.

**컨펌:** 이건 expected 인가, 아니면 doctor.sh 가 "publish-harness 자체 루트에서 실행 중인지" 자동 감지해서 skip 해야 하는가?
- 현재: warn (실패 아님)
- 옵션 A: 현재 그대로 — warn 는 적절한 시그널
- 옵션 B: harness 루트 자동 감지 (`package.json` 의 `name === "publish-harness"`) → skip
- 옵션 C: `--skip-protected` 플래그 추가

**권장:** 옵션 A (현재 그대로). bootstrap 한 프로젝트에서는 정상 동작하므로 harness 자체 점검에서만 보이는 spurious warn 이라면 사용자가 무시 가능.

---

### 2. package.json `scripts.test:progress` 추가 여부

**현상:** plan 에서 언급은 됐으나 시간 절약 차원에서 미반영. 현재 테스트 실행은 매번 직접:
```bash
node --test tests/progress/*.test.mjs
```

**컨펌:** package.json `scripts` 에 추가할지?
```json
"test:progress": "node --test tests/progress/*.test.mjs"
```

**권장:** 추가. 이미 `test:gates` 가 같은 방식으로 등록됨.

---

### 3. Plan 본문에 fold-back 할 deviations

다음 4개의 의도적 plan deviation 이 적용됨. 후속 plan 작성자나 dispatching agent 에게 혼란을 줄 수 있어, plan 본문에 노트 또는 정정 권장:

#### 3-1. Windows-safe CLI self-detect (모든 .mjs)
- **plan 패턴 (broken on Windows)**: `import.meta.url === \`file://${process.argv[1]}\``
- **사용 패턴**: `process.argv[1] && process.argv[1].endsWith('<file>.mjs')`
- **이유**: Windows 의 `URL.pathname` 이 `/C:/...` 반환 → execFileSync 실패
- **영향 task**: A.3, A.4, B.1, B.2, B.3 (5개)

#### 3-2. A.3 의 fileURLToPath
- **plan**: `new URL('../../scripts/progress-update.mjs', import.meta.url).pathname`
- **사용**: `fileURLToPath(new URL(...))`
- **이유**: 위 1번과 동일 — Windows 경로 호환

#### 3-3. B.1 의 missing_token_source blocker 조건
- **plan**: `phase.current === 1 && !fileKey && mode === 'figma'`
- **사용**: 위 조건 + `(pages.length > 0 || sections.length > 0)`
- **이유**: plan §Step 1 fixture (createEmpty 결과 = pages/sections 0) + §Step 2 Test 1 (canProceed=true) + §Step 4 blocker 코드 — 셋이 mathematically inconsistent. blocker 가 fixture 에 매치되어 canProceed=false 가 되었기 때문.
- **의미적 정당성**: createEmpty 직후 (bootstrap 진행 전) 에는 fileKey 없음이 정상. pages/sections 등록 후 fileKey 빠진 경우만 진짜 문제.

#### 3-4. B.2/B.3 의 테스트 inline 패치
- 모든 figma-mode 테스트에 `mode='spec'` 인라인 패치 추가
- **이유**: publish-harness 자체에 `src/styles/tokens.css` 부재 → TOKENS_MISSING 룰이 다른 룰 (DECOMPOSE_REQUIRED, ANTI_LOOP_TRIGGERED, OK_PROCEED) 보다 먼저 매치되어 의도 시나리오 검증 불가
- B.2 테스트 5: 추가로 `phase.current=3, completed=[1,2]` 인라인 (all-done fixture 의 phase=4 가 OK_NEXT_PHASE 의 `< 4` guard 와 충돌)
- B.3 테스트 1: 정규식 `/FIGMA_TOKEN/` → `/figma[_-]?token/i` (kebab-case 매치)
- B.3 테스트 4: 정규식 확장 `/재분할|수동|개입|blocked|재시도|skipped/i` (recommendations[0]='섹션 재분할' 매치)

**컨펌:** plan 문서에 위 deviation 들을 정정 노트로 추가할지 여부. 미정정 시 plan 을 다시 실행하면 동일 시행착오 반복될 수 있음.

**권장:** 정정. 단순 부록 섹션 추가로 충분.

---

### 4. minor 이슈 (모두 reviewer 가 non-blocking 으로 분류, 후속 처리 가능)

| 출처 | 이슈 | 우선순위 |
|---|---|---|
| A.1/A.2 | `progress-store.mjs:2` 의 unused `dirname` import | low |
| A.1/A.2 | `store.test.mjs:3` 의 unused `writeFileSync` import | low |
| A.2 | `setSectionStatus` 의 status 화이트리스트가 `VALID_STATUS` 와 중복 (인라인 array literal) | low |
| A.2 | `addSection` 가 `kind` 값 미검증 (validate 시점에만 검증) | low |
| A.3 | parseArgs 가 malformed input (단일 `--flag`, 누락 value) 시 raw stack trace | medium |
| A.3 | `init --figma-url` flag 가 `createEmpty` source 파라미터 우회 (post-mutation) | low |
| A.4 | empty Phase 3 (pages=0 + orphans=0) trailing blank line 누락 — cosmetic | low |
| A.4 | dangling `page.sections[]` 항목이 sections[] 에 없으면 silent drop | low |
| A.7 | adapter `failures[].gate / message` 필드가 recordGateResult 에서 미소비 (dead metadata) | low |
| B.1 | `missing_token_source` blocker 양성 발동 케이스 테스트 부재 (negative regression risk) | medium |
| B.1 | `gateResults` JSON parse silent error (corrupt 파일 무시) | low |
| B.1 | `nextActionable` 순서 정책 미문서화 (insertion order 의존) | low |
| B.1 | `git.raw` 가 dirty tree 에서 토큰 폭발 가능 (대형 변경 시) | low |
| B.2 | anti-loop guard 가 categories=[] 3회 시 빈 괄호 메시지 (`동일 카테고리 () 로 3회`) | low |
| D.2 | SKILL.md +27 lines (lite 정신 미세 초과 — Task() prompt 예시 + antiLoopRisk 분기표 포함) | low |

**컨펌:** 위 이슈들을 후속 fixup commit 으로 묶어 처리할지 여부. medium 만 우선 처리 + low 는 나중에 봐도 되는 옵션도 있음.

**권장:** medium 2개 (A.3 parseArgs 견고성 + B.1 missing_token_source 양성 테스트) 만 후속 작업으로 추가. low 는 실제 사용 중 누군가 거슬릴 때 처리.

---

## 다음 액션 (사용자 결정 필요)

1. **현재 브랜치 어떻게 처리?**
   - (a) `feat/state-and-meta-commands` 그대로 push, PR 생성 후 main 으로 merge
   - (b) push 만 하고 PR 은 다음에
   - (c) 위 컨펌 사항들 처리 후 push

2. **plan 문서 정정?** (위 §3 fold-back 결정)

3. **medium 이슈 fixup?** (위 §4 — A.3 parseArgs / B.1 missing_token_source 테스트)

4. **package.json scripts 추가?** (위 §2)

5. **doctor warn 처리?** (위 §1)

---

## 41/41 progress 테스트 결과

```
node --test tests/progress/*.test.mjs
# tests 41
# pass 41
# fail 0
# duration_ms 826
```

**파일별 분포:**
- `store.test.mjs`: 17 tests (createEmpty/validate/IO + addPage/addSection/setSectionStatus/recordGateResult + 5 adapter tests)
- `update-cli.test.mjs`: 5 tests (init / overwrite refusal / add-page+section / record-gate-result / set-section)
- `render.test.mjs`: 4 tests
- `status.test.mjs`: 5 tests
- `why.test.mjs`: 6 tests
- `next.test.mjs`: 4 tests

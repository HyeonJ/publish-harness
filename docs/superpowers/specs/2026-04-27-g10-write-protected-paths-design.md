# G10 Write-Protected Paths 게이트 — 설계

**작성일**: 2026-04-27
**상태**: Draft
**트리거**: smoke-modern-retro 의 `home-flavors` 워커가 `public/css/tokens.css` 에 `--brand-3` 직접 추가 — 워커 §금지 위반 (figma 모드 tokens.css 는 `extract-tokens.sh` 만 수정 가능)

## 1. 목표

워커가 명시적으로 "수정 금지" 로 지정된 파일을 건드렸는지 **결정적으로 검출하는 차단 게이트** (G10) 를 추가한다. `section-worker.md` §금지 절의 prose 가이드를 머신리더블 SSoT 로 옮기고 `measure-quality.sh` 의 게이트 블록으로 통합.

## 2. 비목표

- 의미적 패턴 검출 (G9 brand-guardrails 영역)
- 워커 자체의 file system 권한 통제 (sandbox 차원 — 하네스 범위 밖)
- spec 모드 handoff 파일 자체 변경 (handoff 외부에 있음 — 보호 대상 아님)
- pre-commit hook (CI/repo policy 영역, 게이트와 별개)

## 3. 보호 대상 (write-protected paths)

`section-worker.md` §금지 절을 1:1 매핑. 그 외 핵심 SSoT 추가:

| Path | 보호 이유 | 정당한 작성자 |
|---|---|---|
| `src/styles/tokens.css` | Figma 토큰 SSoT (vite 템플릿) | `extract-tokens.sh` / spec 모드 bootstrap |
| `public/css/tokens.css` | Figma 토큰 SSoT (html-static 템플릿) | 동일 |
| `src/styles/fonts.css` | 폰트 family/face SSoT | `extract-tokens.sh` |
| `public/css/fonts.css` | 동일 | 동일 |
| `tailwind.config.js` | 토큰 매핑 SSoT | bootstrap (spec 모드 handoff 복사 / vite 템플릿 default) |
| `tailwind.config.ts` | 동일 | 동일 |
| `docs/components-spec.md` | 컴포넌트 명세 SSoT (spec 모드 handoff 원본) | bootstrap 재임포트만 |
| `docs/handoff-README.md` | handoff README 보존 | bootstrap |
| `public/css/main.css` | html-static 글로벌 reset/타이포 (template 제공) | 하네스 자체 |

## 4. SSoT 위치

`scripts/write-protected-paths.json` — `measure-quality.sh` 와 `check-write-protection.mjs` 가 read. `section-worker.md` 의 §금지 절은 이 파일을 인용.

```json
{
  "version": 1,
  "paths": [
    "src/styles/tokens.css",
    "public/css/tokens.css",
    "src/styles/fonts.css",
    "public/css/fonts.css",
    "tailwind.config.js",
    "tailwind.config.ts",
    "docs/components-spec.md",
    "docs/handoff-README.md",
    "public/css/main.css"
  ]
}
```

JSON 선택 이유: `node-html-parser` / `@babel/parser` 의존성 없이 `JSON.parse` 한 줄. yaml 파서 추가 없음.

## 5. 검출 메커니즘

`scripts/check-write-protection.mjs` — 워커 작업 후, 자동 commit 직전에 호출. **현 working tree 의 변경된 파일** 을 git 으로 조회해 protected list 와 교집합 검사.

```javascript
// 핵심 로직 (의사 코드)
const changed = new Set([
  ...gitDiff("HEAD", "--name-only"),       // commit 된 변경 (이번 작업)
  ...gitDiff("--name-only"),               // unstaged
  ...gitDiff("--cached", "--name-only"),   // staged
]);
const violations = PROTECTED.filter(p => changed.has(p));
if (violations.length) exit(1);
```

**기준점 (base) 결정**:
- 단순 케이스: `HEAD` 와 working tree 비교 → 워커 작업 시작 시점이 마지막 commit 이라 가정 (publish-harness 의 "한 섹션 = 한 커밋" 모델과 일치)
- 명시 base 옵션: `--base <commit-ish>` 로 override 가능 (CI / 멀티-섹션 batch 검증용)

**자동 commit 후 호출 시**: 게이트는 워커가 자동 commit 하기 **전** 에 호출되는 흐름이라 working tree 에 변경이 남아 있음. 단, commit 이 이미 됐으면 `git diff HEAD~1 HEAD --name-only` 로 직전 commit 의 변경 파일을 봐야 — 이건 `--base HEAD~1` 로 처리.

## 6. `measure-quality.sh` 통합

기존 게이트 블록 패턴 그대로:

```bash
# ---------- G10 write-protected paths ----------
echo ""
echo "[G10] write-protected paths"
if node "${SCRIPT_DIR}/check-write-protection.mjs" \
    --paths "${SCRIPT_DIR}/write-protected-paths.json" 2>/tmp/g10.err; then
  G10_STATUS="PASS"
  echo "  ✓ G10 PASS"
else
  G10_STATUS="FAIL"
  FAIL=1
  cat /tmp/g10.err
  echo "  ❌ G10 FAIL"
fi
```

JSON 결과의 `G10_write_protection: "PASS|FAIL"` 필드로 기록.

**호출자 인터페이스 변경 없음** — 워커는 `measure-quality.sh` 를 그대로 호출하면 G10 자동 평가.

## 7. `bootstrap.sh` 확장

스크립트 복사 단계에 2 개 추가:

```bash
cp "$HARNESS_DIR/scripts/check-write-protection.mjs" scripts/
cp "$HARNESS_DIR/scripts/write-protected-paths.json" scripts/
```

bootstrap 자체가 tokens.css 등을 작성하지만, **bootstrap 단계에서는 G10 호출 안 됨** (게이트는 워커 호출 후만 실행). 따라서 false positive 없음.

## 8. `section-worker.md` 변경

§금지 절을 머신리더블 SSoT 참조로 수정:

```markdown
## 금지

- ❌ **`scripts/write-protected-paths.json` 에 명시된 모든 path 수정** (G10 게이트가 차단)
  - 현재 보호: tokens.css / fonts.css / tailwind.config.{js,ts} /
    components-spec.md / handoff-README.md / public/css/main.css
  - 정당한 작성자만 수정 가능 (extract-tokens.sh / bootstrap.sh)
  - 누락된 토큰 발견 시: tokens.css 수정 X, 그냥 가장 가까운 기존 토큰 사용 + notes 에 기록
- ❌ 다른 섹션 파일 수정
- ... (기존 항목 유지)
```

## 9. 게이트 매트릭스 갱신

| Gate | 도구 | 의미 | 차단 |
|---|---|---|---|
| G1 | check-visual-regression.mjs | visual diff | 선택 (baseline 있을 때) |
| G4 | check-token-usage(.mjs / -html.mjs) | hex literal 차단 | ✅ |
| G5 | eslint (jsx-a11y / @html-eslint) | semantic/a11y | ✅ |
| G6 | check-text-ratio(.mjs / -html.mjs) | text:image | ✅ |
| G7 | @lhci/cli | lighthouse | 환경별 |
| G8 | check-text-ratio g8 필드 | i18n | ✅ |
| **G10** | **check-write-protection.mjs** | **write-protected paths 차단** | **✅ 신규** |

G2/G3 폐기, G9 미구현 — 번호 불연속 그대로.

## 10. 마일스톤

| M | 산출물 | 검증 |
|---|---|---|
| M1 | `scripts/write-protected-paths.json` SSoT | JSON parse 가능 + 모든 path 가 §금지 절과 1:1 |
| M2 | `scripts/check-write-protection.mjs` + fixture (PASS/FAIL 2종) | tokens.css 변경 → exit 1, 다른 파일만 변경 → exit 0 |
| M3 | `scripts/measure-quality.sh` G10 블록 | 정상 섹션은 PASS, tokens.css 변경 섹션은 FAIL |
| M4 | `scripts/bootstrap.sh` 가 신규 2 파일 복사 | bootstrap 후 scripts/ 에 두 파일 존재 |
| M5 | `.claude/agents/section-worker.md` §금지 머신리더블 인용 | 검색: "write-protected-paths.json" 키워드 1회 이상 |
| M6 | smoke-modern-retro 의 home-flavors 회귀 검증 | tokens.css 의 --brand-3 추가가 G10 FAIL 로 잡힘 |

## 11. 첫 회귀 검증 (M6)

`smoke-modern-retro` 디렉토리에서:

```bash
cd $HOME/workspace/smoke-modern-retro
# (publish-harness 의 fix 스크립트 가져오기)
cp $HOME/workspace/publish-harness/scripts/check-write-protection.mjs scripts/
cp $HOME/workspace/publish-harness/scripts/write-protected-paths.json scripts/

# home-flavors commit (cebf92c) 이 tokens.css 를 변경했으므로
# 그 commit 의 diff 로 G10 검증
node scripts/check-write-protection.mjs --base cebf92c~1 --head cebf92c
# expected: exit 1, public/css/tokens.css 위반 리포트
```

검증 통과 시 게이트가 의도대로 작동. 향후 같은 패턴 자동 차단 보장.

## 12. 리스크 & 대응

| 리스크 | 대응 |
|---|---|
| `git diff` 의 path 표기와 PROTECTED list 의 매칭 차이 (Windows 백슬래시 등) | path 비교 시 `/` 정규화. fixture 에 Windows 케이스 추가 |
| 워커가 작업 중 stash 사용으로 working tree 에 임시 변경 | 게이트는 `HEAD` 기준 diff 라 stash pop 후 검사 — 정상 |
| Bootstrap 자체의 tokens.css 작성이 G10 에 걸림 | 게이트는 워커 호출 시점에만 실행. bootstrap 단계는 호출 안 함 — 안전 |
| `--base HEAD~1` 자동 commit 후 검증 시 first commit 직전 fail | 옵션 인자로 base 명시 (CI 시나리오만), 일반 워커 흐름은 working tree |
| Path 추가 시 SSoT 잊고 다른 곳에만 추가 | section-worker §금지 절이 SSoT 직접 인용 — 한 곳만 보면 됨 |

## 13. 호환성

- 기존 모든 게이트와 독립 동작
- `measure-quality.sh` 호출 인터페이스 변경 없음
- 기존 부트된 프로젝트는 `scripts/check-write-protection.mjs` 와 `scripts/write-protected-paths.json` 이 없어 게이트 stub 으로 SKIP (또는 게이트 자체 추가 — bootstrap 시점 분기 필요 없음. 새 부트만 자동 포함)
- 기존 프로젝트가 갱신 받으려면 `cp $HARNESS/scripts/{check-write-protection.mjs,write-protected-paths.json} scripts/` 수동 패치

# SETUP.md — publish-harness 환경 셋업

팀원 온보딩 가이드. 새 PC에서 처음 하네스를 쓸 때 순서대로 진행.

**소요 시간**: 15~25분 (Claude Code / Node 미설치 시 포함)

---

## 체크리스트 요약

```
□ 1. 시스템 도구      Node 18+ / bash / git / curl
□ 2. Claude Code CLI
□ 3. Figma MCP 등록
□ 4. Figma PAT 발급 + FIGMA_TOKEN 등록
□ 5. 하네스 리포 clone
□ 6. doctor.sh 로 전체 확인
□ 7. (선택) gh CLI / lhci
```

---

## §1. 시스템 도구

| 도구 | 설치 방법 |
|------|-----------|
| **Node 18+** | [nodejs.org](https://nodejs.org) LTS (v20+) 다운로드. nvm/volta 써도 무방 |
| **bash** | Windows: [Git for Windows](https://git-scm.com/download/win) 설치 시 `bash.exe` 자동 PATH 등록 / macOS·Linux: 기본 포함 |
| **git** | 위 Git for Windows 또는 `brew install git` / `apt install git` |
| **curl** | 대부분 내장. 없으면 OS 패키지 매니저 |

### Windows: 어느 셸을 써도 됩니다

Git for Windows를 설치하면 `bash.exe` 가 PATH에 등록되므로 **PowerShell / cmd / Git Bash 어디서든** `bash scripts/xxx.sh` 호출 가능. 이 문서의 `bash` 명령은 전부 그대로 사용 가능.

**셸별 차이가 나는 건 3가지뿐**:
1. 환경변수 확인/설정 문법 (`$var` vs `$env:var` vs `%var%`)
2. `claude mcp add` 의 토큰 변수 전개 (`$FIGMA_TOKEN` vs `$env:FIGMA_TOKEN`)
3. 쉘 내장 명령 (예: `which` vs `where.exe`)

자세한 대조표는 본 문서 마지막 **[§8 Windows 셸별 명령어 대조](#8-windows-셸별-명령어-대조)** 참고.

확인 (**어떤 셸에서든 동일**):
```bash
node -v
npm -v
bash --version
git --version
curl --version
```

---

## §2. Claude Code CLI

### Windows
[Claude Code 공식 설치 가이드](https://docs.claude.com/ko/docs/claude-code/overview) 를 따라 CLI 설치.

### macOS / Linux
```bash
# 공식 인스톨러 (예시 — 실제 명령은 공식 문서 확인)
npm install -g @anthropic-ai/claude-code
# 또는 brew install anthropic/claude/claude-code
```

### 로그인

최초 실행 (인증만 하고 바로 종료하고 싶을 때):
```bash
claude
# 브라우저 OAuth 또는 API 키 입력 안내
```

### 세션 실행 — 하네스 작업 시

```bash
claude --dangerously-skip-permissions
```

> **`--dangerously-skip-permissions` 권장 이유**
> 하네스는 섹션마다 파일 생성·git 커밋·bash 스크립트 호출·MCP 호출을 반복합니다. 권한 프롬프트가 매번 떠서 자율 흐름이 끊깁니다. 로컬 개발 환경에서는 플래그 사용이 일반적. 단 다음 경우엔 플래그 없이:
> - 회사 공유 PC / 보안 이슈 환경
> - 신뢰하지 않는 프롬프트/스킬 실행
> - 디버깅 중 (각 도구 호출을 단계별 확인하고 싶을 때)

요금제 확인:
- **Max $200 (20x)**: Opus 여유
- **Max $100 (5x)**: Sonnet 기본 권장
- **Pro $20**: Sonnet 전용 권장

확인:
```bash
claude --version    # 0.x.x
```

---

## §3. Figma MCP 등록

`figma-developer-mcp` (NPM 기반, 공식 Figma 연동) 를 Claude Code에 등록.

> **전제**: §4 에서 `FIGMA_TOKEN` 을 먼저 등록해야 MCP가 제대로 동작. 순서상 §4 먼저 한 뒤 §3 로 돌아와도 OK.

### 등록 명령 (셸별)

**Git Bash / macOS / Linux**:
```bash
claude mcp add figma-developer-mcp -- npx -y figma-developer-mcp --figma-api-key=$FIGMA_TOKEN --stdio
```

**PowerShell**:
```powershell
claude mcp add figma-developer-mcp -- npx -y figma-developer-mcp --figma-api-key=$env:FIGMA_TOKEN --stdio
```

**cmd**:
```cmd
claude mcp add figma-developer-mcp -- npx -y figma-developer-mcp --figma-api-key=%FIGMA_TOKEN% --stdio
```

⚠ 어느 경우든 FIGMA_TOKEN 이 **현재 셸 세션에 로드돼 있어야** 함. `setx`로 막 등록한 후라면 새 터미널 세션을 먼저 열어야 전개 가능.

### 확인

```bash
claude mcp list
```

출력에 `figma-developer-mcp` 가 보이면 OK.

### 세션 내 사용 가능 도구

| 도구 | 용도 |
|---|---|
| `get_design_context` | 섹션 노드의 코드/구조/스타일 힌트 |
| `get_metadata` | 파일/페이지의 노드 트리 |
| `get_variable_defs` | 디자인 토큰 (Variables API, Enterprise 전용 제약) |

### 쿼터 주의

- Figma Starter 플랜: 월 6 tool call
- Pro 이상: 여유
- 쿼터 소진 시 REST API (`/v1/files/{key}/nodes?ids=<nodeId>&depth=3`) 로 대체 가능 (하네스가 자동 폴백)

---

## §4. Figma PAT 발급 + FIGMA_TOKEN 등록

### 4.1 PAT 발급 (Figma 웹에서)

1. https://www.figma.com/developers/api#access-tokens 열기
2. Figma 로그인 → Settings → Security → Personal access tokens
3. **"Generate new token"** 클릭
4. 이름: `publish-harness` (또는 임의)
5. Expiration: 90일 권장 (장기는 30일)
6. 스코프: **File content → Read only** 만 체크
7. 생성된 토큰 (`figd_...` 로 시작) **즉시 복사** (다시 볼 수 없음)

### 4.2 전역 env var 등록 — 자동

```bash
bash scripts/setup-figma-token.sh
```

이 대화형 스크립트가:
1. 토큰 입력 받기 (화면에 표시되지 않음)
2. `curl /v1/me` 로 smoke test
3. OS별 전역 등록:
   - Windows: PowerShell User scope (`[Environment]::SetEnvironmentVariable(..., 'User')`)
   - macOS/Linux: `~/.zshrc` 또는 `~/.bashrc` 에 `export` 추가

### 4.3 전역 env var 등록 — 수동 (스크립트 실패 시)

**Windows PowerShell** (권장):
```powershell
[Environment]::SetEnvironmentVariable('FIGMA_TOKEN', 'figd_여기에토큰', 'User')
```

**Windows cmd**:
```cmd
setx FIGMA_TOKEN figd_여기에토큰
```
> `setx`는 **현재 세션에 미반영**. 등록 후 반드시 새 cmd/PowerShell 세션 열어야 적용.

**macOS / Linux**:
```bash
echo 'export FIGMA_TOKEN=figd_여기에토큰' >> ~/.zshrc   # 또는 ~/.bashrc
source ~/.zshrc
```

### 4.4 적용 확인

**새 터미널을 열어야** 적용됨.

**PowerShell**:
```powershell
$env:FIGMA_TOKEN.Substring(0,10)
```

**cmd**:
```cmd
echo %FIGMA_TOKEN:~0,10%
```

**Git Bash / macOS / Linux**:
```bash
printenv FIGMA_TOKEN | head -c 10
```

`figd_` 로 시작하는 10자가 보이면 OK.

### 4.5 보안 주의

- PAT는 **로컬 전용**. git 커밋·로그·스크립트에 평문 노출 금지
- 다른 사람과 공유 PC 쓰면 User scope만 사용 (Machine scope 금지)
- 유출 의심 시 즉시 Figma Settings → 해당 토큰 Revoke 후 재발급

---

## §5. 하네스 리포 clone

```bash
git clone https://github.com/HyeonJ/publish-harness.git "$HOME/workspace/publish-harness"
```

`$HOME/workspace/` 는 **예시**. 본인 관례대로 경로 변경 가능. 이 한 줄은 **macOS / Linux / Git Bash / Windows PowerShell 어디서든 그대로 동작**:

| 셸 | `$HOME` 전개 결과 |
|---|---|
| macOS | `/Users/<username>` |
| Linux | `/home/<username>` |
| Git Bash (Windows) | `/c/Users/<username>` |
| **PowerShell 5.1/7.x** (Windows) | `C:\Users\<username>` |
| cmd (Windows) | ❌ `$HOME` 미지원 → `%USERPROFILE%\workspace\publish-harness` 로 수동 치환 |

> **Windows 사용자 권장**: PowerShell 또는 Git Bash. `$HOME` 이 자동 전개되어 문서 그대로 복붙 가능.

이후 문서에서 `$HOME/workspace/publish-harness` 로 나오는 부분은 **본인이 실제 clone한 경로로 치환**하면 됩니다.

주의: **하네스 리포는 템플릿이지 작업 디렉토리가 아니다.** 실제 프로젝트는 별도 디렉토리에 만들고, 하네스의 `bootstrap.sh` 가 필요한 파일을 그곳으로 복사한다.

---

## §6. doctor.sh 최종 확인

```bash
bash "$HOME/workspace/publish-harness/scripts/doctor.sh"
```

출력 예시:
```
1/5 시스템 도구
  [✓] Node                   v20.11.0
  [✓] npm                    10.2.4
  [✓] bash                   5.2.21
  [✓] git                    2.45.0
  [✓] curl                   설치됨
2/5 Claude Code
  [✓] Claude Code CLI        0.x.x
  [✓] Figma MCP              등록됨
3/5 Figma 인증
  [✓] FIGMA_TOKEN            figd_A...
  [✓] Figma API 연결         alice@example.com
4/5 선택 도구
  [✓] gh CLI                 로그인됨
  [⚠] @lhci/cli              미설치 (G7 Lighthouse 스킵됨)
```

필수 항목 전부 `[✓]` 면 준비 완료. `[✗]` 있으면 해결 명령어 보고 조치.

---

## §7. 선택 도구

### gh CLI (GitHub 리포 자동 생성)

```bash
# 설치
# Windows: winget install GitHub.cli
# macOS:   brew install gh
# Linux:   https://cli.github.com

# 로그인
gh auth login
```

없어도 하네스 동작. 단 `bootstrap` 이후 리포 생성 + push 를 수동으로 해야 함.

### @lhci/cli + lighthouse (G7 Lighthouse 게이트)

```bash
# 프로젝트에서 (bootstrap 후)
npm install -D @lhci/cli lighthouse
```

없으면 G7 스킵 (경고만). G4/G5/G6/G8 는 영향 없음.

---

## 실제 사용으로 진입

셋업 완료 후:

```bash
# 1. 신규 프로젝트 디렉토리
mkdir "$HOME/workspace/my-new-project"
cd "$HOME/workspace/my-new-project"

# 2. Claude Code 세션
claude --dangerously-skip-permissions

# 3. 세션 안에서 README.md §1 부트스트랩 프롬프트 복붙

# 4. (중요) 부트스트랩 완료 후 /exit → 재시작
#    이유: Claude Code는 세션 시작 시점에만 .claude/agents/ 를 스캔.
#    같은 세션에서 이어서 섹션 진행 시 'section-worker not found' 에러.
/exit
claude --dangerously-skip-permissions
```

이후는 루트 [README.md](../README.md) §1~§5 참조.

---

## 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| `FIGMA_TOKEN: unbound variable` | env 적용 안 된 새 터미널 세션 | 새 Git Bash / 터미널 재오픈 |
| `Figma API 인증 실패` | PAT 만료 또는 revoke | Figma 웹에서 재발급 + `setup-figma-token.sh` 재실행 |
| `claude mcp list` 에 figma 없음 | MCP 등록 실패 | §3 명령 재실행. `claude mcp remove figma-developer-mcp` 후 재등록 |
| `extract-tokens.sh` 에서 JSON 파싱 에러 | 파일 접근 권한 없음 또는 fileKey 오타 | URL 다시 확인, PAT 권한 확인 |
| Claude Code에서 MCP 응답 없음 | Figma MCP 서버 프로세스 문제 | Claude Code 재시작 |
| bootstrap 후 빌드 실패 | Node 버전 문제 | Node 18+ 확인, `node_modules/` 지우고 재설치 |

## §8 Windows 셸별 명령어 대조

하네스의 `.sh` 스크립트는 PowerShell/cmd/Git Bash **어느 셸에서 호출하든 동일하게 동작**(내부적으로 bash.exe가 처리). 셸 고유 문법이 필요한 건 **환경변수·변수 전개·일부 유틸리티**뿐.

### 환경변수

| 작업 | Git Bash / macOS / Linux | PowerShell | cmd |
|------|--------------------------|------------|-----|
| 값 확인 | `echo "$FIGMA_TOKEN"` | `echo $env:FIGMA_TOKEN` | `echo %FIGMA_TOKEN%` |
| prefix 10자 | `printenv FIGMA_TOKEN \| head -c 10` | `$env:FIGMA_TOKEN.Substring(0,10)` | `echo %FIGMA_TOKEN:~0,10%` |
| 현재 세션 설정 | `export FIGMA_TOKEN=figd_...` | `$env:FIGMA_TOKEN='figd_...'` | `set FIGMA_TOKEN=figd_...` |
| 영구 등록 (User scope) | `echo 'export FIGMA_TOKEN=...' >> ~/.bashrc` | `[Environment]::SetEnvironmentVariable('FIGMA_TOKEN','figd_...','User')` | `setx FIGMA_TOKEN figd_...` |
| 영구 등록 해제 | `sed -i '/FIGMA_TOKEN/d' ~/.bashrc` | `[Environment]::SetEnvironmentVariable('FIGMA_TOKEN',$null,'User')` | `setx FIGMA_TOKEN ""` |

### 스크립트 실행

모든 셸에서 동일하게 `.sh` 파일을 호출 가능 (bash.exe가 PATH에 있으면):

| 셸 | 명령 |
|----|------|
| Git Bash | `bash scripts/doctor.sh` |
| PowerShell | `bash scripts/doctor.sh` (동일) |
| cmd | `bash scripts/doctor.sh` (동일) |

PATH에 bash가 없다면 전체 경로:
```powershell
& "C:\Program Files\Git\bin\bash.exe" scripts/doctor.sh
```

### 토큰 변수 전개 (claude mcp add)

| 셸 | 명령 |
|----|------|
| Git Bash | `claude mcp add figma-developer-mcp -- npx -y figma-developer-mcp --figma-api-key=$FIGMA_TOKEN --stdio` |
| PowerShell | `claude mcp add figma-developer-mcp -- npx -y figma-developer-mcp --figma-api-key=$env:FIGMA_TOKEN --stdio` |
| cmd | `claude mcp add figma-developer-mcp -- npx -y figma-developer-mcp --figma-api-key=%FIGMA_TOKEN% --stdio` |

### 디렉토리/파일 명령 (자주 쓰는 것)

| 작업 | bash | PowerShell | cmd |
|------|------|------------|-----|
| 디렉토리 이동 | `cd /c/Dev/Workspace/...` | `cd C:\Dev\Workspace\...` | `cd C:\Dev\Workspace\...` |
| 디렉토리 생성 | `mkdir -p foo/bar` | `mkdir foo\bar -Force` | `mkdir foo\bar` |
| 파일 내용 보기 | `cat file.txt` | `Get-Content file.txt` / `cat file.txt` | `type file.txt` |
| 명령 위치 확인 | `which node` | `Get-Command node` / `where.exe node` | `where node` |

### 추천

**Windows 사용자**: PowerShell을 기본 셸로 쓰되, `.sh` 스크립트가 필요한 경우 PowerShell 안에서 그대로 `bash scripts/xxx.sh` 호출. 셸을 바꿔 가며 작업할 필요 없음.

---

## 관련 문서

- [`../README.md`](../README.md) — 부트스트랩/페이지/섹션 프롬프트 모음
- [`workflow.md`](./workflow.md) — 4 Phase 상세
- [`team-playbook.md`](./team-playbook.md) — 브랜치/PR/리뷰 규약

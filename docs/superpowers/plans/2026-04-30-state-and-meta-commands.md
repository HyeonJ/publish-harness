# State & Meta Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** publish-harness 의 LLM 추론 영역(상태 파악·다음 행동 결정·실패 진단·사전 점검)을 결정론적 코드로 옮긴다. PROGRESS.md 마크다운 파싱·게이트 결과 산발 JSON 어그리게이트·anti-loop guard 자연어 로직·환경 점검 부족 — 이 네 군데가 대상.

**Architecture:** 단일 source-of-truth `progress.json` (machine-readable) + 사람용 `PROGRESS.md` (자동 렌더). 5개 신규 스크립트(`progress-update`/`progress-render`/`status`/`why`/`next`) + 1개 helper lib(`_lib/progress-store.mjs`) + `doctor.sh` 확장 + 신규 `code-reviewer` agent. 의존성은 Node built-in(JSON·node:test) 만 사용 — yaml 파서 추가 없음.

**Tech Stack:** Node.js ≥18 ESM (`.mjs`), `node:test` 빌트인 테스트, `node:fs/promises` atomic write, bash for `doctor.sh`. 마크다운 출력은 직접 문자열 빌드.

**Branch:** `feat/state-and-meta-commands` (이미 생성됨)

---

## Task Group 개요

```
Group A — progress.json + 진실의 원천화          (모든 것의 기반)
   ↓
Group B — status / why / next 메타 명령           (A 위에 build, anti-loop guard 코드화)
   ↓
Group C — doctor.sh 확장          (A 와 독립, B 와 병렬 OK)
Group D — code-reviewer agent      (A,B 완료 후, retry 흐름에 끼워넣기)
```

**Critical path:** A → B. C/D 는 A 완료 후 어느 시점에 끼워도 됨.

---

## File Structure

**Create:**
- `scripts/_lib/progress-store.mjs` — read/write/validate progress.json
- `scripts/progress-update.mjs` — CLI wrapper (`init`/`add-page`/`add-section`/`set-section`/`record-gate-result`)
- `scripts/progress-render.mjs` — progress.json → PROGRESS.md 사람용 렌더
- `scripts/status.mjs` — progress.json + tests/quality/*.json + git status 어그리게이트
- `scripts/why.mjs` — "왜 진행 불가" 진단 (게이트 fail 카테고리 분포 + retry_count 분석)
- `scripts/next.mjs` — "다음에 뭐 할지" 가이드
- `tests/progress/store.test.mjs` — progress-store 단위 테스트
- `tests/progress/render.test.mjs` — render 단위 테스트
- `tests/progress/update-cli.test.mjs` — progress-update CLI 단위 테스트
- `tests/progress/status.test.mjs` — status aggregator 단위 테스트
- `tests/progress/why.test.mjs` — why 진단 룰 단위 테스트
- `tests/progress/next.test.mjs` — next 가이드 단위 테스트
- `tests/progress/fixtures/` — 시나리오별 progress.json + tests/quality 픽스처
- `.claude/agents/code-reviewer.md` — 신규 리뷰어 페르소나

**Modify:**
- `scripts/bootstrap.sh` — PROGRESS.md.tmpl 직접 렌더링 → `progress-update init` + `progress-render` 호출
- `scripts/doctor.sh` — `--json` 출력 모드 + 4개 신규 체크 (playwright browser / baseline 만료 / write-protected drift / anchor v2 잔여)
- `templates/vite-react-ts/PROGRESS.md.tmpl` → 삭제 (자동 렌더로 대체)
- `templates/html-static/PROGRESS.md.tmpl` → 삭제
- `.claude/skills/publish-harness/SKILL.md` — PROGRESS.md 직접 쓰기 → progress-update 호출 / status·why 호출 / code-reviewer 통합
- `.claude/agents/section-worker.md` — PROGRESS.md 쓰기 → progress-update 호출 / code-reviewer 피드백 통합 규약
- `package.json` — `test:progress` script 추가

**Delete:**
- `templates/*/PROGRESS.md.tmpl` (자동 렌더로 대체)

---

## progress.json 스키마 (Group A 내내 참조)

```json
{
  "version": 1,
  "project": {
    "name": "my-project",
    "mode": "figma",
    "template": "vite-react-ts",
    "source": { "figmaUrl": "...", "fileKey": "ABC123" },
    "canvas": { "desktop": 1920, "tablet": 768, "mobile": 375 }
  },
  "phase": {
    "current": 3,
    "completed": [1, 2]
  },
  "pages": [
    {
      "name": "home",
      "nodeId": "12:345",
      "nodeIdTablet": "12:346",
      "nodeIdMobile": null,
      "status": "in_progress",
      "sections": ["home-hero", "home-features"]
    }
  ],
  "sections": [
    {
      "name": "home-hero",
      "page": "home",
      "kind": "section",
      "status": "done",
      "retryCount": 0,
      "lastGateResult": {
        "passed": true,
        "gates": { "G1": "PASS", "G4": "PASS", "G5": "PASS", "G6": "PASS", "G8": "PASS", "G10": "PASS", "G11": "PASS" },
        "timestamp": "2026-04-30T10:15:30Z"
      },
      "failureHistory": []
    },
    {
      "name": "Button",
      "page": null,
      "kind": "component",
      "status": "blocked",
      "retryCount": 2,
      "lastGateResult": {
        "passed": false,
        "gates": { "G4": "FAIL", "G6": "PASS" },
        "timestamp": "2026-04-30T11:20:00Z"
      },
      "failureHistory": [
        { "attempt": 0, "categories": ["TOKEN_DRIFT"], "count": 3 },
        { "attempt": 1, "categories": ["TOKEN_DRIFT"], "count": 2 },
        { "attempt": 2, "categories": ["TOKEN_DRIFT", "VISUAL_DRIFT"], "count": 4 }
      ],
      "needsHuman": true
    }
  ],
  "updatedAt": "2026-04-30T11:20:00Z"
}
```

**Status enum:** `pending` | `in_progress` | `done` | `blocked` | `skipped`
**Failure category enum (9개):** SKILL.md §정식 prompt 포맷에 정의됨 — `VISUAL_DRIFT` | `TOKEN_DRIFT` | `A11Y` | `TEXT_RASTER` | `I18N_MISSING` | `IMPORT_MISSING` | `SYNTAX_ERROR` | `LIGHTHOUSE` | `UNKNOWN`

---

## Group A — progress.json + 진실의 원천화

### Task A.1: progress-store 스키마 + 빈 progress.json 생성

**Files:**
- Create: `scripts/_lib/progress-store.mjs`
- Create: `tests/progress/store.test.mjs`
- Create: `tests/progress/fixtures/empty.json`

- [ ] **Step 1: 픽스처 작성**

`tests/progress/fixtures/empty.json` 생성:

```json
{
  "version": 1,
  "project": { "name": "test-proj", "mode": "figma", "template": "vite-react-ts", "source": {}, "canvas": {} },
  "phase": { "current": 1, "completed": [] },
  "pages": [],
  "sections": [],
  "updatedAt": "2026-04-30T00:00:00Z"
}
```

- [ ] **Step 2: 실패 테스트 작성** (`tests/progress/store.test.mjs`)

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmpty, read, write, validate } from '../../scripts/_lib/progress-store.mjs';

test('createEmpty returns valid v1 skeleton', () => {
  const obj = createEmpty({ name: 'foo', mode: 'figma', template: 'vite-react-ts' });
  assert.equal(obj.version, 1);
  assert.equal(obj.project.name, 'foo');
  assert.deepEqual(obj.pages, []);
  assert.deepEqual(obj.sections, []);
  assert.equal(obj.phase.current, 1);
});

test('validate accepts well-formed progress', () => {
  const fx = JSON.parse(readFileSync(new URL('./fixtures/empty.json', import.meta.url), 'utf8'));
  assert.doesNotThrow(() => validate(fx));
});

test('validate rejects missing version', () => {
  assert.throws(() => validate({}), /version/);
});

test('validate rejects unknown status', () => {
  const bad = { version: 1, project: {}, phase: { current: 1, completed: [] }, pages: [],
    sections: [{ name: 'x', kind: 'section', status: 'foo', retryCount: 0, failureHistory: [] }],
    updatedAt: '' };
  assert.throws(() => validate(bad), /status/);
});

test('read/write roundtrip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'progress-'));
  const p = join(dir, 'progress.json');
  const obj = createEmpty({ name: 'x', mode: 'spec', template: 'vite-react-ts' });
  write(p, obj);
  const back = read(p);
  assert.equal(back.project.name, 'x');
  assert.equal(back.project.mode, 'spec');
});
```

- [ ] **Step 3: 테스트 실행 — 실패 확인**

```bash
node --test tests/progress/store.test.mjs
```

Expected: FAIL — "Cannot find module ../../scripts/_lib/progress-store.mjs"

- [ ] **Step 4: 최소 구현** (`scripts/_lib/progress-store.mjs`)

```javascript
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

const VALID_STATUS = new Set(['pending', 'in_progress', 'done', 'blocked', 'skipped']);
const VALID_KIND = new Set(['section', 'component']);
const VALID_MODE = new Set(['figma', 'spec']);
const VALID_TEMPLATE = new Set(['vite-react-ts', 'html-static', 'nextjs-app-router']);

export function createEmpty({ name, mode, template, source = {} }) {
  if (!VALID_MODE.has(mode)) throw new Error(`invalid mode: ${mode}`);
  if (!VALID_TEMPLATE.has(template)) throw new Error(`invalid template: ${template}`);
  return {
    version: 1,
    project: { name, mode, template, source, canvas: {} },
    phase: { current: 1, completed: [] },
    pages: [],
    sections: [],
    updatedAt: new Date().toISOString(),
  };
}

export function validate(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('not an object');
  if (obj.version !== 1) throw new Error(`unsupported version: ${obj.version}`);
  if (!obj.project) throw new Error('missing project');
  if (!Array.isArray(obj.pages)) throw new Error('pages must be array');
  if (!Array.isArray(obj.sections)) throw new Error('sections must be array');
  for (const s of obj.sections) {
    if (!VALID_STATUS.has(s.status)) throw new Error(`invalid status: ${s.status}`);
    if (!VALID_KIND.has(s.kind)) throw new Error(`invalid kind: ${s.kind}`);
    if (typeof s.retryCount !== 'number') throw new Error(`retryCount missing for ${s.name}`);
    if (!Array.isArray(s.failureHistory)) throw new Error(`failureHistory missing for ${s.name}`);
  }
}

export function read(path) {
  const obj = JSON.parse(readFileSync(path, 'utf8'));
  validate(obj);
  return obj;
}

export function write(path, obj) {
  validate(obj);
  obj.updatedAt = new Date().toISOString();
  // atomic: write to .tmp then rename
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
node --test tests/progress/store.test.mjs
```

Expected: PASS, 5 tests

- [ ] **Step 6: 커밋**

```bash
git add scripts/_lib/progress-store.mjs tests/progress/
git commit -m "feat(progress): A.1 progress-store v1 스키마 + read/write/validate"
```

---

### Task A.2: progress-store mutator 함수들 (addPage, addSection, setSectionStatus, recordGateResult)

**Files:**
- Modify: `scripts/_lib/progress-store.mjs`
- Modify: `tests/progress/store.test.mjs`
- Create: `tests/progress/fixtures/in-progress.json`

- [ ] **Step 1: 픽스처 작성** (`in-progress.json`)

```json
{
  "version": 1,
  "project": { "name": "demo", "mode": "figma", "template": "vite-react-ts", "source": {}, "canvas": {} },
  "phase": { "current": 3, "completed": [1, 2] },
  "pages": [{ "name": "home", "nodeId": "1:1", "nodeIdTablet": null, "nodeIdMobile": null, "status": "in_progress", "sections": ["home-hero"] }],
  "sections": [
    { "name": "home-hero", "page": "home", "kind": "section", "status": "in_progress", "retryCount": 0, "lastGateResult": null, "failureHistory": [] }
  ],
  "updatedAt": "2026-04-30T00:00:00Z"
}
```

- [ ] **Step 2: 실패 테스트 추가** (`tests/progress/store.test.mjs` 끝에)

```javascript
import { addPage, addSection, setSectionStatus, recordGateResult } from '../../scripts/_lib/progress-store.mjs';

test('addPage appends and validates', () => {
  const obj = createEmpty({ name: 'x', mode: 'figma', template: 'vite-react-ts' });
  addPage(obj, { name: 'home', nodeId: '1:1' });
  assert.equal(obj.pages.length, 1);
  assert.equal(obj.pages[0].status, 'pending');
});

test('addPage rejects duplicate name', () => {
  const obj = createEmpty({ name: 'x', mode: 'figma', template: 'vite-react-ts' });
  addPage(obj, { name: 'home', nodeId: '1:1' });
  assert.throws(() => addPage(obj, { name: 'home', nodeId: '1:2' }), /duplicate/);
});

test('addSection links to page and appends to page.sections', () => {
  const obj = createEmpty({ name: 'x', mode: 'figma', template: 'vite-react-ts' });
  addPage(obj, { name: 'home', nodeId: '1:1' });
  addSection(obj, { name: 'home-hero', page: 'home', kind: 'section' });
  assert.equal(obj.sections.length, 1);
  assert.deepEqual(obj.pages[0].sections, ['home-hero']);
});

test('addSection without page (component mode) is allowed', () => {
  const obj = createEmpty({ name: 'x', mode: 'spec', template: 'vite-react-ts' });
  addSection(obj, { name: 'Button', page: null, kind: 'component' });
  assert.equal(obj.sections[0].page, null);
});

test('setSectionStatus updates status', () => {
  const obj = createEmpty({ name: 'x', mode: 'spec', template: 'vite-react-ts' });
  addSection(obj, { name: 'Button', page: null, kind: 'component' });
  setSectionStatus(obj, 'Button', 'done');
  assert.equal(obj.sections[0].status, 'done');
});

test('recordGateResult appends failureHistory and increments retryCount on FAIL', () => {
  const obj = createEmpty({ name: 'x', mode: 'spec', template: 'vite-react-ts' });
  addSection(obj, { name: 'Button', page: null, kind: 'component' });
  recordGateResult(obj, 'Button', {
    passed: false,
    gates: { G4: 'FAIL' },
    failures: [{ category: 'TOKEN_DRIFT', gate: 'G4', message: 'hex literal' }],
  });
  const s = obj.sections[0];
  assert.equal(s.retryCount, 1);
  assert.equal(s.failureHistory.length, 1);
  assert.deepEqual(s.failureHistory[0].categories, ['TOKEN_DRIFT']);
  assert.equal(s.lastGateResult.passed, false);
});

test('recordGateResult on PASS sets status=done and clears needsHuman', () => {
  const obj = createEmpty({ name: 'x', mode: 'spec', template: 'vite-react-ts' });
  addSection(obj, { name: 'Button', page: null, kind: 'component' });
  obj.sections[0].needsHuman = true;
  recordGateResult(obj, 'Button', { passed: true, gates: { G4: 'PASS' }, failures: [] });
  assert.equal(obj.sections[0].status, 'done');
  assert.equal(obj.sections[0].needsHuman, undefined);
});
```

- [ ] **Step 3: 테스트 실행 — 실패 확인**

```bash
node --test tests/progress/store.test.mjs
```

Expected: FAIL — "addPage is not a function" 등

- [ ] **Step 4: 구현 추가** (`scripts/_lib/progress-store.mjs` 끝에)

```javascript
export function addPage(obj, { name, nodeId, nodeIdTablet = null, nodeIdMobile = null }) {
  if (obj.pages.find((p) => p.name === name)) {
    throw new Error(`duplicate page: ${name}`);
  }
  obj.pages.push({ name, nodeId, nodeIdTablet, nodeIdMobile, status: 'pending', sections: [] });
}

export function addSection(obj, { name, page, kind }) {
  if (obj.sections.find((s) => s.name === name)) {
    throw new Error(`duplicate section: ${name}`);
  }
  obj.sections.push({
    name, page: page || null, kind,
    status: 'pending', retryCount: 0,
    lastGateResult: null, failureHistory: [],
  });
  if (page) {
    const p = obj.pages.find((x) => x.name === page);
    if (!p) throw new Error(`page not found: ${page}`);
    if (!p.sections.includes(name)) p.sections.push(name);
  }
}

export function setSectionStatus(obj, name, status) {
  const s = obj.sections.find((x) => x.name === name);
  if (!s) throw new Error(`section not found: ${name}`);
  if (!['pending', 'in_progress', 'done', 'blocked', 'skipped'].includes(status)) {
    throw new Error(`invalid status: ${status}`);
  }
  s.status = status;
}

export function recordGateResult(obj, name, result) {
  const s = obj.sections.find((x) => x.name === name);
  if (!s) throw new Error(`section not found: ${name}`);
  s.lastGateResult = {
    passed: !!result.passed,
    gates: result.gates || {},
    timestamp: new Date().toISOString(),
  };
  if (result.passed) {
    s.status = 'done';
    delete s.needsHuman;
  } else {
    const categories = [...new Set((result.failures || []).map((f) => f.category))];
    s.failureHistory.push({ attempt: s.retryCount, categories, count: (result.failures || []).length });
    s.retryCount += 1;
    if (s.retryCount >= 3) {
      s.status = 'blocked';
      s.needsHuman = true;
    } else {
      s.status = 'in_progress';
    }
  }
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
node --test tests/progress/store.test.mjs
```

Expected: PASS, 12 tests total

- [ ] **Step 6: 커밋**

```bash
git add scripts/_lib/progress-store.mjs tests/progress/store.test.mjs tests/progress/fixtures/in-progress.json
git commit -m "feat(progress): A.2 mutator (addPage/addSection/setSectionStatus/recordGateResult)"
```

---

### Task A.3: progress-update.mjs CLI wrapper

**Files:**
- Create: `scripts/progress-update.mjs`
- Create: `tests/progress/update-cli.test.mjs`

- [ ] **Step 1: 실패 테스트 작성**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../../scripts/progress-update.mjs', import.meta.url).pathname;

function run(cwd, args) {
  return execFileSync('node', [SCRIPT, ...args], { cwd, encoding: 'utf8' });
}

test('init creates progress.json in cwd', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pu-'));
  run(dir, ['init', '--name', 'demo', '--mode', 'figma', '--template', 'vite-react-ts']);
  assert.ok(existsSync(join(dir, 'progress.json')));
  const obj = JSON.parse(readFileSync(join(dir, 'progress.json'), 'utf8'));
  assert.equal(obj.project.name, 'demo');
});

test('init refuses to overwrite existing progress.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pu-'));
  run(dir, ['init', '--name', 'demo', '--mode', 'figma', '--template', 'vite-react-ts']);
  assert.throws(() =>
    run(dir, ['init', '--name', 'demo', '--mode', 'figma', '--template', 'vite-react-ts'])
  );
});

test('add-page + add-section', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pu-'));
  run(dir, ['init', '--name', 'demo', '--mode', 'figma', '--template', 'vite-react-ts']);
  run(dir, ['add-page', '--name', 'home', '--node-id', '1:1']);
  run(dir, ['add-section', '--name', 'home-hero', '--page', 'home', '--kind', 'section']);
  const obj = JSON.parse(readFileSync(join(dir, 'progress.json'), 'utf8'));
  assert.equal(obj.pages[0].name, 'home');
  assert.equal(obj.sections[0].name, 'home-hero');
});

test('record-gate-result with --result-file (PASS)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pu-'));
  run(dir, ['init', '--name', 'demo', '--mode', 'spec', '--template', 'vite-react-ts']);
  run(dir, ['add-section', '--name', 'Button', '--kind', 'component']);
  // simulate a gate result file
  const resPath = join(dir, 'gate-result.json');
  const fs = require('node:fs');
  fs.writeFileSync(resPath, JSON.stringify({ passed: true, gates: { G4: 'PASS' }, failures: [] }));
  run(dir, ['record-gate-result', '--section', 'Button', '--result-file', resPath]);
  const obj = JSON.parse(readFileSync(join(dir, 'progress.json'), 'utf8'));
  assert.equal(obj.sections[0].status, 'done');
});

test('set-section direct status update', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pu-'));
  run(dir, ['init', '--name', 'demo', '--mode', 'spec', '--template', 'vite-react-ts']);
  run(dir, ['add-section', '--name', 'Button', '--kind', 'component']);
  run(dir, ['set-section', '--name', 'Button', '--status', 'skipped']);
  const obj = JSON.parse(readFileSync(join(dir, 'progress.json'), 'utf8'));
  assert.equal(obj.sections[0].status, 'skipped');
});
```

(주의: ESM 안에서 require 안 됨 → `await import('node:fs')` 또는 top-level import 사용. 테스트 작성 시 import 로 변경)

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
node --test tests/progress/update-cli.test.mjs
```

Expected: FAIL — script not found

- [ ] **Step 3: CLI 구현** (`scripts/progress-update.mjs`)

```javascript
#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEmpty, read, write, addPage, addSection, setSectionStatus, recordGateResult } from './_lib/progress-store.mjs';

const PROGRESS_PATH = join(process.cwd(), 'progress.json');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i].replace(/^--/, '');
    out[k] = argv[i + 1];
  }
  return out;
}

function die(msg, code = 2) {
  console.error(`progress-update: ${msg}`);
  process.exit(code);
}

const [, , subcmd, ...rest] = process.argv;
const args = parseArgs(rest);

switch (subcmd) {
  case 'init': {
    if (existsSync(PROGRESS_PATH)) die(`progress.json already exists at ${PROGRESS_PATH}`);
    const obj = createEmpty({ name: args.name, mode: args.mode, template: args.template });
    if (args['figma-url']) obj.project.source.figmaUrl = args['figma-url'];
    if (args['file-key']) obj.project.source.fileKey = args['file-key'];
    write(PROGRESS_PATH, obj);
    console.log(`progress.json initialized at ${PROGRESS_PATH}`);
    break;
  }
  case 'add-page': {
    const obj = read(PROGRESS_PATH);
    addPage(obj, {
      name: args.name,
      nodeId: args['node-id'],
      nodeIdTablet: args['node-id-tablet'] || null,
      nodeIdMobile: args['node-id-mobile'] || null,
    });
    write(PROGRESS_PATH, obj);
    console.log(`page added: ${args.name}`);
    break;
  }
  case 'add-section': {
    const obj = read(PROGRESS_PATH);
    addSection(obj, { name: args.name, page: args.page || null, kind: args.kind });
    write(PROGRESS_PATH, obj);
    console.log(`section added: ${args.name}`);
    break;
  }
  case 'set-section': {
    const obj = read(PROGRESS_PATH);
    setSectionStatus(obj, args.name, args.status);
    write(PROGRESS_PATH, obj);
    console.log(`section ${args.name} → ${args.status}`);
    break;
  }
  case 'record-gate-result': {
    const obj = read(PROGRESS_PATH);
    if (!args['result-file']) die('--result-file required');
    const result = JSON.parse(readFileSync(args['result-file'], 'utf8'));
    recordGateResult(obj, args.section, result);
    write(PROGRESS_PATH, obj);
    const s = obj.sections.find((x) => x.name === args.section);
    console.log(`recorded ${args.section}: status=${s.status} retryCount=${s.retryCount}`);
    break;
  }
  default:
    die(`unknown subcommand: ${subcmd || '(none)'}\nUsage: progress-update <init|add-page|add-section|set-section|record-gate-result> [args]`);
}
```

- [ ] **Step 4: 테스트의 require 구문 → import 로 정정**

테스트 파일에서 `const fs = require('node:fs');` → 상단 `import { writeFileSync as fsWrite } from 'node:fs';` 로 옮기고, `fs.writeFileSync` → `fsWrite` 로 치환.

- [ ] **Step 5: shebang 실행 권한 부여**

```bash
chmod +x scripts/progress-update.mjs
```

(Windows 에서는 의미 없지만 Unix 환경 호환을 위해 — git add 가 자동으로 100755 로 stage)

- [ ] **Step 6: 테스트 통과 확인**

```bash
node --test tests/progress/update-cli.test.mjs
```

Expected: PASS, 5 tests

- [ ] **Step 7: 커밋**

```bash
git add scripts/progress-update.mjs tests/progress/update-cli.test.mjs
git commit -m "feat(progress): A.3 progress-update CLI (init/add-page/add-section/set-section/record-gate-result)"
```

---

### Task A.4: progress-render — progress.json → PROGRESS.md 렌더

**Files:**
- Create: `scripts/progress-render.mjs`
- Create: `tests/progress/render.test.mjs`
- Create: `tests/progress/fixtures/done-mixed.json`

- [ ] **Step 1: 픽스처 작성** (`done-mixed.json` — 한 페이지에 done/in_progress/blocked 섞인 상태)

```json
{
  "version": 1,
  "project": { "name": "demo", "mode": "figma", "template": "vite-react-ts",
    "source": { "figmaUrl": "https://figma.com/design/ABC", "fileKey": "ABC" }, "canvas": { "desktop": 1920, "mobile": 375 } },
  "phase": { "current": 3, "completed": [1, 2] },
  "pages": [{ "name": "home", "nodeId": "1:1", "nodeIdTablet": null, "nodeIdMobile": null, "status": "in_progress",
    "sections": ["home-hero", "home-features", "home-cta"] }],
  "sections": [
    { "name": "home-hero", "page": "home", "kind": "section", "status": "done", "retryCount": 0, "lastGateResult": null, "failureHistory": [] },
    { "name": "home-features", "page": "home", "kind": "section", "status": "in_progress", "retryCount": 1, "lastGateResult": null, "failureHistory": [{ "attempt": 0, "categories": ["TOKEN_DRIFT"], "count": 2 }] },
    { "name": "home-cta", "page": "home", "kind": "section", "status": "blocked", "retryCount": 3, "lastGateResult": null, "failureHistory": [], "needsHuman": true }
  ],
  "updatedAt": "2026-04-30T00:00:00Z"
}
```

- [ ] **Step 2: 실패 테스트 작성**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render } from '../../scripts/progress-render.mjs';

const fx = JSON.parse(readFileSync(new URL('./fixtures/done-mixed.json', import.meta.url), 'utf8'));

test('render outputs project meta header', () => {
  const md = render(fx);
  assert.match(md, /# PROGRESS — demo/);
  assert.match(md, /\*\*mode\*\*: figma/);
  assert.match(md, /\*\*template\*\*: vite-react-ts/);
  assert.match(md, /\*\*Figma URL\*\*: https:\/\/figma.com\/design\/ABC/);
});

test('render shows phase progress', () => {
  const md = render(fx);
  assert.match(md, /## Phase 1.*완료/);
  assert.match(md, /## Phase 2.*완료/);
  assert.match(md, /## Phase 3.*진행 중/);
});

test('render lists sections with status icons', () => {
  const md = render(fx);
  assert.match(md, /- \[x\] home-hero/);
  assert.match(md, /- \[ \] home-features.*retry 1/);
  assert.match(md, /- \[!\] home-cta.*needs human/i);
});

test('render shows fixture date in footer', () => {
  const md = render(fx);
  assert.match(md, /updated: 2026-04-30/);
});
```

- [ ] **Step 3: 테스트 실행 — 실패 확인**

```bash
node --test tests/progress/render.test.mjs
```

Expected: FAIL — module not found

- [ ] **Step 4: render 함수 구현** (`scripts/progress-render.mjs`)

```javascript
#!/usr/bin/env node
import { read } from './_lib/progress-store.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PHASE_LABEL = {
  1: '부트스트랩',
  2: '분해',
  3: '구현',
  4: '통합 검증',
};

function statusIcon(s) {
  if (s.status === 'done') return '[x]';
  if (s.status === 'blocked' || s.needsHuman) return '[!]';
  if (s.status === 'skipped') return '[~]';
  return '[ ]';
}

function sectionLine(s) {
  const icon = statusIcon(s);
  const meta = [];
  if (s.retryCount > 0 && s.status !== 'done') meta.push(`retry ${s.retryCount}`);
  if (s.needsHuman) meta.push('needs human');
  const suffix = meta.length ? ` _(${meta.join(', ')})_` : '';
  return `- ${icon} ${s.name}${suffix}`;
}

export function render(progress) {
  const lines = [];
  const p = progress.project;
  lines.push(`# PROGRESS — ${p.name}`, '');
  lines.push('> 자동 생성: progress.json 에서 렌더링됨. 직접 수정 금지.', '');
  lines.push('## 프로젝트 메타');
  lines.push(`- **mode**: ${p.mode}`);
  lines.push(`- **template**: ${p.template}`);
  if (p.source?.figmaUrl) lines.push(`- **Figma URL**: ${p.source.figmaUrl}`);
  if (p.source?.fileKey) lines.push(`- **fileKey**: ${p.source.fileKey}`);
  if (p.canvas?.desktop) lines.push(`- **Desktop 캔버스**: ${p.canvas.desktop}px`);
  if (p.canvas?.mobile) lines.push(`- **Mobile 캔버스**: ${p.canvas.mobile}px`);
  lines.push('');

  for (let i = 1; i <= 4; i++) {
    const status = progress.phase.completed.includes(i) ? '완료'
      : progress.phase.current === i ? '진행 중' : '대기';
    lines.push(`## Phase ${i} — ${PHASE_LABEL[i]} (${status})`);

    if (i === 3) {
      // sections by page
      for (const page of progress.pages) {
        lines.push(`### ${page.name}`);
        for (const sname of page.sections) {
          const s = progress.sections.find((x) => x.name === sname);
          if (s) lines.push(sectionLine(s));
        }
        lines.push('');
      }
      // page-less components (spec 모드)
      const orphan = progress.sections.filter((s) => !s.page);
      if (orphan.length) {
        lines.push('### 컴포넌트 (no page)');
        for (const s of orphan) lines.push(sectionLine(s));
        lines.push('');
      }
    } else {
      lines.push('');
    }
  }

  lines.push(`---`, `_updated: ${progress.updatedAt}_`, '');
  return lines.join('\n');
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1])) {
  const progressPath = join(process.cwd(), 'progress.json');
  const outPath = join(process.cwd(), 'PROGRESS.md');
  const md = render(read(progressPath));
  writeFileSync(outPath, md, 'utf8');
  console.log(`PROGRESS.md rendered (${md.length} bytes)`);
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
node --test tests/progress/render.test.mjs
```

Expected: PASS, 4 tests

- [ ] **Step 6: 커밋**

```bash
git add scripts/progress-render.mjs tests/progress/render.test.mjs tests/progress/fixtures/done-mixed.json
git commit -m "feat(progress): A.4 progress-render (progress.json → PROGRESS.md)"
```

---

### Task A.5: bootstrap.sh 통합 + PROGRESS.md.tmpl 제거

**Files:**
- Modify: `scripts/bootstrap.sh`
- Delete: `templates/vite-react-ts/PROGRESS.md.tmpl`
- Delete: `templates/html-static/PROGRESS.md.tmpl`

- [ ] **Step 1: bootstrap.sh 의 PROGRESS 처리 부분 (line 285~289) 교체**

```bash
# Before:
if [ -f PROGRESS.md.tmpl ]; then
  render_template PROGRESS.md.tmpl PROGRESS.md
  rm -f PROGRESS.md.tmpl
fi

# After:
# progress.json + 자동 렌더된 PROGRESS.md
node "${HARNESS_DIR}/scripts/progress-update.mjs" init \
  --name "${PROJECT_NAME}" \
  --mode "${MODE}" \
  --template "${TEMPLATE}" \
  ${FIGMA_URL:+--figma-url "${FIGMA_URL}"} \
  ${FILE_KEY:+--file-key "${FILE_KEY}"}
node "${HARNESS_DIR}/scripts/progress-render.mjs"
rm -f PROGRESS.md.tmpl  # 잔재 제거 (구버전 호환)
```

- [ ] **Step 2: 템플릿 파일 삭제**

```bash
git rm templates/vite-react-ts/PROGRESS.md.tmpl templates/html-static/PROGRESS.md.tmpl
```

- [ ] **Step 3: 수동 smoke test — bootstrap dry run**

```bash
mkdir -p /tmp/bootstrap-smoke && cd /tmp/bootstrap-smoke
# spec 모드는 handoff 가 필요해서 figma 모드로 검증 (FIGMA_URL 더미)
HARNESS_DIR="$OLDPWD" bash "$OLDPWD/scripts/bootstrap.sh" --mode spec --from-handoff "$OLDPWD/tests/fixtures/dummy-handoff" smoke || true
ls progress.json PROGRESS.md
cat progress.json | head -20
cd "$OLDPWD"
```

(handoff fixture 없으면 이 step 은 spec 모드로 직접 progress-update 호출만 검증)

대안 — direct 검증:

```bash
mkdir -p /tmp/pu-smoke && cd /tmp/pu-smoke
node "$OLDPWD/scripts/progress-update.mjs" init --name smoke --mode spec --template vite-react-ts
node "$OLDPWD/scripts/progress-render.mjs"
cat PROGRESS.md
cd "$OLDPWD"
```

Expected: progress.json + PROGRESS.md 정상 생성, "Phase 1 — 부트스트랩 (진행 중)" 헤더 노출.

- [ ] **Step 4: 커밋**

```bash
git add scripts/bootstrap.sh templates/
git commit -m "refactor(bootstrap): A.5 PROGRESS.md.tmpl → progress-update init + render"
```

---

### Task A.6: SKILL.md / section-worker.md 의 PROGRESS.md 직접 쓰기 제거

**Files:**
- Modify: `.claude/skills/publish-harness/SKILL.md`
- Modify: `.claude/agents/section-worker.md`

이 task 는 코드 변경이 아니라 자연어 instruction 변경이라 "테스트" 가 비전형. 대신 grep 으로 잔재 확인.

- [ ] **Step 1: SKILL.md 의 "PROGRESS.md 에 기록" 류 instruction 을 progress-update CLI 호출로 교체**

대상 라인:
- `:128` 페이지 분해 결과 → `bash scripts/progress-update.mjs add-page ...` + `add-section` 반복
- `:154` 컴포넌트 카탈로그 → `add-section --kind component` 반복
- `:240` PASS 후 체크 → `progress-update record-gate-result` (자동 호출은 measure-quality.sh 가 하도록 A.7 에서 처리)
- `:312`, `:327` 페이지 완료 체크 → `progress-update set-section --status done` (또는 record-gate-result 위임)
- `:400` "PROGRESS.md 읽기 → 다음 미완 섹션 식별" → `bash scripts/status.mjs --json | jq` (Group B 에서 status.mjs 추가 후 활성)
- `:403` PASS 자동 커밋 + PROGRESS.md 업데이트 → progress-update 가 처리하므로 setence 정리

마지막에 **section-worker 가 PROGRESS.md 를 직접 수정하지 말 것** 명시 추가.

- [ ] **Step 2: section-worker.md 의 PROGRESS.md 수정 instruction 검토**

`grep -n PROGRESS section-worker.md` 로 잔재 확인 후 진행. 발견되면 "PROGRESS.md 직접 수정 금지. 게이트 통과 후 오케스트레이터가 progress-update record-gate-result 호출로 반영" 으로 치환.

- [ ] **Step 3: 잔재 검증**

```bash
grep -n "PROGRESS\.md" .claude/skills/publish-harness/SKILL.md .claude/agents/section-worker.md
```

Expected: 모든 매치가 "참조" / "사람용 view" / "자동 렌더" 류 표현이지, "쓰기/수정" 류는 없어야 함.

- [ ] **Step 4: 커밋**

```bash
git add .claude/
git commit -m "refactor(skill,worker): A.6 PROGRESS.md 직접 쓰기 → progress-update CLI 위임"
```

---

### Task A.7: measure-quality.sh 가 자동으로 progress-update record-gate-result 호출

**Files:**
- Modify: `scripts/measure-quality.sh`

- [ ] **Step 1: measure-quality.sh 끝부분 (게이트 결과 JSON 작성 직후) 에 progress-update 호출 추가**

조건: progress.json 이 cwd 에 존재할 때만. 없으면 skip (publish-harness 자체 fixture 테스트가 깨지지 않도록).

```bash
# (... 기존 게이트 실행 + tests/quality/${SECTION}.json 작성 끝난 직후 ...)

# progress.json 이 있으면 자동 반영
if [ -f "progress.json" ]; then
  node scripts/progress-update.mjs record-gate-result \
    --section "${SECTION}" \
    --result-file "tests/quality/${SECTION}.json" 2>/dev/null || \
    echo "[measure-quality] progress.json 업데이트 실패 (수동 record-gate-result 권장)"
  node scripts/progress-render.mjs 2>/dev/null || true
fi
```

- [ ] **Step 2: tests/quality/{section}.json 의 schema 가 progress-store recordGateResult 와 호환되는지 확인**

`tests/quality/*.json` 의 실제 형식을 1개 샘플로 확인:

```bash
ls tests/quality/ 2>/dev/null && cat tests/quality/*.json 2>/dev/null | head -30
```

만약 형식이 `{ passed, gates, failures }` 가 아니면 progress-store.mjs 의 recordGateResult 가 받는 형식을 measure-quality.sh 가 출력하는 형식에 맞춰 어댑터 함수 추가. 어댑터는 `_lib/progress-store.mjs` 에 `recordGateResultFromMeasureQuality(obj, name, mqResult)` 로 추가하고 progress-update.mjs 의 `record-gate-result` 가 자동 감지/변환.

(어댑터 변환 로직은 measure-quality 의 실제 출력 본 후 결정 — schema 가 안 맞으면 별도 sub-task A.7.1 신설)

- [ ] **Step 3: 수동 smoke test**

```bash
# 임시 progress.json 생성 후 가짜 measure-quality 결과 record
cd /tmp/pu-smoke
node "$OLDPWD/scripts/progress-update.mjs" add-section --name TestSection --kind component
echo '{"passed":false,"gates":{"G4":"FAIL"},"failures":[{"category":"TOKEN_DRIFT","gate":"G4","message":"hex literal"}]}' > result.json
node "$OLDPWD/scripts/progress-update.mjs" record-gate-result --section TestSection --result-file result.json
cat progress.json | grep -A 2 retryCount
cd "$OLDPWD"
```

Expected: `"retryCount": 1`, `"failureHistory": [{"attempt": 0, "categories": ["TOKEN_DRIFT"], ...}]`

- [ ] **Step 4: 커밋**

```bash
git add scripts/measure-quality.sh
git commit -m "feat(measure-quality): A.7 progress-update 자동 호출 (게이트 결과 반영)"
```

---

## Group B — status / why / next 메타 명령

### Task B.1: status.mjs --json (어그리게이터)

**Files:**
- Create: `scripts/status.mjs`
- Create: `tests/progress/status.test.mjs`
- Create: `tests/progress/fixtures/scenarios/`

- [ ] **Step 1: 시나리오 픽스처 디렉토리 생성**

```bash
mkdir -p tests/progress/fixtures/scenarios/{empty,phase2-decomposed,phase3-mid,phase3-blocked,all-done}
```

각 시나리오는 `progress.json` + (필요 시) `tests/quality/*.json` 모킹 디렉토리.

`scenarios/phase3-mid/progress.json`:
```json
{
  "version": 1,
  "project": { "name": "demo", "mode": "figma", "template": "vite-react-ts", "source": {}, "canvas": {} },
  "phase": { "current": 3, "completed": [1, 2] },
  "pages": [{ "name": "home", "nodeId": "1:1", "nodeIdTablet": null, "nodeIdMobile": null, "status": "in_progress", "sections": ["home-hero", "home-features"] }],
  "sections": [
    { "name": "home-hero", "page": "home", "kind": "section", "status": "done", "retryCount": 0, "lastGateResult": null, "failureHistory": [] },
    { "name": "home-features", "page": "home", "kind": "section", "status": "pending", "retryCount": 0, "lastGateResult": null, "failureHistory": [] }
  ],
  "updatedAt": "2026-04-30T00:00:00Z"
}
```

`scenarios/phase3-blocked/progress.json`: 한 섹션 retryCount=3 + needsHuman=true
`scenarios/all-done/progress.json`: 모든 섹션 done, phase.completed = [1,2,3]
`scenarios/empty/progress.json`: createEmpty 결과

- [ ] **Step 2: 실패 테스트 작성**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from '../../scripts/status.mjs';
import { readFileSync } from 'node:fs';

function load(name) {
  return JSON.parse(readFileSync(new URL(`./fixtures/scenarios/${name}/progress.json`, import.meta.url), 'utf8'));
}

test('aggregate empty → phase 1 in_progress, no sections', () => {
  const s = aggregate({ progress: load('empty'), gitStatus: '', gateResults: {} });
  assert.equal(s.phase.current, 1);
  assert.equal(s.totals.sections, 0);
  assert.equal(s.totals.done, 0);
  assert.equal(s.canProceed, true);
});

test('aggregate phase3-mid → 1 done / 1 pending', () => {
  const s = aggregate({ progress: load('phase3-mid'), gitStatus: '', gateResults: {} });
  assert.equal(s.totals.sections, 2);
  assert.equal(s.totals.done, 1);
  assert.equal(s.totals.pending, 1);
  assert.equal(s.nextActionable[0].name, 'home-features');
});

test('aggregate phase3-blocked → canProceed false, blockers listed', () => {
  const s = aggregate({ progress: load('phase3-blocked'), gitStatus: '', gateResults: {} });
  assert.equal(s.canProceed, false);
  assert.ok(s.blockers.length >= 1);
  assert.equal(s.blockers[0].kind, 'section_blocked');
});

test('aggregate all-done → phase 4', () => {
  const s = aggregate({ progress: load('all-done'), gitStatus: '', gateResults: {} });
  assert.equal(s.totals.done, s.totals.sections);
  assert.equal(s.recommendedPhase, 4);
});

test('aggregate detects uncommitted changes from gitStatus', () => {
  const s = aggregate({ progress: load('phase3-mid'), gitStatus: ' M src/components/sections/home/HomeHero.tsx', gateResults: {} });
  assert.equal(s.git.dirty, true);
});
```

- [ ] **Step 3: 테스트 실행 — 실패 확인**

```bash
node --test tests/progress/status.test.mjs
```

Expected: FAIL — module not found

- [ ] **Step 4: status.mjs 구현**

```javascript
#!/usr/bin/env node
import { read } from './_lib/progress-store.mjs';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function aggregate({ progress, gitStatus = '', gateResults = {} }) {
  const sections = progress.sections;
  const totals = {
    sections: sections.length,
    done: sections.filter((s) => s.status === 'done').length,
    pending: sections.filter((s) => s.status === 'pending').length,
    in_progress: sections.filter((s) => s.status === 'in_progress').length,
    blocked: sections.filter((s) => s.status === 'blocked' || s.needsHuman).length,
    skipped: sections.filter((s) => s.status === 'skipped').length,
  };

  const blockers = [];
  for (const s of sections) {
    if (s.status === 'blocked' || s.needsHuman) {
      blockers.push({
        kind: 'section_blocked',
        section: s.name,
        retryCount: s.retryCount,
        lastCategories: s.failureHistory.at(-1)?.categories || [],
      });
    }
  }
  if (progress.phase.current === 1 && !progress.project.source?.fileKey && progress.project.mode === 'figma') {
    blockers.push({ kind: 'missing_token_source', message: 'figma 모드인데 fileKey 없음 → bootstrap 미완' });
  }

  const nextActionable = sections.filter((s) => s.status === 'pending' || s.status === 'in_progress');

  // phase recommendation
  let recommendedPhase = progress.phase.current;
  if (totals.sections > 0 && totals.done === totals.sections - totals.skipped) {
    recommendedPhase = 4;
  }

  return {
    phase: progress.phase,
    recommendedPhase,
    totals,
    blockers,
    canProceed: blockers.length === 0,
    nextActionable: nextActionable.slice(0, 5),
    git: {
      dirty: gitStatus.trim().length > 0,
      raw: gitStatus.trim(),
    },
    gateResults,
    project: progress.project,
    updatedAt: progress.updatedAt,
  };
}

function readGateResults(cwd) {
  const dir = join(cwd, 'tests/quality');
  if (!existsSync(dir)) return {};
  const out = {};
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      out[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch {}
  }
  return out;
}

// CLI entry
if (import.meta.url.endsWith(process.argv[1].replace(/^file:\/\//, '')) || process.argv[1].endsWith('status.mjs')) {
  const cwd = process.cwd();
  const progress = read(join(cwd, 'progress.json'));
  let gitStatus = '';
  try { gitStatus = execSync('git status --porcelain', { cwd, encoding: 'utf8' }); } catch {}
  const gateResults = readGateResults(cwd);
  const result = aggregate({ progress, gitStatus, gateResults });

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    // human-readable summary
    const p = result.project;
    console.log(`📍 ${p.name} [${p.mode}/${p.template}]  Phase ${result.phase.current} (recommended: ${result.recommendedPhase})`);
    console.log(`   섹션: ${result.totals.done}/${result.totals.sections} done · ${result.totals.in_progress} in-progress · ${result.totals.blocked} blocked`);
    if (result.blockers.length) {
      console.log(`   ⚠ blockers:`);
      for (const b of result.blockers) console.log(`     - ${b.kind}${b.section ? `: ${b.section}` : ''}`);
    }
    if (result.nextActionable.length) {
      console.log(`   ▶ 다음:`);
      for (const s of result.nextActionable.slice(0, 3)) console.log(`     - ${s.name} (${s.status})`);
    }
    if (result.git.dirty) console.log(`   📝 작업 트리 변경 있음`);
  }
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
node --test tests/progress/status.test.mjs
```

Expected: PASS, 5 tests

- [ ] **Step 6: 커밋**

```bash
git add scripts/status.mjs tests/progress/
git commit -m "feat(meta): B.1 status.mjs (--json 어그리게이터)"
```

---

### Task B.2: why.mjs — 진단 룰 + anti-loop guard 코드화

**Files:**
- Create: `scripts/why.mjs`
- Create: `tests/progress/why.test.mjs`

진단 룰 우선순위 (높은→낮음):
1. progress.json 부재 → "bootstrap 필요"
2. mode=figma + FIGMA_TOKEN 없음 → "토큰 설정 필요"
3. mode=figma + tokens.css 없음 → "extract-tokens 필요"
4. phase 1, project.source.fileKey 없음 → "bootstrap 미완"
5. phase 2, pages.length === 0 → "페이지 분해 필요"
6. blocked 섹션 + 동일 카테고리 3회 연속 → "anti-loop 발동: 재분할 권장"
7. blocked 섹션 일반 → "수동 개입 필요 (drift 패턴 분석)"
8. dirty git tree → "커밋 필요"
9. 이외 모두 OK → "다음 actionable 진행"

- [ ] **Step 1: 실패 테스트 작성**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnose } from '../../scripts/why.mjs';
import { readFileSync } from 'node:fs';

function load(name) {
  return JSON.parse(readFileSync(new URL(`./fixtures/scenarios/${name}/progress.json`, import.meta.url), 'utf8'));
}

test('diagnose missing progress.json', () => {
  const d = diagnose({ progress: null, env: {} });
  assert.equal(d.code, 'BOOTSTRAP_REQUIRED');
});

test('diagnose figma mode missing FIGMA_TOKEN', () => {
  const d = diagnose({ progress: load('empty'), env: {} });
  assert.equal(d.code, 'FIGMA_TOKEN_MISSING');
});

test('diagnose phase2 with no pages', () => {
  const fx = load('empty');
  fx.phase.current = 2;
  fx.project.source = { fileKey: 'X' };
  const d = diagnose({ progress: fx, env: { FIGMA_TOKEN: 'x' } });
  assert.equal(d.code, 'DECOMPOSE_REQUIRED');
});

test('diagnose blocked section with repeated category triggers anti-loop', () => {
  const fx = load('empty');
  fx.phase.current = 3;
  fx.project.source = { fileKey: 'X' };
  fx.sections = [{
    name: 'Bad', page: null, kind: 'component', status: 'blocked',
    retryCount: 3, needsHuman: true, lastGateResult: null,
    failureHistory: [
      { attempt: 0, categories: ['TOKEN_DRIFT'], count: 3 },
      { attempt: 1, categories: ['TOKEN_DRIFT'], count: 3 },
      { attempt: 2, categories: ['TOKEN_DRIFT'], count: 3 },
    ],
  }];
  const d = diagnose({ progress: fx, env: { FIGMA_TOKEN: 'x' } });
  assert.equal(d.code, 'ANTI_LOOP_TRIGGERED');
  assert.match(d.recommendations.join(' '), /재분할/);
});

test('diagnose all-done returns OK_NEXT_PHASE', () => {
  const d = diagnose({ progress: load('all-done'), env: { FIGMA_TOKEN: 'x' } });
  assert.equal(d.code, 'OK_NEXT_PHASE');
});

test('diagnose phase3-mid with normal pending → OK_PROCEED', () => {
  const d = diagnose({ progress: load('phase3-mid'), env: { FIGMA_TOKEN: 'x' } });
  assert.equal(d.code, 'OK_PROCEED');
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
node --test tests/progress/why.test.mjs
```

Expected: FAIL

- [ ] **Step 3: why.mjs 구현**

```javascript
#!/usr/bin/env node
import { read } from './_lib/progress-store.mjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const RULES = [
  {
    code: 'BOOTSTRAP_REQUIRED',
    when: ({ progress }) => !progress,
    message: () => 'progress.json 이 없음. bootstrap.sh 가 실행되지 않았거나 잘못된 디렉토리입니다.',
    recommendations: () => ['bash scripts/bootstrap.sh <figma-url> 또는 --mode spec --from-handoff <dir>'],
  },
  {
    code: 'FIGMA_TOKEN_MISSING',
    when: ({ progress, env }) => progress.project.mode === 'figma' && !env.FIGMA_TOKEN,
    message: () => 'figma 모드인데 FIGMA_TOKEN 환경변수 없음.',
    recommendations: () => ['bash scripts/setup-figma-token.sh', 'export FIGMA_TOKEN=...'],
  },
  {
    code: 'TOKENS_MISSING',
    when: ({ progress, cwd }) => progress.project.mode === 'figma' && !existsSync(join(cwd || '.', 'src/styles/tokens.css')),
    message: () => 'src/styles/tokens.css 없음 — extract-tokens 미실행 / bootstrap 미완.',
    recommendations: ({ progress }) => [`bash scripts/extract-tokens.sh ${progress.project.source?.fileKey || '<fileKey>'}`],
  },
  {
    code: 'DECOMPOSE_REQUIRED',
    when: ({ progress }) => progress.phase.current === 2 && progress.pages.length === 0 && progress.sections.length === 0,
    message: () => 'Phase 2 — 분해가 필요합니다. 페이지/컴포넌트가 등록되지 않았습니다.',
    recommendations: ({ progress }) => progress.project.mode === 'figma'
      ? ['오케스트레이터: get_metadata 로 페이지 트리 추출 → progress-update add-page/add-section']
      : ['오케스트레이터: docs/components-spec.md 읽고 컴포넌트 분류 → progress-update add-section'],
  },
  {
    code: 'ANTI_LOOP_TRIGGERED',
    when: ({ progress }) => {
      const blocked = progress.sections.find((s) => {
        if (!s.needsHuman || s.failureHistory.length < 3) return false;
        const last3 = s.failureHistory.slice(-3);
        const cats = last3.map((h) => JSON.stringify([...h.categories].sort()));
        return new Set(cats).size === 1;
      });
      return !!blocked;
    },
    message: ({ progress }) => {
      const s = progress.sections.find((x) => x.needsHuman);
      return `섹션 '${s.name}' 이 동일 카테고리 (${s.failureHistory.at(-1).categories.join(',')}) 로 3회 반복 실패 — 구조적 문제.`;
    },
    recommendations: () => [
      '섹션 재분할 (서브섹션으로 쪼개기)',
      'docs/components-spec.md 의 해당 컴포넌트 spec 검토',
      '수동 리팩터 후 progress-update set-section --status pending 으로 재시작',
    ],
  },
  {
    code: 'SECTION_BLOCKED',
    when: ({ progress }) => progress.sections.some((s) => s.needsHuman),
    message: ({ progress }) => {
      const s = progress.sections.find((x) => x.needsHuman);
      return `섹션 '${s.name}' 이 ${s.retryCount}회 시도 후 needs_human 상태입니다.`;
    },
    recommendations: () => [
      'lastGateResult 확인 후 drift 분석',
      '수동 수정 → progress-update set-section --status pending 으로 재시도',
      '또는 progress-update set-section --status skipped (다음으로 넘기기)',
    ],
  },
  {
    code: 'OK_NEXT_PHASE',
    when: ({ progress }) => {
      const total = progress.sections.length;
      const done = progress.sections.filter((s) => s.status === 'done').length;
      const skipped = progress.sections.filter((s) => s.status === 'skipped').length;
      return total > 0 && done + skipped === total && progress.phase.current < 4;
    },
    message: () => '모든 섹션 완료. 다음 phase 진입 가능.',
    recommendations: ({ progress }) => [`progress-update 로 phase.current 를 ${progress.phase.current + 1} 로 진행`],
  },
  {
    code: 'OK_PROCEED',
    when: () => true,
    message: () => '진행 가능 상태. 다음 actionable 섹션을 처리하세요.',
    recommendations: () => ['bash scripts/next.mjs 로 다음 행동 확인'],
  },
];

export function diagnose(ctx) {
  for (const rule of RULES) {
    if (rule.when(ctx)) {
      return {
        code: rule.code,
        message: rule.message(ctx),
        recommendations: rule.recommendations(ctx),
      };
    }
  }
  return { code: 'UNKNOWN', message: '진단 불가', recommendations: [] };
}

// CLI entry
if (process.argv[1].endsWith('why.mjs')) {
  const cwd = process.cwd();
  const progressPath = join(cwd, 'progress.json');
  const progress = existsSync(progressPath) ? read(progressPath) : null;
  const result = diagnose({ progress, env: process.env, cwd });

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`[${result.code}] ${result.message}`);
    if (result.recommendations.length) {
      console.log('해결:');
      for (const r of result.recommendations) console.log(`  - ${r}`);
    }
  }
  process.exit(result.code.startsWith('OK_') ? 0 : 1);
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
node --test tests/progress/why.test.mjs
```

Expected: PASS, 6 tests

- [ ] **Step 5: 커밋**

```bash
git add scripts/why.mjs tests/progress/why.test.mjs
git commit -m "feat(meta): B.2 why.mjs (진단 룰 + anti-loop guard 코드화)"
```

---

### Task B.3: next.mjs — "다음에 뭐 할지" 가이드

**Files:**
- Create: `scripts/next.mjs`
- Create: `tests/progress/next.test.mjs`

동작: status.aggregate + why.diagnose 결과를 바탕으로 **하나의 명확한 다음 명령** 출력.

- [ ] **Step 1: 실패 테스트 작성**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggest } from '../../scripts/next.mjs';
import { readFileSync } from 'node:fs';

function load(name) {
  return JSON.parse(readFileSync(new URL(`./fixtures/scenarios/${name}/progress.json`, import.meta.url), 'utf8'));
}

test('suggest empty → bootstrap', () => {
  const out = suggest({ progress: load('empty'), env: {} });
  assert.match(out.action, /FIGMA_TOKEN/);
});

test('suggest phase3-mid → next pending section', () => {
  const out = suggest({ progress: load('phase3-mid'), env: { FIGMA_TOKEN: 'x' } });
  assert.match(out.action, /home-features/);
  assert.equal(out.target, 'home-features');
});

test('suggest all-done → integrate phase', () => {
  const out = suggest({ progress: load('all-done'), env: { FIGMA_TOKEN: 'x' } });
  assert.match(out.action, /Phase 4|통합/);
});

test('suggest blocked → human intervention', () => {
  const out = suggest({ progress: load('phase3-blocked'), env: { FIGMA_TOKEN: 'x' } });
  assert.match(out.action, /수동|개입|blocked/i);
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
node --test tests/progress/next.test.mjs
```

- [ ] **Step 3: next.mjs 구현**

```javascript
#!/usr/bin/env node
import { read } from './_lib/progress-store.mjs';
import { aggregate } from './status.mjs';
import { diagnose } from './why.mjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function suggest({ progress, env = {}, cwd = process.cwd() }) {
  if (!progress) {
    return { action: 'bash scripts/bootstrap.sh <figma-url>', code: 'BOOTSTRAP', target: null };
  }
  const diag = diagnose({ progress, env, cwd });
  if (diag.code !== 'OK_PROCEED' && diag.code !== 'OK_NEXT_PHASE') {
    return { action: diag.recommendations[0] || diag.message, code: diag.code, target: null };
  }
  if (diag.code === 'OK_NEXT_PHASE') {
    return {
      action: `Phase ${progress.phase.current + 1} (통합 검증) 진입`,
      code: 'PHASE_TRANSITION',
      target: progress.phase.current + 1,
    };
  }
  // OK_PROCEED → 다음 actionable
  const status = aggregate({ progress, gitStatus: '', gateResults: {} });
  const next = status.nextActionable[0];
  if (!next) {
    return { action: 'progress-update add-section 으로 작업 단위 추가 필요', code: 'EMPTY_QUEUE', target: null };
  }
  return {
    action: `다음 작업: '${next.name}' (${next.kind}, page=${next.page || 'none'}, status=${next.status}). section-worker 스폰.`,
    code: 'WORK_NEXT',
    target: next.name,
  };
}

if (process.argv[1].endsWith('next.mjs')) {
  const cwd = process.cwd();
  const progressPath = join(cwd, 'progress.json');
  const progress = existsSync(progressPath) ? read(progressPath) : null;
  const out = suggest({ progress, env: process.env, cwd });

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`▶ ${out.action}`);
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
node --test tests/progress/next.test.mjs
```

Expected: PASS, 4 tests

- [ ] **Step 5: 커밋**

```bash
git add scripts/next.mjs tests/progress/next.test.mjs
git commit -m "feat(meta): B.3 next.mjs (다음 행동 가이드)"
```

---

### Task B.4: SKILL.md 의 PROGRESS 추론 → status/why/next 호출 치환

**Files:**
- Modify: `.claude/skills/publish-harness/SKILL.md`

- [ ] **Step 1: SKILL.md 의 phase 분기 / "PROGRESS.md 읽기" 류 instruction 을 스크립트 호출로 치환**

대상 라인 (Phase 0 컨텍스트 파악, line 26~46 부근):
- "PROGRESS.md 존재 여부" → `bash scripts/why.mjs --json | jq -r .code` 결과 확인
- "phase 단계 분기 표" → `bash scripts/status.mjs --json | jq .recommendedPhase`
- "다음 미완 섹션 식별" → `bash scripts/next.mjs --json | jq .target`

대상 라인 (Phase 3 §섹션 진행 순서, line 278~302):
- 안티-루프 가드 자연어 로직 → "why.mjs 가 ANTI_LOOP_TRIGGERED 코드 반환하면 사용자 개입" 한 줄로 정리

- [ ] **Step 2: 통합 진단 흐름 추가** (Phase 0 시작 부분)

```markdown
## Phase 0: 컨텍스트 파악 (간소화)

오케스트레이터는 첫 번째 사용자 요청 수신 후:

```bash
bash scripts/why.mjs --json
```

반환된 `code` 필드로 분기:
- `BOOTSTRAP_REQUIRED` / `FIGMA_TOKEN_MISSING` / `TOKENS_MISSING` → 사용자에게 해당 명령 안내
- `DECOMPOSE_REQUIRED` → Phase 2 진입
- `OK_PROCEED` → `bash scripts/next.mjs --json` 의 `target` 으로 section-worker 스폰
- `OK_NEXT_PHASE` → Phase 4 진입
- `ANTI_LOOP_TRIGGERED` / `SECTION_BLOCKED` → 사용자 개입 (recommendations 필드 그대로 노출)
```

- [ ] **Step 3: 잔재 검증**

```bash
grep -n "PROGRESS\.md.*읽" .claude/skills/publish-harness/SKILL.md
grep -n "PROGRESS\.md.*파싱\|파악" .claude/skills/publish-harness/SKILL.md
```

Expected: 검색 결과 없음 (모두 status/why/next 호출로 치환됨)

- [ ] **Step 4: 커밋**

```bash
git add .claude/skills/publish-harness/SKILL.md
git commit -m "refactor(skill): B.4 PROGRESS 추론 → status/why/next CLI 위임"
```

---

## Group C — doctor.sh 확장

### Task C.1: doctor.sh --json 출력 모드

**Files:**
- Modify: `scripts/doctor.sh`

- [ ] **Step 1: --json 플래그 + JSON 빌드 변수 추가**

doctor.sh 상단의 옵션 파싱에 `--json` 추가, `ok/bad/warn` 함수 안에서 결과를 JSON 누적 (bash 배열 또는 임시 파일).

```bash
JSON_MODE=0
JSON_RESULTS_FILE=$(mktemp)
trap 'rm -f $JSON_RESULTS_FILE' EXIT

# arg parse 에 추가:
--json) JSON_MODE=1 ;;

# ok/bad/warn 함수 내부에 추가:
if [ "$JSON_MODE" -eq 1 ]; then
  printf '{"key":"%s","status":"%s","value":"%s"}\n' "$1" "ok|bad|warn" "$2" >> "$JSON_RESULTS_FILE"
fi
```

마지막에 JSON_MODE=1 이면 결과 파일을 JSON 배열로 출력:

```bash
if [ "$JSON_MODE" -eq 1 ]; then
  echo "{"
  printf '  "summary": { "fail": %d, "warn": %d },\n' "$FAIL" "$WARN"
  echo '  "results": ['
  paste -sd ',' "$JSON_RESULTS_FILE"
  echo '  ]'
  echo "}"
fi
```

- [ ] **Step 2: 수동 검증**

```bash
bash scripts/doctor.sh --json --skip-figma --skip-project
```

Expected: stdout 에 `{ "summary": ..., "results": [ {...}, {...} ] }` JSON, 사람용 출력 동시 안 나옴.

(JSON 모드에서는 `ok/bad/warn` 의 ANSI 출력이 함께 나오면 안 됨 — JSON_MODE 시 사람용 print 스킵 필요)

- [ ] **Step 3: 사람용 print 스킵**

`ok/bad/warn` / `hint` / `section` 안에 `[ "$JSON_MODE" -eq 0 ]` 가드 추가.

- [ ] **Step 4: 커밋**

```bash
git add scripts/doctor.sh
git commit -m "feat(doctor): C.1 --json 출력 모드"
```

---

### Task C.2: doctor.sh 신규 체크 4종 추가

**Files:**
- Modify: `scripts/doctor.sh`

추가 체크:
1. **playwright browser** — `npx playwright --version` 으로 설치 + `~/.cache/ms-playwright` 또는 `%LOCALAPPDATA%\ms-playwright` 경로에 chromium 디렉토리 존재
2. **baseline 만료** — `baselines/*/legacy.json` 의 `expiresAt` 이 30일 이내면 warn, 만료되면 bad
3. **write-protected drift** — `scripts/write-protected-paths.json` 에 등록된 파일이 있으면 그 파일들이 존재하는지 + 마지막 수정시간이 X 이내인지
4. **anchor manifest v2** — `baselines/*/anchors-*.json` 의 `version` 필드가 v2 인지 (v1 잔재 있으면 warn)

- [ ] **Step 1: playwright browser 체크 함수 추가**

doctor.sh 의 §4 선택 도구 섹션에 추가:

```bash
# Playwright browsers
if [ -d "${HOME}/.cache/ms-playwright" ] || [ -d "${LOCALAPPDATA:-}/ms-playwright" ]; then
  ok "Playwright browsers" "설치됨 (G1 visual regression 가능)"
else
  warn "Playwright browsers" "미설치 (G1 SKIP)"
  hint "npx playwright install chromium"
fi
```

- [ ] **Step 2: baseline 만료 체크 함수 추가**

새 §6 (또는 §5 프로젝트 안에) 추가:

```bash
if [ -d baselines ] && [ "$SKIP_PROJECT" -eq 0 ]; then
  now_epoch=$(date +%s)
  expired=0
  expiring_soon=0
  for legacy in baselines/*/legacy.json; do
    [ -f "$legacy" ] || continue
    exp=$(node -e "const j=require('$legacy'); console.log(Math.floor(new Date(j.expiresAt).getTime()/1000))" 2>/dev/null || echo "0")
    diff=$((exp - now_epoch))
    if [ "$diff" -le 0 ]; then
      expired=$((expired+1))
    elif [ "$diff" -le 2592000 ]; then  # 30 days
      expiring_soon=$((expiring_soon+1))
    fi
  done
  if [ "$expired" -gt 0 ]; then
    bad "Baseline 만료" "${expired}개 이미 만료"
    hint "node scripts/migrate-baselines.mjs --renew"
  elif [ "$expiring_soon" -gt 0 ]; then
    warn "Baseline 만료" "${expiring_soon}개 30일 이내 만료 예정"
  else
    ok "Baseline 만료" "모두 유효"
  fi
fi
```

- [ ] **Step 3: write-protected drift 체크**

```bash
if [ -f scripts/write-protected-paths.json ]; then
  drift=0
  for path in $(node -e "console.log(require('./scripts/write-protected-paths.json').paths.join(' '))" 2>/dev/null); do
    [ ! -e "$path" ] && drift=$((drift+1))
  done
  if [ "$drift" -gt 0 ]; then
    warn "Write-protected paths" "${drift}개 누락 (G10 영향)"
  else
    ok "Write-protected paths" "전부 존재"
  fi
fi
```

- [ ] **Step 4: anchor manifest v2 잔재 체크**

```bash
if [ -d baselines ] && [ "$SKIP_PROJECT" -eq 0 ]; then
  v1_count=0
  for f in baselines/*/anchors-*.json; do
    [ -f "$f" ] || continue
    v=$(node -e "try{const j=require('$f');console.log(j.version||1)}catch(e){console.log(0)}" 2>/dev/null)
    [ "$v" = "1" ] && v1_count=$((v1_count+1))
  done
  if [ "$v1_count" -gt 0 ]; then
    warn "Anchor manifest" "${v1_count}개 v1 잔재 (v2 마이그레이션 권장)"
    hint "node scripts/migrate-baselines.mjs --upgrade-anchors"
  fi
fi
```

- [ ] **Step 5: 수동 smoke test**

```bash
bash scripts/doctor.sh --skip-figma
bash scripts/doctor.sh --skip-figma --json | head -30
```

Expected: 신규 4개 체크 항목 노출, JSON 모드에서도 results 배열에 포함.

- [ ] **Step 6: 커밋**

```bash
git add scripts/doctor.sh
git commit -m "feat(doctor): C.2 playwright/baseline-expiry/protected-drift/anchor-v2 체크"
```

---

## Group D — code-reviewer agent 추가

### Task D.1: code-reviewer.md agent 작성

**Files:**
- Create: `.claude/agents/code-reviewer.md`

페르소나 정의 — sp-ai-agent 의 puzzle-code-reviewer 패턴 차용. publish-harness 도메인에 맞게:
- 검사 항목: 게이트 통과 여부 / 토큰 사용 / 시맨틱 HTML / brand_guardrails 준수 / required_imports 사용 / Don't 절 위반
- 결과 형식: Critical / Important / Minor + 파일:라인

- [ ] **Step 1: agent 파일 작성**

```markdown
---
name: code-reviewer
description: 섹션/컴포넌트 구현 후 호출되는 외부 시각 리뷰어. retry_count=1 FAIL 시점에 1회 호출되어 동일 카테고리 반복 차단을 위한 구조적 피드백 제공. publish-harness 의 anti-loop guard 보조 메커니즘.
model: sonnet
---

# code-reviewer

section-worker 가 retry_count=1 FAIL 했을 때, 같은 워커가 self-review 를 반복하면 동일 카테고리 회귀가 빈발한다. 이 페르소나는 **외부 시각** 으로 한 번 검사하여 retry_count=2 호출 시 더 정확한 previous_failures 를 누적한다.

## 호출 시점

오케스트레이터가 `section-worker` 의 retry_count=1 결과를 받은 직후, retry_count=2 재스폰 직전에 1회만 호출. retry_count=0 또는 retry_count=2 시점에는 호출하지 않는다 (불필요).

## 입력 (오케스트레이터가 prompt 로 전달)

- `section_name`: 검사 대상 섹션
- `files`: 변경된 파일 경로 배열 (JSON 문자열)
- `last_failures`: section-worker 가 retry_count=1 에서 보고한 failures 배열 (JSON)
- `mode`: figma | spec
- `spec_section` (spec 모드): 컴포넌트 명세 식별자
- `brand_guardrails` (spec 모드): 금지 패턴 리스트
- `required_imports` (모드 무관): 공통 컴포넌트 사용 의무 리스트

## 검사 절차

1. **변경 파일 직접 읽기** — section-worker 보고서가 아닌 실제 파일을 Read 도구로 확인
2. **last_failures 의 카테고리별 root cause 추정** — 단순 lint 위반인지 vs 구조적 문제인지 판단
3. **추가 검사 항목** (publish-harness 도메인):
   - 토큰 외 색상 직접 기입 (`#hex`, `rgb()`)
   - 매직 px (`absolute top-[42px]` 류) — `tokens.css` 의 spacing scale 비사용
   - required_imports 명시 컴포넌트의 실제 import 여부
   - brand_guardrails 의 금지 패턴 위반
   - JSX literal text 부재 (G8 영향)
4. **drift 패턴 가설 수립** — 같은 카테고리가 retry_count=2 에서도 반복될 가능성 평가

## 반환 형식 (단일 JSON 블록)

```json
{
  "section": "Button",
  "verdict": "fail",
  "critical": [
    { "file": "src/components/ui/Button.tsx", "line": 42, "category": "TOKEN_DRIFT", "issue": "hex literal '#B84A32' 사용", "fix": "tokens.css 의 --color-accent 사용" }
  ],
  "important": [],
  "minor": [],
  "antiLoopRisk": "high",
  "recommendation": "next retry: brand_guardrails 의 토큰 매핑 표를 prompt 에 명시적으로 첨부"
}
```

`antiLoopRisk` enum: `low` (간단 수정으로 해결) | `medium` (구조 변경 필요) | `high` (재분할 권장)

## 주의사항

- 코드 직접 수정 금지 — 검사만. 수정은 retry_count=2 의 section-worker 가 수행
- 감정 표현 없이 기술적 판정만 제시
- 파일·라인 참조 누락 시 issue 항목 무효
- last_failures 와 동일한 issue 만 반복 보고하지 말 것 — 새로운 시각이 핵심 가치
```

- [ ] **Step 2: 커밋**

```bash
git add .claude/agents/code-reviewer.md
git commit -m "feat(agent): D.1 code-reviewer agent 추가 (외부 시각 retry 보조)"
```

---

### Task D.2: SKILL.md 에 code-reviewer 호출 흐름 추가

**Files:**
- Modify: `.claude/skills/publish-harness/SKILL.md`

- [ ] **Step 1: §FAIL 처리 흐름 (line 243~277 부근) 수정**

기존:
```
1. retry_count=0 FAIL → retry_count=1 자동 재스폰
2. retry_count=1 FAIL → retry_count=2 자동 재스폰
3. retry_count=2 FAIL → 사용자 개입
```

수정:
```
1. retry_count=0 FAIL → retry_count=1 자동 재스폰
2. retry_count=1 FAIL → **code-reviewer Agent 호출 (1회)**:
   - 변경 파일 + last_failures 전달
   - 반환된 critical/important 를 retry_count=2 의 previous_failures 에 추가 (구조화)
   - antiLoopRisk=high 면 model: opus 강제 승격 + 재분할 옵션 사전 노출
   - retry_count=2 자동 재스폰
3. retry_count=2 FAIL → 사용자 개입
```

- [ ] **Step 2: previous_failures 누적 규약 명시**

retry_count=2 호출 시 previous_failures 배열은:
- attempt=0 의 failures (section-worker 자체 보고)
- attempt=1 의 failures (section-worker 자체 보고)
- attempt=1.5 의 reviewer findings (code-reviewer 추가, `category` + `gate` + `file` + `line` + `message` 형식 일관)

각 항목에 `source: "worker" | "reviewer"` 필드 추가하여 워커가 출처 구분 가능.

- [ ] **Step 3: 잔재 검증**

```bash
grep -n "code-reviewer" .claude/skills/publish-harness/SKILL.md
grep -n "code-reviewer" .claude/agents/section-worker.md
```

Expected: SKILL.md 에 호출 흐름 명시, section-worker.md 에 source 필드 처리 명시.

- [ ] **Step 4: 커밋**

```bash
git add .claude/
git commit -m "refactor(skill,worker): D.2 retry_count=1 FAIL 시점 code-reviewer 1회 호출"
```

---

### Task D.3: section-worker.md 의 source=reviewer failures 처리 규약

**Files:**
- Modify: `.claude/agents/section-worker.md`

- [ ] **Step 1: §previous_failures 처리 규약에 source 필드 명시**

기존 §previous_failures 섹션 끝에 추가:

```markdown
**source 필드 (D.2 추가)**:
- `source: "worker"` — 이전 호출의 자체 보고 failure
- `source: "reviewer"` — code-reviewer agent 의 외부 시각 findings
- 두 source 가 같은 file:line 을 가리키면 reviewer 의 fix 제안을 우선
- reviewer findings 의 `antiLoopRisk` 가 `high` 인 카테고리는 retry_count=2 에서 반드시 다른 접근법 시도
```

- [ ] **Step 2: 커밋**

```bash
git add .claude/agents/section-worker.md
git commit -m "feat(worker): D.3 previous_failures source 필드 (worker | reviewer)"
```

---

## Self-Review (작성 후 한 번에)

이 plan 의 spec coverage / placeholder / type 일관성을 plan 작성 마치고 점검:

**1. Spec coverage**:
- ✅ P0 #1 progress.json — Group A 전체
- ✅ P0 #2 status/why/next — Group B
- ✅ P1 #3 doctor 확장 — Group C
- ✅ P1 #4 code-reviewer — Group D

**2. Placeholder scan**: 모든 step 에 실제 코드/명령 있는지 재확인 (특히 A.7 Step 2 의 어댑터 부분 — measure-quality 출력 schema 확인 후 결정 사항 명시되어 있어 placeholder 아님)

**3. Type consistency**:
- `progress-store.mjs` 의 `recordGateResult` signature 가 A.2/A.3/A.7 에서 동일 (`obj, name, result` with `{passed, gates, failures}`)
- `aggregate({ progress, gitStatus, gateResults })` 가 B.1/B.3 에서 동일
- `diagnose({ progress, env, cwd })` 가 B.2/B.3 에서 동일
- 모두 일관됨 ✓

---

## 작업 의존성 요약

```
A.1 → A.2 → A.3 → A.4 → A.5 → A.6 → A.7
                              ↓
                              B.1 → B.2 → B.3 → B.4
                              ↓        ↓
                              C.1 → C.2     D.1 → D.2 → D.3
```

C / D 는 A.7 완료 후 어느 시점에든 실행 가능. B 는 A 의 record-gate-result 가 작동해야 의미 있음.

총 task: 16개. 한 task = TDD cycle 1회 = 1 commit. 16 commits 예상.

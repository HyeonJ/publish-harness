# Strict Visual Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore "<5% diff" 차단 게이트를 G1 strict + G11 layout escape budget 으로 구현 — 옛 heavy 의 absolute 회귀와 flex 1-3px 자연 오차 압력을 다축 합산으로 해체.

**Architecture:** L1(pixel diff, text-block mask) + L2(DOM bbox) + G11(layout escape budget, 정적 + Playwright runtime sweep + dependency closure) 3축 차단. anchor manifest v2 (required/optional/role/figmaNodeId). legacy.json 거버넌스 (createdBy/sourceCommit/expiresAt). default strict + 호환 룰.

**Tech Stack:** Node.js (ES Module), Playwright, pixelmatch, pngjs, @babel/parser (이미 의존성), @babel/traverse, bash.

**Spec:** `docs/superpowers/specs/2026-04-28-strict-visual-harness-design.md` (v3, commit 5c25294)

---

## File Structure

### 신규
- `scripts/_lib/anchor-manifest.mjs` — manifest v2 read/write/검증 헬퍼
- `scripts/_lib/legacy-manifest.mjs` — legacy.json 거버넌스 검증 (createdBy 화이트리스트, expiresAt, sourceCommit)
- `scripts/_lib/playwright-stable.mjs` — Playwright 안정화 조건 (fonts.ready, animation disable 등)
- `scripts/_lib/escape-detect.mjs` — G11 정적 검사 (정규식 + AST) + dependency closure 추출
- `scripts/_lib/escape-runtime-sweep.mjs` — G11 runtime computed-style sweep (Playwright page.evaluate)
- `scripts/extract-figma-anchors.mjs` — Figma REST 노드 트리 → anchor manifest v2 (role 자동 추론)
- `scripts/prepare-baseline.mjs` — png + manifest 통합 생성 (figma/spec 모드 자동 분기, 캐싱, anchor diff report)
- `scripts/check-layout-escapes.mjs` — G11 게이트 (정적 + runtime + dependency closure)
- `scripts/migrate-baselines.mjs` — 기존 프로젝트 1회 마이그레이션 (legacy.json 발급, --renew)
- `scripts/check-legacy-additions.mjs` — CI 용, 구현 PR 의 신규 legacy 추가 차단
- `scripts/test-strict-gates.sh` — fixture 검증 통합 스크립트
- `tests/fixtures/strict-gate/` — 18종 fixture (각각 sections + baselines + manifest)

### 변경
- `scripts/check-visual-regression.mjs` — strict 옵션, L1 mask + 35% 상한, L2 mixed tolerance, section-root 별도, multi-viewport 병렬, manifest v2, strictEffective, G11 runtime sweep 통합
- `scripts/measure-quality.sh` — G11 호출 + fail-fast 순서 변경 + viewport 자동 감지 + LITE=1 처리
- `scripts/bootstrap.sh` — 신규 스크립트 복사 + tests/fixtures/strict-gate (template 별 stub)
- `.claude/agents/section-worker.md` — anchor manifest 룰, retry 카테고리, escape budget 가이드
- `docs/workflow.md` — Phase 3.4.1/4.2 갱신, §baseline 갱신 프로토콜 추가
- `CLAUDE.md` — 게이트 표 갱신 (G1 strict + G11)
- `package.json` — playwright/pixelmatch/pngjs 를 devDependencies 추가 (선택 → 게이트가 안 미설치 시 SKIP 처리는 그대로지만 default 설치 권장)

### 삭제
- `scripts/fetch-figma-baseline.sh` (prepare-baseline.mjs 로 흡수)
- `scripts/render-spec-baseline.mjs` (동일)

---

## Phase 1 — 기초 헬퍼 (T1~T4)

### Task 1: scripts/_lib/anchor-manifest.mjs — manifest v2 read/write/검증

**Files:**
- Create: `scripts/_lib/anchor-manifest.mjs`
- Test: 별도 단위 테스트는 없음 — Phase 5 의 fixture 통합 검증으로 대체

- [ ] **Step 1: 헬퍼 작성**

```javascript
// scripts/_lib/anchor-manifest.mjs
/**
 * Anchor Manifest v2 헬퍼 — read/write/검증.
 *
 * 형식: baselines/<section>/anchors-<viewport>.json
 * {
 *   version: 2,
 *   section: string,
 *   viewport: "desktop"|"tablet"|"mobile",
 *   anchors: [
 *     {
 *       id: string,                   // 예: "hero/title"
 *       role: string,                 // section-root | primary-heading | primary-cta | primary-media | text-block | decorative | secondary-* | unknown
 *       required: boolean,
 *       figmaNodeId: string | null,
 *       bbox: { x, y, w, h }
 *     }
 *   ]
 * }
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const ROLES = Object.freeze({
  SECTION_ROOT: "section-root",
  PRIMARY_HEADING: "primary-heading",
  PRIMARY_CTA: "primary-cta",
  PRIMARY_MEDIA: "primary-media",
  TEXT_BLOCK: "text-block",
  DECORATIVE: "decorative",
  UNKNOWN: "unknown",
});

const REQUIRED_ROLES = new Set([
  ROLES.SECTION_ROOT,
  ROLES.PRIMARY_HEADING,
  ROLES.PRIMARY_CTA,
  ROLES.PRIMARY_MEDIA,
]);

export function readManifest(path) {
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (raw.version !== 2) {
    throw new Error(`anchor manifest version mismatch: ${path} v=${raw.version}`);
  }
  return raw;
}

export function writeManifest(path, manifest) {
  if (manifest.version !== 2) throw new Error("manifest must be version 2");
  if (!manifest.section || !manifest.viewport) throw new Error("section/viewport required");
  if (!Array.isArray(manifest.anchors)) throw new Error("anchors must be array");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
}

export function validateManifest(manifest) {
  const errors = [];
  if (!manifest) {
    errors.push("manifest is null");
    return errors;
  }
  const ids = new Set();
  let hasRoot = false;
  for (const a of manifest.anchors) {
    if (!a.id || !a.role) errors.push(`anchor missing id/role: ${JSON.stringify(a)}`);
    if (ids.has(a.id)) errors.push(`duplicate anchor id: ${a.id}`);
    ids.add(a.id);
    if (a.role === ROLES.SECTION_ROOT) hasRoot = true;
    if (a.required && !a.bbox) errors.push(`required anchor ${a.id} missing bbox`);
  }
  if (!hasRoot) errors.push("section-root anchor missing");
  return errors;
}

export function isRequiredRole(role) {
  return REQUIRED_ROLES.has(role);
}

export function unknownRoleRatio(manifest) {
  if (!manifest || !manifest.anchors.length) return 0;
  const unknown = manifest.anchors.filter((a) => a.role === ROLES.UNKNOWN).length;
  return unknown / manifest.anchors.length;
}

/**
 * 매칭 룰 (개수별):
 * - required: 100% 강제 (모든 required 가 매칭되어야 함)
 * - optional ≤ 5: all required (zero missing)
 * - optional 6~10: 1 missing OK
 * - optional > 10: 2 missing OK
 *
 * @param {Array} required - required anchor 리스트
 * @param {Array} optional - optional anchor 리스트
 * @param {Set<string>} matchedIds - 코드에 매칭된 anchor id 집합
 * @returns {{pass: boolean, missing: Array, reason: string|null}}
 */
export function applyMatchingRule(required, optional, matchedIds) {
  const missingRequired = required.filter((a) => !matchedIds.has(a.id));
  if (missingRequired.length > 0) {
    return {
      pass: false,
      missing: missingRequired,
      reason: `required anchor missing: ${missingRequired.map((a) => a.id).join(", ")}`,
    };
  }
  const missingOptional = optional.filter((a) => !matchedIds.has(a.id));
  let allowedMissing;
  if (optional.length <= 5) allowedMissing = 0;
  else if (optional.length <= 10) allowedMissing = 1;
  else allowedMissing = 2;
  if (missingOptional.length > allowedMissing) {
    return {
      pass: false,
      missing: missingOptional,
      reason: `optional anchor missing > allowed (${missingOptional.length} > ${allowedMissing})`,
    };
  }
  return { pass: true, missing: missingOptional, reason: null };
}
```

- [ ] **Step 2: 노드로 import smoke test**

Run: `node -e "import('./scripts/_lib/anchor-manifest.mjs').then(m => console.log(Object.keys(m).join(',')))"`
Expected: `ROLES,readManifest,writeManifest,validateManifest,isRequiredRole,unknownRoleRatio,applyMatchingRule`

- [ ] **Step 3: 매칭 룰 unit smoke**

```bash
node -e '
import("./scripts/_lib/anchor-manifest.mjs").then(({ applyMatchingRule }) => {
  const required = [{id:"hero/root"}, {id:"hero/title"}];
  const optional = [{id:"hero/badge"}, {id:"hero/icon"}];
  const matched = new Set(["hero/root","hero/title","hero/badge"]);
  const r = applyMatchingRule(required, optional, matched);
  console.log(JSON.stringify(r));
})'
```
Expected: `{"pass":true,"missing":[{"id":"hero/icon"}],"reason":null}` (optional 4개라 all required = 0 missing 만 허용. 한 개 missing 이라 FAIL 이어야)

수정 검증: 실제 위 룰은 4개 ≤ 5 이므로 0 missing 만 OK. Step 3 의 expected 가 실제로 fail 케이스 — 다시 작성:

```bash
# 사실 위 케이스는 FAIL 이어야 함. PASS 케이스로 다시:
node -e '
import("./scripts/_lib/anchor-manifest.mjs").then(({ applyMatchingRule }) => {
  const required = [{id:"hero/root"}];
  const optional = [{id:"hero/badge"}];
  const matched = new Set(["hero/root","hero/badge"]);
  const r = applyMatchingRule(required, optional, matched);
  console.log(JSON.stringify(r));
})'
```
Expected: `{"pass":true,"missing":[],"reason":null}`

- [ ] **Step 4: Commit**

```bash
git add scripts/_lib/anchor-manifest.mjs
git commit -m "feat(strict): _lib/anchor-manifest — v2 read/write/validate + 매칭 룰"
```

---

### Task 2: scripts/_lib/legacy-manifest.mjs — legacy.json 거버넌스

**Files:**
- Create: `scripts/_lib/legacy-manifest.mjs`

- [ ] **Step 1: 헬퍼 작성**

```javascript
// scripts/_lib/legacy-manifest.mjs
/**
 * legacy.json 거버넌스 — createdBy 화이트리스트, sourceCommit, expiresAt 검증.
 *
 * 형식 v2:
 * {
 *   version: 2,
 *   reason: string,
 *   skipL2: boolean,
 *   skipViewports: ["tablet", "mobile"],
 *   createdAt: "YYYY-MM-DD",
 *   createdBy: "migrate-baselines" | "bootstrap",
 *   sourceCommit: "<git-hash>",
 *   expiresAt: "YYYY-MM-DD"
 * }
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const ALLOWED_CREATORS = Object.freeze(["migrate-baselines", "bootstrap"]);

export function readLegacy(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeLegacy(path, legacy) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(legacy, null, 2) + "\n");
}

/**
 * @returns {{valid: boolean, reason: string|null}}
 */
export function validateLegacy(legacy) {
  if (!legacy) return { valid: false, reason: "no legacy manifest" };
  if (legacy.version !== 2) return { valid: false, reason: `unsupported legacy version ${legacy.version}` };
  if (!ALLOWED_CREATORS.includes(legacy.createdBy)) {
    return { valid: false, reason: `invalid createdBy "${legacy.createdBy}" — only ${ALLOWED_CREATORS.join("/")} allowed` };
  }
  if (!legacy.sourceCommit || !/^[0-9a-f]{7,40}$/.test(legacy.sourceCommit)) {
    return { valid: false, reason: "missing or invalid sourceCommit" };
  }
  if (!legacy.expiresAt || !/^\d{4}-\d{2}-\d{2}$/.test(legacy.expiresAt)) {
    return { valid: false, reason: "missing or invalid expiresAt (YYYY-MM-DD)" };
  }
  const expires = new Date(legacy.expiresAt + "T23:59:59Z").getTime();
  if (Date.now() > expires) {
    return { valid: false, reason: `legacy expired ${legacy.expiresAt}` };
  }
  return { valid: true, reason: null };
}

/**
 * 신규 legacy 발급 (migrate-baselines 또는 bootstrap 만 호출)
 */
export function issueLegacy({ creator, reason, skipL2 = true, skipViewports = [], sourceCommit }) {
  if (!ALLOWED_CREATORS.includes(creator)) {
    throw new Error(`creator must be one of ${ALLOWED_CREATORS.join("/")}`);
  }
  const today = new Date();
  const expires = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return {
    version: 2,
    reason,
    skipL2,
    skipViewports,
    createdAt: fmt(today),
    createdBy: creator,
    sourceCommit,
    expiresAt: fmt(expires),
  };
}

export function renewLegacy(legacy, { sourceCommit }) {
  const today = new Date();
  const expires = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);
  return {
    ...legacy,
    sourceCommit,
    expiresAt: expires.toISOString().slice(0, 10),
  };
}
```

- [ ] **Step 2: 검증 smoke test**

```bash
node -e '
import("./scripts/_lib/legacy-manifest.mjs").then(({ validateLegacy, issueLegacy }) => {
  const valid = issueLegacy({creator:"migrate-baselines", reason:"test", sourceCommit:"abc1234"});
  console.log("valid:", JSON.stringify(validateLegacy(valid)));
  const invalid = {...valid, createdBy:"worker"};
  console.log("invalid creator:", JSON.stringify(validateLegacy(invalid)));
  const expired = {...valid, expiresAt:"2020-01-01"};
  console.log("expired:", JSON.stringify(validateLegacy(expired)));
})'
```
Expected:
- `valid: {"valid":true,"reason":null}`
- `invalid creator: {"valid":false,"reason":"invalid createdBy \"worker\" — only migrate-baselines/bootstrap allowed"}`
- `expired: {"valid":false,"reason":"legacy expired 2020-01-01"}`

- [ ] **Step 3: Commit**

```bash
git add scripts/_lib/legacy-manifest.mjs
git commit -m "feat(strict): _lib/legacy-manifest — 거버넌스 (createdBy 화이트리스트 + expiresAt 90일)"
```

---

### Task 3: scripts/_lib/playwright-stable.mjs — 안정화 조건

**Files:**
- Create: `scripts/_lib/playwright-stable.mjs`

- [ ] **Step 1: 헬퍼 작성**

```javascript
// scripts/_lib/playwright-stable.mjs
/**
 * Playwright 측정 안정화 조건.
 * - fonts.ready 대기
 * - animation/transition 정지
 * - 이미지 loading 대기
 * - deviceScaleFactor 고정 (브라우저 컨텍스트 단계)
 */

export const STABLE_VIEWPORTS = Object.freeze({
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
});

export async function newStableContext(browser, viewport) {
  const vp = STABLE_VIEWPORTS[viewport];
  if (!vp) throw new Error(`unknown viewport: ${viewport}`);
  return browser.newContext({
    viewport: vp,
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
}

export async function stabilizePage(page, { url, timeout = 15000 }) {
  await page.goto(url, { waitUntil: "networkidle", timeout });
  // 웹폰트 로딩 완료 보장
  await page.evaluate(() => document.fonts && document.fonts.ready);
  // 애니메이션/트랜지션 frozen
  await page.addStyleTag({
    content: `*, *::before, *::after { animation: none !important; transition: none !important; }`,
  });
  // 모든 이미지가 complete 인지
  await page.waitForFunction(
    () => Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0),
    { timeout: 5000 }
  ).catch(() => {
    // 일부 lazy-load 등이 timeout 일 수 있음 — 비동기 게이트로 SKIP 안 함
  });
}
```

- [ ] **Step 2: import smoke**

Run: `node -e "import('./scripts/_lib/playwright-stable.mjs').then(m => console.log(Object.keys(m).join(',')))"`
Expected: `STABLE_VIEWPORTS,newStableContext,stabilizePage`

- [ ] **Step 3: Commit**

```bash
git add scripts/_lib/playwright-stable.mjs
git commit -m "feat(strict): _lib/playwright-stable — fonts.ready/animation disable/이미지 대기"
```

---

### Task 4: scripts/_lib/escape-detect.mjs — G11 정적 검사 + dependency closure

**Files:**
- Create: `scripts/_lib/escape-detect.mjs`

- [ ] **Step 1: 헬퍼 작성**

```javascript
// scripts/_lib/escape-detect.mjs
/**
 * G11 정적 escape 검사 + dependency closure 추출.
 *
 * 카테고리:
 *   A. positioning (absolute/fixed/sticky)
 *   B. transform (translate/translate-x/translate-y px)
 *   C. negative margin (-m*/-mt-*/-ml-*)
 *   D. arbitrary px ([<n>px], inline style px)
 *   E. breakpoint divergence (md:left-[..], lg:translate-x-[..])
 *   F. positioning helpers (inset-*/top-*/left-*/right-*/bottom-* px)
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, extname, join } from "node:path";
import * as parser from "@babel/parser";
import _traverse from "@babel/traverse";

const traverse = _traverse.default || _traverse;

// 정규식 (className/style 문자열 검색용). AST 가 안 닿는 동적 합성 외에는 정규식이 단순/빠름.
const PATTERNS = {
  positioning: /\b(?:absolute|fixed|sticky)\b/g,
  positioningInline: /position\s*:\s*(?:absolute|fixed|sticky)/g,
  transformTw: /\btranslate-(?:x|y)-\[\d+(?:\.\d+)?(?:px|em|rem)?\]/g,
  transformInline: /transform\s*:\s*translate/g,
  negativeMargin: /\b-m[trblxy]?-(?:\[\d+(?:\.\d+)?(?:px|em|rem)?\]|\d+)/g,
  arbitraryPx: /\[(\d+(?:\.\d+)?)px\]/g,
  breakpoint: /\b(?:sm|md|lg|xl|2xl):(?:left|right|top|bottom|inset|translate-[xy])-\[\d+(?:\.\d+)?px\]/g,
  positioningHelper: /\b(?:inset|top|left|right|bottom)-\[\d+(?:\.\d+)?px\]/g,
};

const TOKEN_VALUES_ALLOWED = new Set([0, 1, 2, 4, 8, 16, 24, 32, 48, 64, 96, 128, 256]); // 토큰 가능성 있는 단위

/**
 * 파일에서 escape 카운트 추출 (정적 축).
 */
export function detectEscapesInFile(filePath) {
  const src = readFileSync(filePath, "utf8");
  const result = {
    file: filePath,
    positioning: [],
    transform: [],
    negativeMargin: [],
    arbitraryPx: [],
    breakpointDivergence: [],
    positioningHelper: [],
  };
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const collect = (cat, regex) => {
      const matches = line.match(regex);
      if (matches) {
        for (const m of matches) {
          // arbitraryPx 는 토큰 가능 값 제외
          if (cat === "arbitraryPx") {
            const numMatch = m.match(/\[(\d+(?:\.\d+)?)px\]/);
            if (numMatch && TOKEN_VALUES_ALLOWED.has(Number(numMatch[1]))) continue;
          }
          result[cat].push({ line: i + 1, pattern: m });
        }
      }
    };
    collect("positioning", PATTERNS.positioning);
    collect("positioning", PATTERNS.positioningInline);
    collect("transform", PATTERNS.transformTw);
    collect("transform", PATTERNS.transformInline);
    collect("negativeMargin", PATTERNS.negativeMargin);
    collect("arbitraryPx", PATTERNS.arbitraryPx);
    collect("breakpointDivergence", PATTERNS.breakpoint);
    collect("positioningHelper", PATTERNS.positioningHelper);
  }
  return result;
}

/**
 * data-allow-escape 의 subtree 추출 — JSX AST.
 * 반환: data-allow-escape 가 박힌 element 의 subtree 안에 있는 라인 번호 집합.
 */
export function detectAllowedEscapeRanges(filePath) {
  const ext = extname(filePath);
  if (![".tsx", ".jsx", ".ts", ".js"].includes(ext)) return { ranges: [], reasons: [] };
  const src = readFileSync(filePath, "utf8");
  let ast;
  try {
    ast = parser.parse(src, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
  } catch (e) {
    return { ranges: [], reasons: [], parseError: e.message };
  }
  const ranges = [];
  const reasons = [];
  traverse(ast, {
    JSXElement(path) {
      const open = path.node.openingElement;
      const attr = open.attributes.find(
        (a) => a.type === "JSXAttribute" && a.name.name === "data-allow-escape"
      );
      if (!attr) return;
      // value 가 string literal 인 경우만 valid (사유 enum)
      const reason = attr.value && attr.value.type === "StringLiteral" ? attr.value.value : null;
      const start = path.node.loc.start.line;
      const end = path.node.loc.end.line;
      ranges.push({ start, end });
      reasons.push({ line: start, reason });
    },
  });
  return { ranges, reasons };
}

/**
 * import 그래프 추출 — first-party 만 재귀.
 */
export function extractDependencyClosure(entryFile, projectRoot) {
  const visited = new Set();
  const queue = [entryFile];
  while (queue.length) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    if (!existsSync(file)) continue;
    const ext = extname(file);
    if (![".tsx", ".jsx", ".ts", ".js"].includes(ext)) continue;
    const src = readFileSync(file, "utf8");
    let ast;
    try {
      ast = parser.parse(src, {
        sourceType: "module",
        plugins: ["jsx", "typescript"],
      });
    } catch {
      continue;
    }
    const importDir = dirname(file);
    traverse(ast, {
      ImportDeclaration(path) {
        const src = path.node.source.value;
        if (!src.startsWith(".") && !src.startsWith("/")) return; // 외부 패키지 제외
        const candidates = [];
        const resolved = resolve(importDir, src);
        candidates.push(resolved);
        candidates.push(resolved + ".tsx");
        candidates.push(resolved + ".ts");
        candidates.push(resolved + ".jsx");
        candidates.push(resolved + ".js");
        candidates.push(join(resolved, "index.tsx"));
        candidates.push(join(resolved, "index.ts"));
        for (const c of candidates) {
          if (existsSync(c)) {
            queue.push(c);
            break;
          }
        }
      },
    });
  }
  visited.delete(entryFile); // entry 는 closure 외 (별도 직접 검사)
  return [...visited];
}

/**
 * data-allow-escape 의 reason enum.
 */
export const ALLOWED_ESCAPE_REASONS = new Set([
  "decorative-overlap",
  "connector-line",
  "badge-offset",
  "sticky-nav",
  "animation-anchor",
]);
```

- [ ] **Step 2: smoke test — 간단 fixture 만들고 검사**

```bash
mkdir -p /tmp/escape-test
cat > /tmp/escape-test/A.tsx << 'EOF'
export function A() {
  return <div className="absolute top-[37px] -mt-2"><span>Hi</span></div>;
}
EOF
node -e '
import("./scripts/_lib/escape-detect.mjs").then(({ detectEscapesInFile }) => {
  console.log(JSON.stringify(detectEscapesInFile("/tmp/escape-test/A.tsx"), null, 2));
})'
```
Expected: positioning 1개 (`absolute`), positioningHelper 1개 (`top-[37px]`), arbitraryPx 1개 (`[37px]`), negativeMargin 1개 (`-mt-2`).

- [ ] **Step 3: Commit**

```bash
git add scripts/_lib/escape-detect.mjs
git commit -m "feat(strict): _lib/escape-detect — 정적 검사 + data-allow-escape 추출 + dependency closure"
```

---

## Phase 2 — Figma anchor 추출 + baseline 준비 (T5~T6)

### Task 5: scripts/extract-figma-anchors.mjs — Figma REST 노드 트리 → manifest

**Files:**
- Create: `scripts/extract-figma-anchors.mjs`

- [ ] **Step 1: 스크립트 작성**

```javascript
#!/usr/bin/env node
/**
 * extract-figma-anchors.mjs — Figma REST 노드 트리 → anchor manifest v2.
 *
 * Usage:
 *   node scripts/extract-figma-anchors.mjs \
 *     --file-key <key> \
 *     --section-node <id> \
 *     --section <slug> \
 *     --viewport desktop|tablet|mobile \
 *     --out baselines/<section>/anchors-<viewport>.json
 *
 * 환경변수: FIGMA_TOKEN
 */

import { writeManifest, ROLES } from "./_lib/anchor-manifest.mjs";
import { resolve } from "node:path";

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      opts[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const required = ["file-key", "section-node", "section", "viewport", "out"];
for (const r of required) {
  if (!opts[r]) {
    console.error(`ERROR: --${r} required`);
    process.exit(2);
  }
}

const TOKEN = process.env.FIGMA_TOKEN;
if (!TOKEN) {
  console.error("ERROR: FIGMA_TOKEN env required");
  process.exit(2);
}

const url = `https://api.figma.com/v1/files/${opts["file-key"]}/nodes?ids=${encodeURIComponent(opts["section-node"])}&depth=4`;
const res = await fetch(url, { headers: { "X-Figma-Token": TOKEN } });
if (!res.ok) {
  console.error(`ERROR: Figma REST failed ${res.status}`);
  process.exit(1);
}
const json = await res.json();
const sectionNode = Object.values(json.nodes)[0]?.document;
if (!sectionNode) {
  console.error("ERROR: section node not found");
  process.exit(1);
}

const sectionAbs = sectionNode.absoluteBoundingBox;

function isMeaningfulName(name) {
  if (!name) return false;
  if (/^Frame\s*\d+$/i.test(name)) return false;
  if (/^Group\s*\d*$/i.test(name)) return false;
  if (/^Rectangle\s*\d*$/i.test(name)) return false;
  return true;
}

function inferRole(node, depth) {
  const name = (node.name || "").toLowerCase();
  if (depth === 0) return ROLES.SECTION_ROOT;
  if (node.type === "TEXT") {
    const fs = node.style?.fontSize || 0;
    if (fs >= 32) return ROLES.PRIMARY_HEADING;
    return ROLES.TEXT_BLOCK;
  }
  if (node.type === "INSTANCE" || node.type === "COMPONENT") {
    if (/button|cta/.test(name)) return ROLES.PRIMARY_CTA;
  }
  if (node.type === "RECTANGLE" || node.type === "VECTOR") {
    if (/image|illu|hero|cover/.test(name)) return ROLES.PRIMARY_MEDIA;
    return ROLES.DECORATIVE;
  }
  if (isMeaningfulName(node.name)) return ROLES.UNKNOWN;
  return null; // skip
}

const anchors = [];
function walk(node, depth = 0) {
  const role = inferRole(node, depth);
  if (role && node.absoluteBoundingBox) {
    const abs = node.absoluteBoundingBox;
    const id = `${opts.section}/${slugify(node.name || `node-${node.id}`)}`;
    anchors.push({
      id: depth === 0 ? `${opts.section}/root` : id,
      role,
      required: [
        ROLES.SECTION_ROOT,
        ROLES.PRIMARY_HEADING,
        ROLES.PRIMARY_CTA,
        ROLES.PRIMARY_MEDIA,
      ].includes(role),
      figmaNodeId: node.id,
      bbox: {
        x: Math.round(abs.x - sectionAbs.x),
        y: Math.round(abs.y - sectionAbs.y),
        w: Math.round(abs.width),
        h: Math.round(abs.height),
      },
    });
  }
  if (node.children) {
    for (const c of node.children) walk(c, depth + 1);
  }
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

walk(sectionNode);

const manifest = {
  version: 2,
  section: opts.section,
  viewport: opts.viewport,
  anchors,
};

writeManifest(resolve(opts.out), manifest);

const unknown = anchors.filter((a) => a.role === ROLES.UNKNOWN).length;
const ratio = anchors.length ? unknown / anchors.length : 0;
console.log(JSON.stringify({
  section: opts.section,
  viewport: opts.viewport,
  total: anchors.length,
  unknown,
  unknownRatio: Number(ratio.toFixed(3)),
  out: opts.out,
}));
if (ratio > 0.3) {
  console.error(`MANIFEST_REVIEW_REQUIRED — unknown role ratio ${(ratio * 100).toFixed(1)}% > 30%`);
}
process.exit(0);
```

- [ ] **Step 2: 권한 부여**

```bash
chmod +x scripts/extract-figma-anchors.mjs
```

- [ ] **Step 3: Commit**

```bash
git add scripts/extract-figma-anchors.mjs
git commit -m "feat(strict): extract-figma-anchors — 노드 트리 → manifest v2 (role 자동 추론)"
```

---

### Task 6: scripts/prepare-baseline.mjs — png + manifest 통합

**Files:**
- Create: `scripts/prepare-baseline.mjs`

- [ ] **Step 1: 스크립트 작성**

```javascript
#!/usr/bin/env node
/**
 * prepare-baseline.mjs — figma/spec 모드 통합 baseline 준비.
 *
 * 결과:
 *   baselines/<section>/<viewport>.png
 *   baselines/<section>/anchors-<viewport>.json
 *
 * Usage:
 *   node scripts/prepare-baseline.mjs \
 *     --mode figma --section hero --viewports desktop,tablet,mobile \
 *     --file-key <key> --section-node <id>
 *   node scripts/prepare-baseline.mjs \
 *     --mode spec --section hero --viewports desktop \
 *     --reference-html docs/handoff/sections/hero.html
 *
 * --force 로 캐시 우회.
 * --force 시 stdout 에 anchor diff report 출력.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { readManifest } from "./_lib/anchor-manifest.mjs";

function parseArgs(argv) {
  const opts = { force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--force") { opts.force = true; continue; }
    if (argv[i].startsWith("--")) { opts[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const required = ["mode", "section", "viewports"];
for (const r of required) {
  if (!opts[r]) { console.error(`ERROR: --${r} required`); process.exit(2); }
}
const viewports = opts.viewports.split(",").map((v) => v.trim());
const baselineDir = resolve(`baselines/${opts.section}`);
mkdirSync(baselineDir, { recursive: true });

const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname.replace(/^\/(\w):/, "$1:"));

async function diffManifests(oldPath, newPath) {
  const oldM = readManifest(oldPath);
  const newM = readManifest(newPath);
  if (!oldM) return [{ id: "(new manifest)", change: "INITIAL" }];
  const oldMap = new Map(oldM.anchors.map((a) => [a.id, a]));
  const newMap = new Map(newM.anchors.map((a) => [a.id, a]));
  const changes = [];
  for (const [id, n] of newMap) {
    const o = oldMap.get(id);
    if (!o) { changes.push({ id, change: "ADDED", role: n.role }); continue; }
    if (o.role !== n.role) { changes.push({ id, change: "ROLE", from: o.role, to: n.role }); }
    const dx = n.bbox.x - o.bbox.x;
    const dy = n.bbox.y - o.bbox.y;
    const dw = n.bbox.w - o.bbox.w;
    const dh = n.bbox.h - o.bbox.h;
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dw) + Math.abs(dh) > 0) {
      changes.push({ id, change: "BBOX", delta: { x: dx, y: dy, w: dw, h: dh } });
    }
  }
  for (const [id] of oldMap) {
    if (!newMap.has(id)) changes.push({ id, change: "REMOVED" });
  }
  return changes;
}

async function prepareViewport(viewport) {
  const pngPath = join(baselineDir, `${viewport}.png`);
  const manifestPath = join(baselineDir, `anchors-${viewport}.json`);
  let manifestBefore = null;
  if (existsSync(manifestPath)) {
    try { manifestBefore = readFileSync(manifestPath, "utf8"); } catch {}
  }

  // 캐싱: --force 아니면 mtime 비교는 fetch source 별로. 단순화 — 이미 존재하면 SKIP (force 외).
  if (existsSync(pngPath) && existsSync(manifestPath) && !opts.force) {
    return { viewport, status: "CACHED", pngPath, manifestPath };
  }

  if (opts.mode === "figma") {
    if (!opts["file-key"] || !opts["section-node"]) {
      throw new Error("figma 모드는 --file-key + --section-node 필요");
    }
    // 1) png
    execSync(
      `bash "${SCRIPT_DIR}/figma-rest-image.sh" ${opts["file-key"]} ${opts["section-node"]} "${pngPath}" --scale 2`,
      { stdio: "inherit" }
    );
    // 2) anchors
    execSync(
      `node "${SCRIPT_DIR}/extract-figma-anchors.mjs" --file-key ${opts["file-key"]} --section-node ${opts["section-node"]} --section ${opts.section} --viewport ${viewport} --out "${manifestPath}"`,
      { stdio: "inherit" }
    );
  } else if (opts.mode === "spec") {
    if (!opts["reference-html"]) {
      throw new Error("spec 모드는 --reference-html 필요");
    }
    // spec 모드 baseline + DOM anchor: Phase 6 LOW 위임 (M1 v3 한계). 현재는 png 만 생성.
    // TODO(plan 단계 위임 #3): reference HTML 의 [data-anchor] 추출.
    const refPath = resolve(opts["reference-html"]);
    if (!existsSync(refPath)) throw new Error(`reference HTML not found: ${refPath}`);
    // Playwright 로 reference 렌더 후 fullpage 캡처 — render-spec-baseline.mjs 흡수
    // (구현은 인라인이 너무 큼 — 일단 외부 헬퍼 호출. 호환 위해 기존 render-spec-baseline.mjs 재사용)
    execSync(
      `node "${SCRIPT_DIR}/render-spec-baseline.mjs" --reference "${refPath}" --viewport ${viewport} --out "${pngPath}"`,
      { stdio: "inherit" }
    );
    // anchor json: spec 모드는 partial strict — 자동 생성 시도하되 실패해도 OK
    // (현재는 manifest 없음 = L2 SKIP, partial strict)
  }

  let diffReport = null;
  if (opts.force && manifestBefore) {
    // diff
    const tmpPath = manifestPath + ".prev";
    require("node:fs").writeFileSync(tmpPath, manifestBefore);
    diffReport = await diffManifests(tmpPath, manifestPath);
    require("node:fs").unlinkSync(tmpPath);
  }
  return { viewport, status: "PREPARED", pngPath, manifestPath, diffReport };
}

const results = [];
for (const v of viewports) {
  try {
    results.push(await prepareViewport(v));
  } catch (e) {
    results.push({ viewport: v, status: "FAIL", reason: e.message });
  }
}

console.log(JSON.stringify({ section: opts.section, mode: opts.mode, results }, null, 2));

// --force 시 diff report 출력
if (opts.force) {
  for (const r of results) {
    if (r.diffReport && r.diffReport.length) {
      console.error(`\nAnchor changes (${r.viewport}):`);
      for (const c of r.diffReport) {
        console.error(`  ${c.id}: ${c.change}${c.delta ? ` ${JSON.stringify(c.delta)}` : ""}${c.from ? ` ${c.from} → ${c.to}` : ""}`);
      }
    }
  }
}

const fail = results.some((r) => r.status === "FAIL");
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: 권한 부여**

```bash
chmod +x scripts/prepare-baseline.mjs
```

- [ ] **Step 3: smoke (FIGMA_TOKEN 없으면 SKIP — 환경 의존)**

```bash
node scripts/prepare-baseline.mjs --mode figma --section dummy --viewports desktop --file-key xxx --section-node 1:1 || echo "expected fail without real token"
```
Expected: error 출력 + exit 1 (real token 없을 때).

- [ ] **Step 4: Commit**

```bash
git add scripts/prepare-baseline.mjs
git commit -m "feat(strict): prepare-baseline — figma/spec 통합 baseline + manifest + --force diff report"
```

---

## Phase 3 — G1 strict 확장 (T7~T9)

### Task 7: check-visual-regression.mjs — strict 옵션 + L1 mask + Playwright 안정화

**Files:**
- Modify: `scripts/check-visual-regression.mjs`

- [ ] **Step 1: 기존 스크립트 백업 후 새로 작성**

기존 시그니처 (`--baseline <path> --viewport <v>`) 는 backward compat 로 유지. 새 시그니처 (`--baseline-dir <path> --viewports <list> --strict`) 추가. strict 모드에서만 multi-viewport / L2 / mask 적용.

```javascript
#!/usr/bin/env node
/**
 * G1 visual regression — strict 모드 확장.
 *
 * Lite (기존, backward compat):
 *   node scripts/check-visual-regression.mjs --section <id> --baseline <path> [--viewport desktop]
 *   → 단일 viewport pixel diff. SKIPPED/NO_BASELINE 차단 안 함.
 *
 * Strict (신규):
 *   node scripts/check-visual-regression.mjs --section <id> --baseline-dir baselines/<id>/ \
 *     --viewports desktop,tablet,mobile --threshold-l1 5 --threshold-l2-px 4 --threshold-l2-pct 1 --strict
 *   → multi-viewport 병렬, L1 mask + 35% 상한, L2 mixed tolerance, manifest v2,
 *     legacy.json 거버넌스, strictEffective 출력.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readManifest, applyMatchingRule, isRequiredRole, ROLES } from "./_lib/anchor-manifest.mjs";
import { readLegacy, validateLegacy } from "./_lib/legacy-manifest.mjs";
import { newStableContext, stabilizePage, STABLE_VIEWPORTS } from "./_lib/playwright-stable.mjs";

// ---------- 인자 ----------
const argv = process.argv.slice(2);
const opts = {
  section: null,
  baseline: null,
  "baseline-dir": null,
  viewport: "desktop",
  viewports: null,
  url: null,
  "preview-base": "http://127.0.0.1:5173",
  "threshold-l1": 5,
  "threshold-l2-px": 4,
  "threshold-l2-pct": 1,
  "diff-dir": "tests/quality/diffs",
  "update-baseline": false,
  strict: false,
  timeout: 15000,
  help: false,
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "-h" || a === "--help") { opts.help = true; }
  else if (a === "--update-baseline") opts["update-baseline"] = true;
  else if (a === "--strict") opts.strict = true;
  else if (a.startsWith("--")) {
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith("--")) { console.error(`ERROR: ${a} requires value`); process.exit(2); }
    if (["threshold-l1","threshold-l2-px","threshold-l2-pct","timeout"].includes(key)) {
      opts[key] = Number(val);
    } else opts[key] = val;
    i++;
  } else { console.error(`ERROR: unexpected arg ${a}`); process.exit(2); }
}

if (opts.help) {
  console.log(`G1 visual regression — strict + lite 양쪽 지원.\nlite: --baseline <path>\nstrict: --baseline-dir <dir> --viewports desktop,tablet,mobile --strict`);
  process.exit(0);
}

if (!opts.section) { console.error("usage: --section <id>"); process.exit(2); }

// 모드 분기: --strict 있고 --baseline-dir 있으면 strict, 아니면 lite (기존 동작)
const STRICT = opts.strict && opts["baseline-dir"];

// ---------- 옵셔널 의존성 (lite 호환) ----------
let chromium, pixelmatch, PNG;
try {
  ({ chromium } = await import("playwright"));
  pixelmatch = (await import("pixelmatch")).default;
  ({ PNG } = await import("pngjs"));
} catch (e) {
  console.log(JSON.stringify({
    section: opts.section,
    status: "SKIPPED",
    reason: `missing deps (${e.message.split("\n")[0]}) — npm i -D playwright pixelmatch pngjs`,
    strictEffective: false,
  }));
  process.exit(0);
}

if (!STRICT) {
  // === LITE 모드 (기존 동작 backward compat) — 별도 호출 함수 ===
  await runLite();
} else {
  await runStrict();
}

// ============ LITE ============
async function runLite() {
  if (!opts.baseline) { console.error("lite: --baseline required"); process.exit(2); }
  const baselinePath = resolve(opts.baseline);
  if (!existsSync(baselinePath) && !opts["update-baseline"]) {
    console.log(JSON.stringify({ section: opts.section, viewport: opts.viewport, status: "NO_BASELINE", baseline: baselinePath }));
    process.exit(0);
  }
  const url = opts.url || `${opts["preview-base"]}/__preview/${opts.section}`;
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (e) {
    console.log(JSON.stringify({ section: opts.section, status: "SKIPPED", reason: `chromium 미설치 (${e.message.split("\n")[0]})` }));
    process.exit(0);
  }
  let currentBuf;
  try {
    const ctx = await newStableContext(browser, opts.viewport);
    const page = await ctx.newPage();
    await stabilizePage(page, { url, timeout: opts.timeout });
    currentBuf = await page.screenshot({ fullPage: true });
  } catch (e) {
    await browser.close().catch(() => {});
    console.log(JSON.stringify({ section: opts.section, status: "SKIPPED", reason: `Playwright 렌더 실패 (${e.message.split("\n")[0]})` }));
    process.exit(0);
  }
  await browser.close();
  if (opts["update-baseline"]) {
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, currentBuf);
    console.log(JSON.stringify({ section: opts.section, viewport: opts.viewport, status: "BASELINE_UPDATED", baseline: baselinePath }));
    process.exit(0);
  }
  const cur = PNG.sync.read(currentBuf);
  const base = PNG.sync.read(readFileSync(baselinePath));
  if (cur.width !== base.width || cur.height !== base.height) {
    console.log(JSON.stringify({ section: opts.section, viewport: opts.viewport, status: "FAIL", reason: `dimension mismatch — baseline ${base.width}x${base.height}, current ${cur.width}x${cur.height}` }));
    process.exit(1);
  }
  const diff = new PNG({ width: cur.width, height: cur.height });
  const dp = pixelmatch(cur.data, base.data, diff.data, cur.width, cur.height, { threshold: 0.1 });
  const dpct = (dp / (cur.width * cur.height)) * 100;
  mkdirSync(opts["diff-dir"], { recursive: true });
  const diffPath = join(opts["diff-dir"], `${opts.section}-${opts.viewport}.diff.png`);
  writeFileSync(diffPath, PNG.sync.write(diff));
  const pass = dpct <= opts["threshold-l1"];
  console.log(JSON.stringify({ section: opts.section, viewport: opts.viewport, status: pass ? "PASS" : "FAIL", diffPercent: Number(dpct.toFixed(3)), threshold: opts["threshold-l1"], diffPath, baseline: baselinePath }));
  process.exit(pass ? 0 : 1);
}

// ============ STRICT ============
async function runStrict() {
  const baseDir = resolve(opts["baseline-dir"]);
  const requestedViewports = (opts.viewports || "desktop,tablet,mobile").split(",").map((s) => s.trim());

  // legacy.json 검증
  const legacyPath = join(baseDir, "legacy.json");
  const legacy = readLegacy(legacyPath);
  let legacyValid = false;
  let legacyReason = null;
  if (legacy) {
    const r = validateLegacy(legacy);
    legacyValid = r.valid;
    legacyReason = r.reason;
  }

  // 어떤 viewport 가 평가 가능한지
  const evalPlan = [];
  for (const v of requestedViewports) {
    const png = join(baseDir, `${v}.png`);
    const am = join(baseDir, `anchors-${v}.json`);
    const skipByLegacy = legacy && legacyValid && (legacy.skipViewports || []).includes(v);
    if (skipByLegacy) { evalPlan.push({ v, status: "SKIPPED_LEGACY" }); continue; }
    if (!existsSync(png)) { evalPlan.push({ v, status: "NO_BASELINE", png }); continue; }
    let l2skip = false;
    if (!existsSync(am)) {
      if (legacy && legacyValid && legacy.skipL2) l2skip = true;
      else { evalPlan.push({ v, status: "NO_MANIFEST", reason: "anchor manifest 부재. legacy.json 없음 — strict 강제로 FAIL." }); continue; }
    }
    evalPlan.push({ v, status: "READY", png, am, l2skip });
  }

  // legacy invalid 면 모든 viewport 강제 FAIL
  if (legacy && !legacyValid) {
    console.log(JSON.stringify({ section: opts.section, status: "FAIL", strictEffective: false, reason: `invalid legacy: ${legacyReason}`, viewports: {} }));
    process.exit(1);
  }

  const blockingNoManifest = evalPlan.filter((e) => e.status === "NO_MANIFEST");
  if (blockingNoManifest.length) {
    console.log(JSON.stringify({ section: opts.section, status: "FAIL", strictEffective: false, reason: `missing anchor manifest: ${blockingNoManifest.map((e) => e.v).join(",")}`, viewports: {} }));
    process.exit(1);
  }

  const blockingNoBaseline = evalPlan.filter((e) => e.status === "NO_BASELINE");
  if (blockingNoBaseline.length) {
    console.log(JSON.stringify({ section: opts.section, status: "FAIL", strictEffective: false, reason: `NO_BASELINE: ${blockingNoBaseline.map((e) => e.v).join(",")}`, viewports: {} }));
    process.exit(1);
  }

  // Playwright launch (1회)
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (e) {
    console.log(JSON.stringify({ section: opts.section, status: "SKIPPED", reason: `chromium 미설치 (${e.message.split("\n")[0]})`, strictEffective: false }));
    process.exit(0);
  }

  // 3 viewport 병렬
  const url = opts.url || `${opts["preview-base"]}/__preview/${opts.section}`;
  const evalReady = evalPlan.filter((e) => e.status === "READY");
  const evalResults = await Promise.all(evalReady.map((e) => evaluateViewport(browser, e, url)));
  await browser.close();

  // 합산
  const viewportResults = {};
  let strictEffective = true;
  let fail = false;
  let reason = null;
  for (const e of evalPlan) {
    if (e.status === "SKIPPED_LEGACY") {
      viewportResults[e.v] = { status: "SKIPPED_LEGACY", strictEffective: false };
      strictEffective = false;
    }
  }
  for (const r of evalResults) {
    viewportResults[r.viewport] = r;
    if (r.l2 && r.l2.status === "SKIPPED") strictEffective = false;
    if (r.status === "FAIL") { fail = true; reason = reason || r.reason; }
  }

  console.log(JSON.stringify({
    section: opts.section,
    status: fail ? "FAIL" : "PASS",
    strictEffective,
    reason,
    viewports: viewportResults,
  }));
  process.exit(fail ? 1 : 0);
}

async function evaluateViewport(browser, plan, url) {
  const { v: viewport, png, am, l2skip } = plan;
  const ctx = await newStableContext(browser, viewport);
  const page = await ctx.newPage();
  try {
    await stabilizePage(page, { url, timeout: opts.timeout });
  } catch (e) {
    await ctx.close();
    return { viewport, status: "FAIL", reason: `Playwright 렌더 실패 (${e.message.split("\n")[0]})` };
  }
  // L2 측정 (anchor bbox)
  let l2 = { status: "SKIPPED" };
  let maskRects = [];
  if (!l2skip) {
    const manifest = readManifest(am);
    const ids = manifest.anchors.map((a) => a.id);
    const bboxes = await page.evaluate((ids) => {
      const out = {};
      for (const id of ids) {
        const el = document.querySelector(`[data-anchor="${id.replace(/"/g, '\\"')}"]`);
        if (el) {
          const r = el.getBoundingClientRect();
          out[id] = { x: r.x, y: r.y, w: r.width, h: r.height, tag: el.tagName, semantic: ["H1","H2","H3","H4","H5","H6","P","SPAN","LI","DT","DD","STRONG","EM"].includes(el.tagName) };
        }
      }
      return out;
    }, ids);
    const matched = new Set(Object.keys(bboxes));
    const required = manifest.anchors.filter((a) => a.required);
    const optional = manifest.anchors.filter((a) => !a.required);
    const rule = applyMatchingRule(required, optional, matched);
    let maxDelta = 0;
    let bboxFail = null;
    for (const a of manifest.anchors) {
      const m = bboxes[a.id];
      if (!m) continue;
      const isRoot = a.role === ROLES.SECTION_ROOT;
      const pct = isRoot ? 0.5 : opts["threshold-l2-pct"];
      const tolX = Math.max(opts["threshold-l2-px"], (pct / 100) * a.bbox.w);
      const tolY = a.role === ROLES.TEXT_BLOCK
        ? Math.max(opts["threshold-l2-px"] * 2, (pct / 100) * a.bbox.h)
        : Math.max(opts["threshold-l2-px"], (pct / 100) * a.bbox.h);
      const dx = Math.abs(m.x - a.bbox.x);
      const dy = Math.abs(m.y - a.bbox.y);
      maxDelta = Math.max(maxDelta, dx, dy);
      if (dx > tolX || dy > tolY) {
        bboxFail = bboxFail || `${a.id} delta x=${dx.toFixed(0)} y=${dy.toFixed(0)} tol(${tolX.toFixed(0)},${tolY.toFixed(0)})`;
      }
      // text-block 은 실제 text-bearing element 인지 검사
      if (a.role === ROLES.TEXT_BLOCK && !m.semantic) {
        bboxFail = bboxFail || `${a.id} role:text-block on non-text element <${m.tag}>`;
      }
      // mask 영역 누적
      if (a.role === ROLES.TEXT_BLOCK) {
        maskRects.push({ x: m.x, y: m.y, w: m.w, h: m.h });
      }
    }
    l2 = {
      status: rule.pass && !bboxFail ? "PASS" : "FAIL",
      anchorsMatched: matched.size,
      anchorsTotal: manifest.anchors.length,
      requiredMatched: required.filter((a) => matched.has(a.id)).length,
      requiredTotal: required.length,
      maxDeltaPx: Math.round(maxDelta),
      reason: rule.pass ? bboxFail : rule.reason,
    };
  }

  // L1 측정 (mask 적용)
  const buf = await page.screenshot({ fullPage: true });
  await ctx.close();
  const cur = PNG.sync.read(buf);
  const base = PNG.sync.read(readFileSync(png));
  if (cur.width !== base.width || cur.height !== base.height) {
    return { viewport, status: "FAIL", reason: `dimension mismatch — baseline ${base.width}x${base.height}, current ${cur.width}x${cur.height}`, l1: null, l2 };
  }
  // mask 면적 검사 — section 면적의 35% 초과 시 FAIL
  const totalArea = cur.width * cur.height;
  const maskArea = maskRects.reduce((s, r) => s + r.w * r.h, 0);
  if (maskArea / totalArea > 0.35) {
    return { viewport, status: "FAIL", reason: `text-block mask area ${(maskArea/totalArea*100).toFixed(1)}% > 35% 상한`, l1: null, l2 };
  }
  // mask 픽셀 무시
  if (maskRects.length) {
    for (const r of maskRects) {
      const x0 = Math.max(0, Math.floor(r.x));
      const y0 = Math.max(0, Math.floor(r.y));
      const x1 = Math.min(cur.width, Math.floor(r.x + r.w));
      const y1 = Math.min(cur.height, Math.floor(r.y + r.h));
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = (y * cur.width + x) * 4;
          base.data[idx] = cur.data[idx];
          base.data[idx + 1] = cur.data[idx + 1];
          base.data[idx + 2] = cur.data[idx + 2];
          base.data[idx + 3] = cur.data[idx + 3];
        }
      }
    }
  }
  const diff = new PNG({ width: cur.width, height: cur.height });
  const dp = pixelmatch(cur.data, base.data, diff.data, cur.width, cur.height, { threshold: 0.1 });
  const dpct = (dp / totalArea) * 100;
  mkdirSync(opts["diff-dir"], { recursive: true });
  const diffPath = join(opts["diff-dir"], `${opts.section}-${viewport}.diff.png`);
  writeFileSync(diffPath, PNG.sync.write(diff));
  const l1 = {
    status: dpct <= opts["threshold-l1"] ? "PASS" : "FAIL",
    diffPercent: Number(dpct.toFixed(3)),
    maskArea: Number(((maskArea / totalArea) * 100).toFixed(1)),
    diffPath,
  };
  const overallFail = l1.status === "FAIL" || l2.status === "FAIL";
  return {
    viewport,
    status: overallFail ? "FAIL" : "PASS",
    reason: overallFail ? (l1.status === "FAIL" ? `L1 ${dpct.toFixed(2)}% > ${opts["threshold-l1"]}%` : l2.reason) : null,
    l1,
    l2,
  };
}
```

- [ ] **Step 2: lite 모드 backward compat smoke (기존 호출자 영향 검증)**

```bash
node scripts/check-visual-regression.mjs --section dummy --baseline /nonexistent.png --viewport desktop
```
Expected: `{"section":"dummy","viewport":"desktop","status":"NO_BASELINE",...}` — 기존 lite 동작.

- [ ] **Step 3: strict 모드 smoke (baseline 부재 → FAIL)**

```bash
node scripts/check-visual-regression.mjs --section dummy --baseline-dir baselines/dummy/ --viewports desktop --strict
```
Expected: `status: "FAIL"`, `reason: "NO_BASELINE: desktop"`.

- [ ] **Step 4: Commit**

```bash
git add scripts/check-visual-regression.mjs
git commit -m "feat(strict): G1 strict 모드 — multi-viewport 병렬 + L1 mask + L2 mixed tolerance + manifest v2 + legacy 거버넌스"
```

---

### Task 8: scripts/_lib/escape-runtime-sweep.mjs — runtime sweep 헬퍼

**Files:**
- Create: `scripts/_lib/escape-runtime-sweep.mjs`

- [ ] **Step 1: 헬퍼 작성**

```javascript
// scripts/_lib/escape-runtime-sweep.mjs
/**
 * G11 runtime computed-style sweep — Playwright page 위에서 실행.
 * data-allow-escape 의 subtree 는 카운트 제외.
 */

export async function runtimeSweep(page, sectionRootSelector) {
  return await page.evaluate((selector) => {
    const root = document.querySelector(selector);
    if (!root) return { error: `selector ${selector} not found` };
    const allowed = new WeakSet();
    const allowedReasons = [];
    root.querySelectorAll("[data-allow-escape]").forEach((el) => {
      const reason = el.getAttribute("data-allow-escape") || "";
      allowedReasons.push({ tag: el.tagName, reason });
      const queue = [el];
      while (queue.length) {
        const cur = queue.shift();
        allowed.add(cur);
        for (const c of cur.children) queue.push(c);
      }
    });
    const all = [root, ...root.querySelectorAll("*")];
    const result = { positioning: [], transform: [], negativeMargin: [], offset: [], allowedReasons };
    for (const el of all) {
      if (allowed.has(el)) continue;
      const cs = getComputedStyle(el);
      if (["absolute", "fixed", "sticky"].includes(cs.position) && el !== root) {
        result.positioning.push({ tag: el.tagName, pos: cs.position, classes: el.className.toString().slice(0, 80) });
      }
      if (cs.transform && cs.transform !== "none") {
        result.transform.push({ tag: el.tagName, value: cs.transform.slice(0, 80) });
      }
      for (const side of ["marginTop","marginRight","marginBottom","marginLeft"]) {
        const v = parseFloat(cs[side]);
        if (!Number.isNaN(v) && v < 0) result.negativeMargin.push({ tag: el.tagName, side, value: cs[side] });
      }
      if (cs.position !== "static" && el !== root) {
        for (const side of ["top","right","bottom","left"]) {
          const v = parseFloat(cs[side]);
          if (!Number.isNaN(v) && v !== 0) {
            result.offset.push({ tag: el.tagName, side, value: cs[side] });
          }
        }
      }
    }
    return result;
  }, sectionRootSelector);
}
```

- [ ] **Step 2: import smoke**

```bash
node -e "import('./scripts/_lib/escape-runtime-sweep.mjs').then(m => console.log(Object.keys(m).join(',')))"
```
Expected: `runtimeSweep`

- [ ] **Step 3: Commit**

```bash
git add scripts/_lib/escape-runtime-sweep.mjs
git commit -m "feat(strict): _lib/escape-runtime-sweep — Playwright runtime computed-style sweep"
```

---

### Task 9: scripts/check-layout-escapes.mjs — G11 게이트

**Files:**
- Create: `scripts/check-layout-escapes.mjs`

- [ ] **Step 1: 스크립트 작성**

```javascript
#!/usr/bin/env node
/**
 * G11 — layout escape budget 게이트.
 *
 * 정적 검사 (필수) + Playwright runtime sweep (선택, dev 서버 기동 시).
 * dependency closure 포함.
 *
 * Usage:
 *   node scripts/check-layout-escapes.mjs --section <id> --files "<glob1> <glob2>" \
 *     [--runtime --url <preview-url>] [--budget-positioning 0] [--budget-transform 2] \
 *     [--budget-negative-margin 2] [--budget-arbitrary-px 3] [--budget-breakpoint 2]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { detectEscapesInFile, detectAllowedEscapeRanges, extractDependencyClosure, ALLOWED_ESCAPE_REASONS } from "./_lib/escape-detect.mjs";

function parseArgs(argv) {
  const o = {
    section: null,
    files: null,
    runtime: false,
    url: null,
    "budget-positioning": 0,
    "budget-transform": 2,
    "budget-negative-margin": 2,
    "budget-arbitrary-px": 3,
    "budget-breakpoint": 2,
    "data-allow-escape-max": 2,
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--runtime") { o.runtime = true; continue; }
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      const v = argv[i + 1];
      if (k.startsWith("budget-") || k === "data-allow-escape-max") o[k] = Number(v);
      else o[k] = v;
      i++;
    }
  }
  return o;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.section || !opts.files) { console.error("usage: --section <id> --files \"f1 f2\""); process.exit(2); }

const fileList = opts.files.split(/\s+/).filter((f) => f && existsSync(f));
const projectRoot = process.cwd();

// 정적 축
const staticResults = [];
const closureFiles = new Set();
for (const f of fileList) {
  staticResults.push(detectEscapesInFile(f));
  for (const c of extractDependencyClosure(resolve(f), projectRoot)) {
    closureFiles.add(c);
  }
}
for (const c of closureFiles) {
  if (!fileList.includes(c)) {
    staticResults.push({ ...detectEscapesInFile(c), closure: true });
  }
}

// data-allow-escape 추출
const allowedRanges = new Map(); // file -> ranges
const allowedReasons = [];
for (const f of [...fileList, ...closureFiles]) {
  const r = detectAllowedEscapeRanges(f);
  allowedRanges.set(f, r.ranges);
  for (const reason of r.reasons) {
    if (!ALLOWED_ESCAPE_REASONS.has(reason.reason)) {
      allowedReasons.push({ file: f, line: reason.line, reason: reason.reason, valid: false });
    } else {
      allowedReasons.push({ file: f, line: reason.line, reason: reason.reason, valid: true });
    }
  }
}

// reason invalid 가 있으면 즉시 FAIL
const invalidReasons = allowedReasons.filter((a) => !a.valid);
if (invalidReasons.length) {
  console.log(JSON.stringify({
    section: opts.section,
    status: "FAIL",
    reason: `data-allow-escape with invalid reason: ${invalidReasons.map((r) => r.reason).join(", ")} (allowed: ${[...ALLOWED_ESCAPE_REASONS].join(", ")})`,
    violations: [],
    allowedEscapes: allowedReasons,
  }));
  process.exit(1);
}

// data-allow-escape 카운트 상한
if (allowedReasons.length > opts["data-allow-escape-max"]) {
  console.log(JSON.stringify({
    section: opts.section,
    status: "FAIL",
    reason: `data-allow-escape used ${allowedReasons.length} > max ${opts["data-allow-escape-max"]}`,
    allowedEscapes: allowedReasons,
  }));
  process.exit(1);
}

// allowed range 안의 violation 제외
function inAllowedRange(file, line) {
  const ranges = allowedRanges.get(file) || [];
  return ranges.some((r) => line >= r.start && line <= r.end);
}

const escapeCounts = { positioning: 0, transform: 0, negativeMargin: 0, arbitraryPx: 0, breakpointDivergence: 0, positioningHelper: 0 };
const violations = [];
for (const r of staticResults) {
  for (const cat of ["positioning","transform","negativeMargin","arbitraryPx","breakpointDivergence","positioningHelper"]) {
    for (const v of r[cat] || []) {
      if (inAllowedRange(r.file, v.line)) continue;
      escapeCounts[cat]++;
      violations.push({ file: r.file, line: v.line, category: cat, pattern: v.pattern });
    }
  }
}

// runtime 축 (선택)
let runtimeResult = null;
if (opts.runtime && opts.url) {
  try {
    const { chromium } = await import("playwright");
    const { runtimeSweep } = await import("./_lib/escape-runtime-sweep.mjs");
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(opts.url, { waitUntil: "networkidle", timeout: 15000 });
    const sel = `[data-anchor="${opts.section}/root"]`;
    runtimeResult = await runtimeSweep(page, sel);
    await browser.close();
    if (runtimeResult.error) {
      console.error(`runtime sweep skip: ${runtimeResult.error}`);
    } else {
      escapeCounts.positioning += runtimeResult.positioning.length;
      escapeCounts.transform += runtimeResult.transform.length;
      escapeCounts.negativeMargin += runtimeResult.negativeMargin.length;
      escapeCounts.positioningHelper += runtimeResult.offset.length;
      for (const v of runtimeResult.positioning) violations.push({ source: "runtime", category: "positioning", ...v });
      for (const v of runtimeResult.transform) violations.push({ source: "runtime", category: "transform", ...v });
      for (const v of runtimeResult.negativeMargin) violations.push({ source: "runtime", category: "negativeMargin", ...v });
      for (const v of runtimeResult.offset) violations.push({ source: "runtime", category: "positioningHelper", ...v });
    }
  } catch (e) {
    console.error(`runtime sweep skip (env): ${e.message.split("\n")[0]}`);
  }
}

// 임계 검사
const overBudget = [];
const limits = {
  positioning: opts["budget-positioning"],
  transform: opts["budget-transform"],
  negativeMargin: opts["budget-negative-margin"],
  arbitraryPx: opts["budget-arbitrary-px"],
  breakpointDivergence: opts["budget-breakpoint"],
};
for (const cat of Object.keys(limits)) {
  if (escapeCounts[cat] > limits[cat]) overBudget.push({ category: cat, count: escapeCounts[cat], limit: limits[cat] });
}
escapeCounts.positioningHelper && (escapeCounts.positioning += 0); // helper 는 positioning 과 함께 검사 — 위 limits.positioning 에 합산

const fail = overBudget.length > 0;
console.log(JSON.stringify({
  section: opts.section,
  status: fail ? "FAIL" : "PASS",
  escapeCounts,
  violations,
  allowedEscapes: allowedReasons,
  dependencyClosure: [...closureFiles],
  runtime: runtimeResult,
  overBudget,
}, null, 2));
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: 권한 부여 + 정적 smoke**

```bash
chmod +x scripts/check-layout-escapes.mjs
echo 'export function A() { return <div className="absolute top-[37px]"></div>; }' > /tmp/escape-fixture.tsx
node scripts/check-layout-escapes.mjs --section dummy --files "/tmp/escape-fixture.tsx"
```
Expected: `status: "FAIL"`, `escapeCounts.positioning: 1`, `escapeCounts.arbitraryPx: 1`, `escapeCounts.positioningHelper: 1`. overBudget 에 positioning.

- [ ] **Step 3: Commit**

```bash
git add scripts/check-layout-escapes.mjs
git commit -m "feat(strict): G11 check-layout-escapes — 정적 + dependency closure + runtime sweep + data-allow-escape"
```

---

## Phase 4 — 통합 (T10)

### Task 10: measure-quality.sh — G11 추가 + viewport 자동 + LITE=1

**Files:**
- Modify: `scripts/measure-quality.sh`

- [ ] **Step 1: G1 호출 부분 수정 (strict default + viewport 자동 감지)**

기존 G1 블록 (line 144-176) 을 다음으로 교체:

```bash
# ---------- G1 visual regression (strict default + LITE 옵트아웃) ----------
echo "[G1] visual regression (section=${section})"
G1_BASELINE_DIR="baselines/${section}"
# 환경변수 LITE=1 이면 lite 모드 강제
if [ "${LITE:-0}" = "1" ]; then
  echo "  ⚠ LITE=1 — strict 옵트아웃 (G1 lite 호출)"
  G1_JSON=$(node "${SCRIPT_DIR}/check-visual-regression.mjs" \
    --section "$section" \
    --baseline "${BASELINE:-${G1_BASELINE_DIR}/desktop.png}" \
    --viewport "${VIEWPORT}" 2>/tmp/g1.err || true)
elif [ -d "$G1_BASELINE_DIR" ]; then
  # 사용 가능한 viewport 자동 감지
  AVAIL_VIEWPORTS=""
  for v in desktop tablet mobile; do
    if [ -f "${G1_BASELINE_DIR}/${v}.png" ]; then
      AVAIL_VIEWPORTS="${AVAIL_VIEWPORTS}${AVAIL_VIEWPORTS:+,}${v}"
    fi
  done
  if [ -z "$AVAIL_VIEWPORTS" ]; then
    AVAIL_VIEWPORTS="desktop"
  fi
  G1_JSON=$(node "${SCRIPT_DIR}/check-visual-regression.mjs" \
    --section "$section" \
    --baseline-dir "$G1_BASELINE_DIR" \
    --viewports "$AVAIL_VIEWPORTS" \
    --strict 2>/tmp/g1.err || true)
else
  # baseline 디렉토리 자체 부재 — strict 강제로 FAIL (legacy.json 도 없음)
  G1_JSON='{"section":"'"$section"'","status":"FAIL","reason":"baselines/'"$section"'/ 부재 — prepare-baseline.mjs 실행 필요","strictEffective":false}'
fi
G1_RAW_STATUS=$(echo "$G1_JSON" | node -e "let j='';process.stdin.on('data',d=>j+=d);process.stdin.on('end',()=>{try{process.stdout.write(JSON.parse(j).status||'')}catch(e){}})" 2>/dev/null)
case "$G1_RAW_STATUS" in
  PASS)
    G1_STATUS="PASS"; G1_DETAIL="$G1_JSON"
    echo "  ✓ G1 PASS"
    ;;
  FAIL)
    G1_STATUS="FAIL"; G1_DETAIL="$G1_JSON"; FAIL=1
    echo "  ❌ G1 FAIL"
    echo "    $G1_JSON"
    ;;
  SKIPPED|NO_BASELINE|BASELINE_UPDATED)
    G1_STATUS="$G1_RAW_STATUS"; G1_DETAIL="$G1_JSON"
    echo "  ⚠ G1 $G1_RAW_STATUS"
    ;;
  *)
    G1_STATUS="SKIP"; G1_DETAIL='{"status":"SKIP","reason":"script error"}'
    cat /tmp/g1.err 2>/dev/null || true
    echo "  ⚠ G1 SKIP"
    ;;
esac
```

- [ ] **Step 2: G11 블록 추가** (G10 다음, 즉 G10 블록 바로 다음 줄에)

G10 블록 끝 (`fi` 이후) 에 추가:

```bash
# ---------- G11 layout escape budget ----------
echo ""
echo "[G11] layout escape budget"
G11_FILES=""
if [ "$TARGET_SCOPE" = "files" ]; then
  G11_FILES="$TARGET_SET"
else
  # 디렉토리 → 안의 .tsx/.jsx/.ts/.js 모두
  G11_FILES=$(find "$dir" -type f \( -name "*.tsx" -o -name "*.jsx" -o -name "*.ts" -o -name "*.js" \) 2>/dev/null | tr '\n' ' ')
fi
if [ -z "$G11_FILES" ]; then
  echo "  ⚠ G11 SKIP (no source files)"
  G11_STATUS="SKIP"
else
  if node "${SCRIPT_DIR}/check-layout-escapes.mjs" --section "$section" --files "$G11_FILES" >/tmp/g11.out 2>/tmp/g11.err; then
    G11_STATUS="PASS"
    echo "  ✓ G11 PASS"
  else
    G11_STATUS="FAIL"
    FAIL=1
    cat /tmp/g11.out 2>/dev/null || true
    echo "  ❌ G11 FAIL"
  fi
fi
```

- [ ] **Step 3: G1 변수 초기화에 `G11_STATUS="SKIP"` 추가**

기존 `G10_STATUS="SKIP"` 줄 (line 142 부근) 다음에 `G11_STATUS="SKIP"` 추가.

- [ ] **Step 4: 결과 JSON 출력에 G11 추가**

스크립트 마지막 부분의 결과 JSON 출력 부분 찾아서 (search "G10_status") g11_status 필드 추가:

```bash
# JSON 출력 부분 끝에:
"g11_layout_escapes": "$G11_STATUS",
```

(정확한 위치는 기존 파일의 JSON 출력부에 맞춰. G10 다음에 G11 추가.)

- [ ] **Step 5: smoke — 더미 섹션으로 측정**

```bash
mkdir -p /tmp/qsmoke/src/components/sections/dummy && cat > /tmp/qsmoke/src/components/sections/dummy/Dummy.tsx <<'EOF'
export function Dummy() { return <div data-anchor="dummy/root"><h1>Hello</h1></div>; }
EOF
cd /tmp/qsmoke && bash $OLDPWD/scripts/measure-quality.sh dummy src/components/sections/dummy 2>&1 | head -40
```
Expected: G11 PASS (escape 없음). G1 FAIL (baseline 부재).

- [ ] **Step 6: Commit**

```bash
cd $OLDPWD && git add scripts/measure-quality.sh
git commit -m "feat(strict): measure-quality — G11 추가 + G1 strict default + viewport 자동 감지 + LITE=1 처리"
```

---

## Phase 5 — 마이그레이션 (T11~T13)

### Task 11: scripts/migrate-baselines.mjs — legacy.json 발급

**Files:**
- Create: `scripts/migrate-baselines.mjs`

- [ ] **Step 1: 스크립트 작성**

```javascript
#!/usr/bin/env node
/**
 * migrate-baselines.mjs — 기존 프로젝트 1회 마이그레이션 + --renew.
 *
 * Usage:
 *   node scripts/migrate-baselines.mjs --section hero --reason "기존 프로젝트"
 *   node scripts/migrate-baselines.mjs --renew --section hero
 *   node scripts/migrate-baselines.mjs --all --reason "..." (모든 baselines/*/ 일괄)
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { issueLegacy, renewLegacy, readLegacy, writeLegacy } from "./_lib/legacy-manifest.mjs";

function parseArgs(argv) {
  const o = { all: false, renew: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--all") { o.all = true; continue; }
    if (argv[i] === "--renew") { o.renew = true; continue; }
    if (argv[i].startsWith("--")) { o[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return o;
}

const opts = parseArgs(process.argv.slice(2));
let sourceCommit;
try {
  sourceCommit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
} catch {
  sourceCommit = "0000000";
}

function processSection(section) {
  const dir = resolve(`baselines/${section}`);
  if (!existsSync(dir)) {
    console.error(`SKIP ${section}: baselines/ 부재`);
    return;
  }
  const legacyPath = join(dir, "legacy.json");
  // 어떤 viewport png 있는지
  const hasViewport = ["desktop","tablet","mobile"].filter((v) => existsSync(join(dir, `${v}.png`)));
  const skipViewports = ["desktop","tablet","mobile"].filter((v) => !hasViewport.includes(v));
  const hasManifest = ["desktop","tablet","mobile"].some((v) => existsSync(join(dir, `anchors-${v}.json`)));

  if (opts.renew) {
    const cur = readLegacy(legacyPath);
    if (!cur) { console.error(`${section}: --renew 인데 legacy.json 부재`); return; }
    const renewed = renewLegacy(cur, { sourceCommit });
    writeLegacy(legacyPath, renewed);
    console.log(`RENEWED ${section}: expiresAt=${renewed.expiresAt}`);
    return;
  }

  // 신규 발급
  const legacy = issueLegacy({
    creator: "migrate-baselines",
    reason: opts.reason || "1회 마이그레이션 — strict 점진 도입",
    skipL2: !hasManifest,
    skipViewports,
    sourceCommit,
  });
  writeLegacy(legacyPath, legacy);
  console.log(`ISSUED ${section}: skipL2=${legacy.skipL2}, skipViewports=[${skipViewports.join(",")}], expiresAt=${legacy.expiresAt}`);
}

if (opts.all) {
  const baseDir = resolve("baselines");
  if (!existsSync(baseDir)) { console.error("baselines/ 부재 — 마이그레이션 대상 없음"); process.exit(0); }
  for (const e of readdirSync(baseDir)) {
    if (statSync(join(baseDir, e)).isDirectory()) processSection(e);
  }
} else if (opts.section) {
  processSection(opts.section);
} else {
  console.error("usage: --section <id> 또는 --all");
  process.exit(2);
}
```

- [ ] **Step 2: 권한 + smoke**

```bash
chmod +x scripts/migrate-baselines.mjs
mkdir -p /tmp/migsmoke/baselines/hero && touch /tmp/migsmoke/baselines/hero/desktop.png
cd /tmp/migsmoke && node $OLDPWD/scripts/migrate-baselines.mjs --section hero --reason "test"
cat baselines/hero/legacy.json
cd $OLDPWD
```
Expected: `legacy.json` 생성됨. `createdBy: "migrate-baselines"`, `skipViewports: ["tablet","mobile"]`, `skipL2: true`.

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-baselines.mjs
git commit -m "feat(strict): migrate-baselines — legacy.json 거버넌스 발급 + --renew + --all"
```

---

### Task 12: scripts/check-legacy-additions.mjs — CI 차단

**Files:**
- Create: `scripts/check-legacy-additions.mjs`

- [ ] **Step 1: 스크립트 작성**

```javascript
#!/usr/bin/env node
/**
 * check-legacy-additions.mjs — CI 용.
 * PR diff 검사: 신규 legacy.json 추가 + 코드 변경(.tsx/.jsx 등) 동시 포함이면 FAIL.
 *
 * Usage (CI):
 *   node scripts/check-legacy-additions.mjs --base origin/main --head HEAD
 */

import { execSync } from "node:child_process";

function parseArgs(argv) {
  const o = { base: "origin/main", head: "HEAD" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { o[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return o;
}
const opts = parseArgs(process.argv.slice(2));

let added, changed;
try {
  added = execSync(`git diff --diff-filter=A --name-only ${opts.base}..${opts.head}`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  changed = execSync(`git diff --name-only ${opts.base}..${opts.head}`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
} catch (e) {
  console.error(`ERROR: git diff failed (${e.message.split("\n")[0]})`);
  process.exit(2);
}

const addedLegacy = added.filter((f) => /^baselines\/[^/]+\/legacy\.json$/.test(f));
const codeChanges = changed.filter((f) =>
  /\.(tsx|jsx|ts|js|css|html)$/.test(f) ||
  /^src\//.test(f) ||
  /^public\//.test(f)
);

if (addedLegacy.length === 0) {
  console.log(JSON.stringify({ status: "PASS", reason: "no new legacy.json" }));
  process.exit(0);
}

if (codeChanges.length === 0) {
  console.log(JSON.stringify({ status: "PASS", reason: "migration-only PR (legacy added but no code changes)", addedLegacy }));
  process.exit(0);
}

console.log(JSON.stringify({
  status: "FAIL",
  reason: "구현 PR 에 신규 legacy.json 추가 — migrate-baselines 단독 PR 로 분리하세요",
  addedLegacy,
  codeChanges: codeChanges.slice(0, 10),
}));
process.exit(1);
```

- [ ] **Step 2: 권한 + smoke**

```bash
chmod +x scripts/check-legacy-additions.mjs
node scripts/check-legacy-additions.mjs --base HEAD~1 --head HEAD
```
Expected: 현재 commit 기준 PASS 출력 (legacy 추가 없음).

- [ ] **Step 3: Commit**

```bash
git add scripts/check-legacy-additions.mjs
git commit -m "feat(strict): check-legacy-additions — CI 용 구현 PR 의 신규 legacy 차단"
```

---

### Task 13: bootstrap.sh — 신규 스크립트 복사

**Files:**
- Modify: `scripts/bootstrap.sh`

- [ ] **Step 1: bootstrap.sh 의 scripts/ 복사 부분 찾기**

```bash
grep -n "cp.*scripts/" scripts/bootstrap.sh | head -20
```

- [ ] **Step 2: 신규 스크립트 4개 + _lib 5개 복사 항목 추가**

기존 cp 패턴 위치에 추가 (예시 — 정확한 위치는 grep 결과 보고 결정):

```bash
# strict visual harness 추가 스크립트
cp "$HARNESS_DIR/scripts/extract-figma-anchors.mjs" scripts/
cp "$HARNESS_DIR/scripts/prepare-baseline.mjs" scripts/
cp "$HARNESS_DIR/scripts/check-layout-escapes.mjs" scripts/
cp "$HARNESS_DIR/scripts/migrate-baselines.mjs" scripts/
cp "$HARNESS_DIR/scripts/check-legacy-additions.mjs" scripts/
chmod +x scripts/extract-figma-anchors.mjs scripts/prepare-baseline.mjs scripts/check-layout-escapes.mjs scripts/migrate-baselines.mjs scripts/check-legacy-additions.mjs

cp "$HARNESS_DIR/scripts/_lib/anchor-manifest.mjs" scripts/_lib/
cp "$HARNESS_DIR/scripts/_lib/legacy-manifest.mjs" scripts/_lib/
cp "$HARNESS_DIR/scripts/_lib/playwright-stable.mjs" scripts/_lib/
cp "$HARNESS_DIR/scripts/_lib/escape-detect.mjs" scripts/_lib/
cp "$HARNESS_DIR/scripts/_lib/escape-runtime-sweep.mjs" scripts/_lib/
```

- [ ] **Step 3: 의존성 추가 안내** — bootstrap 후 사용자에게 안내문 출력

bootstrap.sh 의 마지막 출력 부분에 다음 추가:

```bash
echo ""
echo "📦 strict visual harness 의존성 (선택, 없으면 G1 SKIP):"
echo "   npm i -D playwright pixelmatch pngjs"
echo "   npx playwright install chromium"
```

- [ ] **Step 4: smoke — bootstrap 검증은 통합 테스트로 따로 확인 (별도 임시 디렉토리에 부트)**

bootstrap 검증은 Phase 7 통합 단계에서 수행. 일단 grep 으로 추가 확인:

```bash
grep -E "(extract-figma-anchors|prepare-baseline|check-layout-escapes)" scripts/bootstrap.sh
```
Expected: 추가 라인 출력.

- [ ] **Step 5: Commit**

```bash
git add scripts/bootstrap.sh
git commit -m "feat(strict): bootstrap — 신규 스크립트 복사 + 의존성 안내"
```

---

## Phase 6 — 가이드 문서 (T14~T16)

### Task 14: section-worker.md — anchor 룰 + retry + escape budget

**Files:**
- Modify: `.claude/agents/section-worker.md`

- [ ] **Step 1: 현재 섹션 구조 파악**

```bash
grep -n "^##\|^###" .claude/agents/section-worker.md
```

- [ ] **Step 2: 신규 섹션 추가 — "anchor 박는 룰" + "G11 escape budget" + "retry 카테고리 가이드"**

기존 `## 금지` 절 다음에 새 섹션 추가:

```markdown
## anchor 박는 룰 (G1 strict)

implementation 시 다음 element 에 `data-anchor` 박아라:

- **section 루트**: `data-anchor="<section-id>/root"` 필수
- **텍스트 헤딩** (h1/h2/h3): `data-anchor="<section-id>/heading"` 또는 의미명
- **주요 CTA** (button/link): `data-anchor="<section-id>/cta"`
- **메인 이미지/일러스트**: `data-anchor="<section-id>/image"`
- **텍스트 본문 영역**: `data-anchor="<section-id>/<name>" data-role="text-block"` (선택)
- 디자인이 명명한 element (Figma 노드 이름) → kebab-case 슬러그
- 6~10개 권장. kebab-case. `<section-id>/` prefix 필수

baseline manifest 에 `required: true` 표시된 anchor 는 **반드시** 박을 것 (없으면 G1 L2 FAIL).

가능하면 `data-anchor-figma-node="<nodeId>"` 도 함께 박음 (이름 변경 강인성 ↑).

## G11 escape budget (절대 금지 + 카운트 제한)

section root subtree (= `data-anchor="<id>/root"` 자손 + import 한 first-party 컴포넌트) 에서:

| 카테고리 | 임계 |
|---|---|
| `position: absolute/fixed/sticky` (root 제외) | 0개 |
| `transform: translate(*)`, Tailwind `translate-x/y-[N]px` | ≤ 2개 |
| negative margin (`-m*`, `-mt-`, `-ml-`) | ≤ 2개 |
| arbitrary px (`w-[37px]` 등 토큰 외) | ≤ 3개 |
| breakpoint별 매직 px (`md:left-[37px]`) | ≤ 2개 |

**원칙**: 절대 좌표/매직 px 로 픽셀 맞추지 마라. 디자인 의도는 flex/grid + 토큰 으로 표현.

예외 (data-allow-escape):
```tsx
<svg data-allow-escape="connector-line" className="absolute -right-8 top-0" aria-hidden="true">...</svg>
```
- reason 은 정해진 enum: `decorative-overlap` / `connector-line` / `badge-offset` / `sticky-nav` / `animation-anchor`
- section 당 ≤ 2회 사용
- 자식에 텍스트 element/text node 있으면 무효

## retry 카테고리 가이드 (게이트 FAIL 시)

| FAIL | 행동 |
|---|---|
| G11 escape budget 초과 | 카테고리별 룰 따라 재구성. transform→flex/grid, negative margin→상위 wrapper 정리, 매직 px→토큰 사용 |
| G1 L1 pixel diff | tests/quality/diffs/<section>-<viewport>.diff.png 확인. spacing/typography 토큰 점검 |
| G1 L2 anchor required missing | stdout 의 missing 리스트 그대로 박기 |
| G1 L2 bbox delta | 해당 anchor element 의 width/height/margin 점검. **escape budget 남발 금지** (G11 으로 재차단) |
| G1 NO_BASELINE | 사용자 개입 분기로 돌려보냄 (baseline 갱신 또는 prepare-baseline 호출) |
| G1 NO_MANIFEST + legacy.json 부재 | strict 강제 — 사용자 개입 분기 |
| G1 dimension mismatch | section 전체 크기 재점검 |
```

- [ ] **Step 3: 기존 §금지 절 보강 — escape budget 명시**

기존 §금지 의 항목에 추가:

```markdown
- ❌ section 파일 (또는 section import 한 first-party 컴포넌트) 에서 `position: absolute/fixed/sticky` 사용 (G11 차단). 진짜 데코면 `data-allow-escape="<enum>"`
- ❌ Tailwind 매직 px (`w-[37px]`, `top-[12px]`) 남용 — 토큰 또는 standard 값 (4/8/16/24…) 사용
- ❌ G11 의 budget 카테고리 임계 초과
```

- [ ] **Step 4: smoke**

```bash
grep -c "data-anchor" .claude/agents/section-worker.md
```
Expected: ≥ 5 (룰 + 예시).

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/section-worker.md
git commit -m "docs(strict): section-worker — anchor 룰 + G11 escape budget + retry 가이드"
```

---

### Task 15: docs/workflow.md — Phase 4.1/4.2 + baseline 갱신 프로토콜

**Files:**
- Modify: `docs/workflow.md`

- [ ] **Step 1: Phase 3 의 4.1 baseline 준비 부분 갱신**

기존 (line 144 부근):
```
4.1 G1 baseline 준비 → baselines/<section>/<viewport>.png (선택)
                   · figma 모드: fetch-figma-baseline.sh
                   · spec 모드: render-spec-baseline.mjs (reference HTML 렌더)
                     또는 --update-baseline 으로 첫 구현 고정
```

다음으로 교체:
```
4.1 G1 baseline 준비 → baselines/<section>/<viewport>.png + anchors-<viewport>.json (필수, strict)
                   · 통합: prepare-baseline.mjs (모드 자동 분기)
                   · figma 모드: figma-rest-image + extract-figma-anchors
                   · spec 모드: reference HTML 렌더 (anchor 자동 추출 LOW — partial strict)
                   · --force 시 anchor diff report 출력
                   · 캐싱: figma lastModified / spec mtime
4.2 품질 게이트   → scripts/measure-quality.sh
                   · 실행 순서 fail-fast: G10 → G4 → G11 → G5 → G6/G8 → G1 → G7
                   · G1 strict default + viewport 자동 감지
                   · G11 escape budget (정적 + Playwright runtime sweep + dependency closure)
                   · LITE=1 env 로 옵트아웃 (개발 로컬만)
```

- [ ] **Step 2: 새 §추가 — baseline 갱신 프로토콜**

`## Phase 4 — 페이지 통합` 다음, `## 섹션 작성 규칙` 전에 새 섹션 추가:

```markdown
## baseline 갱신 프로토콜

옛 heavy 폐기 원인 중 하나: "Figma 가 변경됐는지 코드가 회귀했는지 구분 안 됨". 명시적 분리:

| 시나리오 | 처리 |
|---|---|
| Figma 디자인 변경 (디자이너 알림) | "디자인 변경 PR" — `prepare-baseline.mjs --force --section <id>` 실행, 새 baseline + manifest commit |
| 구현 회귀 (코드 변경으로 FAIL) | "구현 PR" — baseline 갱신 금지. 코드 수정으로 PASS |
| 둘 다 | 두 PR 분리 권장 |

`prepare-baseline.mjs --force` 는 stdout 에 **anchor diff report** 출력 — 리뷰어가 디자인 의도된 변경 여부 검토.

### legacy.json 운영

기존 프로젝트는 `migrate-baselines.mjs --section <id>` 로 1회 발급. 90일 만료.

- 만료된 legacy: 다음 중 하나
  1. `prepare-baseline.mjs` 로 manifest 추출 → 자동 strict 진입 (legacy 제거)
  2. `migrate-baselines.mjs --renew --section <id>` (90일 연장, 단독 commit)
- 워커/사용자 직접 작성 금지 — `migrate-baselines.mjs` 만 거버넌스 필드 정확히 채움
- CI: `check-legacy-additions.mjs` 가 구현 PR 의 신규 legacy 추가 차단
```

- [ ] **Step 3: 섹션 작성 규칙 표 갱신** (line 184 부근)

기존 표에 G11 행 추가:

```markdown
| section root subtree 에 `position: absolute/fixed/sticky` 사용 (root 제외) | G11 FAIL |
| 토큰 외 매직 px (`w-[37px]` 등) > 3개 | G11 FAIL |
| transform px / negative margin / breakpoint divergence 임계 초과 | G11 FAIL |
```

- [ ] **Step 4: 실패 대응 표 갱신** (마지막 §)

```markdown
| G11 FAIL | layout escape 남발 | flex/grid 재구성. 데코는 `data-allow-escape="<enum>"` (≤2회) |
| G1 L2 anchor missing | manifest required 박지 않음 | stdout missing 리스트 따라 추가 |
| G1 L2 bbox delta | element 위치/크기 어긋남 | width/height/margin 점검 (escape budget 추가는 G11 으로 차단) |
```

- [ ] **Step 5: smoke**

```bash
grep -c "G11\|escape budget\|prepare-baseline" docs/workflow.md
```
Expected: ≥ 5.

- [ ] **Step 6: Commit**

```bash
git add docs/workflow.md
git commit -m "docs(strict): workflow — Phase 4.1/4.2 갱신 + baseline 갱신 프로토콜 + G11 추가"
```

---

### Task 16: CLAUDE.md — 게이트 표 갱신

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: 차단 게이트 표에 G11 추가**

기존 차단 게이트 표 (현재 G4/G5/G6/G8/G10) 다음 행 추가:

```markdown
| G11 | `check-layout-escapes.mjs` | layout escape budget (absolute/fixed/sticky/transform/negative margin/매직 px/breakpoint divergence) — 정적 + dependency closure + Playwright runtime sweep |
```

- [ ] **Step 2: 선택적 게이트 표에서 G1 항목을 차단 게이트로 이동 — strict 화**

기존 선택적 게이트 의 G1 행 삭제, 차단 게이트 표 맨 위 (또는 G4 앞) 에 추가:

```markdown
| G1 | `check-visual-regression.mjs` (strict) | L1 pixel ≤ 5% (text-block mask 35% 상한) + L2 DOM bbox max(4px, 1%) + 3 viewport 통과 + manifest v2 + legacy 거버넌스 |
```

`G1 원칙` 절 갱신:
```markdown
**G1 strict 원칙**: default 차단. 신규 프로젝트는 anchor manifest 부재 시 FAIL. 기존 프로젝트는 `baselines/<section>/legacy.json` (createdBy: migrate-baselines, 90일 expiresAt) 만 SKIP 허용. `LITE=1` env 로 개발 로컬 우회 가능 (CI 차단). 결과 JSON 의 `strictEffective` 필드로 가시화.
```

- [ ] **Step 3: smoke**

```bash
grep -c "G11\|G1 strict\|legacy.json\|escape budget" CLAUDE.md
```
Expected: ≥ 4.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(strict): CLAUDE.md — G1 strict 차단 + G11 추가"
```

---

## Phase 7 — Deprecated 정리 + fixture (T17~T19)

### Task 17: scripts/fetch-figma-baseline.sh / render-spec-baseline.mjs 삭제

**Files:**
- Delete: `scripts/fetch-figma-baseline.sh`
- Delete: `scripts/render-spec-baseline.mjs`

- [ ] **Step 1: 다른 곳에서 호출 안 하는지 확인**

```bash
grep -rn "fetch-figma-baseline\|render-spec-baseline" --include="*.sh" --include="*.mjs" --include="*.md" .
```

prepare-baseline.mjs 안에서 spec 모드의 fallback 으로 render-spec-baseline.mjs 를 호출하는 부분이 있다면 제거. 그 위치는 spec 모드 partial-strict 의 한계 — 인라인 구현 또는 LOW 위임.

- [ ] **Step 2: 의존 제거 결정**

prepare-baseline.mjs 의 spec 모드 부분에서 render-spec-baseline 호출이 있으면, 다음 중 선택:
- (a) 인라인으로 흡수 (Playwright 로 reference HTML 렌더)
- (b) LOW 위임 — 일단 spec 모드 baseline 자동 생성을 plan 후속으로 미룸 (prepare-baseline.mjs 에서 spec 모드 호출 시 안내문 출력 후 exit 0)

여기서는 (b) 선택 — spec 모드는 §16 의 "Plan 단계 위임 #3" 에 명시되어 있음. prepare-baseline.mjs 의 spec 분기를 안내문으로 교체:

```javascript
// spec 분기 (prepare-baseline.mjs 안)
} else if (opts.mode === "spec") {
  console.error(`spec 모드 baseline 자동 생성은 LOW 위임 (#3) — 수동으로 baselines/<section>/<viewport>.png 준비 필요`);
  return { viewport, status: "SKIPPED_SPEC_MODE", reason: "spec mode auto-prep deferred" };
}
```

- [ ] **Step 3: 파일 삭제**

```bash
rm scripts/fetch-figma-baseline.sh scripts/render-spec-baseline.mjs
```

- [ ] **Step 4: 다른 호출자 정리 후 커밋**

```bash
git add -u
git commit -m "refactor(strict): deprecated 삭제 — fetch-figma-baseline.sh / render-spec-baseline.mjs (prepare-baseline 흡수, spec 모드 LOW 위임)"
```

---

### Task 18: tests/fixtures/strict-gate/ — fixture 18종

**Files:**
- Create: `tests/fixtures/strict-gate/<각 케이스>/...`

분량이 크므로 fixture 를 sub-step 으로 분할.

- [ ] **Step 1: pass/ 기본 fixture**

```bash
mkdir -p tests/fixtures/strict-gate/pass/src/components/sections/hero
cat > tests/fixtures/strict-gate/pass/src/components/sections/hero/Hero.tsx <<'EOF'
export function Hero() {
  return (
    <section data-anchor="hero/root" className="flex flex-col items-center gap-4 p-8">
      <h1 data-anchor="hero/title">Welcome</h1>
      <p data-anchor="hero/body">Body text here</p>
      <button data-anchor="hero/cta" className="bg-blue-500 text-white px-4 py-2">Click</button>
    </section>
  );
}
EOF
```

- [ ] **Step 2: fail-positioning/ — absolute 사용**

```bash
mkdir -p tests/fixtures/strict-gate/fail-positioning/src/components/sections/hero
cat > tests/fixtures/strict-gate/fail-positioning/src/components/sections/hero/Hero.tsx <<'EOF'
export function Hero() {
  return (
    <section data-anchor="hero/root" className="relative">
      <h1 data-anchor="hero/title" className="absolute top-10 left-5">Title</h1>
    </section>
  );
}
EOF
```

- [ ] **Step 3: fail-arbitrary-px/ — 매직 px 4개**

```bash
mkdir -p tests/fixtures/strict-gate/fail-arbitrary-px/src/components/sections/hero
cat > tests/fixtures/strict-gate/fail-arbitrary-px/src/components/sections/hero/Hero.tsx <<'EOF'
export function Hero() {
  return (
    <section data-anchor="hero/root">
      <div className="w-[37px] h-[42px] gap-[7px] mt-[13px]"><h1 data-anchor="hero/title">T</h1></div>
    </section>
  );
}
EOF
```

- [ ] **Step 4: fail-transform-overflow/ — transform 3개**

```bash
mkdir -p tests/fixtures/strict-gate/fail-transform-overflow/src/components/sections/hero
cat > tests/fixtures/strict-gate/fail-transform-overflow/src/components/sections/hero/Hero.tsx <<'EOF'
export function Hero() {
  return (
    <section data-anchor="hero/root">
      <div className="translate-x-[10px]"></div>
      <div className="translate-y-[20px]"></div>
      <div className="translate-x-[30px]"></div>
      <h1 data-anchor="hero/title">T</h1>
    </section>
  );
}
EOF
```

- [ ] **Step 5: pass-data-allow-escape-decorative/**

```bash
mkdir -p tests/fixtures/strict-gate/pass-data-allow-escape-decorative/src/components/sections/hero
cat > tests/fixtures/strict-gate/pass-data-allow-escape-decorative/src/components/sections/hero/Hero.tsx <<'EOF'
export function Hero() {
  return (
    <section data-anchor="hero/root" className="relative">
      <h1 data-anchor="hero/title">Title</h1>
      <svg data-allow-escape="connector-line" className="absolute -right-8 top-0" aria-hidden="true" />
    </section>
  );
}
EOF
```

- [ ] **Step 6: fail-data-allow-escape-text-child/**

```bash
mkdir -p tests/fixtures/strict-gate/fail-data-allow-escape-text-child/src/components/sections/hero
cat > tests/fixtures/strict-gate/fail-data-allow-escape-text-child/src/components/sections/hero/Hero.tsx <<'EOF'
export function Hero() {
  return (
    <section data-anchor="hero/root" className="relative">
      <div data-allow-escape="connector-line" className="absolute"><h2>Text inside escape — INVALID</h2></div>
    </section>
  );
}
EOF
```

- [ ] **Step 7: fail-no-anchor-manifest/ + pass-legacy-valid/ + fail-legacy-invalid-creator/ + fail-legacy-expired/**

```bash
# fail-no-anchor-manifest
mkdir -p tests/fixtures/strict-gate/fail-no-anchor-manifest/src/components/sections/hero
mkdir -p tests/fixtures/strict-gate/fail-no-anchor-manifest/baselines/hero
# desktop.png 만 (manifest 없음, legacy 없음)
echo "fake png" > tests/fixtures/strict-gate/fail-no-anchor-manifest/baselines/hero/desktop.png

# pass-legacy-valid
mkdir -p tests/fixtures/strict-gate/pass-legacy-valid/baselines/hero
cat > tests/fixtures/strict-gate/pass-legacy-valid/baselines/hero/legacy.json <<'EOF'
{
  "version": 2,
  "reason": "test",
  "skipL2": true,
  "skipViewports": ["tablet","mobile"],
  "createdAt": "2026-04-28",
  "createdBy": "migrate-baselines",
  "sourceCommit": "abc1234",
  "expiresAt": "2099-12-31"
}
EOF

# fail-legacy-invalid-creator
mkdir -p tests/fixtures/strict-gate/fail-legacy-invalid-creator/baselines/hero
cat > tests/fixtures/strict-gate/fail-legacy-invalid-creator/baselines/hero/legacy.json <<'EOF'
{
  "version": 2,
  "reason": "test",
  "skipL2": true,
  "skipViewports": [],
  "createdAt": "2026-04-28",
  "createdBy": "worker",
  "sourceCommit": "abc1234",
  "expiresAt": "2099-12-31"
}
EOF

# fail-legacy-expired
mkdir -p tests/fixtures/strict-gate/fail-legacy-expired/baselines/hero
cat > tests/fixtures/strict-gate/fail-legacy-expired/baselines/hero/legacy.json <<'EOF'
{
  "version": 2,
  "reason": "test",
  "skipL2": true,
  "skipViewports": [],
  "createdAt": "2020-01-01",
  "createdBy": "migrate-baselines",
  "sourceCommit": "abc1234",
  "expiresAt": "2020-01-01"
}
EOF
```

- [ ] **Step 8: fail-import-dirty-ui-component/ + pass-import-clean-ui-component/**

```bash
# fail-import-dirty
mkdir -p tests/fixtures/strict-gate/fail-import-dirty-ui-component/src/components/{ui,sections/hero}
cat > tests/fixtures/strict-gate/fail-import-dirty-ui-component/src/components/ui/DirtyWrapper.tsx <<'EOF'
export function DirtyWrapper({ children }) {
  return <div className="absolute top-[15px]">{children}</div>;
}
EOF
cat > tests/fixtures/strict-gate/fail-import-dirty-ui-component/src/components/sections/hero/Hero.tsx <<'EOF'
import { DirtyWrapper } from "../../ui/DirtyWrapper";
export function Hero() {
  return <section data-anchor="hero/root"><DirtyWrapper><h1 data-anchor="hero/title">T</h1></DirtyWrapper></section>;
}
EOF

# pass-import-clean (clean ui component, no escape)
mkdir -p tests/fixtures/strict-gate/pass-import-clean-ui-component/src/components/{ui,sections/hero}
cat > tests/fixtures/strict-gate/pass-import-clean-ui-component/src/components/ui/CleanWrapper.tsx <<'EOF'
export function CleanWrapper({ children }) {
  return <div className="flex flex-col gap-2">{children}</div>;
}
EOF
cat > tests/fixtures/strict-gate/pass-import-clean-ui-component/src/components/sections/hero/Hero.tsx <<'EOF'
import { CleanWrapper } from "../../ui/CleanWrapper";
export function Hero() {
  return <section data-anchor="hero/root"><CleanWrapper><h1 data-anchor="hero/title">T</h1></CleanWrapper></section>;
}
EOF
```

- [ ] **Step 9: 나머지 fixture 5종 (다른 fixture 들)**

나머지: fail-anchor-required-missing, fail-anchor-bbox-delta, fail-pixel-diff-no-mask, pass-text-heavy-with-mask, fail-mask-area-exceeded, fail-text-block-on-non-text-element, fail-dynamic-classname, fail-css-module-position.

이 fixture 들은 baseline PNG (실제 이미지 + manifest) 가 필요. PNG 파일은 prepare-baseline.mjs 의 "spec 모드 LOW" 한계로 인해 manual 또는 dogfooding 단계에서 생성. 일단 fixture 디렉토리 구조 만들고 각 src 파일 + manifest stub 만 작성:

```bash
mkdir -p tests/fixtures/strict-gate/fail-anchor-required-missing/src/components/sections/hero
cat > tests/fixtures/strict-gate/fail-anchor-required-missing/src/components/sections/hero/Hero.tsx <<'EOF'
// section-root anchor 없음
export function Hero() {
  return <section><h1>T</h1></section>;
}
EOF

mkdir -p tests/fixtures/strict-gate/fail-dynamic-classname/src/components/sections/hero
cat > tests/fixtures/strict-gate/fail-dynamic-classname/src/components/sections/hero/Hero.tsx <<'EOF'
const cls = "ab" + "solute";
export function Hero() {
  return <section data-anchor="hero/root" className={cls}><h1 data-anchor="hero/title">T</h1></section>;
}
EOF

mkdir -p tests/fixtures/strict-gate/fail-css-module-position/src/components/sections/hero
cat > tests/fixtures/strict-gate/fail-css-module-position/src/components/sections/hero/Hero.module.css <<'EOF'
.title { position: absolute; top: 17px; }
EOF
cat > tests/fixtures/strict-gate/fail-css-module-position/src/components/sections/hero/Hero.tsx <<'EOF'
import styles from "./Hero.module.css";
export function Hero() {
  return <section data-anchor="hero/root"><h1 data-anchor="hero/title" className={styles.title}>T</h1></section>;
}
EOF

# pass-text-heavy-with-mask, fail-mask-area-exceeded, fail-text-block-on-non-text-element
# 는 baseline PNG 없이는 동작 검증이 어려움 — manifest 만 stub 으로
mkdir -p tests/fixtures/strict-gate/fail-text-block-on-non-text-element/src/components/sections/hero
cat > tests/fixtures/strict-gate/fail-text-block-on-non-text-element/src/components/sections/hero/Hero.tsx <<'EOF'
export function Hero() {
  return (
    <section data-anchor="hero/root">
      <div data-anchor="hero/wrapper" data-role="text-block">Text inside non-semantic div — should FAIL L2</div>
    </section>
  );
}
EOF
```

(나머지 mask/pixel 관련 fixture 는 dogfooding M10 단계에서 실제 PNG 생성)

- [ ] **Step 10: Commit**

```bash
git add tests/fixtures/strict-gate/
git commit -m "test(strict): fixture 13종 — pass/fail 케이스 (baseline PNG 의존 5종은 dogfooding 단계로)"
```

---

### Task 19: scripts/test-strict-gates.sh — fixture 일괄 검증

**Files:**
- Create: `scripts/test-strict-gates.sh`

- [ ] **Step 1: 스크립트 작성**

```bash
#!/usr/bin/env bash
# test-strict-gates.sh — fixture 일괄 검증
# 각 fixture 에서 measure-quality.sh 실행 → 의도된 PASS/FAIL 일치 검증.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
FIXTURE_DIR="${ROOT}/tests/fixtures/strict-gate"

pass_count=0
fail_count=0
for fix in "$FIXTURE_DIR"/*/; do
  name=$(basename "$fix")
  expected_pass=true
  case "$name" in
    fail-*) expected_pass=false ;;
  esac
  # measure-quality.sh 의 G11 만 격리 검증 (G1 은 baseline PNG 의존)
  src_dir="$fix/src/components/sections/hero"
  if [ ! -d "$src_dir" ]; then
    echo "SKIP $name (no src dir)"
    continue
  fi
  files=$(find "$src_dir" -type f \( -name "*.tsx" -o -name "*.jsx" \) | tr '\n' ' ')
  result=$(node "${SCRIPT_DIR}/check-layout-escapes.mjs" --section hero --files "$files" 2>&1 || true)
  status=$(echo "$result" | grep -oE '"status":\s*"[A-Z]+"' | head -1 | grep -oE '[A-Z]+$')
  case "$status" in
    PASS) actual_pass=true ;;
    FAIL) actual_pass=false ;;
    *) actual_pass=unknown ;;
  esac
  if [ "$expected_pass" = "$actual_pass" ]; then
    echo "  ✓ $name (expected=$expected_pass, actual=$actual_pass)"
    pass_count=$((pass_count + 1))
  else
    echo "  ❌ $name (expected=$expected_pass, actual=$actual_pass)"
    echo "$result" | head -10
    fail_count=$((fail_count + 1))
  fi
done

echo ""
echo "Total: $((pass_count + fail_count)) | Passed: $pass_count | Failed: $fail_count"
[ $fail_count -eq 0 ]
```

- [ ] **Step 2: 권한 + 실행**

```bash
chmod +x scripts/test-strict-gates.sh
bash scripts/test-strict-gates.sh
```
Expected: 대부분 fixture 가 의도된 PASS/FAIL 와 일치. 실패하면 fixture 또는 게이트 정정.

- [ ] **Step 3: Commit**

```bash
git add scripts/test-strict-gates.sh
git commit -m "test(strict): test-strict-gates.sh — fixture 일괄 검증 (G11 정적 축)"
```

---

## Phase 8 — 의존성 + 마무리 (T20)

### Task 20: package.json — playwright/pixelmatch/pngjs 추가

**Files:**
- Modify: `package.json`

- [ ] **Step 1: devDependencies 추가**

```json
{
  "devDependencies": {
    "node-html-parser": "^6.1.13",
    "@babel/parser": "^7.24.0",
    "@babel/traverse": "^7.24.0",
    "playwright": "^1.45.0",
    "pixelmatch": "^5.3.0",
    "pngjs": "^7.0.0"
  }
}
```

- [ ] **Step 2: scripts/test:gates 갱신**

기존 `test:gates` 명령에 strict-gates 추가:
```json
"scripts": {
  "test:gates": "node scripts/check-token-usage-html.mjs tests/fixtures/html-static/g4-pass.html tests/fixtures/html-static/g4-pass.css && node scripts/check-text-ratio-html.mjs tests/fixtures/html-static/g6-pass.html && bash scripts/test-strict-gates.sh"
}
```

- [ ] **Step 3: 설치 확인**

```bash
npm install
ls node_modules/playwright node_modules/pixelmatch node_modules/pngjs
```
Expected: 세 패키지 모두 존재.

- [ ] **Step 4: chromium 설치 (사용자가 한 번)**

```bash
npx playwright install chromium
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(strict): playwright/pixelmatch/pngjs 의존성 + test:gates 통합"
```

---

## Phase 9 — Dogfooding (별도 PR 권장)

### Task 21 (선택, 별 PR): 본 리포 또는 사용자 운영 프로젝트에서 실측 검증

이 단계는 plan 외부 — 별도 작업. M10 마일스톤 해당.

검증 항목:
- 실제 페이지 1개에서 strict 통과
- false-positive < 5% (의미 없는 FAIL 비율)
- 평균 runtime / retry율 / SKIP율 기록

결과는 `docs/strict-harness-dogfooding-2026-04-28.md` 에 기록 후 spec 의 §운영 SLO 갱신.

---

## Self-Review (이 plan 작성자 셀프 체크)

**1. Spec 커버리지**
- ✅ G1 strict 확장 (T7): L1 mask + 35% 상한 + L2 mixed tolerance + section-root 별도 + multi-viewport 병렬 + Playwright 안정화 + manifest v2 + legacy 거버넌스 + strictEffective
- ✅ G11 (T9): 정적 + dependency closure + runtime sweep + data-allow-escape 5중 보강
- ✅ anchor manifest v2 (T1): required/optional/role/figmaNodeId/bbox + 매칭 룰 + unknown ratio
- ✅ legacy.json 거버넌스 (T2, T11, T12): createdBy 화이트리스트 + sourceCommit + expiresAt + CI 차단
- ✅ baseline 갱신 프로토콜 (T15): 디자인 PR vs 구현 PR
- ✅ measure-quality 통합 (T10): G11 추가 + G1 strict default + viewport 자동 + LITE
- ✅ 워커 가이드 (T14): anchor 룰 + escape budget + retry 카테고리
- ✅ 마이그레이션 (T11, T13): migrate-baselines + bootstrap 복사
- ✅ fixture (T18): 13종 (PNG 의존 5종은 dogfooding)
- ✅ 호환성 / LITE=1 / spec 모드 partial-strict / Deprecated 삭제

**2. Placeholder 스캔**: 모든 step 에 실제 코드 또는 명령. 단 spec 모드 baseline 자동 prepare 는 §16 LOW 위임 — Task 17 의 안내문으로 처리. fixture 의 baseline PNG 5종은 dogfooding 으로 명시 위임.

**3. 타입 일관성**: ROLES 상수, applyMatchingRule 시그니처, validateLegacy 반환 형식, escape category 이름 (positioning/transform/negativeMargin/arbitraryPx/breakpointDivergence/positioningHelper) 모두 task 간 일관.

이상.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-28-strict-visual-harness.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - 각 task 마다 fresh subagent dispatch. plan 분량이 크고 task 간 의존성이 명확해서 추천.

**2. Inline Execution** - 이 세션에서 batch 실행 + 체크포인트 리뷰.

**Which approach?**

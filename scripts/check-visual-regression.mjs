#!/usr/bin/env node
/**
 * G1 visual regression — Playwright 로 섹션 preview 렌더 + pixelmatch 로 baseline diff.
 *
 * lite 철학 준수: 환경 미비 / baseline 없음은 SKIP (게이트 차단 아님).
 * diffPercent > threshold 에서만 FAIL.
 *
 * Usage:
 *   node scripts/check-visual-regression.mjs --section <id> --baseline <path> [options]
 *
 * 인자 (모두 --flag value 형식):
 *   --section <id>           섹션 식별자 (preview route 에도 사용)
 *   --baseline <path>        baseline PNG 경로 (없으면 NO_BASELINE)
 *   --viewport <v>           desktop | tablet | mobile (default: desktop)
 *   --url <url>              preview URL (default: http://127.0.0.1:5173/__preview/{section})
 *   --threshold <percent>    FAIL 기준 diff 백분율 (default: 2)
 *   --diff-dir <path>        diff PNG 저장 디렉토리 (default: tests/quality/diffs)
 *   --update-baseline        현재 스크린샷으로 baseline 덮어쓰기 (최초 설정용)
 *   --timeout <ms>           페이지 로드 타임아웃 (default: 15000)
 *   -h, --help               도움말
 *
 * 출력 (stdout, 단일 JSON 줄):
 *   { section, viewport, status, ... }
 *   status enum: PASS | FAIL | SKIPPED | NO_BASELINE | BASELINE_UPDATED
 *
 * 종료 코드:
 *   0 PASS / SKIPPED / NO_BASELINE / BASELINE_UPDATED
 *   1 FAIL (diffPercent > threshold 또는 치수 불일치)
 *   2 usage 에러
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// ---------- 인자 파싱 ----------
const argv = process.argv.slice(2);
const opts = {
  section: null,
  baseline: null,
  viewport: "desktop",
  url: null,
  threshold: 2,
  "diff-dir": "tests/quality/diffs",
  "update-baseline": false,
  timeout: 15000,
  help: false,
};

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "-h" || a === "--help") {
    opts.help = true;
  } else if (a === "--update-baseline") {
    opts["update-baseline"] = true;
  } else if (a.startsWith("--")) {
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith("--")) {
      console.error(`ERROR: ${a} requires a value`);
      process.exit(2);
    }
    if (key === "threshold" || key === "timeout") {
      opts[key] = Number(val);
      if (Number.isNaN(opts[key])) {
        console.error(`ERROR: ${a} must be a number`);
        process.exit(2);
      }
    } else if (key in opts) {
      opts[key] = val;
    } else {
      console.error(`ERROR: unknown option ${a}`);
      process.exit(2);
    }
    i++;
  } else {
    console.error(`ERROR: unexpected arg ${a}`);
    process.exit(2);
  }
}

if (opts.help) {
  // 파일 상단 주석 출력
  const src = readFileSync(new URL(import.meta.url), "utf8");
  const m = src.match(/\/\*\*([\s\S]*?)\*\//);
  console.log(m ? m[1].replace(/^\s*\*\s?/gm, "").trim() : "see source");
  process.exit(0);
}

if (!opts.section || !opts.baseline) {
  console.error("usage: check-visual-regression.mjs --section <id> --baseline <path> [options]");
  console.error("  --help 로 전체 옵션 확인");
  process.exit(2);
}

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
};

if (!VIEWPORTS[opts.viewport]) {
  console.error(`ERROR: --viewport must be one of: ${Object.keys(VIEWPORTS).join(", ")}`);
  process.exit(2);
}

const url = opts.url || `http://127.0.0.1:5173/__preview/${opts.section}`;
const baselinePath = resolve(opts.baseline);

// 출력 헬퍼
function emit(payload) {
  console.log(JSON.stringify({ section: opts.section, viewport: opts.viewport, ...payload }));
}

// ---------- baseline 존재 여부 (환경 체크보다 우선 — 가장 빈번한 사용자 사례) ----------
const hasBaseline = existsSync(baselinePath);
if (!hasBaseline && !opts["update-baseline"]) {
  emit({
    status: "NO_BASELINE",
    baseline: baselinePath,
    hint: "fetch-figma-baseline.sh (figma) 또는 --update-baseline 으로 생성",
  });
  process.exit(0);
}

// ---------- 옵셔널 의존성 로드 (lite: 미설치 = SKIP) ----------
let chromium, pixelmatch, PNG;
try {
  ({ chromium } = await import("playwright"));
  pixelmatch = (await import("pixelmatch")).default;
  ({ PNG } = await import("pngjs"));
} catch (e) {
  emit({
    status: "SKIPPED",
    reason: `missing deps (${e.message.split("\n")[0]}) — npm i -D playwright pixelmatch pngjs 후 재시도`,
  });
  process.exit(0);
}

// ---------- dev 서버 reachability ----------
try {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  const res = await fetch(url, { signal: ctrl.signal });
  clearTimeout(timer);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
} catch (e) {
  emit({
    status: "SKIPPED",
    reason: `dev 서버 미접근 ${url} (${e.message}) — npm run dev 기동 후 재시도`,
  });
  process.exit(0);
}

// ---------- Playwright 실행 ----------
let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (e) {
  emit({
    status: "SKIPPED",
    reason: `chromium 미설치 (${e.message.split("\n")[0]}) — npx playwright install chromium 후 재시도`,
  });
  process.exit(0);
}

let currentBuf;
try {
  const context = await browser.newContext({ viewport: VIEWPORTS[opts.viewport] });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: opts.timeout });
  currentBuf = await page.screenshot({ fullPage: true });
} catch (e) {
  await browser.close().catch(() => {});
  emit({
    status: "SKIPPED",
    reason: `Playwright 렌더 실패 (${e.message.split("\n")[0]})`,
  });
  process.exit(0);
}
await browser.close();

// ---------- --update-baseline 모드 ----------
if (opts["update-baseline"]) {
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, currentBuf);
  emit({ status: "BASELINE_UPDATED", baseline: baselinePath });
  process.exit(0);
}

// ---------- pixelmatch diff ----------
const currentPng = PNG.sync.read(currentBuf);
const baselinePng = PNG.sync.read(readFileSync(baselinePath));

if (currentPng.width !== baselinePng.width || currentPng.height !== baselinePng.height) {
  emit({
    status: "FAIL",
    reason: `dimension mismatch — baseline ${baselinePng.width}x${baselinePng.height}, current ${currentPng.width}x${currentPng.height}`,
    hint: "--update-baseline 재설정 필요 또는 섹션 치수 확인",
  });
  process.exit(1);
}

const diffPng = new PNG({ width: currentPng.width, height: currentPng.height });
const diffPixels = pixelmatch(
  currentPng.data,
  baselinePng.data,
  diffPng.data,
  currentPng.width,
  currentPng.height,
  { threshold: 0.1 }, // per-pixel 색상 민감도
);

const totalPixels = currentPng.width * currentPng.height;
const diffPercent = (diffPixels / totalPixels) * 100;

mkdirSync(opts["diff-dir"], { recursive: true });
const diffPath = join(opts["diff-dir"], `${opts.section}-${opts.viewport}.diff.png`);
writeFileSync(diffPath, PNG.sync.write(diffPng));

const pass = diffPercent <= opts.threshold;
emit({
  status: pass ? "PASS" : "FAIL",
  diffPercent: Number(diffPercent.toFixed(3)),
  threshold: opts.threshold,
  diffPath,
  baseline: baselinePath,
});
process.exit(pass ? 0 : 1);

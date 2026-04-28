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

// budget check 시 positioningHelper 도 positioning limit 에 포함시킴
// escapeCounts 출력은 granular 하게 유지 (positioning vs positioningHelper 구분),
// 예산 검사 시에만 합산한 budgetCounts 사용
const budgetCounts = { ...escapeCounts, positioning: escapeCounts.positioning + escapeCounts.positioningHelper };
const overBudget = [];
const limits = {
  positioning: opts["budget-positioning"],
  transform: opts["budget-transform"],
  negativeMargin: opts["budget-negative-margin"],
  arbitraryPx: opts["budget-arbitrary-px"],
  breakpointDivergence: opts["budget-breakpoint"],
};
for (const cat of Object.keys(limits)) {
  if (budgetCounts[cat] > limits[cat]) overBudget.push({ category: cat, count: budgetCounts[cat], limit: limits[cat] });
}

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

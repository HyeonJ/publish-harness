#!/usr/bin/env node
/**
 * check-token-usage.mjs — G4 디자인 토큰 사용 게이트.
 *
 * 섹션 .tsx 파일을 AST 파싱해서:
 *   - hex literal (#AABBCC / #RGB)        → FAIL  (토큰 드리프트 방지)
 *   - rgb()/rgba() literal                → FAIL
 *   - Tailwind arbitrary color [#...]     → FAIL
 *   - Tailwind arbitrary spacing [Npx]    → WARN (상대지표)
 *
 * 허용:
 *   - var(--*) 참조
 *   - `text-brand-*`, `bg-surface-*`, `border-*` 등 설정된 토큰 클래스
 *   - transparent / currentColor / inherit
 *   - #fff #000 같은 기본값은 warn 레벨이지만 허용 (공통 CSS reset 지점)
 *
 * Usage:
 *   node scripts/check-token-usage.mjs <section-dir>
 *   node scripts/check-token-usage.mjs <target-dir> --diff <old-tokens.css>
 *     → 토큰 재추출 시 기존 섹션 영향 분석. old vs 현재 tokens.css 비교 후
 *       변경된 토큰명을 참조하는 섹션 파일 리스트 출력.
 *
 * 종료 코드:
 *   0 PASS
 *   1 FAIL (hex/rgb literal 발견)
 *   2 usage error
 *   3 --diff 모드: 영향받는 섹션 있음 (exit 0 과 차별하려고 분리)
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default ?? traverseModule;

const HEX_PATTERN = /#[0-9A-Fa-f]{3,8}\b/g;
const RGB_PATTERN = /rgba?\(\s*\d+[\s,]/g;
const TW_ARB_COLOR_PATTERN = /(?:text|bg|border|fill|stroke|ring|shadow|from|via|to|divide|outline|accent|caret|decoration)-\[#[0-9A-Fa-f]{3,8}\]/g;
const TW_ARB_SPACING_PATTERN = /(?:p|m|gap|top|left|right|bottom|inset|w|h|min-w|min-h|max-w|max-h|translate|space)-\w*\[\-?\d+(?:\.\d+)?px\]/g;

// 화이트리스트: 중립 값
const ALLOWED_COLOR_LITERALS = new Set([
  "#fff", "#ffffff", "#FFF", "#FFFFFF",
  "#000", "#000000",
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (extname(full) === ".tsx" || extname(full) === ".jsx") out.push(full);
  }
  return out;
}

function collectLiterals(file) {
  const code = readFileSync(file, "utf8");
  const failures = [];
  const warnings = [];

  // 1. Tailwind arbitrary hex (className 내부)
  const arbColorMatches = code.matchAll(TW_ARB_COLOR_PATTERN);
  for (const m of arbColorMatches) {
    failures.push({ type: "tw-arbitrary-hex", value: m[0] });
  }

  // 2. AST 기반 hex/rgb literal 검출 (StringLiteral / TemplateLiteral 내부)
  let ast;
  try {
    ast = parse(code, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch (e) {
    // 파싱 실패는 block 아님 (eslint가 별도 잡음)
    return { failures, warnings };
  }

  const checkString = (str, loc) => {
    if (typeof str !== "string") return;
    const hexes = str.match(HEX_PATTERN) || [];
    for (const h of hexes) {
      if (!ALLOWED_COLOR_LITERALS.has(h)) {
        failures.push({ type: "hex-literal", value: h, loc });
      }
    }
    const rgbs = str.match(RGB_PATTERN) || [];
    for (const r of rgbs) {
      failures.push({ type: "rgb-literal", value: r.trim(), loc });
    }
    const arbSpacing = str.match(TW_ARB_SPACING_PATTERN) || [];
    for (const a of arbSpacing) {
      warnings.push({ type: "tw-arbitrary-spacing", value: a, loc });
    }
  };

  traverse(ast, {
    StringLiteral(path) {
      checkString(path.node.value, path.node.loc?.start?.line);
    },
    TemplateLiteral(path) {
      for (const q of path.node.quasis) {
        checkString(q.value.cooked, path.node.loc?.start?.line);
      }
    },
  });

  return { failures, warnings };
}

// --------- diff 모드: 변경된 토큰명 추출 ---------
function extractTokenNames(cssText) {
  // :root { --brand-1: #aaa; ... } 형태에서 토큰명과 값 수집
  const map = new Map();
  const re = /--([\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(cssText))) {
    map.set(m[1], m[2].trim());
  }
  return map;
}

function findChangedTokens(oldCssPath, newCssPath) {
  const oldMap = extractTokenNames(readFileSync(oldCssPath, "utf8"));
  const newMap = extractTokenNames(readFileSync(newCssPath, "utf8"));
  const changed = [];
  const removed = [];
  for (const [k, v] of oldMap) {
    if (!newMap.has(k)) removed.push(k);
    else if (newMap.get(k) !== v) changed.push({ name: k, old: v, new: newMap.get(k) });
  }
  const added = [];
  for (const k of newMap.keys()) if (!oldMap.has(k)) added.push(k);
  return { changed, removed, added };
}

function findReferences(files, tokenNames) {
  // 각 파일에서 해당 토큰명을 참조하는지 문자열 검색 (빠르게)
  const refs = [];
  const names = Array.from(tokenNames);
  for (const f of files) {
    const code = readFileSync(f, "utf8");
    const hits = [];
    for (const n of names) {
      // var(--name) 또는 tailwind 클래스의 -name- 식별
      const varPat = new RegExp(`var\\(\\s*--${n}\\b`);
      const twPat = new RegExp(`-${n}\\b`);
      if (varPat.test(code) || twPat.test(code)) hits.push(n);
    }
    if (hits.length) refs.push({ file: relative(process.cwd(), f), tokens: hits });
  }
  return refs;
}

function runDiffMode(target, oldCssPath) {
  const newCssPath = "src/styles/tokens.css";
  try {
    readFileSync(oldCssPath, "utf8");
  } catch (e) {
    console.error(`ERROR: --diff 기준 파일 없음: ${oldCssPath}`);
    process.exit(2);
  }
  try {
    readFileSync(newCssPath, "utf8");
  } catch (e) {
    console.error(`ERROR: 현재 tokens.css 없음 (${newCssPath}). extract-tokens.sh 먼저 실행?`);
    process.exit(2);
  }

  const { changed, removed, added } = findChangedTokens(oldCssPath, newCssPath);
  const files = walk(target);

  const affectedByChanged = findReferences(files, new Set(changed.map((c) => c.name)));
  const affectedByRemoved = findReferences(files, new Set(removed));

  const report = {
    mode: "diff",
    oldCss: oldCssPath,
    newCss: newCssPath,
    target,
    added,
    removed,
    changed,
    affectedByChanged,
    affectedByRemoved,
  };
  console.log(JSON.stringify(report, null, 2));

  const total = affectedByChanged.length + affectedByRemoved.length;
  if (total > 0) {
    console.error(`\n⚠ ${total}개 파일이 변경/제거된 토큰을 참조합니다. 재검증 필요.`);
    console.error(`   권장: 각 섹션에 measure-quality.sh 재실행`);
    process.exit(3);
  }
  console.error(`✓ 토큰 변경이 기존 섹션에 영향 없음 (added ${added.length}, changed ${changed.length}, removed ${removed.length})`);
  process.exit(0);
}

function main() {
  // args 파싱
  const args = process.argv.slice(2);
  let target = null;
  let diffOld = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--diff") {
      diffOld = args[++i];
    } else if (!target) {
      target = args[i];
    }
  }
  if (!target) {
    console.error("usage: check-token-usage.mjs <section-dir> [--diff <old-tokens.css>]");
    process.exit(2);
  }

  if (diffOld) {
    runDiffMode(target, diffOld);
    return;
  }

  const files = walk(target);
  if (files.length === 0) {
    console.error(`no .tsx/.jsx under ${target}`);
    process.exit(2);
  }

  let totalFail = 0;
  let totalWarn = 0;
  const report = { files: files.length, failures: [], warnings: [] };

  for (const f of files) {
    const { failures, warnings } = collectLiterals(f);
    totalFail += failures.length;
    totalWarn += warnings.length;
    for (const x of failures) report.failures.push({ file: relative(process.cwd(), f), ...x });
    for (const x of warnings) report.warnings.push({ file: relative(process.cwd(), f), ...x });
  }

  console.log(JSON.stringify(report, null, 2));

  if (totalFail > 0) {
    console.error(
      `\n❌ G4 FAIL — ${totalFail}개의 hex/rgb literal 발견. ` +
        `src/styles/tokens.css 의 var(--*) 또는 Tailwind 토큰 클래스로 치환하세요.`,
    );
    process.exit(1);
  }
  if (totalWarn > 0) {
    console.error(`⚠ G4 WARN — ${totalWarn}개의 비-토큰 arbitrary spacing (permitted이지만 재검토 권장)`);
  }
  console.error(`✓ G4 PASS (${files.length} files)`);
  process.exit(0);
}

main();

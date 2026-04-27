#!/usr/bin/env node
/**
 * G4 게이트 (html-static 변형) — HTML 파일의 inline style/<style> 블록과 CSS 파일에서
 * 토큰 외 hex/rgb literal 검출.
 *
 * Usage:
 *   node scripts/check-token-usage-html.mjs <path> [<path> ...]
 *     path: .html 또는 .css 파일 또는 디렉토리. 여러 개 허용 (섹션 격리용).
 *
 * 종료 코드: 0 PASS, 1 FAIL, 2 usage error.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { parse as parseHtml } from "node-html-parser";

const HEX_PATTERN = /#[0-9A-Fa-f]{3,8}\b/g;
const RGB_PATTERN = /rgba?\(\s*\d+[\s,]/g;
const ALLOWED = new Set(["#fff", "#ffffff", "#FFF", "#FFFFFF", "#000", "#000000"]);

function walk(target, out = []) {
  const st = statSync(target);
  if (st.isFile()) {
    const ext = extname(target);
    if (ext === ".html" || ext === ".css") out.push(target);
    return out;
  }
  for (const entry of readdirSync(target)) {
    const full = join(target, entry);
    const st2 = statSync(full);
    if (st2.isDirectory()) walk(full, out);
    else {
      const ext = extname(full);
      if (ext === ".html" || ext === ".css") out.push(full);
    }
  }
  return out;
}

function scanCssText(text) {
  const failures = [];
  const hexes = text.match(HEX_PATTERN) || [];
  for (const h of hexes) if (!ALLOWED.has(h)) failures.push({ type: "hex-literal", value: h });
  const rgbs = text.match(RGB_PATTERN) || [];
  for (const r of rgbs) failures.push({ type: "rgb-literal", value: r.trim() });
  return failures;
}

function scanFile(file) {
  const code = readFileSync(file, "utf8");
  const ext = extname(file);
  if (ext === ".css") return scanCssText(code);
  // .html
  const failures = [];
  const root = parseHtml(code, { lowerCaseTagName: true });
  for (const styleEl of root.querySelectorAll("style")) {
    failures.push(...scanCssText(styleEl.text || ""));
  }
  for (const el of root.querySelectorAll("[style]")) {
    const s = el.getAttribute("style");
    if (s) failures.push(...scanCssText(s));
  }
  return failures;
}

function main() {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    console.error("usage: check-token-usage-html.mjs <path> [<path> ...]");
    process.exit(2);
  }
  const files = [];
  for (const t of targets) walk(t, files);
  if (files.length === 0) {
    console.error(`no .html/.css in: ${targets.join(", ")}`);
    process.exit(2);
  }
  const report = { files: files.length, failures: [] };
  let totalFail = 0;
  for (const f of files) {
    const fails = scanFile(f);
    totalFail += fails.length;
    for (const x of fails) report.failures.push({ file: relative(process.cwd(), f), ...x });
  }
  console.log(JSON.stringify(report, null, 2));
  if (totalFail > 0) {
    console.error(`\n❌ G4 FAIL — ${totalFail} hex/rgb literal 발견. tokens.css 의 var(--*) 로 치환.`);
    process.exit(1);
  }
  console.error(`✓ G4 PASS (${files.length} files)`);
  process.exit(0);
}

main();

#!/usr/bin/env node
/**
 * G6 (text:image ratio + raster-heavy 휴리스틱) + G8 (i18n 가능성) 게이트
 * — html-static 변형. node-html-parser 로 .html 파싱.
 *
 * Usage: node scripts/check-text-ratio-html.mjs <path> [<path> ...]
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { parse as parseHtml } from "node-html-parser";

const RATIO_THRESHOLD = 3;
const ALT_FLOOR_CHARS = 80;
const RASTER_HEAVY_IMG_COUNT = 1;
const RASTER_HEAVY_TEXT_MIN = 10;

function walk(target, out = []) {
  const st = statSync(target);
  if (st.isFile()) {
    if (extname(target) === ".html") out.push(target);
    return out;
  }
  for (const entry of readdirSync(target)) {
    const full = join(target, entry);
    const st2 = statSync(full);
    if (st2.isDirectory()) walk(full, out);
    else if (extname(full) === ".html") out.push(full);
  }
  return out;
}

function analyzeFile(file) {
  const code = readFileSync(file, "utf8");
  const root = parseHtml(code, { lowerCaseTagName: true });

  // body 만 대상으로 — head 의 <title> 등은 사용자 가시 본문 아님
  const body = root.querySelector("body") || root;

  let textChars = 0;
  let altChars = 0;
  let imgCount = 0;
  let hasLiteralText = false;

  // <img> 카운트
  for (const _img of body.querySelectorAll("img")) imgCount++;

  // alt / aria-label / title 집계 (alt chars)
  for (const el of body.querySelectorAll("*")) {
    for (const attr of ["alt", "aria-label", "title"]) {
      const v = el.getAttribute(attr);
      if (typeof v === "string" && v.trim().length > 0) altChars += v.trim().length;
    }
  }

  // innerText (textNode 만, attr 제외)
  function collect(node) {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      const t = (node.text || "").trim();
      if (t.length > 0) {
        textChars += t.length;
        if (/[가-힣a-zA-Z]/.test(t)) hasLiteralText = true;
      }
      return;
    }
    if (node.childNodes) for (const c of node.childNodes) collect(c);
  }
  collect(body);

  return { file, textChars, altChars, imgCount, hasLiteralText };
}

function main() {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    console.error("usage: check-text-ratio-html.mjs <path> [<path> ...]");
    process.exit(2);
  }
  const files = [];
  for (const t of targets) walk(t, files);
  if (files.length === 0) {
    console.error(`no .html in: ${targets.join(", ")}`);
    process.exit(2);
  }
  let totalText = 0, totalAlt = 0, totalImg = 0, anyLiteral = false;
  for (const f of files) {
    const r = analyzeFile(f);
    totalText += r.textChars;
    totalAlt += r.altChars;
    totalImg += r.imgCount;
    if (r.hasLiteralText) anyLiteral = true;
  }
  const ratio = totalAlt === 0 ? Infinity : totalText / totalAlt;
  const rasterHeavy = totalImg >= RASTER_HEAVY_IMG_COUNT && totalText < RASTER_HEAVY_TEXT_MIN;
  const g6 = rasterHeavy
    ? false
    : totalAlt === 0 || totalAlt < ALT_FLOOR_CHARS || ratio >= RATIO_THRESHOLD;
  const g8 = anyLiteral || totalAlt < ALT_FLOOR_CHARS;
  const report = {
    section: targets.length === 1 ? targets[0] : "multi",
    files: files.length,
    textChars: totalText,
    altChars: totalAlt,
    imgCount: totalImg,
    ratio: totalAlt === 0 ? "∞ (no alt)" : ratio.toFixed(2),
    rasterHeavy,
    g6: g6 ? "PASS" : "FAIL",
    g8: g8 ? "PASS" : "FAIL",
    threshold: RATIO_THRESHOLD,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!g6 || !g8) {
    const reason = rasterHeavy
      ? `raster-heavy (img ${totalImg} + text ${totalText}자 < ${RASTER_HEAVY_TEXT_MIN})`
      : `text/alt=${report.ratio}, 임계 ${RATIO_THRESHOLD}:1`;
    console.error(`\n❌ G6/G8 FAIL — ${reason}.`);
    process.exit(1);
  }
  console.error(`✓ G6/G8 PASS (ratio ${report.ratio})`);
  process.exit(0);
}

main();

#!/usr/bin/env node
/**
 * G6 (text:image ratio + raster-heavy 휴리스틱) + G8 (i18n 가능성) 게이트
 * — html-static 변형. node-html-parser 로 .html 파싱.
 *
 * Usage: node scripts/check-text-ratio-html.mjs <path> [<path> ...]
 */

import { readFileSync } from "node:fs";
import { parse as parseHtml } from "node-html-parser";
import { walkByExt } from "./_lib/walk.mjs";
import { judge, writeReport } from "./_lib/text-ratio-judge.mjs";

const HTML_EXTS = new Set([".html"]);

function analyzeFile(file) {
  const code = readFileSync(file, "utf8");
  const root = parseHtml(code, { lowerCaseTagName: true });
  const body = root.querySelector("body") || root;

  let textChars = 0;
  let altChars = 0;
  let imgCount = 0;
  let hasLiteralText = false;

  for (const _img of body.querySelectorAll("img")) imgCount++;

  for (const el of body.querySelectorAll("*")) {
    for (const attr of ["alt", "aria-label", "title"]) {
      const v = el.getAttribute(attr);
      if (typeof v === "string" && v.trim().length > 0) altChars += v.trim().length;
    }
  }

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

  return { textChars, altChars, imgCount, hasLiteralText };
}

function main() {
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    console.error("usage: check-text-ratio-html.mjs <path> [<path> ...]");
    process.exit(2);
  }
  const files = [];
  for (const t of targets) walkByExt(t, HTML_EXTS, files);
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

  const verdict = judge({
    totalText,
    totalAlt,
    totalImg,
    anyLiteral,
    section: targets.length === 1 ? targets[0] : "multi",
    files: files.length,
  });
  const ok = writeReport(verdict, { totalText, totalAlt, totalImg });
  process.exit(ok ? 0 : 1);
}

main();

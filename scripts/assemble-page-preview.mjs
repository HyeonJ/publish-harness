#!/usr/bin/env node
/**
 * assemble-page-preview.mjs — 페이지 통합본 빌더 (template: html-static).
 *
 * 여러 섹션의 preview HTML 을 한 페이지에 stack 으로 합쳐 정식 페이지 산출물 생성.
 * 매트릭스 §Stage 2 D1 (옵션 C) — 페이지 통합본은 정식 산출. 섹션 단독 preview
 * (`public/__preview/<section>/`) 는 G1/G7 측정·디버그·retry 단위로 유지.
 *
 * Usage:
 *   node scripts/assemble-page-preview.mjs --page <name> --sections <s1,s2,...> [--out <path>]
 *
 * 예:
 *   node scripts/assemble-page-preview.mjs --page home \
 *     --sections home-header,home-cta,home-about,home-featured,home-product-grid,home-flavors,home-stocklist,home-footer
 *
 * Default output 경로:
 *   --page home  → public/index.html (web root)
 *   --page <x>   → public/<x>.html
 *   (또는 --out 으로 명시 override)
 *
 * 종료 코드: 0 OK, 1 산출물 모두 누락, 2 usage error.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parse as parseHtml } from "node-html-parser";

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { page: null, sections: null, out: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--page") opts.page = args[++i];
    else if (a === "--sections") opts.sections = args[++i];
    else if (a === "--out") opts.out = args[++i];
    else if (a === "-h" || a === "--help") {
      console.error("usage: assemble-page-preview.mjs --page <name> --sections <s1,s2,...> [--out <path>]");
      process.exit(2);
    } else {
      console.error(`ERROR: unknown arg: ${a}`);
      process.exit(2);
    }
  }
  if (!opts.page || !opts.sections) {
    console.error("usage: assemble-page-preview.mjs --page <name> --sections <s1,s2,...> [--out <path>]");
    process.exit(2);
  }
  if (!opts.out) {
    opts.out = opts.page === "home" ? "public/index.html" : `public/${opts.page}.html`;
  }
  return opts;
}

function main() {
  const opts = parseArgs();
  const sections = opts.sections.split(",").map((s) => s.trim()).filter(Boolean);
  if (sections.length === 0) {
    console.error("ERROR: 섹션 리스트가 비어있음");
    process.exit(2);
  }

  const stylesheets = new Map();
  for (const href of ["/css/tokens.css", "/css/fonts.css", "/css/main.css"]) {
    stylesheets.set(href, true);
  }

  const bodies = [];
  let foundCount = 0;

  for (const s of sections) {
    const path = `public/__preview/${s}/index.html`;
    let html;
    try {
      html = readFileSync(path, "utf8");
    } catch (e) {
      console.warn(`WARN: 섹션 누락 — ${path}`);
      continue;
    }
    foundCount++;
    const root = parseHtml(html, { lowerCaseTagName: true });

    for (const link of root.querySelectorAll('link[rel="stylesheet"]')) {
      const href = link.getAttribute("href");
      if (href) stylesheets.set(href, true);
    }

    const body = root.querySelector("body");
    const inner = body ? body.innerHTML : "";
    bodies.push(`  <!-- ${s} -->\n  <div data-section="${s}">${inner}</div>`);
  }

  if (foundCount === 0) {
    console.error("ERROR: 섹션 산출물을 하나도 찾지 못함");
    process.exit(1);
  }

  const linkTags = [...stylesheets.keys()]
    .map((href) => `  <link rel="stylesheet" href="${href}">`)
    .join("\n");

  const out = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${opts.page}</title>
${linkTags}
</head>
<body>
${bodies.join("\n\n")}
</body>
</html>
`;

  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, out);
  console.log(
    `✓ assembled ${foundCount}/${sections.length} sections → ${opts.out} ` +
      `(stylesheets: ${stylesheets.size})`,
  );
}

main();

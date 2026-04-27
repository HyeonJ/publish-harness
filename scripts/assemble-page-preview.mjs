#!/usr/bin/env node
/**
 * assemble-page-preview.mjs — preview 어셈블리 도구.
 *
 * 여러 섹션의 preview HTML 을 한 페이지에 stack 으로 합쳐 시각 확인용 통합본 생성.
 * 매트릭스 §Stage 2 D1 결정 ("페이지 통합은 사용자 책임") 를 깨지 않는 임시 시각
 * 도구다 — 프로덕션 빌드가 아니라 "preview 어셈블리". 실제 프로덕션 페이지는
 * 사용자가 Astro/11ty/Vite plugin/기타 도구로 빌드.
 *
 * Usage:
 *   node scripts/assemble-page-preview.mjs <page> <section1,section2,...>
 *
 * 예:
 *   node scripts/assemble-page-preview.mjs home \
 *     home-header,home-cta,home-about,home-featured,home-product-grid,home-flavors,home-stocklist,home-footer
 *
 * 동작:
 *   - 각 섹션의 public/__preview/{section}/index.html 을 읽어 <body> 내용 추출
 *   - 모든 섹션의 <link rel="stylesheet"> 태그 통합 (중복 제거, 등장 순서 유지)
 *   - 통합 head + body 에 섹션 wrapper 로 stack
 *   - output: public/__assembled/{page}.html
 *
 * 종료 코드: 0 OK, 1 산출물 모두 누락, 2 usage error.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parse as parseHtml } from "node-html-parser";

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    console.error("usage: assemble-page-preview.mjs <page> <section1,section2,...>");
    process.exit(2);
  }
  const [page, sectionsCsv] = args;
  const sections = sectionsCsv.split(",").map((s) => s.trim()).filter(Boolean);
  if (sections.length === 0) {
    console.error("ERROR: 섹션 리스트가 비어있음");
    process.exit(2);
  }

  // 통합 stylesheet — 등장 순서 유지 (Map 사용)
  const stylesheets = new Map();
  // 기본 globals 먼저
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
  <title>${page} — Assembled Preview (visual only, not production build)</title>
${linkTags}
</head>
<body>
${bodies.join("\n\n")}
</body>
</html>
`;

  mkdirSync("public/__assembled", { recursive: true });
  const outPath = `public/__assembled/${page}.html`;
  writeFileSync(outPath, out);
  console.log(
    `✓ assembled ${foundCount}/${sections.length} sections → ${outPath} ` +
      `(stylesheets: ${stylesheets.size})`,
  );
}

main();

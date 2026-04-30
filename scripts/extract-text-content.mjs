#!/usr/bin/env node
/**
 * extract-text-content.mjs — Figma REST 일괄 호출 → 모든 텍스트 노드의 characters 추출.
 *
 * beverage-product §M10/B-6: get_metadata 응답의 노드 이름이 placeholder
 * ("BOLD TITLE OF YOUR STORY") 라 워커가 그대로 박음. 실제 콘텐츠
 * ("Your boost of energy ⚡") 는 design_context 또는 REST `characters` 필드에만
 * 존재. M7 회피 default 가이드 (design_context 호출 금지) 와 충돌하지 않게
 * Phase 2 분해 단계에서 일괄 추출 → docs/text-content.md 단일 진실의 원천.
 *
 * Usage:
 *   node scripts/extract-text-content.mjs \
 *     --file-key <key> \
 *     --page-node <id> \
 *     --out docs/text-content.md
 *
 * 출력 형식 (docs/text-content.md):
 *   # Text Content — figma 추출
 *   생성: <ISO date>
 *   page-node: <id>
 *
 *   | section | nodeId | role | characters |
 *   |---|---|---|---|
 *   | section-3-features | 1:234 | TEXT | Your boost of energy ⚡ |
 *
 * 환경변수: FIGMA_TOKEN
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = true;
      }
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const required = ["file-key", "page-node", "out"];
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

// page node + 깊이 충분히 (depth=8 — section 안 자식 트리 까지). 응답 사이즈 ↑ 단
// design_context 보다 작음 (text 만 추출, raster fill / blend / effect 데이터 무관).
const url = `https://api.figma.com/v1/files/${opts["file-key"]}/nodes?ids=${encodeURIComponent(opts["page-node"])}&depth=8`;
const res = await fetch(url, { headers: { "X-Figma-Token": TOKEN } });
if (!res.ok) {
  console.error(`ERROR: Figma REST failed ${res.status}`);
  process.exit(1);
}
const json = await res.json();
const pageNode = Object.values(json.nodes)[0]?.document;
if (!pageNode) {
  console.error("ERROR: page node not found");
  process.exit(1);
}

// section 식별 — page 의 직속 자식 중 FRAME (이름이 section 후보)
// 단순화: 노드 트리 traverse 하면서 가장 가까운 FRAME 의 name 을 section 으로
const textNodes = [];
function walk(node, sectionName) {
  if (!node) return;
  // section 이름 갱신 (FRAME 만, 또는 명시적 section 이름 패턴)
  let nextSection = sectionName;
  if (node.type === "FRAME" && node.name) {
    // 명시적 section 이름이 있으면 갱신 (sectionName 이 비어있거나 자식 FRAME 일 때)
    nextSection = node.name;
  }
  if (node.type === "TEXT" && typeof node.characters === "string") {
    textNodes.push({
      section: sectionName || nextSection || "(unknown)",
      nodeId: node.id,
      name: node.name || "",
      characters: node.characters,
      // 추가 메타 — fontFamily / fontSize (B-4 보조 — design_context 호출 없이 폰트 정보)
      fontFamily: node.style?.fontFamily || null,
      fontSize: node.style?.fontSize || null,
      fontWeight: node.style?.fontWeight || null,
    });
  }
  if (node.children) {
    for (const c of node.children) walk(c, nextSection);
  }
}
walk(pageNode, null);

// markdown 출력
const lines = [];
lines.push("# Text Content — figma 추출");
lines.push("");
lines.push(`> 생성: ${new Date().toISOString()}`);
lines.push(`> page-node: \`${opts["page-node"]}\``);
lines.push(`> 총 텍스트 노드: ${textNodes.length}`);
lines.push("");
lines.push("**B-6 (beverage-product §M10/B-6) 차단 메커니즘**:");
lines.push("get_metadata 응답의 노드 이름은 placeholder. 실제 figma 텍스트는 이 파일이");
lines.push("진실의 원천. workers 는 docs/text-content.md 의 `characters` 필드를 그대로 사용.");
lines.push("");
lines.push("| section | nodeId | name | characters | fontFamily | fontSize |");
lines.push("|---|---|---|---|---|---|");
for (const t of textNodes) {
  // characters 안에 | 또는 \n 있으면 escape
  const escaped = t.characters
    .replace(/\|/g, "\\|")
    .replace(/\n/g, "<br>")
    .slice(0, 200); // 너무 긴 텍스트는 자름 (희귀)
  const sectionEsc = (t.section || "").replace(/\|/g, "\\|");
  const nameEsc = (t.name || "").replace(/\|/g, "\\|");
  lines.push(`| ${sectionEsc} | \`${t.nodeId}\` | ${nameEsc} | ${escaped} | ${t.fontFamily || "-"} | ${t.fontSize || "-"} |`);
}

const outPath = resolve(opts.out);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, lines.join("\n") + "\n");

console.log(JSON.stringify({
  out: opts.out,
  total: textNodes.length,
  sections: [...new Set(textNodes.map((t) => t.section))].length,
}));

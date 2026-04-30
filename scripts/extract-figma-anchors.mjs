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
if (!sectionAbs) {
  console.error("ERROR: section root node has no absoluteBoundingBox");
  process.exit(1);
}

function isMeaningfulName(name) {
  if (!name) return false;
  if (/^Frame\s*\d+$/i.test(name)) return false;
  if (/^Group\s*\d*$/i.test(name)) return false;
  if (/^Rectangle\s*\d*$/i.test(name)) return false;
  return true;
}

// N2 가드 (a): interactive 부모 이름 패턴 — 이 안의 TEXT 자식은 text-block role 부여 금지
//   회고 §F3-(a): Header 워커가 anchor data-role="text-block" 을 <a> 링크에 할당하니
//   G1 L2 매칭 실패 (text-bearing semantic element 검사). manifest 단계에서 차단.
const INTERACTIVE_NAME_PATTERN = /button|cta|link|btn/i;

function isInteractiveAncestor(parents) {
  return parents.some((p) =>
    (p.type === "INSTANCE" || p.type === "COMPONENT" || p.type === "FRAME") &&
    INTERACTIVE_NAME_PATTERN.test(p.name || "")
  );
}

function inferRole(node, depth, parents) {
  const name = (node.name || "").toLowerCase();
  if (depth === 0) return ROLES.SECTION_ROOT;
  if (node.type === "TEXT") {
    // 가드 (a): interactive 부모 안 텍스트는 text-block role 부여 금지
    if (isInteractiveAncestor(parents)) return null; // skip — CTA/link 의 텍스트는 부모 anchor 가 cover
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

// N2 가드 (b): 0-size element 제외
//   회고 §F3-(b): SVG path 같은 0-size 노드를 optional anchor 로 포함시키니
//   getBoundingClientRect 매칭 실패. 추출 단계에서 제외.
function hasMeasurableBbox(abs) {
  return abs && abs.width > 0 && abs.height > 0;
}

const anchors = [];
// N2 가드 (c): sibling name collision — 같은 id 면 -1, -2 suffix 자동 부여.
//   회고 §F3-(c): "2025"×2 / "2024"×2 같은 이름 collision 으로 about-founder 워커가
//   수동 분리. 추출 단계에서 자동 처리.
const idCounter = new Map();
function uniqueId(baseId) {
  const count = idCounter.get(baseId) || 0;
  idCounter.set(baseId, count + 1);
  return count === 0 ? baseId : `${baseId}-${count + 1}`;
}

function walk(node, depth = 0, parents = []) {
  const role = inferRole(node, depth, parents);
  if (role && hasMeasurableBbox(node.absoluteBoundingBox)) {
    const abs = node.absoluteBoundingBox;
    const baseId = depth === 0
      ? `${opts.section}/root`
      : `${opts.section}/${slugify(node.name || `node-${node.id}`)}`;
    anchors.push({
      id: uniqueId(baseId),
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
    const nextParents = [...parents, node];
    for (const c of node.children) walk(c, depth + 1, nextParents);
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

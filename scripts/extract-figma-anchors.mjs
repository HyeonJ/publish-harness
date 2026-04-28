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
      opts[argv[i].slice(2)] = argv[i + 1];
      i++;
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

function isMeaningfulName(name) {
  if (!name) return false;
  if (/^Frame\s*\d+$/i.test(name)) return false;
  if (/^Group\s*\d*$/i.test(name)) return false;
  if (/^Rectangle\s*\d*$/i.test(name)) return false;
  return true;
}

function inferRole(node, depth) {
  const name = (node.name || "").toLowerCase();
  if (depth === 0) return ROLES.SECTION_ROOT;
  if (node.type === "TEXT") {
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

const anchors = [];
function walk(node, depth = 0) {
  const role = inferRole(node, depth);
  if (role && node.absoluteBoundingBox) {
    const abs = node.absoluteBoundingBox;
    const id = `${opts.section}/${slugify(node.name || `node-${node.id}`)}`;
    anchors.push({
      id: depth === 0 ? `${opts.section}/root` : id,
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
    for (const c of node.children) walk(c, depth + 1);
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

#!/usr/bin/env node
/**
 * prepare-baseline.mjs — figma/spec 모드 통합 baseline 준비.
 *
 * 결과:
 *   baselines/<section>/<viewport>.png
 *   baselines/<section>/anchors-<viewport>.json
 *
 * Usage:
 *   node scripts/prepare-baseline.mjs \
 *     --mode figma --section hero --viewports desktop,tablet,mobile \
 *     --file-key <key> --section-node <id>
 *   node scripts/prepare-baseline.mjs \
 *     --mode spec --section hero --viewports desktop \
 *     --reference-html docs/handoff/sections/hero.html
 *
 * --force 로 캐시 우회.
 * --force 시 stderr 에 anchor diff report 출력 (stdout 은 단일 JSON summary).
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { readManifest } from "./_lib/anchor-manifest.mjs";

function parseArgs(argv) {
  const opts = { force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--force") { opts.force = true; continue; }
    if (argv[i].startsWith("--")) { opts[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const required = ["mode", "section", "viewports"];
for (const r of required) {
  if (!opts[r]) { console.error(`ERROR: --${r} required`); process.exit(2); }
}
const viewports = opts.viewports.split(",").map((v) => v.trim());
const baselineDir = resolve(`baselines/${opts.section}`);
mkdirSync(baselineDir, { recursive: true });

const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname.replace(/^\/(\w):/, "$1:"));

async function diffManifests(oldPath, newPath) {
  const oldM = readManifest(oldPath);
  const newM = readManifest(newPath);
  if (!oldM) return [{ id: "(new manifest)", change: "INITIAL" }];
  const oldMap = new Map(oldM.anchors.map((a) => [a.id, a]));
  const newMap = new Map(newM.anchors.map((a) => [a.id, a]));
  const changes = [];
  for (const [id, n] of newMap) {
    const o = oldMap.get(id);
    if (!o) { changes.push({ id, change: "ADDED", role: n.role }); continue; }
    if (o.role !== n.role) { changes.push({ id, change: "ROLE", from: o.role, to: n.role }); }
    const dx = n.bbox.x - o.bbox.x;
    const dy = n.bbox.y - o.bbox.y;
    const dw = n.bbox.w - o.bbox.w;
    const dh = n.bbox.h - o.bbox.h;
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dw) + Math.abs(dh) > 0) {
      changes.push({ id, change: "BBOX", delta: { x: dx, y: dy, w: dw, h: dh } });
    }
  }
  for (const [id] of oldMap) {
    if (!newMap.has(id)) changes.push({ id, change: "REMOVED" });
  }
  return changes;
}

async function prepareViewport(viewport) {
  const pngPath = join(baselineDir, `${viewport}.png`);
  const manifestPath = join(baselineDir, `anchors-${viewport}.json`);
  let manifestBefore = null;
  if (existsSync(manifestPath)) {
    try { manifestBefore = readFileSync(manifestPath, "utf8"); } catch {
      // 파일이 existsSync ↔ readFileSync 사이에 사라졌거나 권한 flake — diff report best-effort
    }
  }

  // 캐싱: --force 아니면 mtime 비교는 fetch source 별로. 단순화 — 이미 존재하면 SKIP (force 외).
  if (existsSync(pngPath) && existsSync(manifestPath) && !opts.force) {
    return { viewport, status: "CACHED", pngPath, manifestPath };
  }

  if (opts.mode === "figma") {
    if (!opts["file-key"] || !opts["section-node"]) {
      throw new Error("figma 모드는 --file-key + --section-node 필요");
    }
    // 1) png
    execSync(
      `bash "${SCRIPT_DIR}/figma-rest-image.sh" "${opts["file-key"]}" "${opts["section-node"]}" "${pngPath}" --scale 2`,
      { stdio: "inherit" }
    );
    // 2) anchors
    execSync(
      `node "${SCRIPT_DIR}/extract-figma-anchors.mjs" --file-key "${opts["file-key"]}" --section-node "${opts["section-node"]}" --section "${opts.section}" --viewport "${viewport}" --out "${manifestPath}"`,
      { stdio: "inherit" }
    );
  } else if (opts.mode === "spec") {
    // --reference-html 검증 — 의도 문서화용 (실제 호출은 LOW 위임)
    if (!opts["reference-html"]) {
      console.error("WARN: --reference-html 없음 (spec 모드 baseline 자동 생성은 LOW 위임 (#3))");
    }
    console.error(`spec 모드 baseline 자동 생성은 LOW 위임 (#3) — 수동으로 baselines/<section>/<viewport>.png 준비 필요`);
    return { viewport, status: "SKIPPED_SPEC_MODE", reason: "spec mode auto-prep deferred", pngPath, manifestPath };
  }

  let diffReport = null;
  if (opts.force && manifestBefore) {
    const tmpPath = manifestPath + ".prev";
    writeFileSync(tmpPath, manifestBefore);
    try {
      diffReport = await diffManifests(tmpPath, manifestPath);
    } finally {
      unlinkSync(tmpPath);
    }
  }
  return { viewport, status: "PREPARED", pngPath, manifestPath, diffReport };
}

const results = [];
for (const v of viewports) {
  try {
    results.push(await prepareViewport(v));
  } catch (e) {
    results.push({ viewport: v, status: "FAIL", reason: e.message });
  }
}

console.log(JSON.stringify({ section: opts.section, mode: opts.mode, results }, null, 2));

// --force 시 diff report 출력
if (opts.force) {
  for (const r of results) {
    if (r.diffReport && r.diffReport.length) {
      console.error(`\nAnchor changes (${r.viewport}):`);
      for (const c of r.diffReport) {
        console.error(`  ${c.id}: ${c.change}${c.delta ? ` ${JSON.stringify(c.delta)}` : ""}${c.from ? ` ${c.from} → ${c.to}` : ""}`);
      }
    }
  }
}

const fail = results.some((r) => r.status === "FAIL");
process.exit(fail ? 1 : 0);

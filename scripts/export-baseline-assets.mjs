#!/usr/bin/env node
/**
 * Export implementation assets by cropping the authoritative G1 baseline PNG.
 *
 * Use this when Figma REST baseline pixels must match implementation media more
 * closely than a separate MCP/rendered asset export. It reads
 * baselines/<section>/<viewport>.png plus anchors-<viewport>.json and writes
 * cropped PNGs for selected anchor ids or roles.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { PNG } from "pngjs";
import { readManifest } from "./_lib/anchor-manifest.mjs";

function parseArgs(argv) {
  const opts = {
    viewport: "desktop",
    "out-dir": null,
    ids: "",
    roles: "",
    prefix: "",
  };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith("--")) {
      opts[key] = true;
    } else {
      opts[key] = val;
      i++;
    }
  }
  return opts;
}

function slugFromId(id) {
  return id.split("/").pop().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "");
}

function cropPng(src, bbox) {
  const x = Math.max(0, Math.round(bbox.x));
  const y = Math.max(0, Math.round(bbox.y));
  const w = Math.min(Math.round(bbox.w), src.width - x);
  const h = Math.min(Math.round(bbox.h), src.height - y);
  if (w <= 0 || h <= 0) throw new Error(`invalid crop bbox ${JSON.stringify(bbox)} for ${src.width}x${src.height}`);

  const dst = new PNG({ width: w, height: h });
  PNG.bitblt(src, dst, x, y, w, h, 0, 0);
  return dst;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.section) {
  console.error("usage: export-baseline-assets.mjs --section <section> [--viewport desktop] [--ids a,b] [--roles primary-media,decorative] --out-dir <dir>");
  process.exit(2);
}

const outDir = opts["out-dir"] || `src/assets/${opts.section}`;
const baselinePath = opts.baseline || join("baselines", opts.section, `${opts.viewport}.png`);
const manifestPath = opts.manifest || join("baselines", opts.section, `anchors-${opts.viewport}.json`);
if (!existsSync(baselinePath)) {
  console.error(`ERROR: baseline PNG missing: ${baselinePath}`);
  process.exit(2);
}
if (!existsSync(manifestPath)) {
  console.error(`ERROR: anchor manifest missing: ${manifestPath}`);
  process.exit(2);
}

const wantedIds = new Set(String(opts.ids || "").split(",").map((s) => s.trim()).filter(Boolean));
const wantedRoles = new Set(String(opts.roles || "").split(",").map((s) => s.trim()).filter(Boolean));
if (!wantedIds.size && !wantedRoles.size) {
  console.error("ERROR: provide --ids or --roles");
  process.exit(2);
}

const baseline = PNG.sync.read(readFileSync(baselinePath));
const manifest = readManifest(manifestPath);
const anchors = manifest.anchors.filter((anchor) =>
  anchor.bbox && (wantedIds.has(anchor.id) || wantedRoles.has(anchor.role))
);

mkdirSync(outDir, { recursive: true });
const exports = [];
for (const anchor of anchors) {
  const png = cropPng(baseline, anchor.bbox);
  const name = `${opts.prefix || ""}${slugFromId(anchor.id)}.png`;
  const outPath = join(outDir, name);
  writeFileSync(outPath, PNG.sync.write(png));
  exports.push({ id: anchor.id, role: anchor.role, outPath, width: png.width, height: png.height });
}

console.log(JSON.stringify({
  status: "PASS",
  section: opts.section,
  baseline: basename(baselinePath),
  manifest: manifestPath,
  outDir,
  exports,
}, null, 2));

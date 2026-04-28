#!/usr/bin/env node
/**
 * migrate-baselines.mjs — 기존 프로젝트 1회 마이그레이션 + --renew.
 *
 * Usage:
 *   node scripts/migrate-baselines.mjs --section hero --reason "기존 프로젝트"
 *   node scripts/migrate-baselines.mjs --renew --section hero
 *   node scripts/migrate-baselines.mjs --all --reason "..." (모든 baselines/<section>/ 일괄)
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { issueLegacy, renewLegacy, readLegacy, writeLegacy } from "./_lib/legacy-manifest.mjs";

function parseArgs(argv) {
  const o = { all: false, renew: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--all") { o.all = true; continue; }
    if (argv[i] === "--renew") { o.renew = true; continue; }
    if (argv[i].startsWith("--")) { o[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return o;
}

const opts = parseArgs(process.argv.slice(2));
let sourceCommit;
try {
  sourceCommit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
} catch {
  sourceCommit = "0000000";
}

function processSection(section) {
  const dir = resolve(`baselines/${section}`);
  if (!existsSync(dir)) {
    console.error(`SKIP ${section}: baselines/ 부재`);
    return;
  }
  const legacyPath = join(dir, "legacy.json");
  // 어떤 viewport png 있는지
  const hasViewport = ["desktop","tablet","mobile"].filter((v) => existsSync(join(dir, `${v}.png`)));
  const skipViewports = ["desktop","tablet","mobile"].filter((v) => !hasViewport.includes(v));
  const hasManifest = ["desktop","tablet","mobile"].some((v) => existsSync(join(dir, `anchors-${v}.json`)));

  if (opts.renew) {
    const cur = readLegacy(legacyPath);
    if (!cur) { console.error(`${section}: --renew 인데 legacy.json 부재`); return; }
    const renewed = renewLegacy(cur, { sourceCommit });
    writeLegacy(legacyPath, renewed);
    console.log(`RENEWED ${section}: expiresAt=${renewed.expiresAt}`);
    return;
  }

  // 신규 발급
  const legacy = issueLegacy({
    creator: "migrate-baselines",
    reason: opts.reason || "1회 마이그레이션 — strict 점진 도입",
    skipL2: !hasManifest,
    skipViewports,
    sourceCommit,
  });
  writeLegacy(legacyPath, legacy);
  console.log(`ISSUED ${section}: skipL2=${legacy.skipL2}, skipViewports=[${skipViewports.join(",")}], expiresAt=${legacy.expiresAt}`);
}

if (opts.all) {
  const baseDir = resolve("baselines");
  if (!existsSync(baseDir)) { console.error("baselines/ 부재 — 마이그레이션 대상 없음"); process.exit(0); }
  for (const e of readdirSync(baseDir)) {
    if (statSync(join(baseDir, e)).isDirectory()) processSection(e);
  }
} else if (opts.section) {
  processSection(opts.section);
} else {
  console.error("usage: --section <id> 또는 --all");
  process.exit(2);
}

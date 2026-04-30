#!/usr/bin/env node
/**
 * migrate-baselines.mjs — 기존 프로젝트 1회 마이그레이션 + --renew + --detect-self-capture.
 *
 * Usage:
 *   node scripts/migrate-baselines.mjs --section hero --reason "기존 프로젝트"
 *   node scripts/migrate-baselines.mjs --renew --section hero
 *   node scripts/migrate-baselines.mjs --all --reason "..." (모든 baselines/<section>/ 일괄)
 *   node scripts/migrate-baselines.mjs --detect-self-capture (B-1 backwards compat 검사)
 *
 * B-1 backwards compat (self-capture detect):
 *   beverage-product §M6 회피 회로 발현으로 기존 baselines/ 의 anchor manifest 가
 *   self-capture (preview viewport 좌표) 일 가능성. figmaPageWidth 부재가 강한 시그널.
 *   detect 시 사람이 prepare-baseline.mjs --force (UPDATE_BASELINE_ALLOWED=1) 로 figma 재생성.
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { issueLegacy, renewLegacy, readLegacy, writeLegacy } from "./_lib/legacy-manifest.mjs";

function parseArgs(argv) {
  const o = { all: false, renew: false, "detect-self-capture": false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--all") { o.all = true; continue; }
    if (argv[i] === "--renew") { o.renew = true; continue; }
    if (argv[i] === "--detect-self-capture") { o["detect-self-capture"] = true; continue; }
    if (argv[i].startsWith("--")) { o[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return o;
}

/**
 * B-1 self-capture detect — 기존 baseline 의 anchor manifest 에 figmaPageWidth 부재면
 * self-capture (preview 좌표) 의심. figma 좌표 기반 normalize 안 됨 → migrate 필요.
 */
function detectSelfCapture(baselineDir) {
  const reasons = [];
  for (const v of ["desktop", "tablet", "mobile"]) {
    const manifestPath = join(baselineDir, `anchors-${v}.json`);
    if (!existsSync(manifestPath)) continue;
    let m;
    try { m = JSON.parse(readFileSync(manifestPath, "utf8")); } catch { continue; }
    if (m.figmaPageWidth == null) {
      reasons.push(`${v}: figmaPageWidth 부재 (B-1b 이전 박힘 — self-capture 가능성)`);
    }
    // 추가 휴리스틱: source 필드가 'self' 면 명시적 self-capture
    if (m.source === "self") {
      reasons.push(`${v}: source='self' 명시 (deprecated — 분석 원칙 #1 위반)`);
    }
  }
  return reasons;
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

if (opts["detect-self-capture"]) {
  // B-1 backwards compat — self-capture suspect 일괄 detect
  const baseDir = resolve("baselines");
  if (!existsSync(baseDir)) { console.error("baselines/ 부재 — detect 대상 없음"); process.exit(0); }
  const suspects = [];
  for (const e of readdirSync(baseDir)) {
    const sectionDir = join(baseDir, e);
    if (!statSync(sectionDir).isDirectory()) continue;
    const reasons = detectSelfCapture(sectionDir);
    if (reasons.length) suspects.push({ section: e, reasons });
  }
  console.log(JSON.stringify({ suspectCount: suspects.length, suspects }, null, 2));
  if (suspects.length) {
    console.error(
      `\n⚠ ${suspects.length} 섹션 self-capture 의심 (figmaPageWidth 부재).\n` +
      `figma 가 유일한 baseline 진실의 원천 (분석 원칙 #1).\n` +
      `migrate 경로:\n` +
      `  UPDATE_BASELINE_ALLOWED=1 node scripts/prepare-baseline.mjs \\\n` +
      `    --mode figma --section <id> --viewports desktop,... \\\n` +
      `    --file-key <FILE_KEY> --section-node <NODE_ID> --page-node <PAGE_ID> --force\n` +
      `\n또는 일시적 legacy 표기 (grace period):\n` +
      `  node scripts/migrate-baselines.mjs --section <id> --reason "..."\n`
    );
    process.exit(1);
  }
  console.log("✓ self-capture 의심 0건 — 모든 baseline figma 출처");
  process.exit(0);
} else if (opts.all) {
  const baseDir = resolve("baselines");
  if (!existsSync(baseDir)) { console.error("baselines/ 부재 — 마이그레이션 대상 없음"); process.exit(0); }
  for (const e of readdirSync(baseDir)) {
    if (statSync(join(baseDir, e)).isDirectory()) processSection(e);
  }
} else if (opts.section) {
  processSection(opts.section);
} else {
  console.error("usage: --section <id> | --all | --detect-self-capture");
  process.exit(2);
}

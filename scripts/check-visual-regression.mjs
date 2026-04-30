#!/usr/bin/env node
/**
 * G1 visual regression — strict 모드 확장.
 *
 * Lite (기존, backward compat):
 *   node scripts/check-visual-regression.mjs --section <id> --baseline <path> [--viewport desktop]
 *   → 단일 viewport pixel diff. SKIPPED/NO_BASELINE 차단 안 함.
 *
 * Strict (신규):
 *   node scripts/check-visual-regression.mjs --section <id> --baseline-dir baselines/<id>/ \
 *     --viewports desktop,tablet,mobile --threshold-l1 5 --threshold-l2-px 4 --threshold-l2-pct 1 --strict
 *   → multi-viewport 병렬, L1 mask + 35% 상한, L2 mixed tolerance, manifest v2,
 *     legacy.json 거버넌스, strictEffective 출력.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readManifest, applyMatchingRule, ROLES } from "./_lib/anchor-manifest.mjs";
import { readLegacy, validateLegacy } from "./_lib/legacy-manifest.mjs";
import { newStableContext, stabilizePage, attachConsoleErrorCollector, assertEnvironmentClean } from "./_lib/playwright-stable.mjs";

// B-1b: PNG nearest-neighbor resize (sharp 의존성 없이). pngjs RGBA buffer 직접 조작.
// 정밀도 < bilinear 단 % budget 안에서 흡수. dimension mismatch normalize 용.
let _PNG_CONSTRUCTOR;
function resizePngNearest(srcPng, newWidth, newHeight) {
  if (!_PNG_CONSTRUCTOR) _PNG_CONSTRUCTOR = srcPng.constructor;
  const dst = new _PNG_CONSTRUCTOR({ width: newWidth, height: newHeight });
  const ratioX = srcPng.width / newWidth;
  const ratioY = srcPng.height / newHeight;
  for (let y = 0; y < newHeight; y++) {
    const srcY = Math.min(srcPng.height - 1, Math.floor(y * ratioY));
    for (let x = 0; x < newWidth; x++) {
      const srcX = Math.min(srcPng.width - 1, Math.floor(x * ratioX));
      const srcIdx = (srcY * srcPng.width + srcX) * 4;
      const dstIdx = (y * newWidth + x) * 4;
      dst.data[dstIdx] = srcPng.data[srcIdx];
      dst.data[dstIdx + 1] = srcPng.data[srcIdx + 1];
      dst.data[dstIdx + 2] = srcPng.data[srcIdx + 2];
      dst.data[dstIdx + 3] = srcPng.data[srcIdx + 3];
    }
  }
  return dst;
}

// ---------- 인자 ----------
const argv = process.argv.slice(2);
const opts = {
  section: null,
  baseline: null,
  "baseline-dir": null,
  viewport: "desktop",
  viewports: null,
  url: null,
  "preview-base": "http://127.0.0.1:5173",
  "threshold-l1": 5,
  "threshold-l2-px": 4,
  "threshold-l2-pct": 1,
  "diff-dir": "tests/quality/diffs",
  "update-baseline": false,
  strict: false,
  timeout: 15000,
  help: false,
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "-h" || a === "--help") { opts.help = true; }
  else if (a === "--update-baseline") opts["update-baseline"] = true;
  else if (a === "--strict") opts.strict = true;
  else if (a.startsWith("--")) {
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith("--")) { console.error(`ERROR: ${a} requires value`); process.exit(2); }
    if (["threshold-l1","threshold-l2-px","threshold-l2-pct","timeout"].includes(key)) {
      opts[key] = Number(val);
      if (Number.isNaN(opts[key])) { console.error(`ERROR: ${a} must be a number`); process.exit(2); }
    } else opts[key] = val;
    i++;
  } else { console.error(`ERROR: unexpected arg ${a}`); process.exit(2); }
}

if (opts.help) {
  console.log(`G1 visual regression — strict + lite 양쪽 지원.\nlite: --baseline <path>\nstrict: --baseline-dir <dir> --viewports desktop,tablet,mobile --strict`);
  process.exit(0);
}

if (!opts.section) { console.error("usage: --section <id>"); process.exit(2); }

// 모드 분기: --strict 있고 --baseline-dir 있으면 strict, 아니면 lite (기존 동작)
const STRICT = opts.strict && opts["baseline-dir"];

// ---------- 옵셔널 의존성 (lite 호환) ----------
let chromium, pixelmatch, PNG;
try {
  ({ chromium } = await import("playwright"));
  pixelmatch = (await import("pixelmatch")).default;
  ({ PNG } = await import("pngjs"));
} catch (e) {
  console.log(JSON.stringify({
    section: opts.section,
    status: "SKIPPED",
    reason: `missing deps (${e.message.split("\n")[0]}) — npm i -D playwright pixelmatch pngjs`,
    strictEffective: false,
  }));
  process.exit(0);
}

if (!STRICT) {
  // === LITE 모드 (기존 동작 backward compat) — 별도 호출 함수 ===
  await runLite();
} else {
  await runStrict();
}

// ============ LITE ============
async function runLite() {
  if (!opts.baseline) { console.error("lite: --baseline required"); process.exit(2); }
  const baselinePath = resolve(opts.baseline);
  if (!existsSync(baselinePath) && !opts["update-baseline"]) {
    console.log(JSON.stringify({ section: opts.section, viewport: opts.viewport, status: "NO_BASELINE", baseline: baselinePath }));
    process.exit(0);
  }
  const url = opts.url || `${opts["preview-base"]}/__preview/${opts.section}`;
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (e) {
    console.log(JSON.stringify({ section: opts.section, status: "SKIPPED", reason: `chromium 미설치 (${e.message.split("\n")[0]})` }));
    process.exit(0);
  }
  let currentBuf;
  let envCheckError = null;
  try {
    const ctx = await newStableContext(browser, opts.viewport);
    const page = await ctx.newPage();
    const collector = attachConsoleErrorCollector(page);
    await stabilizePage(page, { url, timeout: opts.timeout });
    // 환경 무결성 sanity check (B2):
    // baseline 박을 때 (--update-baseline) 또는 lite 비교 시 dev 서버 fallback 폰트 / console error
    // 가 있으면 잘못된 baseline 캡처 → strict gate 영원히 PASS. 캡처 직전 차단.
    try {
      await assertEnvironmentClean({
        page,
        errors: collector.errors,
        section: opts.section,
        viewport: opts.viewport,
      });
    } catch (envErr) {
      envCheckError = envErr;
    }
    currentBuf = await page.screenshot({ fullPage: true });
  } catch (e) {
    await browser.close().catch(() => {});
    console.log(JSON.stringify({ section: opts.section, status: "SKIPPED", reason: `Playwright 렌더 실패 (${e.message.split("\n")[0]})` }));
    process.exit(0);
  }
  await browser.close();
  // 환경 sanity 실패면 baseline 박는 것도 비교도 모두 abort (FAIL)
  if (envCheckError) {
    console.log(JSON.stringify({
      section: opts.section,
      viewport: opts.viewport,
      status: "FAIL",
      reason: "environment sanity check failed",
      detail: envCheckError.message,
    }));
    process.exit(1);
  }
  if (opts["update-baseline"]) {
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, currentBuf);
    console.log(JSON.stringify({ section: opts.section, viewport: opts.viewport, status: "BASELINE_UPDATED", baseline: baselinePath }));
    process.exit(0);
  }
  const cur = PNG.sync.read(currentBuf);
  const base = PNG.sync.read(readFileSync(baselinePath));
  if (cur.width !== base.width || cur.height !== base.height) {
    console.log(JSON.stringify({ section: opts.section, viewport: opts.viewport, status: "FAIL", reason: `dimension mismatch — baseline ${base.width}x${base.height}, current ${cur.width}x${cur.height}` }));
    process.exit(1);
  }
  const diff = new PNG({ width: cur.width, height: cur.height });
  const dp = pixelmatch(cur.data, base.data, diff.data, cur.width, cur.height, { threshold: 0.1 });
  const dpct = (dp / (cur.width * cur.height)) * 100;
  mkdirSync(opts["diff-dir"], { recursive: true });
  const diffPath = join(opts["diff-dir"], `${opts.section}-${opts.viewport}.diff.png`);
  writeFileSync(diffPath, PNG.sync.write(diff));
  const pass = dpct <= opts["threshold-l1"];
  console.log(JSON.stringify({ section: opts.section, viewport: opts.viewport, status: pass ? "PASS" : "FAIL", diffPercent: Number(dpct.toFixed(3)), threshold: opts["threshold-l1"], diffPath, baseline: baselinePath }));
  process.exit(pass ? 0 : 1);
}

// ============ STRICT ============
async function runStrict() {
  if (opts["update-baseline"]) {
    console.error("strict mode: --update-baseline is not supported; use scripts/prepare-baseline.mjs --force");
    process.exit(2);
  }
  const baseDir = resolve(opts["baseline-dir"]);
  const requestedViewports = (opts.viewports || "desktop,tablet,mobile").split(",").map((s) => s.trim());

  // legacy.json 검증
  const legacyPath = join(baseDir, "legacy.json");
  const legacy = readLegacy(legacyPath);
  let legacyValid = false;
  let legacyReason = null;
  if (legacy) {
    const r = validateLegacy(legacy);
    legacyValid = r.valid;
    legacyReason = r.reason;
  }

  // 어떤 viewport 가 평가 가능한지
  const evalPlan = [];
  for (const v of requestedViewports) {
    const png = join(baseDir, `${v}.png`);
    const am = join(baseDir, `anchors-${v}.json`);
    const skipByLegacy = legacy && legacyValid && (legacy.skipViewports || []).includes(v);
    if (skipByLegacy) { evalPlan.push({ v, status: "SKIPPED_LEGACY" }); continue; }
    if (!existsSync(png)) { evalPlan.push({ v, status: "NO_BASELINE", png }); continue; }
    let l2skip = false;
    if (!existsSync(am)) {
      if (legacy && legacyValid && legacy.skipL2) l2skip = true;
      else {
        const noManifestReason = legacy && legacyValid
          ? "anchor manifest 부재. legacy.skipL2=false — strict 강제로 FAIL."
          : "anchor manifest 부재. legacy.json 없음 — strict 강제로 FAIL.";
        evalPlan.push({ v, status: "NO_MANIFEST", reason: noManifestReason }); continue;
      }
    }
    evalPlan.push({ v, status: "READY", png, am, l2skip });
  }

  // legacy invalid 면 모든 viewport 강제 FAIL
  if (legacy && !legacyValid) {
    console.log(JSON.stringify({ section: opts.section, status: "FAIL", strictEffective: false, reason: `invalid legacy: ${legacyReason}`, viewports: {} }));
    process.exit(1);
  }

  const blockingNoManifest = evalPlan.filter((e) => e.status === "NO_MANIFEST");
  if (blockingNoManifest.length) {
    console.log(JSON.stringify({ section: opts.section, status: "FAIL", strictEffective: false, reason: `missing anchor manifest: ${blockingNoManifest.map((e) => e.v).join(",")}`, viewports: {} }));
    process.exit(1);
  }

  const blockingNoBaseline = evalPlan.filter((e) => e.status === "NO_BASELINE");
  if (blockingNoBaseline.length) {
    console.log(JSON.stringify({ section: opts.section, status: "FAIL", strictEffective: false, reason: `NO_BASELINE: ${blockingNoBaseline.map((e) => e.v).join(",")}`, viewports: {} }));
    process.exit(1);
  }

  // Playwright launch (1회)
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (e) {
    console.log(JSON.stringify({ section: opts.section, status: "SKIPPED", reason: `chromium 미설치 (${e.message.split("\n")[0]})`, strictEffective: false }));
    process.exit(0);
  }

  // 3 viewport 병렬
  const url = opts.url || `${opts["preview-base"]}/__preview/${opts.section}`;
  const evalReady = evalPlan.filter((e) => e.status === "READY");
  const evalResults = await Promise.all(evalReady.map((e) => evaluateViewport(browser, e, url)));
  await browser.close();

  // 합산
  const viewportResults = {};
  let strictEffective = true;
  let fail = false;
  let reason = null;
  for (const e of evalPlan) {
    if (e.status === "SKIPPED_LEGACY") {
      viewportResults[e.v] = { status: "SKIPPED_LEGACY", strictEffective: false };
      strictEffective = false;
    }
  }
  for (const r of evalResults) {
    viewportResults[r.viewport] = r;
    if (r.l2 && r.l2.status === "SKIPPED") strictEffective = false;
    if (r.status === "FAIL") { fail = true; reason = reason || r.reason; } // first FAIL viewport's reason only — mirrors validateLegacy first-violation pattern
  }

  console.log(JSON.stringify({
    section: opts.section,
    status: fail ? "FAIL" : "PASS",
    strictEffective,
    reason,
    viewports: viewportResults,
  }));
  process.exit(fail ? 1 : 0);
}

async function evaluateViewport(browser, plan, url) {
  const { v: viewport, png, am, l2skip } = plan;
  const ctx = await newStableContext(browser, viewport);
  const page = await ctx.newPage();
  const collector = attachConsoleErrorCollector(page);
  try {
    try {
      await stabilizePage(page, { url, timeout: opts.timeout });
    } catch (e) {
      return { viewport, status: "FAIL", reason: `Playwright 렌더 실패 (${e.message.split("\n")[0]})` };
    }

    // 환경 무결성 sanity check (B2): 잘못된 환경에서 코드 캡처되면 baseline 과
    // 같은 fallback 상태라 일관 PASS — strict 무력화. 캡처 직전 차단.
    try {
      await assertEnvironmentClean({ page, errors: collector.errors, section: opts.section, viewport });
    } catch (envErr) {
      return { viewport, status: "FAIL", reason: "environment sanity check failed", detail: envErr.message };
    }

    // L2 측정 (anchor bbox) — B-1b: figma 좌표 viewport scale 자동 normalize.
    // 핵심: figma 좌표와 preview viewport 좌표 시스템 다름. M6 sham strict 의 root.
    //   - manifest bbox: figma section-relative (extract-figma-anchors 가 abs.x - sectionAbs.x 로 박음)
    //   - 측정값 (m): viewport 절대좌표 (getBoundingClientRect)
    // root anchor 의 measured.w / manifest.bbox.w = scale 비율로 normalize.
    // measured 도 root 측정값 빼서 root-relative 로 변환.
    let l2 = { status: "SKIPPED" };
    let maskRects = [];
    let normalizeMeta = null;
    if (!l2skip) {
      const manifest = readManifest(am);
      const ids = manifest.anchors.map((a) => a.id);
      const bboxes = await page.evaluate((ids) => {
        const out = {};
        for (const id of ids) {
          const el = document.querySelector(`[data-anchor="${id.replace(/"/g, '\\"')}"]`);
          if (el) {
            const r = el.getBoundingClientRect();
            out[id] = { x: r.x, y: r.y, w: r.width, h: r.height, tag: el.tagName, semantic: ["H1","H2","H3","H4","H5","H6","P","SPAN","LI","DT","DD","STRONG","EM"].includes(el.tagName) };
          }
        }
        return out;
      }, ids);
      const matched = new Set(Object.keys(bboxes));
      const required = manifest.anchors.filter((a) => a.required);
      const optional = manifest.anchors.filter((a) => !a.required);
      const rule = applyMatchingRule(required, optional, matched);

      // root anchor 의 measured / figma 비율 = scale (B-1b core)
      const rootAnchor = manifest.anchors.find((a) => a.role === ROLES.SECTION_ROOT);
      const measuredRoot = rootAnchor ? bboxes[rootAnchor.id] : null;
      let scale = 1;
      let rootOriginX = 0;
      let rootOriginY = 0;
      if (rootAnchor && rootAnchor.bbox && measuredRoot && measuredRoot.w > 0 && rootAnchor.bbox.w > 0) {
        scale = measuredRoot.w / rootAnchor.bbox.w;
        rootOriginX = measuredRoot.x;
        rootOriginY = measuredRoot.y;
        normalizeMeta = {
          scale: Number(scale.toFixed(4)),
          rootMeasuredW: Math.round(measuredRoot.w),
          rootFigmaW: rootAnchor.bbox.w,
        };
      } else if (manifest.figmaPageWidth && rootAnchor && bboxes[rootAnchor.id]) {
        // fallback — root bbox 없을 때 figmaPageWidth 와 viewport 비율
        const measured = bboxes[rootAnchor.id];
        scale = measured.w / manifest.figmaPageWidth;
        rootOriginX = measured.x;
        rootOriginY = measured.y;
        normalizeMeta = {
          scale: Number(scale.toFixed(4)),
          fallback: "figmaPageWidth",
        };
      }
      // scale ≈ 1 이면 normalize 사실상 무관

      let maxDelta = 0;
      let bboxFail = null;
      for (const a of manifest.anchors) {
        const m = bboxes[a.id];
        if (!m) continue;
        if (!a.bbox) {
          // optional anchor without stored bbox: still mask if text-block, but skip delta check
          if (a.role === ROLES.TEXT_BLOCK) {
            maskRects.push({ x: m.x, y: m.y, w: m.w, h: m.h });
          }
          continue;
        }
        // measured 를 root-relative 로 변환 (root anchor 기준)
        const measuredRelX = m.x - rootOriginX;
        const measuredRelY = m.y - rootOriginY;
        // figma bbox 를 scale 곱해 normalize (figma section-relative × scale = preview section-relative)
        const figmaNormalizedX = a.bbox.x * scale;
        const figmaNormalizedY = a.bbox.y * scale;
        const figmaNormalizedW = a.bbox.w * scale;
        const figmaNormalizedH = a.bbox.h * scale;

        const isRoot = a.role === ROLES.SECTION_ROOT;
        const pct = isRoot ? 0.5 : opts["threshold-l2-pct"];
        // tolerance 도 normalize 후 크기 기준
        const tolX = Math.max(opts["threshold-l2-px"], (pct / 100) * figmaNormalizedW);
        const tolY = a.role === ROLES.TEXT_BLOCK
          ? Math.max(opts["threshold-l2-px"] * 2, (pct / 100) * figmaNormalizedH)
          : Math.max(opts["threshold-l2-px"], (pct / 100) * figmaNormalizedH);
        // root anchor 자체는 root-relative 가 (0,0) 이라 비교 무의미 → SKIP
        if (isRoot) {
          // text-block mask only (root rarely text-block — 안전 fallback)
          if (a.role === ROLES.TEXT_BLOCK) {
            maskRects.push({ x: m.x, y: m.y, w: m.w, h: m.h });
          }
          continue;
        }
        const dx = Math.abs(measuredRelX - figmaNormalizedX);
        const dy = Math.abs(measuredRelY - figmaNormalizedY);
        maxDelta = Math.max(maxDelta, dx, dy);
        if (dx > tolX || dy > tolY) {
          // first failure only — mirrors validateLegacy first-violation pattern
          bboxFail = bboxFail || `${a.id} delta x=${dx.toFixed(0)} y=${dy.toFixed(0)} tol(${tolX.toFixed(0)},${tolY.toFixed(0)}) [scale=${scale.toFixed(3)}]`;
        }
        // text-block 은 실제 text-bearing element 인지 검사
        if (a.role === ROLES.TEXT_BLOCK && !m.semantic) {
          bboxFail = bboxFail || `${a.id} role:text-block on non-text element <${m.tag}>`;
        }
        // mask 영역 누적 (mask 는 viewport 절대좌표 그대로)
        if (a.role === ROLES.TEXT_BLOCK) {
          maskRects.push({ x: m.x, y: m.y, w: m.w, h: m.h });
        }
      }
      l2 = {
        status: rule.pass && !bboxFail ? "PASS" : "FAIL",
        anchorsMatched: matched.size,
        anchorsTotal: manifest.anchors.length,
        requiredMatched: required.filter((a) => matched.has(a.id)).length,
        requiredTotal: required.length,
        maxDeltaPx: Math.round(maxDelta),
        normalize: normalizeMeta,
        reason: rule.pass ? bboxFail : rule.reason,
      };
    }

    // L1 측정 (mask 적용)
    const buf = await page.screenshot({ fullPage: true });
    const cur = PNG.sync.read(buf);
    let base = PNG.sync.read(readFileSync(png));
    // B-1b L1 resize: dimension mismatch 시 baseline 을 current 폭/높이로 nearest-neighbor resize.
    // figma export (scale=2) 와 preview viewport (1×) 차이 자동 흡수 → 워커 self-capture 회피 동기 제거.
    // % budget 안에서 antialiasing 차이 흡수.
    let resizeApplied = false;
    if (cur.width !== base.width || cur.height !== base.height) {
      // baseline 을 current 폭으로 resize (nearest-neighbor, height 비율 보존)
      const heightAfterRatio = Math.round(base.height * (cur.width / base.width));
      // height 도 current 와 일치시키기 위해 추가 resize (stretch — 비율 보존 X 단순화)
      base = resizePngNearest(base, cur.width, cur.height);
      resizeApplied = true;
    }
    // mask 면적 검사 — section 면적의 35% 초과 시 FAIL
    const totalArea = cur.width * cur.height;
    const maskArea = maskRects.reduce((s, r) => s + r.w * r.h, 0);
    if (maskArea / totalArea > 0.35) {
      return { viewport, status: "FAIL", reason: `text-block mask area ${(maskArea/totalArea*100).toFixed(1)}% > 35% 상한`, l1: null, l2 };
    }
    // mask 픽셀 무시
    if (maskRects.length) {
      for (const r of maskRects) {
        const x0 = Math.max(0, Math.floor(r.x));
        const y0 = Math.max(0, Math.floor(r.y));
        const x1 = Math.min(cur.width, Math.floor(r.x + r.w));
        const y1 = Math.min(cur.height, Math.floor(r.y + r.h));
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const idx = (y * cur.width + x) * 4;
            base.data[idx] = cur.data[idx];
            base.data[idx + 1] = cur.data[idx + 1];
            base.data[idx + 2] = cur.data[idx + 2];
            base.data[idx + 3] = cur.data[idx + 3];
          }
        }
      }
    }
    const diff = new PNG({ width: cur.width, height: cur.height });
    const dp = pixelmatch(cur.data, base.data, diff.data, cur.width, cur.height, { threshold: 0.1 });
    const dpct = (dp / totalArea) * 100;
    mkdirSync(opts["diff-dir"], { recursive: true });
    const diffPath = join(opts["diff-dir"], `${opts.section}-${viewport}.diff.png`);
    writeFileSync(diffPath, PNG.sync.write(diff));
    const l1 = {
      status: dpct <= opts["threshold-l1"] ? "PASS" : "FAIL",
      diffPercent: Number(dpct.toFixed(3)),
      maskArea: Number(((maskArea / totalArea) * 100).toFixed(1)),
      resizeApplied,
      diffPath,
    };
    const overallFail = l1.status === "FAIL" || l2.status === "FAIL";
    return {
      viewport,
      status: overallFail ? "FAIL" : "PASS",
      reason: overallFail ? (l1.status === "FAIL" ? `L1 ${dpct.toFixed(2)}% > ${opts["threshold-l1"]}%` : l2.reason) : null,
      l1,
      l2,
    };
  } catch (e) {
    return { viewport, status: "FAIL", reason: `평가 실패 (${e.message.split("\n")[0]})` };
  } finally {
    await ctx.close().catch(() => {});
  }
}

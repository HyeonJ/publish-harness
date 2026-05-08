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
 *     --viewports desktop,tablet,mobile --threshold-l1 10 --threshold-l1-target 5 --threshold-l2-px 4 --threshold-l2-pct 1 --strict
 *   → multi-viewport 병렬, L1 mask + 35% 상한, L2 mixed tolerance, manifest v2,
 *     legacy.json 거버넌스, strictEffective 출력.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { readManifest, applyMatchingRule, ROLES } from "./_lib/anchor-manifest.mjs";
import { readLegacy, validateLegacy } from "./_lib/legacy-manifest.mjs";
import { newStableContext, stabilizePage, attachConsoleErrorCollector, assertEnvironmentClean } from "./_lib/playwright-stable.mjs";

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readJsonFileOr(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function iterationFilePath(section, viewport) {
  const safeSection = String(section || "section").replace(/[^A-Za-z0-9_.-]+/g, "_");
  const safeViewport = String(viewport || "desktop").replace(/[^A-Za-z0-9_.-]+/g, "_");
  return join("tests", "quality", "iterations", `${safeSection}-${safeViewport}.json`);
}

function compactL2(l2) {
  if (!l2 || typeof l2 !== "object") return null;
  return {
    status: l2.status || null,
    reason: l2.reason || null,
    anchorsMatched: l2.anchorsMatched ?? null,
    anchorsTotal: l2.anchorsTotal ?? null,
    requiredMatched: l2.requiredMatched ?? null,
    requiredTotal: l2.requiredTotal ?? null,
    maxDeltaPx: l2.maxDeltaPx ?? null,
    categories: l2.diagnostics?.categories || [],
  };
}

function appendG1Iteration({ section, viewport, status, reason, l1, l2 }) {
  const path = iterationFilePath(section, viewport);
  const existing = readJsonFileOr(path, null);
  const previousIterations = existing?.summary?.converged || existing?.summary?.outcome === "converged"
    ? []
    : Array.isArray(existing?.iterations)
      ? existing.iterations
      : [];
  const entry = {
    i: previousIterations.length,
    section,
    viewport,
    status,
    reason: reason || null,
    l1: l1
      ? {
          status: l1.status || null,
          reason: l1.reason || null,
          diffPercent: l1.diffPercent ?? null,
          thresholdEffective: l1.thresholdEffective ?? null,
          thresholdTarget: l1.thresholdTarget ?? null,
          targetGap: l1.targetGap ?? null,
          diffPath: l1.diffPath || null,
          sectionL1Failures: (l1.sectionL1Failures || []).slice(0, 5).map((item) => ({
            sectionId: item.sectionId,
            diffPercent: item.diffPercent,
            diffPixels: item.diffPixels,
            categories: item.categories || [],
          })),
        }
      : null,
    l2: compactL2(l2),
    timestamp: new Date().toISOString(),
  };
  const iterations = [...previousIterations, entry];
  const numeric = iterations
    .map((item) => Number(item.l1?.diffPercent))
    .filter((value) => Number.isFinite(value));
  const latest = numeric.at(-1) ?? null;
  const previous = numeric.length >= 2 ? numeric.at(-2) : null;
  const improvement = latest != null && previous != null
    ? Number((previous - latest).toFixed(3))
    : null;
  const monotonic = numeric.length <= 1 || numeric.every((value, index) => index === 0 || value <= numeric[index - 1]);
  const stallThreshold = Number(process.env.G1_STALL_THRESHOLD || 0.5);
  const maxIterations = Number(process.env.G1_MAX_ITERATIONS || 5);
  const recent = numeric.slice(-4);
  const recentImprovements = recent.length >= 4
    ? [recent[0] - recent[1], recent[1] - recent[2], recent[2] - recent[3]]
    : [];
  const targetGap = Number(entry.l1?.targetGap ?? Infinity);
  const converged = status === "PASS" && Number.isFinite(targetGap) && targetGap <= 0 && (entry.l2?.status === "PASS" || !entry.l2);
  const stalled = !converged && recentImprovements.length === 3 && recentImprovements.every((value) => value < stallThreshold);
  const regressed = !converged && improvement != null && improvement < -stallThreshold;
  const abandoned = !converged && iterations.length >= maxIterations && (stalled || regressed);
  const outcome = converged
    ? "converged"
    : stalled
      ? "stalled"
      : regressed
        ? "regressed"
        : improvement != null && improvement >= stallThreshold
          ? "converging"
          : abandoned
            ? "abandoned"
            : "iterating";
  const summary = {
    currentIteration: entry.i,
    attempts: iterations.length,
    latestL1: latest,
    previousL1: previous,
    improvement,
    monotonic,
    stallThreshold,
    maxIterations,
    recentImprovements: recentImprovements.map((value) => Number(value.toFixed(3))),
    outcome,
    stalled,
    regressed,
    converged,
    abandoned,
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({
    section,
    viewport,
    updatedAt: entry.timestamp,
    summary,
    iterations,
  }, null, 2) + "\n", "utf8");
  return { path, ...summary };
}

// B-1b: PNG nearest-neighbor resize (sharp 의존성 없이). pngjs RGBA buffer 직접 조작.
// 정밀도 < bilinear 단 % budget 안에서 흡수. dimension mismatch normalize 용.
let _PNG_CONSTRUCTOR;
function resizePngNearest(srcPng, newWidth, newHeight) {
  if (!_PNG_CONSTRUCTOR) _PNG_CONSTRUCTOR = srcPng.constructor;
  const dst = new _PNG_CONSTRUCTOR({ width: newWidth, height: newHeight });
  ensurePngData(dst, "resized baseline");
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

function cropPng(srcPng, rect, fill = { r: 255, g: 255, b: 255, a: 255 }) {
  if (!_PNG_CONSTRUCTOR) _PNG_CONSTRUCTOR = srcPng.constructor;
  const width = Math.max(1, Math.round(rect.w));
  const height = Math.max(1, Math.round(rect.h));
  const dst = new _PNG_CONSTRUCTOR({ width, height });
  ensurePngData(dst, "cropped PNG");
  for (let y = 0; y < height; y++) {
    const srcY = Math.round(rect.y) + y;
    for (let x = 0; x < width; x++) {
      const srcX = Math.round(rect.x) + x;
      const dstIdx = (y * width + x) * 4;
      if (srcX >= 0 && srcX < srcPng.width && srcY >= 0 && srcY < srcPng.height) {
        const srcIdx = (srcY * srcPng.width + srcX) * 4;
        dst.data[dstIdx] = srcPng.data[srcIdx];
        dst.data[dstIdx + 1] = srcPng.data[srcIdx + 1];
        dst.data[dstIdx + 2] = srcPng.data[srcIdx + 2];
        dst.data[dstIdx + 3] = srcPng.data[srcIdx + 3];
      } else {
        dst.data[dstIdx] = fill.r;
        dst.data[dstIdx + 1] = fill.g;
        dst.data[dstIdx + 2] = fill.b;
        dst.data[dstIdx + 3] = fill.a;
      }
    }
  }
  return dst;
}

function pushMaskRect(maskRects, rect) {
  if (!rect || !(rect.w > 0) || !(rect.h > 0)) return;
  maskRects.push({ x: rect.x, y: rect.y, w: rect.w, h: rect.h });
}

function ensurePngData(png, label) {
  if (!png || typeof png.width !== "number" || typeof png.height !== "number") {
    throw new Error(`${label} PNG is invalid`);
  }
  const required = png.width * png.height * 4;
  if (!png.data) {
    png.data = Buffer.alloc(required);
  }
  if (png.data.length < required) {
    throw new Error(`${label} PNG data buffer is too small (${png.data.length} < ${required})`);
  }
  return png;
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
  "threshold-l1": 10,
  "threshold-l1-target": 5,
  "threshold-section-l1": 7,
  "threshold-section-l1-pixels": 100000,
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
    if (["threshold-l1","threshold-l1-target","threshold-section-l1","threshold-section-l1-pixels","threshold-l2-px","threshold-l2-pct","timeout"].includes(key)) {
      opts[key] = Number(val);
      if (Number.isNaN(opts[key])) { console.error(`ERROR: ${a} must be a number`); process.exit(2); }
    } else opts[key] = val;
    i++;
  } else { console.error(`ERROR: unexpected arg ${a}`); process.exit(2); }
}

if (process.env.G1_ENFORCE_L1_TARGET === "1") {
  opts["threshold-l1"] = opts["threshold-l1-target"];
}

if (opts.help) {
  console.log(`G1 visual regression — strict + lite 양쪽 지원.\nlite: --baseline <path>\nstrict: --baseline-dir <dir> --viewports desktop,tablet,mobile --strict`);
  process.exit(0);
}

if (!opts.section) { console.error("usage: --section <id>"); process.exit(2); }

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function anchorName(id) {
  return String(id || "").split("/").pop() || "";
}

function round1(value) {
  return Number(Number(value || 0).toFixed(1));
}

function roundBox(box) {
  return {
    x: round1(box.x),
    y: round1(box.y),
    w: round1(box.w),
    h: round1(box.h),
  };
}

function isSectionAnchorId(id) {
  return /\/(?:root|section-\d+)$/i.test(String(id || ""));
}

function sectionNumber(id) {
  const match = String(id || "").match(/\/section-(\d+)$/i);
  return match ? Number(match[1]) : null;
}

function sizeRatio(measured, figma) {
  return {
    widthRatio: figma?.w > 0 ? measured.w / figma.w : 1,
    heightRatio: figma?.h > 0 ? measured.h / figma.h : 1,
  };
}

function median(values) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function mean(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function deltaDistance(item) {
  const dx = Number.isFinite(item.deltaX) ? item.deltaX : item.dx;
  const dy = Number.isFinite(item.deltaY) ? item.deltaY : item.dy;
  return Math.sqrt((dx || 0) ** 2 + (dy || 0) ** 2);
}

function isLikelyRepeatedSlotAnchor(item) {
  const id = String(item?.id || "");
  const role = item?.role || "";
  const figma = item?.figma || {};
  if (!figma.w || !figma.h) return false;
  if (role === ROLES.SECTION_ROOT || role === ROLES.PRIMARY_HEADING || role === ROLES.TEXT_BLOCK) return false;
  if (figma.w >= 900 && figma.h >= 400) return false;
  if (figma.w < 90 || figma.h < 90) return false;
  return (
    role === ROLES.PRIMARY_MEDIA ||
    role === ROLES.DECORATIVE ||
    role === ROLES.PRIMARY_CTA ||
    role === "unknown" ||
    /\/(?:rectangle|frame|card|review|item)(?:-|$)/i.test(id)
  );
}

function distinctRoundedCount(values, tolerance = 16) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const buckets = [];
  for (const value of sorted) {
    if (!buckets.some((bucket) => Math.abs(bucket - value) <= tolerance)) buckets.push(value);
  }
  return buckets.length;
}

function slotBboxKey(item, tolerance = 8) {
  const figma = item?.figma || {};
  if (!figma.w || !figma.h) return null;
  return [
    Math.round((figma.x || 0) / tolerance),
    Math.round((figma.y || 0) / tolerance),
    Math.round((figma.w || 0) / tolerance),
    Math.round((figma.h || 0) / tolerance),
  ].join(":");
}

function collapseDuplicateSlotVariants(anchors = []) {
  const byBbox = new Map();
  for (const anchor of anchors) {
    const key = slotBboxKey(anchor);
    if (!key) continue;
    const group = byBbox.get(key) || [];
    group.push(anchor);
    byBbox.set(key, group);
  }
  const duplicateVariantGroups = [];
  const collapsed = [];
  for (const group of byBbox.values()) {
    const ordered = [...group].sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
    const measured = ordered.find((item) => item.measured)?.measured || null;
    const representative = ordered.find((item) => item.measured) || ordered[0];
    collapsed.push({
      ...representative,
      measured: representative.measured || measured,
      duplicateVariantIds: ordered.map((item) => item.id),
    });
    if (ordered.length >= 2) {
      duplicateVariantGroups.push({
        ids: ordered.map((item) => item.id),
        representative: representative.id,
        figma: representative.figma,
        measuredCount: ordered.filter((item) => item.measured).length,
        suggestedAction: `if these ids represent one visible slot, use data-anchors="${ordered.map((item) => item.id).join(" ")}"`,
        categories: ["duplicate-slot-variant-group", "repeated-slot-duplicates-collapsed"],
      });
    }
  }
  return { collapsed, duplicateVariantGroups };
}

function buildRepeatedSlotSequenceDriftsForSection(sectionId, anchors = []) {
  const candidates = anchors.filter(isLikelyRepeatedSlotAnchor);
  const grouped = new Map();
  for (const anchor of candidates) {
    const wBucket = Math.round((anchor.figma?.w || 0) / 32);
    const hBucket = Math.round((anchor.figma?.h || 0) / 32);
    const yBucket = Math.round((anchor.figma?.y || 0) / 80);
    const key = `${wBucket}:${hBucket}:${yBucket}`;
    const group = grouped.get(key) || [];
    group.push(anchor);
    grouped.set(key, group);
  }
  return [...grouped.values()]
    .filter((group) => group.length >= 3)
    .map((group) => {
      const { collapsed, duplicateVariantGroups } = collapseDuplicateSlotVariants(group);
      const ordered = [...collapsed].sort((a, b) => (a.figma?.x || 0) - (b.figma?.x || 0));
      const figmaXs = ordered.map((a) => round1(a.figma?.x || 0));
      const measuredXs = ordered.map((a) => Number.isFinite(a.measured?.x) ? round1(a.measured.x) : null);
      const measuredPresent = measuredXs.filter(Number.isFinite);
      const figmaGaps = figmaXs.slice(1).map((x, index) => round1(x - figmaXs[index]));
      const measuredGaps = measuredPresent.slice(1).map((x, index) => round1(x - measuredPresent[index]));
      const medianFigmaGap = median(figmaGaps);
      const medianMeasuredGap = median(measuredGaps);
      const maxDeltaX = Math.max(0, ...ordered.map((a) => Math.abs(Number.isFinite(a.deltaX) ? a.deltaX : a.dx || 0)));
      const distinctFigmaXCount = distinctRoundedCount(figmaXs);
      const distinctMeasuredXCount = distinctRoundedCount(measuredPresent);
      const categories = ["repeated-slot-sequence-drift", "repeated-card-layout-model-mismatch"];
      if (duplicateVariantGroups.length) {
        categories.push("duplicate-slot-variant-group", "repeated-slot-duplicates-collapsed");
      }
      if (measuredPresent.length < ordered.length || distinctMeasuredXCount < ordered.length) {
        categories.push("card-row-cardinality-mismatch");
      }
      if (medianFigmaGap !== null && medianMeasuredGap !== null && Math.abs(medianMeasuredGap - medianFigmaGap) >= 32) {
        categories.push("centered-grid-vs-figma-slot-row");
      }
      const actionable =
        maxDeltaX >= 80 ||
        measuredPresent.length < ordered.length ||
        distinctMeasuredXCount < ordered.length ||
        (medianFigmaGap !== null && medianMeasuredGap !== null && Math.abs(medianMeasuredGap - medianFigmaGap) >= 32);
      return {
        sectionId,
        idsInFigmaOrder: ordered.map((a) => a.id),
        figmaCountRaw: group.length,
        figmaCount: ordered.length,
        distinctFigmaXCount,
        measuredCount: measuredPresent.length,
        distinctMeasuredXCount,
        duplicateVariantGroups,
        figmaXSequence: figmaXs,
        measuredXSequence: measuredXs,
        medianFigmaGap: medianFigmaGap === null ? null : round1(medianFigmaGap),
        medianMeasuredGap: medianMeasuredGap === null ? null : round1(medianMeasuredGap),
        maxDeltaX: round1(maxDeltaX),
        suggestedAction: duplicateVariantGroups.length && !actionable
          ? "map duplicate slot variants with data-anchors"
          : "match repeated card/item count, order, and slot spacing before tuning individual anchors",
        categories: unique(categories),
        actionable,
      };
    })
    .filter((group) => group.actionable)
    .slice(0, 8);
}

function enrichInternalSectionGroup(sectionId, members) {
  const signedMembers = members.map((d) => {
    const deltaX = Number.isFinite(d.deltaX) ? d.deltaX : round1((d.measured?.x || 0) - (d.figma?.x || 0));
    const deltaY = Number.isFinite(d.deltaY) ? d.deltaY : round1((d.measured?.y || 0) - (d.figma?.y || 0));
    return { ...d, deltaX, deltaY };
  });
  const distances = signedMembers.map(deltaDistance);
  const medianDx = median(signedMembers.map((d) => d.deltaX));
  const medianDy = median(signedMembers.map((d) => d.deltaY));
  const residuals = signedMembers.map((d) => ({
    x: d.deltaX - (medianDx || 0),
    y: d.deltaY - (medianDy || 0),
  }));
  const normalizedMaxDeltaAfterSharedOffset = residuals.length
    ? Math.max(...residuals.map((d) => Math.max(Math.abs(d.x), Math.abs(d.y))))
    : 0;
  const placementSpread = residuals.length
    ? Math.max(...residuals.map((d) => Math.sqrt(d.x ** 2 + d.y ** 2)))
    : 0;
  const maxDelta = Math.max(...signedMembers.map((d) => Math.max(d.dx, d.dy)));
  const medianDelta = median(distances);
  const meanDelta = mean(distances);
  const residualSharedOffsetLikely =
    signedMembers.length >= 4 &&
    maxDelta >= 70 &&
    normalizedMaxDeltaAfterSharedOffset <= Math.max(32, maxDelta * 0.35) &&
    placementSpread <= Math.max(48, (medianDelta || maxDelta) * 0.45);
  const categories = ["internal-section-layout-drift", "section-internal-placement-drift"];
  if (residualSharedOffsetLikely) {
    categories.push("residual-shared-section-offset");
  } else {
    categories.push("semantic-grid-vs-figma-freeform");
  }
  const repeatedSlotSequenceDrifts = buildRepeatedSlotSequenceDriftsForSection(sectionId, signedMembers);
  categories.push(...repeatedSlotSequenceDrifts.flatMap((group) => group.categories || []));
  return {
    sectionId,
    count: signedMembers.length,
    maxDelta: round1(maxDelta),
    medianDelta: medianDelta === null ? null : round1(medianDelta),
    meanDelta: meanDelta === null ? null : round1(meanDelta),
    medianDx: medianDx === null ? null : round1(medianDx),
    medianDy: medianDy === null ? null : round1(medianDy),
    residualSharedOffsetLikely,
    residualSharedOffset: {
      dx: medianDx === null ? null : round1(medianDx),
      dy: medianDy === null ? null : round1(medianDy),
    },
    normalizedMaxDeltaAfterSharedOffset: round1(normalizedMaxDeltaAfterSharedOffset),
    placementSpread: round1(placementSpread),
    repeatedSlotSequenceDrifts,
    anchors: signedMembers
      .sort((a, b) => Math.max(b.dx, b.dy) - Math.max(a.dx, a.dy))
      .slice(0, 10)
      .map((d) => ({
        id: d.id,
        role: d.role,
        dx: d.dx,
        dy: d.dy,
        deltaX: d.deltaX,
        deltaY: d.deltaY,
        measured: d.measured,
        figma: d.figma,
        widthRatio: round1(sizeRatio(d.measured, d.figma).widthRatio),
        heightRatio: round1(sizeRatio(d.measured, d.figma).heightRatio),
      })),
    categories,
  };
}

function buildSectionOffsetPropagation(sectionByY) {
  const propagation = [];
  for (let i = 0; i < sectionByY.length - 1; i++) {
    const from = sectionByY[i];
    const to = sectionByY[i + 1];
    const figmaGap = round1((to.figma?.y || 0) - ((from.figma?.y || 0) + (from.figma?.h || 0)));
    const measuredGap = round1((to.measured?.y || 0) - ((from.measured?.y || 0) + (from.measured?.h || 0)));
    const gapDelta = round1(measuredGap - figmaGap);
    const fromYDelta = round1(Number.isFinite(from.deltaY) ? from.deltaY : (from.measured?.y || 0) - (from.figma?.y || 0));
    const toYDelta = round1(Number.isFinite(to.deltaY) ? to.deltaY : (to.measured?.y || 0) - (to.figma?.y || 0));
    const fromBottomDelta = round1(fromYDelta + (from.heightDelta || 0));
    const predictedToYDelta = round1(fromBottomDelta + gapDelta);
    const residual = round1(toYDelta - predictedToYDelta);
    const confidence = Math.abs(residual) <= 8
      ? "high"
      : Math.abs(residual) <= 24
        ? "medium"
        : "low";
    const categories = [];
    if (Math.abs(predictedToYDelta) >= 24 && confidence !== "low") {
      categories.push("section-offset-propagation", "upstream-section-offset-propagation");
    }
    if (Math.abs(gapDelta) >= 40) categories.push("section-gap-drift", "normal-flow-spacing-drift");
    propagation.push({
      from: from.id,
      to: to.id,
      fromYDelta,
      fromHeightDelta: from.heightDelta,
      fromBottomDelta,
      gapDelta,
      predictedToYDelta,
      actualToYDelta: toYDelta,
      residual,
      confidence,
      categories: unique(categories),
    });
  }
  return propagation;
}

function attachSharedOffsetSources(internalSectionDriftGroups, sectionOffsetPropagation) {
  const sharedResidualOffsetSources = [];
  for (const group of internalSectionDriftGroups) {
    if (!group.residualSharedOffsetLikely) continue;
    const sharedDy = group.residualSharedOffset?.dy;
    if (!Number.isFinite(sharedDy)) continue;
    const candidates = sectionOffsetPropagation
      .filter((entry) => entry.to === group.sectionId)
      .map((entry) => {
        const predictedResidual = Math.abs((entry.predictedToYDelta || 0) - sharedDy);
        const actualResidual = Math.abs((entry.actualToYDelta || 0) - sharedDy);
        const residual = Math.min(predictedResidual, actualResidual);
        const confidence = residual <= 8 ? "high" : residual <= 24 ? "medium" : "low";
        return { ...entry, sharedOffsetDy: sharedDy, sharedOffsetResidual: round1(residual), confidence };
      })
      .sort((a, b) => a.sharedOffsetResidual - b.sharedOffsetResidual);
    const source = candidates[0];
    if (!source || source.confidence === "low") continue;
    group.sourceSection = source.from;
    group.sourcePair = { from: source.from, to: source.to };
    group.offsetPropagation = source;
    group.categories = unique([...(group.categories || []), "upstream-section-offset-propagation"]);
    sharedResidualOffsetSources.push({
      sectionId: group.sectionId,
      sourceSection: source.from,
      sourcePair: { from: source.from, to: source.to },
      sharedOffset: group.residualSharedOffset,
      propagation: source,
      reason: "previous section bottom drift plus pair gap predicts this section's shared residual offset",
      categories: ["upstream-section-offset-propagation", "residual-shared-section-offset"],
    });
  }
  return sharedResidualOffsetSources;
}

function buildNonActionableRootResiduals(sectionOffsetPropagation = []) {
  return sectionOffsetPropagation
    .filter((entry) =>
      Math.abs(entry.actualToYDelta || 0) >= 8 &&
      Math.abs(entry.residual || 0) <= 4 &&
      Math.abs(entry.gapDelta || 0) <= 25 &&
      (entry.confidence === "high" || entry.confidence === "medium")
    )
    .map((entry) => ({
      targetSection: entry.to,
      sourcePair: { from: entry.from, to: entry.to },
      actualToYDelta: entry.actualToYDelta,
      predictedToYDelta: entry.predictedToYDelta,
      gapDelta: entry.gapDelta,
      residual: entry.residual,
      confidence: entry.confidence,
      suggestedAction: "do not move the target section; inspect upstream residual source or L1-dominant visual diff",
      categories: ["propagated-section-root-residual", "non-actionable-target-section-residual", "l1-dominant-after-l2-cleanup"],
    }))
    .slice(0, 12);
}

function pixelColorDistance(data, indexA, otherData, indexB) {
  const dr = (data[indexA] || 0) - (otherData[indexB] || 0);
  const dg = (data[indexA + 1] || 0) - (otherData[indexB + 1] || 0);
  const db = (data[indexA + 2] || 0) - (otherData[indexB + 2] || 0);
  const da = (data[indexA + 3] || 0) - (otherData[indexB + 3] || 0);
  return Math.sqrt(dr ** 2 + dg ** 2 + db ** 2 + (da * 0.5) ** 2);
}

function hexColor(rgb) {
  const toHex = (value) => Math.max(0, Math.min(255, Math.round(value || 0))).toString(16).padStart(2, "0");
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

function colorDistanceRgb(a, b) {
  if (!a || !b) return 0;
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function sampleAverageColorInRects(image, rects = [], maxSamples = 3000) {
  let r = 0;
  let g = 0;
  let b = 0;
  let samples = 0;
  const totalArea = rects.reduce((sum, rect) => sum + Math.max(0, rect.w) * Math.max(0, rect.h), 0);
  const stride = Math.max(1, Math.floor(Math.sqrt(totalArea / maxSamples)));
  for (const rect of rects) {
    const x0 = Math.max(0, Math.floor(rect.x));
    const y0 = Math.max(0, Math.floor(rect.y));
    const x1 = Math.min(image.width, Math.ceil(rect.x + rect.w));
    const y1 = Math.min(image.height, Math.ceil(rect.y + rect.h));
    for (let y = y0; y < y1; y += stride) {
      for (let x = x0; x < x1; x += stride) {
        const idx = (y * image.width + x) * 4;
        r += image.data[idx] || 0;
        g += image.data[idx + 1] || 0;
        b += image.data[idx + 2] || 0;
        samples++;
      }
    }
  }
  return samples ? { r: r / samples, g: g / samples, b: b / samples } : null;
}

function backgroundSampleRects(x0, y0, x1, y1) {
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return [];
  const band = Math.max(12, Math.min(80, Math.floor(Math.min(w, h) * 0.12)));
  const corner = Math.max(24, Math.min(160, Math.floor(Math.min(w, h) * 0.22)));
  return [
    { x: x0, y: y0, w, h: band },
    { x: x0, y: y1 - band, w, h: band },
    { x: x0, y: y0, w: band, h },
    { x: x1 - band, y: y0, w: band, h },
    { x: x0, y: y0, w: corner, h: corner },
    { x: x1 - corner, y: y0, w: corner, h: corner },
    { x: x0, y: y1 - corner, w: corner, h: corner },
    { x: x1 - corner, y: y1 - corner, w: corner, h: corner },
  ];
}

function textSignalSectionMatch(signal, section) {
  return signalSectionMatch(signal, section);
}

function signalSectionMatch(signal, section) {
  const figma = signal?.figma;
  const measured = signal?.measured;
  const sectionFigma = section?.figma;
  const sectionMeasured = section?.measured;
  const inFigma =
    figma &&
    sectionFigma &&
    Number.isFinite(figma.y) &&
    figma.y >= (sectionFigma.y || 0) &&
    figma.y <= (sectionFigma.y || 0) + (sectionFigma.h || 0);
  const inMeasured =
    measured &&
    sectionMeasured &&
    Number.isFinite(measured.y) &&
    measured.y >= (sectionMeasured.y || 0) &&
    measured.y <= (sectionMeasured.y || 0) + (sectionMeasured.h || 0);
  return inFigma || inMeasured;
}

function isOverlayTextSignal(signal) {
  const categories = new Set(signal?.categories || []);
  const id = String(signal?.id || "");
  const roleTextLike = signal?.role === ROLES.PRIMARY_HEADING || signal?.role === ROLES.TEXT_BLOCK;
  const idTextLike = /(?:title|heading|copy|paragraph|caption|subtitle|subheading|sale|product|bundle|energy|support|focus|sellers|clients|quote|review|logoname|wordmark|handle)/i.test(id);
  const categoryTextLike = [...categories].some((category) =>
    /^text-/.test(category) ||
    category.includes("text") ||
    category.includes("anchor-name") ||
    category.includes("content") ||
    category.includes("generic-layer") ||
    category.includes("semantic-layer") ||
    category.includes("expected-text")
  );
  return Boolean(
    categoryTextLike ||
    roleTextLike ||
    (idTextLike && (signal?.actualText || signal?.expectedText || signal?.anchorNameText))
  );
}

function summarizeTextSignal(signal) {
  const categories = (signal?.categories || []).filter((category) =>
    category.includes("text") ||
    category.includes("content") ||
    category.includes("anchor-name") ||
    category.includes("generic-layer") ||
    category.includes("semantic-layer") ||
    category.includes("expected")
  );
  const reviewOnly = isReviewOnlyTextSignal(signal);
  const metric = isTrueMetricTextSignal(signal);
  const highConfidenceContent = isHighConfidenceContentTextSignal(signal);
  return {
    id: signal.id,
    role: signal.role || null,
    dx: signal.dx ?? null,
    dy: signal.dy ?? null,
    deltaX: signal.deltaX ?? null,
    deltaY: signal.deltaY ?? null,
    confidence: signal.confidence || null,
    expectedText: normalizeText(signal.expectedText) || null,
    actualText: normalizeText(signal.actualText) || null,
    anchorNameText: normalizeText(signal.anchorNameText) || null,
    measured: signal.measured || null,
    figma: signal.figma || null,
    reviewOnly,
    actionable: highConfidenceContent || metric,
    signalKind: highConfidenceContent ? "high-confidence-content" : metric ? "text-metric-placement" : reviewOnly ? "review-only" : "text-reference",
    categories: unique(categories).slice(0, 8),
  };
}

function isReviewOnlyTextSignal(signal) {
  const categories = new Set(signal?.categories || []);
  return Boolean(
    signal?.reviewOnly ||
    signal?.confidence === "low" ||
    (!signal?.expectedText && (
      categories.has("expected-text-missing") ||
      categories.has("generic-layer-name-text-mismatch") ||
      categories.has("low-confidence-anchor-name-mismatch") ||
      categories.has("semantic-layer-name-text-mismatch") ||
      categories.has("low-confidence-semantic-layer-name") ||
      categories.has("duplicate-social-handle-anchor")
    ))
  );
}

function isHighConfidenceContentTextSignal(signal) {
  if (isReviewOnlyTextSignal(signal)) return false;
  const categories = new Set(signal?.categories || []);
  return Boolean(
    signal?.confidence === "high" ||
    (signal?.expectedText && (
      signal?.textMatchesExpected === false ||
      categories.has("text-content-mismatch") ||
      categories.has("possible-wrong-anchor-target")
    ))
  );
}

function isTrueMetricTextSignal(signal) {
  if (isReviewOnlyTextSignal(signal) || isHighConfidenceContentTextSignal(signal)) return false;
  const categories = new Set(signal?.categories || []);
  return [
    "text-metric-drift",
    "text-placement-drift",
    "text-wrapping-width-drift",
    "text-line-height-drift",
    "text-bbox-too-small",
    "text-size-too-small",
    "wrapping-width-too-narrow",
    "text-line-height-too-small",
    "text-micro-placement-drift",
    "text-placement-residual",
  ].some((category) => categories.has(category));
}

function dedupeSignalsById(signals = []) {
  const byId = new Map();
  const priority = (signal) =>
    (isHighConfidenceContentTextSignal(signal) ? 4 : 0) +
    (isTrueMetricTextSignal(signal) ? 2 : 0) +
    (isReviewOnlyTextSignal(signal) ? -1 : 0) +
    Math.max(signal?.dx || 0, signal?.dy || 0) / 10000;
  for (const signal of signals) {
    if (!signal?.id) continue;
    const existing = byId.get(signal.id);
    if (!existing || priority(signal) > priority(existing)) byId.set(signal.id, signal);
  }
  return [...byId.values()];
}

function overlayTextCandidateIsActionable(signals = []) {
  const actionable = signals.filter((signal) => signal.actionable && !signal.reviewOnly);
  const highConfidenceContentCount = actionable.filter((signal) => signal.signalKind === "high-confidence-content").length;
  const trueMetricCount = actionable.filter((signal) => signal.signalKind === "text-metric-placement").length;
  const explicitOverlayCount = actionable.filter((signal) =>
    (signal.categories || []).some((category) =>
      category.includes("overlay") ||
      category.includes("overlap") ||
      category.includes("text-on-background")
    )
  ).length;
  return highConfidenceContentCount >= 1 || trueMetricCount >= 2 || explicitOverlayCount >= 1;
}

function isImageLikeSignal(signal) {
  const id = String(signal?.id || "");
  const role = signal?.role || "";
  const figma = signal?.figma || {};
  if (!figma.w || !figma.h) return false;
  if (role === ROLES.SECTION_ROOT || role === ROLES.PRIMARY_HEADING || role === ROLES.TEXT_BLOCK) return false;
  if (signal?.actualText && !/(?:rectangle|image|media|photo|gallery|frame|card|decor|bg|background)/i.test(id)) return false;
  return (
    role === ROLES.PRIMARY_MEDIA ||
    role === ROLES.DECORATIVE ||
    /\/(?:rectangle|image|media|photo|gallery|frame|card|decor|bg|background)(?:-|$)/i.test(id)
  );
}

function imageCandidateReason(signal, sectionCategories = []) {
  const ratios = sizeRatio(signal.measured || {}, signal.figma || {});
  const widthRatio = ratios.widthRatio;
  const heightRatio = ratios.heightRatio;
  const dx = signal.dx || 0;
  const dy = signal.dy || 0;
  const reasons = [];
  const sizeClose = widthRatio >= 0.85 && widthRatio <= 1.15 && heightRatio >= 0.85 && heightRatio <= 1.15;
  if (sizeClose && Math.max(dx, dy) >= 48) reasons.push("asset-order-mismatch-suspected");
  if (widthRatio < 0.85 || widthRatio > 1.15 || heightRatio < 0.85 || heightRatio > 1.15) {
    reasons.push("image-crop-or-object-position-suspected");
  }
  if (widthRatio < 0.75 || widthRatio > 1.35 || heightRatio < 0.75 || heightRatio > 1.35) {
    reasons.push("image-size-ratio-drift");
  }
  if (sectionCategories.includes("solid-background-color-drift") && sectionCategories.includes("image-content-mismatch-candidate")) {
    reasons.push("background-or-image-mixed");
  }
  if (!reasons.length) reasons.push("image-content-or-crop-check");
  return unique(reasons);
}

function summarizeImageSignal(signal, sectionCategories = []) {
  const ratios = sizeRatio(signal.measured || {}, signal.figma || {});
  const categories = (signal.categories || []).filter((category) =>
    category.includes("media") ||
    category.includes("image") ||
    category.includes("asset") ||
    category.includes("crop") ||
    category.includes("decorative") ||
    category.includes("background") ||
    category.includes("position") ||
    category.includes("size")
  );
  return {
    id: signal.id,
    role: signal.role || null,
    dx: signal.dx ?? null,
    dy: signal.dy ?? null,
    deltaX: signal.deltaX ?? null,
    deltaY: signal.deltaY ?? null,
    measured: signal.measured || null,
    figma: signal.figma || null,
    widthRatio: round1(ratios.widthRatio),
    heightRatio: round1(ratios.heightRatio),
    candidateReason: imageCandidateReason(signal, sectionCategories),
    categories: unique(categories).slice(0, 8),
  };
}

function imageSignalPriority(signal) {
  const ratios = sizeRatio(signal.measured || {}, signal.figma || {});
  const sizeClose = ratios.widthRatio >= 0.85 && ratios.widthRatio <= 1.15 && ratios.heightRatio >= 0.85 && ratios.heightRatio <= 1.15;
  const mediaRole = signal.role === ROLES.PRIMARY_MEDIA || signal.role === ROLES.DECORATIVE ? 500 : 0;
  const positionScore = Math.max(signal.dx || 0, signal.dy || 0);
  const sizeScore = Math.max(Math.abs((ratios.widthRatio || 1) - 1), Math.abs((ratios.heightRatio || 1) - 1)) * 180;
  return mediaRole + positionScore + sizeScore + (sizeClose && positionScore >= 48 ? 120 : 0);
}

function computeSectionL1Diffs({ cur, base, sections = [], rootOriginX = 0, rootOriginY = 0, textSignals = [], imageSignals = [] }) {
  const out = [];
  for (const section of sections || []) {
    const measured = section.measured;
    if (!measured?.w || !measured?.h) continue;
    const x0 = Math.max(0, Math.floor((measured.x || 0) + rootOriginX));
    const y0 = Math.max(0, Math.floor((measured.y || 0) + rootOriginY));
    const x1 = Math.min(cur.width, Math.ceil(x0 + measured.w));
    const y1 = Math.min(cur.height, Math.ceil(y0 + measured.h));
    if (x1 <= x0 || y1 <= y0) continue;
    const totalPixels = (x1 - x0) * (y1 - y0);
    let diffPixels = 0;
    let curR = 0;
    let curG = 0;
    let curB = 0;
    let baseR = 0;
    let baseG = 0;
    let baseB = 0;
    let samples = 0;
    const sampleStride = Math.max(1, Math.floor(Math.sqrt(totalPixels / 5000)));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const idx = (y * cur.width + x) * 4;
        if (pixelColorDistance(cur.data, idx, base.data, idx) > 32) diffPixels++;
        if ((x - x0) % sampleStride === 0 && (y - y0) % sampleStride === 0) {
          curR += cur.data[idx] || 0;
          curG += cur.data[idx + 1] || 0;
          curB += cur.data[idx + 2] || 0;
          baseR += base.data[idx] || 0;
          baseG += base.data[idx + 1] || 0;
          baseB += base.data[idx + 2] || 0;
          samples++;
        }
      }
    }
    const currentAverage = samples ? { r: curR / samples, g: curG / samples, b: curB / samples } : null;
    const baselineAverage = samples ? { r: baseR / samples, g: baseG / samples, b: baseB / samples } : null;
    const colorDistance = colorDistanceRgb(currentAverage, baselineAverage);
    const backgroundRects = backgroundSampleRects(x0, y0, x1, y1);
    const backgroundSampleCurrent = sampleAverageColorInRects(cur, backgroundRects);
    const backgroundSampleBaseline = sampleAverageColorInRects(base, backgroundRects);
    const backgroundColorDistance = colorDistanceRgb(backgroundSampleCurrent, backgroundSampleBaseline);
    const diffPercent = totalPixels > 0 ? (diffPixels / totalPixels) * 100 : 0;
    const allRelatedTextSignals = dedupeSignalsById((textSignals || [])
      .filter(isOverlayTextSignal)
      .filter((signal) => textSignalSectionMatch(signal, section))
    )
      .sort((a, b) => Math.max(b.dx || 0, b.dy || 0) - Math.max(a.dx || 0, a.dy || 0))
      .map(summarizeTextSignal);
    const actionableTextSignals = allRelatedTextSignals.filter((signal) => signal.actionable && !signal.reviewOnly).slice(0, 6);
    const reviewOnlyTextSignals = allRelatedTextSignals.filter((signal) => signal.reviewOnly).slice(0, 6);
    const relatedTextSignals = allRelatedTextSignals.slice(0, 6);
    const actionableOverlay = overlayTextCandidateIsActionable(allRelatedTextSignals);
    const categories = ["section-l1-diff-hotspot"];
    if (diffPercent >= 25 && (colorDistance >= 35 || backgroundColorDistance >= 25)) categories.push("solid-background-color-drift");
    if (diffPixels >= 100000 && diffPercent >= 20 && colorDistance < 20) {
      categories.push("image-content-mismatch-candidate", "asset-order-mismatch-candidate");
    }
    if (diffPixels >= 100000 && diffPercent >= 20 && actionableOverlay) {
      categories.push("overlay-text-content-drift-candidate", "overlay-text-order-mismatch-candidate");
      if (backgroundColorDistance < 35) categories.push("overlay-text-over-background-candidate");
    } else if (diffPixels >= 100000 && diffPercent >= 20 && relatedTextSignals.length) {
      categories.push("text-signal-present-nonblocking");
    }
    const relatedImageSignals = dedupeSignalsById((imageSignals || [])
      .filter(isImageLikeSignal)
      .filter((signal) => signalSectionMatch(signal, section))
    )
      .sort((a, b) => imageSignalPriority(b) - imageSignalPriority(a))
      .slice(0, 8)
      .map((signal) => summarizeImageSignal(signal, categories));
    out.push({
      sectionId: section.id,
      bbox: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
      diffPixels,
      totalPixels,
      diffPercent: Number(diffPercent.toFixed(3)),
      currentAverageColor: currentAverage ? hexColor(currentAverage) : null,
      baselineAverageColor: baselineAverage ? hexColor(baselineAverage) : null,
      colorDistance: Number(colorDistance.toFixed(1)),
      backgroundSampleCurrent: backgroundSampleCurrent ? hexColor(backgroundSampleCurrent) : null,
      backgroundSampleBaseline: backgroundSampleBaseline ? hexColor(backgroundSampleBaseline) : null,
      backgroundColorDistance: Number(backgroundColorDistance.toFixed(1)),
      textSignals: relatedTextSignals,
      actionableTextSignals,
      reviewOnlyTextSignals,
      imageSignals: relatedImageSignals,
      categories,
    });
  }
  return out
    .sort((a, b) => b.diffPixels - a.diffPixels)
    .map((item, index) => ({ ...item, rank: index + 1 }))
    .slice(0, 12);
}

function textLooksExpected(anchor, measured) {
  const actual = normalizeText(measured?.text);
  if (!actual) return false;
  const expected = normalizeText(anchor?.typography?.characters);
  if (expected) return actual.includes(expected) || expected.includes(actual);
  const name = anchorName(anchor?.id)
    .replace(/-\d+$/g, "")
    .replace(/-/g, " ")
    .trim()
    .toLowerCase();
  return !name || actual.toLowerCase().includes(name) || name.includes(actual.toLowerCase());
}

function shouldMaskTextForL1(anchor, measured) {
  if (!anchor || !measured) return false;
  if (!measured.semantic) return false;
  if (!normalizeText(measured.text)) return false;
  if (anchor.role === ROLES.SECTION_ROOT || anchor.role === ROLES.PRIMARY_MEDIA || anchor.role === ROLES.DECORATIVE) return false;
  if (isFrameLikeAnchorId(anchor.id)) return false;
  if (anchor.role === ROLES.TEXT_BLOCK || anchor.role === ROLES.PRIMARY_HEADING) return true;
  if (anchor.typography?.characters) return true;
  return true;
}

function readableAnchorName(id) {
  return anchorName(id)
    .replace(/-\d+$/g, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textMatches(a, b) {
  const left = normalizeForTextMatch(a);
  const right = normalizeForTextMatch(b);
  if (!left || !right) return null;
  return left.includes(right) || right.includes(left);
}

function normalizeForTextMatch(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/["'`“”‘’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textTokens(value) {
  return normalizeForTextMatch(value).split(/\s+/).filter((token) => token.length > 1);
}

function fuzzyTextMatches(actual, anchorName) {
  const actualTokens = textTokens(actual);
  const anchorTokens = textTokens(anchorName);
  if (!actualTokens.length || !anchorTokens.length) return null;
  if (typoTextMatchesTokens(actualTokens, anchorTokens)) return true;
  if (anchorTokens.length < 4) return textMatches(actual, anchorName);
  const actualSet = new Set(actualTokens);
  const overlap = anchorTokens.filter((token) => actualSet.has(token)).length;
  const overlapRatio = overlap / anchorTokens.length;
  let sequence = 0;
  let cursor = 0;
  for (const token of anchorTokens) {
    const foundAt = actualTokens.indexOf(token, cursor);
    if (foundAt >= 0) {
      sequence++;
      cursor = foundAt + 1;
    }
  }
  return overlapRatio >= 0.7 || sequence >= Math.min(4, anchorTokens.length);
}

function editDistance(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i++) dp[i][0] = i;
  for (let j = 0; j <= right.length; j++) dp[0][j] = j;
  for (let i = 1; i <= left.length; i++) {
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[left.length][right.length];
}

function typoTextMatchesTokens(actualTokens, anchorTokens) {
  if (Math.abs(actualTokens.length - anchorTokens.length) > 1) return false;
  if (anchorTokens.length > 5) return false;
  let totalDistance = 0;
  let matched = 0;
  const remaining = [...actualTokens];
  for (const anchorToken of anchorTokens) {
    let bestIndex = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const distance = editDistance(anchorToken, remaining[i]);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    const allowed = Math.max(anchorToken.length, bestIndex >= 0 ? remaining[bestIndex].length : 0) >= 5 ? 1 : 0;
    if (bestIndex >= 0 && bestDistance <= allowed) {
      totalDistance += bestDistance;
      matched++;
      remaining.splice(bestIndex, 1);
    }
  }
  return matched === anchorTokens.length && totalDistance <= 1;
}

function isGenericLayerName(value) {
  const text = normalizeText(value).toLowerCase();
  if (!text) return false;
  return (
    /^(text|paragraph|heading|title|label|copy|body|description|caption|subtitle|subheading)$/i.test(text) ||
    /\blorem ipsum\b/i.test(text) ||
    /\ba paragraph (?:or two|with)\b/i.test(text) ||
    /\binformation on\b/i.test(text) ||
    /^(?:body|paragraph|heading|title|label|copy|description)\s*\d+$/i.test(text)
  );
}

function isSemanticLayerName(value) {
  const text = normalizeForTextMatch(value);
  if (!text) return false;
  return /^(?:logo|logoname|logo name|wordmark|brand|brand name|handle|social handle|instagram|twitter|x handle)$/.test(text);
}

function isFrameLikeAnchorId(id) {
  return /(?:^|\/)(?:section-\d+|rectangle|frame|background|bg|container|wrapper)(?:-|$)/i.test(String(id || ""));
}

function isTextishAnchor(item) {
  const id = String(item?.id || "");
  const role = item?.role || "";
  if (role === ROLES.PRIMARY_HEADING || role === ROLES.TEXT_BLOCK) return true;
  if (item?.expectedText || item?.actualText) return true;
  if (/\/(?:section-\d+|rectangle|frame|background|bg|container|wrapper)(?:-|$)/i.test(id)) return false;
  return /title|heading|text|copy|paragraph|seller|sale|energy|boost|support|focus|review|client|logoname/i.test(id);
}

function isLikelyFullBboxDuplicateGroup(group) {
  return group.some((item) =>
    isLargeFigmaBox(item.figma || item.bbox) &&
    (
      isFrameLikeAnchorId(item.id) ||
      item.role === ROLES.SECTION_ROOT ||
      item.role === ROLES.DECORATIVE ||
      item.role === ROLES.PRIMARY_MEDIA
    )
  );
}

function isNumberedSectionAnchorId(id) {
  return /\/section-\d+$/i.test(String(id || ""));
}

function isLargeFigmaBox(box) {
  return (box?.w || 0) >= 500 && (box?.h || 0) >= 200;
}

function hasCategory(item, category) {
  return (item.categories || []).includes(category);
}

function buildLogoBrandScaleDrifts(deltas = []) {
  return deltas
    .filter((d) =>
      (hasCategory(d, "repeated-logo-scale-drift") || hasCategory(d, "footer-wordmark-target")) &&
      !hasCategory(d, "wrapper-target-too-large") &&
      !hasCategory(d, "possible-wrong-wrapper-target")
    )
    .map((d) => {
      const ratios = sizeRatio(d.measured, d.figma);
      const targetRisk = d.actualText && !textMatches(d.actualText, d.expectedText || d.anchorNameText);
      return {
        id: d.id,
        role: d.role,
        dx: d.dx,
        dy: d.dy,
        measured: d.measured,
        figma: d.figma,
        widthRatio: round1(ratios.widthRatio),
        heightRatio: round1(ratios.heightRatio),
        actualText: d.actualText || null,
        expectedText: d.expectedText || null,
        anchorNameText: d.anchorNameText || null,
        suggestedAction: targetRisk
          ? "verify logo/wordmark anchor target; if target is correct, tune logo fit box / optical scale"
          : "if target is correct, tune logo fit box / optical scale; do not treat as text content mismatch without expectedText evidence",
        categories: unique([...(d.categories || []), "logo-brand-scale-drift"]),
      };
    })
    .sort((a, b) => Math.max(b.dx || 0, b.dy || 0) - Math.max(a.dx || 0, a.dy || 0))
    .slice(0, 12);
}

function findContainingSection(item, sectionDeltas = []) {
  if (!item?.figma || !sectionDeltas.length) return null;
  const y = item.figma.y;
  const containing = sectionDeltas
    .filter((section) => section.figma && y >= section.figma.y && y <= section.figma.y + section.figma.h)
    .sort((a, b) => (a.figma.h || 0) - (b.figma.h || 0))[0];
  if (containing) return containing;
  return [...sectionDeltas]
    .filter((section) => section.figma)
    .sort((a, b) => Math.abs((a.figma.y || 0) - y) - Math.abs((b.figma.y || 0) - y))[0] || null;
}

function enrichSharedTextYOffsetGroup(group, sectionDeltas = []) {
  const sections = new Map();
  for (const anchor of group.anchors || []) {
    const section = findContainingSection(anchor, sectionDeltas);
    if (!section) continue;
    const entry = sections.get(section.id) || { section, count: 0 };
    entry.count += 1;
    sections.set(section.id, entry);
  }
  const nearest = [...sections.values()].sort((a, b) => b.count - a.count)[0]?.section || null;
  const sectionDeltaY = nearest
    ? round1(Number.isFinite(nearest.deltaY) ? nearest.deltaY : (nearest.measured?.y || 0) - (nearest.figma?.y || 0))
    : null;
  const residualVsSection = sectionDeltaY === null ? null : round1(group.signedDeltaY - sectionDeltaY);
  const residualLarge = residualVsSection !== null && Math.abs(residualVsSection) >= 32;
  const categories = new Set(group.categories || []);
  categories.add(residualLarge ? "section-internal-wrapper-offset" : "downstream-section-flow-offset");
  if (residualLarge) categories.add("internal-wrapper-offset-candidate");
  else categories.add("section-flow-offset-propagation");
  return {
    ...group,
    sectionId: nearest?.id || null,
    sectionDeltaY,
    residualVsSection,
    suggestedAction: residualLarge
      ? "inspect common inner wrapper/content group offset before tuning each text individually"
      : "inspect upstream section/root/gap flow before tuning each text individually",
    categories: [...categories],
  };
}

function buildSharedTextYOffsetGroups(textDrifts = [], sectionDeltas = []) {
  const candidates = textDrifts
    .filter((item) => !isTextContentLike(item))
    .filter((item) => Number.isFinite(item.deltaY) && Math.abs(item.deltaY) >= 24)
    .filter((item) => !(item.categories || []).some((c) =>
      c === "text-bbox-too-small" ||
      c === "text-size-too-small" ||
      c === "wrapping-width-too-narrow" ||
      c === "text-line-height-too-small"
    ));
  const groups = new Map();
  for (const item of candidates) {
    const band = Math.round(item.deltaY / 16) * 16;
    const key = String(band);
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([band, items]) => {
      if (items.length < 2) return null;
      const signedDeltaY = Number(band);
      return enrichSharedTextYOffsetGroup({
        signedDeltaY,
        count: items.length,
        maxAbsDeltaY: round1(Math.max(...items.map((item) => Math.abs(item.deltaY || 0)))),
        anchors: items
          .sort((a, b) => Math.abs(b.deltaY || 0) - Math.abs(a.deltaY || 0))
          .slice(0, 10)
          .map((item) => ({
            id: item.id,
            dx: item.dx,
            dy: item.dy,
            deltaX: item.deltaX,
            deltaY: item.deltaY,
            measured: item.measured,
            figma: item.figma,
            widthRatio: item.widthRatio,
            heightRatio: item.heightRatio,
            categories: item.categories,
          })),
        suggestedAction: "inspect upstream flow/section height before tuning each text individually",
        categories: ["shared-text-y-offset", "downstream-text-placement-drift", "text-flow-offset-propagation", "text-metric-fix-side-effect-candidate"],
      }, sectionDeltas);
    })
    .filter(Boolean)
    .sort((a, b) => b.count - a.count || b.maxAbsDeltaY - a.maxAbsDeltaY)
    .slice(0, 10);
}

function isTextContentLike(item) {
  return (item.categories || []).some((c) =>
    c === "text-content-mismatch" ||
    c === "anchor-name-text-mismatch" ||
    c === "possible-wrong-anchor-target" ||
    c === "expected-text-missing" ||
    c === "generic-layer-name-text-mismatch" ||
    c === "low-confidence-anchor-name-mismatch" ||
    c === "semantic-layer-name-text-mismatch" ||
    c === "low-confidence-semantic-layer-name" ||
    c === "duplicate-social-handle-anchor"
  );
}

function classifyAnchorDelta({ anchor, measured, dx, dy, figmaW, figmaH }) {
  const id = anchor.id || "";
  const name = anchorName(id);
  const role = anchor.role || "";
  const categories = [];
  const widthRatio = figmaW > 0 ? measured.w / figmaW : 1;
  const heightRatio = figmaH > 0 ? measured.h / figmaH : 1;
  const expectedText = normalizeText(anchor?.typography?.characters);
  const actualText = normalizeText(measured?.text);
  const anchorNameText = readableAnchorName(id);
  const textMatchesExpected = expectedText ? textMatches(actualText, expectedText) : null;
  const textMatchesAnchorName = anchorNameText ? fuzzyTextMatches(actualText, anchorNameText) : null;

  if (/alex-carter-2|wordmark|footer-brand|footer-logo/i.test(id) && widthRatio < 0.35) {
    categories.push("footer-wordmark-target");
  }
  if (/project-section|more-projects|work-more|footer|section/i.test(name) && heightRatio > 2) {
    categories.push("section-height-explosion");
  }
  if ((role === ROLES.DECORATIVE || role === ROLES.PRIMARY_MEDIA || /image|pizza|egg|bacon|food|decor/i.test(id)) && dy > 80) {
    categories.push(anchor.bbox?.y < 0 ? "decorative-flow-drift" : "media-position-drift");
  }
  if ((role === ROLES.TEXT_BLOCK || measured.semantic) && Math.abs(measured.h - figmaH) > 12 && dy <= 24) {
    categories.push("text-metric-mismatch");
  }
  if (/nav|label|work|about|alex-carter/i.test(id) && dy <= 24 && Math.abs(measured.h - figmaH) > 12) {
    categories.push("control-text-anchor-mismatch");
  }
  if (
    /(?:logo|brand|mark|wordmark|logoname)/i.test(id) &&
    actualText.length >= 60 &&
    (widthRatio >= 1.8 || heightRatio >= 2)
  ) {
    categories.push("wrapper-target-too-large", "possible-wrong-wrapper-target");
  }
  if (
    /(?:logo|brand|mark|wordmark|project-card)/i.test(id) &&
    !categories.includes("wrapper-target-too-large") &&
    (widthRatio < 0.75 || widthRatio > 1.25 || heightRatio < 0.75 || heightRatio > 1.25)
  ) {
    categories.push("repeated-logo-scale-drift");
  }
  if (
    (role === ROLES.PRIMARY_HEADING || role === ROLES.TEXT_BLOCK) &&
    measured.semantic &&
    figmaW > 0 &&
    widthRatio >= 2 &&
    heightRatio >= 0.7 &&
    heightRatio <= 1.4 &&
    textLooksExpected(anchor, measured)
  ) {
    categories.push("anchor-target-too-wide", "text-anchor-wrapper-mismatch");
  }
  const isTextAnchor = role === ROLES.PRIMARY_HEADING || role === ROLES.TEXT_BLOCK || measured.semantic;
  const textExpected = isTextAnchor && textLooksExpected(anchor, measured);
  const targetTooWide = categories.includes("anchor-target-too-wide");
  if (textExpected && !targetTooWide && Math.max(dx, dy) >= 24) {
    const widthOff = widthRatio <= 0.8 || (widthRatio >= 1.25 && widthRatio < 2);
    const heightOff = heightRatio <= 0.8 || heightRatio >= 1.25;
    if (widthOff || heightOff) {
      categories.push("text-metric-drift");
      if (widthRatio <= 0.5) categories.push("text-bbox-too-small", "text-size-too-small", "wrapping-width-too-narrow");
      else if (widthRatio <= 0.8) categories.push("wrapping-width-too-narrow");
      if (heightRatio <= 0.6) categories.push("text-bbox-too-small", "text-line-height-too-small");
      else if (heightRatio <= 0.8) categories.push("text-line-height-too-small");
      if (widthRatio >= 1.25 && widthRatio < 2) categories.push("text-wrapping-width-drift");
      if (heightRatio >= 1.25) categories.push("text-line-height-drift");
      if (widthRatio < 2 && widthRatio >= 1.15) categories.push("text-anchor-resolved-wrapper-mismatch");
    }
    if (dx >= 24 || dy >= 24) {
      categories.push("text-placement-drift");
      if (
        widthRatio >= 0.9 &&
        widthRatio <= 1.1 &&
        heightRatio >= 0.9 &&
        heightRatio <= 1.1 &&
        Math.max(dx, dy) <= 40
      ) {
        categories.push("text-micro-placement-drift", "text-placement-residual");
      }
    }
  }
  if (isTextAnchor && !targetTooWide && actualText && Math.max(dx, dy) >= 24) {
    const sectionRootLike = isNumberedSectionAnchorId(id) || role === ROLES.SECTION_ROOT;
    if (!sectionRootLike && isFrameLikeAnchorId(id) && isLargeFigmaBox({ w: figmaW, h: figmaH })) {
      categories.push("text-on-background-anchor", "background-anchor-wrong-target", "section-background-anchor-target-mismatch", "possible-wrong-anchor-target");
    }
    if (textMatchesExpected === false) {
      categories.push("text-content-mismatch", "possible-wrong-anchor-target");
    }
    if (!expectedText && textMatchesAnchorName === false) {
      if (isGenericLayerName(anchorNameText)) {
        categories.push("expected-text-missing", "generic-layer-name-text-mismatch", "low-confidence-anchor-name-mismatch");
      } else if (isSemanticLayerName(anchorNameText)) {
        categories.push("expected-text-missing", "semantic-layer-name-text-mismatch", "low-confidence-semantic-layer-name");
        if (/^@/.test(actualText)) categories.push("duplicate-social-handle-anchor");
      } else {
        categories.push("anchor-name-text-mismatch", "possible-wrong-anchor-target");
      }
    } else if (!expectedText && textMatchesAnchorName === true && !textMatches(actualText, anchorNameText)) {
      const typoMatch = typoTextMatchesTokens(textTokens(actualText), textTokens(anchorNameText));
      categories.push(typoMatch ? "text-anchor-name-typo-match" : "text-anchor-name-partial-match");
      categories.push(typoMatch ? "anchor-name-spelling-typo" : "punctuation-normalization-mismatch");
    }
  }

  return unique(categories);
}

function bboxKey(box, tolerance = 8) {
  if (!box) return null;
  const snap = (value) => Math.round((Number(value) || 0) / tolerance) * tolerance;
  return [snap(box.x), snap(box.y), snap(box.w), snap(box.h)].join(",");
}

function bboxSpread(items, field = "measured") {
  const boxes = items.map((item) => item[field]).filter(Boolean);
  if (!boxes.length) return { x: 0, y: 0, w: 0, h: 0, max: 0 };
  const spread = {};
  for (const key of ["x", "y", "w", "h"]) {
    const values = boxes.map((box) => Number(box[key]) || 0);
    spread[key] = round1(Math.max(...values) - Math.min(...values));
  }
  spread.max = Math.max(spread.x, spread.y, spread.w, spread.h);
  return spread;
}

function buildDuplicateTextBboxGroups(deltas = []) {
  const byKey = new Map();
  for (const delta of deltas) {
    if (!delta.figma) continue;
    const key = bboxKey(delta.figma, 6);
    if (!key) continue;
    const group = byKey.get(key) || [];
    group.push(delta);
    byKey.set(key, group);
  }
  return [...byKey.values()]
    .filter((group) => group.length >= 2 && !isLikelyFullBboxDuplicateGroup(group) && group.some(isTextishAnchor))
    .map((group) => {
      const measuredItems = group.map((item) => ({ id: item.id, measured: item.measured }));
      const measuredSpread = bboxSpread(measuredItems, "measured");
      const wrapperTargetIds = group
        .filter((item) => (item.categories || []).some((c) => c === "wrapper-target-too-large" || c === "possible-wrong-wrapper-target"))
        .map((item) => item.id);
      const resolved = group.length > 0 && measuredItems.every((item) => item.measured) && measuredSpread.max <= 8;
      return {
        ids: group.map((item) => item.id),
        roles: unique(group.map((item) => item.role)),
        figma: group[0].figma,
        measured: measuredItems,
        measuredSpread,
        resolved,
        wrapperTargetIds,
        suggestedAction: wrapperTargetIds.length
          ? `use data-anchors="${group.map((item) => item.id).join(" ")}" on the visible text element if these are duplicate text layers`
          : `if these ids represent the same visible text layer, use data-anchors="${group.map((item) => item.id).join(" ")}"`,
        categories: unique(["duplicate-text-bbox-group", resolved ? "duplicate-text-bbox-group-resolved" : "duplicate-text-bbox-group-unresolved", wrapperTargetIds.length ? "duplicate-text-wrapper-target-candidate" : null]),
      };
    })
    .sort((a, b) => (b.wrapperTargetIds.length - a.wrapperTargetIds.length) || b.ids.length - a.ids.length)
    .slice(0, 20);
}

function summarizeAnchorDeltas(deltas) {
  const categories = [];
  const topDeltas = [...deltas]
    .sort((a, b) => Math.max(b.dx, b.dy) - Math.max(a.dx, a.dy))
    .slice(0, 10);

  const exhibitDeltas = deltas.filter((d) => /exhibit|image-\d+|project-card/i.test(d.id) && Math.abs(d.dy) > 24);
  if (exhibitDeltas.length >= 3) {
    categories.push("repeated-stack-height-drift");
  }

  const logoScaleDeltas = deltas.filter((d) => (d.categories || []).includes("repeated-logo-scale-drift"));
  if (logoScaleDeltas.length >= 2) {
    categories.push("repeated-logo-scale-drift");
  }

  const allSectionDeltas = deltas
    .filter((d) => isSectionAnchorId(d.id))
    .map((d) => ({
      ...d,
      heightDelta: round1((d.measured?.h || 0) - (d.figma?.h || 0)),
      widthDelta: round1((d.measured?.w || 0) - (d.figma?.w || 0)),
      sectionNumber: sectionNumber(d.id),
    }));
  const sectionDeltas = [...allSectionDeltas]
    .sort((a, b) => {
      const aMax = Math.max(a.dx, a.dy);
      const bMax = Math.max(b.dx, b.dy);
      return bMax - aMax;
    })
    .slice(0, 12);

  const sectionByY = [...allSectionDeltas].sort((a, b) => (a.figma?.y || 0) - (b.figma?.y || 0));
  const sectionOffsetPropagation = buildSectionOffsetPropagation(sectionByY);
  const nonActionableRootResiduals = buildNonActionableRootResiduals(sectionOffsetPropagation);
  const sectionGapDeltas = [];
  for (let i = 0; i < sectionByY.length - 1; i++) {
    const from = sectionByY[i];
    const to = sectionByY[i + 1];
    const figmaGap = round1((to.figma?.y || 0) - ((from.figma?.y || 0) + (from.figma?.h || 0)));
    const measuredGap = round1((to.measured?.y || 0) - ((from.measured?.y || 0) + (from.measured?.h || 0)));
    const gapDelta = round1(measuredGap - figmaGap);
    const gapCategories = [];
    if (Math.abs(gapDelta) >= 40) {
      gapCategories.push("section-gap-drift", "normal-flow-spacing-drift");
      if (Math.abs(to.dy) >= 40) gapCategories.push("downstream-section-y-drift");
    }
    sectionGapDeltas.push({
      from: from.id,
      to: to.id,
      figmaGap,
      measuredGap,
      gapDelta,
      fromHeightDelta: from.heightDelta,
      toYDelta: to.dy,
      categories: unique(gapCategories),
    });
  }

  const repeatedHeightGroups = [];
  const heightCandidates = allSectionDeltas
    .filter((d) => Math.abs(d.heightDelta) >= 40 && Number.isFinite(d.sectionNumber))
    .sort((a, b) => a.sectionNumber - b.sectionNumber);
  const used = new Set();
  for (let i = 0; i < heightCandidates.length; i++) {
    if (used.has(heightCandidates[i].id)) continue;
    const seed = heightCandidates[i];
    const group = heightCandidates.filter((d) =>
      !used.has(d.id) &&
      Math.abs(d.heightDelta - seed.heightDelta) <= 8 &&
      Math.abs(d.sectionNumber - seed.sectionNumber) <= 4
    );
    if (group.length >= 3) {
      for (const item of group) {
        used.add(item.id);
        item.categories = unique([...(item.categories || []), "repeated-section-height-drift", "repeated-row-height-drift"]);
      }
      repeatedHeightGroups.push({
        ids: group.map((d) => d.id),
        heightDelta: round1(group.reduce((sum, d) => sum + d.heightDelta, 0) / group.length),
        measuredHeights: group.map((d) => d.measured?.h),
        figmaHeights: group.map((d) => d.figma?.h),
        categories: ["repeated-section-height-drift", "repeated-row-height-drift"],
      });
    }
  }

  const anchorTargetMismatches = deltas
    .filter((d) => (d.categories || []).some((c) => c === "anchor-target-too-wide" || c === "text-anchor-wrapper-mismatch"))
    .map((d) => {
      const ratios = sizeRatio(d.measured, d.figma);
      return {
        id: d.id,
        role: d.role,
        dx: d.dx,
        dy: d.dy,
        deltaX: d.deltaX,
        deltaY: d.deltaY,
        measured: d.measured,
        figma: d.figma,
        widthRatio: round1(ratios.widthRatio),
        heightRatio: round1(ratios.heightRatio),
        categories: d.categories,
      };
    })
    .sort((a, b) => b.widthRatio - a.widthRatio)
    .slice(0, 20);

  const fullBboxAnchorGroups = [];
  const fullBboxMap = new Map();
  for (const d of deltas) {
    if (!isLargeFigmaBox(d.figma)) continue;
    if (!isFrameLikeAnchorId(d.id) && d.role !== ROLES.SECTION_ROOT && d.role !== ROLES.DECORATIVE && d.role !== ROLES.PRIMARY_MEDIA) continue;
    const key = bboxKey(d.figma);
    if (!key) continue;
    const group = fullBboxMap.get(key) || [];
    group.push(d);
    fullBboxMap.set(key, group);
  }
  for (const group of fullBboxMap.values()) {
    if (group.length < 2) continue;
    const representative = group.find((d) => d.role === ROLES.SECTION_ROOT) || group[0];
    const measuredSpread = bboxSpread(group, "measured");
    const matchedCount = group.filter((d) => d.measured).length;
    const resolved = matchedCount === group.length && measuredSpread.max <= 8;
    const unresolvedIds = resolved ? [] : group
      .filter((d) => !d.measured || (d.actualText && isFrameLikeAnchorId(d.id) && Math.max(d.dx, d.dy) >= 24))
      .map((d) => d.id);
    const ids = group.map((d) => d.id);
    fullBboxAnchorGroups.push({
      ids,
      roles: unique(group.map((d) => d.role)),
      figma: representative.figma,
      measured: group.map((d) => ({ id: d.id, measured: d.measured })),
      representative: representative.id,
      likelyMeaning: "section/background/frame variants",
      resolved,
      resolution: resolved ? "same-measured-bbox" : "unresolved",
      measuredSpread,
      maxMeasuredDelta: measuredSpread.max,
      unresolvedIds,
      suggestedAction: resolved
        ? "resolved: same measured bbox / data-anchors likely OK"
        : `if these ids represent the same full-bbox layer, use data-anchors="${ids.join(" ")}" on the visible section/background/root box; do not attach them to gallery/media/text children`,
      categories: [
        "full-bbox-anchor-group",
        "section-background-frame-variants",
        resolved ? "full-bbox-anchor-group-resolved" : "full-bbox-anchor-group-unresolved",
      ],
    });
  }
  const resolvedFullBboxIds = new Set(fullBboxAnchorGroups.filter((g) => g.resolved).flatMap((g) => g.ids || []));
  const unresolvedFullBboxIds = new Set(fullBboxAnchorGroups.filter((g) => !g.resolved).flatMap((g) => g.ids || []));

  const sectionBackgroundAnchorTargetMismatches = deltas
    .filter((d) => (d.categories || []).some((c) =>
      c === "text-on-background-anchor" ||
      c === "background-anchor-wrong-target" ||
      c === "section-background-anchor-target-mismatch"
    ))
    .filter((d) => !resolvedFullBboxIds.has(d.id) && unresolvedFullBboxIds.has(d.id))
    .map((d) => ({
      id: d.id,
      role: d.role,
      dx: d.dx,
      dy: d.dy,
      measured: d.measured,
      figma: d.figma,
      actualText: d.actualText || null,
      anchorNameText: d.anchorNameText || null,
      warning: "do not tune text; move anchor to visible section/background/frame box or document missing visual mapping",
      categories: d.categories,
    }))
    .sort((a, b) => Math.max(b.dx, b.dy) - Math.max(a.dx, a.dy))
    .slice(0, 20);
  const wrapperTargetMismatches = deltas
    .filter((d) => (d.categories || []).some((c) => c === "wrapper-target-too-large" || c === "possible-wrong-wrapper-target"))
    .map((d) => {
      const ratios = sizeRatio(d.measured, d.figma);
      return {
        id: d.id,
        role: d.role,
        dx: d.dx,
        dy: d.dy,
        measured: d.measured,
        figma: d.figma,
        widthRatio: round1(ratios.widthRatio),
        heightRatio: round1(ratios.heightRatio),
        actualText: d.actualText || null,
        anchorNameText: d.anchorNameText || null,
        suggestedAction: "move anchor from section/wrapper to the visible logo/wordmark/text element, or document intentional wrapper mapping",
        categories: d.categories,
      };
    })
    .sort((a, b) => Math.max(b.dx, b.dy) - Math.max(a.dx, a.dy))
    .slice(0, 20);
  const duplicateTextBboxGroups = buildDuplicateTextBboxGroups(deltas);

  const textMetricDrifts = deltas
    .filter((d) => (d.categories || []).some((c) =>
      c === "text-metric-drift" ||
      c === "text-placement-drift" ||
      c === "text-wrapping-width-drift" ||
      c === "text-line-height-drift" ||
      c === "text-bbox-too-small" ||
      c === "text-size-too-small" ||
      c === "wrapping-width-too-narrow" ||
      c === "text-line-height-too-small" ||
      c === "text-micro-placement-drift" ||
      c === "text-placement-residual" ||
      c === "text-anchor-resolved-wrapper-mismatch" ||
      c === "text-content-mismatch" ||
      c === "anchor-name-text-mismatch" ||
      c === "possible-wrong-anchor-target" ||
      c === "expected-text-missing" ||
      c === "generic-layer-name-text-mismatch" ||
      c === "low-confidence-anchor-name-mismatch" ||
      c === "semantic-layer-name-text-mismatch" ||
      c === "low-confidence-semantic-layer-name" ||
      c === "duplicate-social-handle-anchor" ||
      c === "text-anchor-name-partial-match" ||
      c === "punctuation-normalization-mismatch" ||
      c === "anchor-name-spelling-typo" ||
      c === "text-anchor-name-typo-match" ||
      c === "text-on-background-anchor" ||
      c === "background-anchor-wrong-target" ||
      c === "section-background-anchor-target-mismatch"
    ))
    .map((d) => {
      const ratios = sizeRatio(d.measured, d.figma);
      const suggestedCause = [];
      if ((d.categories || []).some((c) => c === "text-content-mismatch" || c === "anchor-name-text-mismatch" || c === "possible-wrong-anchor-target")) {
        suggestedCause.push("content/anchor mismatch");
      } else if ((d.categories || []).some((c) => c === "generic-layer-name-text-mismatch" || c === "low-confidence-anchor-name-mismatch")) {
        suggestedCause.push("generic layer-name mismatch");
      } else if ((d.categories || []).some((c) => c === "semantic-layer-name-text-mismatch" || c === "low-confidence-semantic-layer-name")) {
        suggestedCause.push("semantic layer-name mismatch");
      } else if ((d.categories || []).some((c) => c === "anchor-name-spelling-typo" || c === "text-anchor-name-typo-match")) {
        suggestedCause.push("anchor-name spelling typo");
      }
      if ((d.categories || []).includes("text-wrapping-width-drift")) suggestedCause.push("wrapping width");
      if ((d.categories || []).includes("wrapping-width-too-narrow")) suggestedCause.push("wrapping box too narrow");
      if ((d.categories || []).includes("text-line-height-drift")) suggestedCause.push("line-height");
      if ((d.categories || []).includes("text-line-height-too-small")) suggestedCause.push("line-height too small");
      if ((d.categories || []).includes("text-size-too-small")) suggestedCause.push("text size too small");
      if ((d.categories || []).includes("text-micro-placement-drift")) suggestedCause.push("micro placement tune");
      else if ((d.categories || []).includes("text-placement-drift")) suggestedCause.push("placement");
      if (!suggestedCause.length) suggestedCause.push("font-size or text metrics");
      return {
        id: d.id,
        role: d.role,
        dx: d.dx,
        dy: d.dy,
        measured: d.measured,
        figma: d.figma,
        widthRatio: round1(ratios.widthRatio),
        heightRatio: round1(ratios.heightRatio),
        expectedText: d.expectedText || null,
        actualText: d.actualText || null,
        anchorNameText: d.anchorNameText || null,
        textMatchesExpected: d.textMatchesExpected,
        textMatchesAnchorName: d.textMatchesAnchorName,
        suggestedCause: suggestedCause.join(", "),
        suggestedAction: (d.categories || []).some((c) => c === "text-bbox-too-small" || c === "text-size-too-small" || c === "wrapping-width-too-narrow" || c === "text-line-height-too-small")
          ? "increase font-size/line-height/wrapping box, then tune placement"
          : (d.categories || []).some((c) => c === "text-micro-placement-drift" || c === "text-placement-residual")
            ? "micro placement tune after larger text metric issues"
          : null,
        warning: (d.categories || []).some((c) => c === "anchor-name-spelling-typo" || c === "text-anchor-name-typo-match")
          ? "do not change app copy to match a likely Figma layer-name typo; tune size/placement only if needed"
          : null,
        categories: d.categories,
      };
    })
    .sort((a, b) => Math.max(b.dx, b.dy) - Math.max(a.dx, a.dy))
    .slice(0, 20);
  const textContentAnchorMismatches = textMetricDrifts
    .filter((d) => (d.categories || []).some((c) =>
      c === "text-content-mismatch" ||
      c === "anchor-name-text-mismatch" ||
      c === "possible-wrong-anchor-target" ||
      c === "expected-text-missing" ||
      c === "generic-layer-name-text-mismatch" ||
      c === "low-confidence-anchor-name-mismatch" ||
      c === "semantic-layer-name-text-mismatch" ||
      c === "low-confidence-semantic-layer-name" ||
      c === "duplicate-social-handle-anchor"
    ))
    .map((d) => ({
      ...d,
      confidence: (d.categories || []).some((c) => c === "low-confidence-anchor-name-mismatch" || c === "generic-layer-name-text-mismatch" || c === "low-confidence-semantic-layer-name" || c === "semantic-layer-name-text-mismatch") ? "low" : "high",
      reason: (d.categories || []).some((c) => c === "low-confidence-semantic-layer-name" || c === "semantic-layer-name-text-mismatch")
        ? "expected text is missing and anchor name looks like a semantic layer name"
        : (d.categories || []).some((c) => c === "low-confidence-anchor-name-mismatch" || c === "generic-layer-name-text-mismatch")
          ? "expected text is missing and anchor name looks like a generic Figma layer name"
          : "actual text conflicts with expected text or a non-generic anchor name",
      warning: (d.categories || []).some((c) => c === "low-confidence-semantic-layer-name" || c === "semantic-layer-name-text-mismatch")
        ? "do not move anchor solely from semantic layer-name mismatch; inspect overlapping text anchors and surrounding context"
        : (d.categories || []).some((c) => c === "low-confidence-anchor-name-mismatch" || c === "generic-layer-name-text-mismatch")
          ? "review only: do not move anchor, change copy, or tune text metrics solely from a generic layer-name mismatch; inspect expected text or surrounding context"
          : "do not tune text metrics until anchor/content mapping is verified",
    }));
  const highConfidenceTextContentAnchorMismatches = textContentAnchorMismatches
    .filter((d) => d.confidence === "high");
  const lowConfidenceTextContentAnchorMismatches = textContentAnchorMismatches
    .filter((d) => d.confidence === "low")
    .map((d) => ({
      ...d,
      reviewOnly: true,
      warning: d.warning || "review only: expected text is missing and anchor name is a weak hint",
    }));
  const textContentAnchorMismatchSummary = {
    total: textContentAnchorMismatches.length,
    highConfidence: highConfidenceTextContentAnchorMismatches.length,
    lowConfidence: lowConfidenceTextContentAnchorMismatches.length,
    expectedTextMissing: textContentAnchorMismatches.filter((d) => !d.expectedText).length,
    reviewOnly: lowConfidenceTextContentAnchorMismatches.length,
  };
  const trueTextMetricDrifts = textMetricDrifts
    .filter((d) => !isTextContentLike(d));
  const sharedTextYOffsetGroups = buildSharedTextYOffsetGroups(trueTextMetricDrifts, allSectionDeltas);
  const logoBrandScaleDrifts = buildLogoBrandScaleDrifts(deltas);

  const internalSectionDriftGroups = [];
  for (let i = 0; i < sectionByY.length; i++) {
    const section = sectionByY[i];
    const next = sectionByY[i + 1] || null;
    const sectionY = section.figma?.y || 0;
    const sectionBottom = sectionY + (section.figma?.h || 0);
    const nextY = next?.figma?.y ?? Infinity;
    const members = deltas.filter((d) => {
      if (isSectionAnchorId(d.id)) return false;
      const fy = d.figma?.y || 0;
      if (fy < sectionY || fy >= Math.min(sectionBottom, nextY)) return false;
      const ratios = sizeRatio(d.measured, d.figma);
      const targetMismatch = (d.categories || []).some((c) => c === "anchor-target-too-wide" || c === "text-anchor-wrapper-mismatch");
      return !targetMismatch &&
        ratios.widthRatio >= 0.5 &&
        ratios.widthRatio <= 2 &&
        ratios.heightRatio >= 0.5 &&
        ratios.heightRatio <= 1.6 &&
        Math.max(d.dx, d.dy) >= 80;
    });
    if (members.length >= 3) {
      internalSectionDriftGroups.push(enrichInternalSectionGroup(section.id, members));
    }
  }
  const sharedResidualOffsetSources = attachSharedOffsetSources(internalSectionDriftGroups, sectionOffsetPropagation);
  const repeatedSlotSequenceDrifts = internalSectionDriftGroups
    .flatMap((group) => group.repeatedSlotSequenceDrifts || []);

  const layoutModelMismatches = internalSectionDriftGroups.map((group) => {
    const sectionRoot = allSectionDeltas.find((d) => d.id === group.sectionId);
    const members = (group.anchors || []).map((anchor) => ({
      ...anchor,
      widthRatioRaw: sizeRatio(anchor.measured, anchor.figma).widthRatio,
      heightRatioRaw: sizeRatio(anchor.measured, anchor.figma).heightRatio,
    }));
    const medianWidthRatio = median(members.map((a) => a.widthRatioRaw));
    const medianHeightRatio = median(members.map((a) => a.heightRatioRaw));
    const largePlacementDeltaCount = members.filter((a) => Math.max(a.dx, a.dy) >= 200).length;
    const targetMismatchCount = members.filter((a) =>
      (a.categories || []).some((c) => c === "anchor-target-too-wide" || c === "text-anchor-wrapper-mismatch")
    ).length;
    const sizeLooksNormal =
      medianWidthRatio !== null &&
      medianHeightRatio !== null &&
      medianWidthRatio >= 0.7 &&
      medianWidthRatio <= 1.4 &&
      medianHeightRatio >= 0.7 &&
      medianHeightRatio <= 1.4;
    const sectionRootReasonable = sectionRoot
      ? Math.max(sectionRoot.dx, sectionRoot.dy) <= Math.max(100, (sectionRoot.figma?.h || 0) * 0.1)
      : false;
    let decision = "continue-small-tuning";
    if (group.residualSharedOffsetLikely) {
      decision = "rewrite-effective-residual-offset";
    } else if (largePlacementDeltaCount >= 4 && sizeLooksNormal && targetMismatchCount === 0 && sectionRootReasonable) {
      decision = "rewrite-required";
    } else if (largePlacementDeltaCount >= 4 && targetMismatchCount > 0) {
      decision = "anchor-refinement-required";
    } else if (largePlacementDeltaCount >= 4) {
      decision = "ask-human";
    }
    const reason = decision === "rewrite-effective-residual-offset"
      ? "internal anchors share a common residual offset; section rewrite likely helped and the next source is upstream/root/stack positioning"
      : decision === "rewrite-required"
      ? "section root is close and anchor sizes are reasonable, but multiple internal anchors have large section-relative placement deltas"
      : decision === "anchor-refinement-required"
        ? "large placement deltas remain mixed with anchor target mismatch signals"
        : decision === "ask-human"
          ? "large internal placement deltas exist, but size/root heuristics are not conclusive"
          : "internal placement drift exists but does not meet rewrite threshold";
    return {
      sectionId: group.sectionId,
      decision,
      sectionRootDelta: sectionRoot ? {
        dx: sectionRoot.dx,
        dy: sectionRoot.dy,
        widthDelta: sectionRoot.widthDelta,
        heightDelta: sectionRoot.heightDelta,
      } : null,
      internalAnchorCount: group.count,
      largePlacementDeltaCount,
      residualSharedOffsetLikely: group.residualSharedOffsetLikely,
      residualSharedOffset: group.residualSharedOffset,
      sourceSection: group.sourceSection,
      sourcePair: group.sourcePair,
      offsetPropagation: group.offsetPropagation,
      normalizedMaxDeltaAfterSharedOffset: group.normalizedMaxDeltaAfterSharedOffset,
      placementSpread: group.placementSpread,
      medianWidthRatio: medianWidthRatio === null ? null : round1(medianWidthRatio),
      medianHeightRatio: medianHeightRatio === null ? null : round1(medianHeightRatio),
      dominantCategories: group.categories || [],
      currentDomModel: decision === "rewrite-effective-residual-offset" ? "rewritten-or-close-layout" : "semantic-grid-or-stack",
      figmaModel: decision === "rewrite-required" ? "freeform-or-staggered" : decision === "rewrite-effective-residual-offset" ? "shared-root-offset" : "unknown",
      orderMismatchLikely: largePlacementDeltaCount >= 4,
      reason,
      anchors: group.anchors || [],
    };
  });
  const actionabilitySummary = {
    highConfidenceContentMismatch: highConfidenceTextContentAnchorMismatches.length,
    trueTextMetricDrift: trueTextMetricDrifts.length,
    wrapperTargetMismatch: wrapperTargetMismatches.length,
    anchorTargetMismatch: anchorTargetMismatches.length,
    sectionBackgroundAnchorTargetMismatch: sectionBackgroundAnchorTargetMismatches.length,
    repeatedSlotSequenceDrift: repeatedSlotSequenceDrifts.length,
    repeatedHeightDrift: repeatedHeightGroups.length,
    internalSectionDrift: internalSectionDriftGroups.length,
    rewriteRequired: layoutModelMismatches.filter((m) => m.decision === "rewrite-required").length,
    reviewOnlyTextMismatch: lowConfidenceTextContentAnchorMismatches.length,
  };
  actionabilitySummary.actionableRemaining = [
    actionabilitySummary.highConfidenceContentMismatch,
    actionabilitySummary.trueTextMetricDrift,
    actionabilitySummary.wrapperTargetMismatch,
    actionabilitySummary.anchorTargetMismatch,
    actionabilitySummary.sectionBackgroundAnchorTargetMismatch,
    actionabilitySummary.repeatedSlotSequenceDrift,
    actionabilitySummary.repeatedHeightDrift,
    actionabilitySummary.internalSectionDrift,
    actionabilitySummary.rewriteRequired,
  ].some((count) => count > 0);

  categories.push(...deltas.flatMap((d) => d.categories || []));
  categories.push(...sectionGapDeltas.flatMap((d) => d.categories || []));
  categories.push(...sectionOffsetPropagation.flatMap((d) => d.categories || []));
  categories.push(...nonActionableRootResiduals.flatMap((d) => d.categories || []));
  categories.push(...repeatedHeightGroups.flatMap((g) => g.categories || []));
  categories.push(...fullBboxAnchorGroups.flatMap((g) => g.categories || []));
  categories.push(...sectionBackgroundAnchorTargetMismatches.flatMap((g) => g.categories || []));
  categories.push(...wrapperTargetMismatches.flatMap((g) => g.categories || []));
  categories.push(...duplicateTextBboxGroups.flatMap((g) => g.categories || []));
  categories.push(...logoBrandScaleDrifts.flatMap((g) => g.categories || []));
  categories.push(...sharedTextYOffsetGroups.flatMap((g) => g.categories || []));
  categories.push(...internalSectionDriftGroups.flatMap((g) => g.categories || []));
  categories.push(...repeatedSlotSequenceDrifts.flatMap((g) => g.categories || []));
  categories.push(...sharedResidualOffsetSources.flatMap((g) => g.categories || []));
  if (layoutModelMismatches.some((m) => m.decision === "rewrite-required")) {
    categories.push("rewrite-required");
  }
  if (layoutModelMismatches.some((m) => m.decision === "rewrite-effective-residual-offset")) {
    categories.push("rewrite-effective-residual-offset", "residual-shared-section-offset");
  }
  return {
    categories: unique(categories),
    allDeltas: deltas,
    topDeltas,
    sectionDeltas,
    sectionGapDeltas,
    sectionOffsetPropagation,
    nonActionableRootResiduals,
    sharedResidualOffsetSources,
    repeatedHeightGroups,
    anchorTargetMismatches,
    fullBboxAnchorGroups,
    sectionBackgroundAnchorTargetMismatches,
    wrapperTargetMismatches,
    duplicateTextBboxGroups,
    logoBrandScaleDrifts,
    textContentAnchorMismatches,
    highConfidenceTextContentAnchorMismatches,
    lowConfidenceTextContentAnchorMismatches,
    textContentAnchorMismatchSummary,
    textMetricDrifts,
    trueTextMetricDrifts,
    sharedTextYOffsetGroups,
    repeatedSlotSequenceDrifts,
    internalSectionDriftGroups,
    layoutModelMismatches,
    actionabilitySummary,
  };
}

const GENERIC_FONT_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "cursive",
  "fantasy",
  "inherit",
  "initial",
  "revert",
  "unset",
  "-apple-system",
  "blinkmacsystemfont",
]);

function stripFontQuotes(value) {
  return String(value || "").trim().replace(/^['"]|['"]$/g, "");
}

function splitFontFamilies(value) {
  const out = [];
  let cur = "";
  let quote = null;
  for (const ch of String(value || "")) {
    if ((ch === '"' || ch === "'") && !quote) {
      quote = ch;
      cur += ch;
      continue;
    }
    if (quote && ch === quote) {
      quote = null;
      cur += ch;
      continue;
    }
    if (ch === "," && !quote) {
      out.push(stripFontQuotes(cur));
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(stripFontQuotes(cur));
  return out.filter(Boolean);
}

function normalizeFontFamily(value) {
  return stripFontQuotes(value).toLowerCase();
}

function primaryFontFamily(value) {
  return splitFontFamilies(value).find((name) => !GENERIC_FONT_FAMILIES.has(normalizeFontFamily(name))) || null;
}

function normalizeFontWeight(value) {
  if (value == null || value === "") return null;
  const text = String(value).trim().toLowerCase();
  if (text === "normal") return 400;
  if (text === "bold") return 700;
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) ? n : null;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function compareTypography(anchor, measured) {
  if (!anchor.typography || !measured) return null;
  const expected = anchor.typography;
  const failures = [];
  const expectedFamily = normalizeFontFamily(expected.fontFamily);
  const actualFamily = normalizeFontFamily(measured.primaryFontFamily);
  if (expectedFamily && actualFamily && expectedFamily !== actualFamily) {
    failures.push(`fontFamily expected=${expected.fontFamily} actual=${measured.primaryFontFamily}`);
  }

  const expectedWeight = normalizeFontWeight(expected.fontWeight);
  const actualWeight = normalizeFontWeight(measured.fontWeight);
  if (expectedWeight && actualWeight && expectedWeight !== actualWeight) {
    failures.push(`fontWeight expected=${expectedWeight} actual=${actualWeight}`);
  }

  const expectedSize = Number(expected.fontSize);
  const actualSize = Number(measured.fontSize);
  if (Number.isFinite(expectedSize) && Number.isFinite(actualSize)) {
    const tol = Math.max(2, expectedSize * 0.03);
    const delta = Math.abs(expectedSize - actualSize);
    if (delta > tol) failures.push(`fontSize expected=${expectedSize}px actual=${actualSize.toFixed(1)}px`);
  }

  const expectedText = normalizeText(expected.characters);
  const actualText = normalizeText(measured.text);
  if (expectedText && actualText && expectedText !== actualText) {
    failures.push(`text expected="${expectedText}" actual="${actualText}"`);
  }

  if (!failures.length) return null;
  return {
    id: anchor.id,
    figmaNodeId: anchor.figmaNodeId,
    failures,
    expected: {
      text: expectedText,
      fontFamily: expected.fontFamily,
      fontWeight: expectedWeight,
      fontSize: Number.isFinite(expectedSize) ? expectedSize : null,
    },
    actual: {
      text: actualText,
      fontFamily: measured.primaryFontFamily,
      fontWeight: actualWeight,
      fontSize: Number.isFinite(actualSize) ? Number(actualSize.toFixed(1)) : null,
    },
  };
}

// 모드 분기: --strict 있고 --baseline-dir 있으면 strict, 아니면 lite (기존 동작)
const STRICT = opts.strict && opts["baseline-dir"];

// B-1a — --update-baseline 환경변수 게이트 (Playwright launch 전 차단).
// 분석 원칙 #1: figma 가 유일한 진실의 원천. 워커 self-capture 봉쇄.
if (opts["update-baseline"] && process.env.UPDATE_BASELINE_ALLOWED !== "1") {
  console.log(JSON.stringify({
    section: opts.section,
    viewport: opts.viewport,
    status: "FAIL",
    reason: "BASELINE_UPDATE_FORBIDDEN — figma 가 유일한 진실의 원천",
    detail: "--update-baseline 은 워커가 직접 호출 불가. 정당한 갱신 경로:\n" +
      "  1. UPDATE_BASELINE_ALLOWED=1 prepare-baseline.mjs --force --section <id> (figma 기준)\n" +
      "  2. 사람이 figma 디자인 변경 검토 후 명시 승인\n" +
      "회피 동기 제거: dimension mismatch 는 게이트가 자동 normalize (B-1b).",
    strictEffective: false,
  }));
  process.exit(1);
}

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
    // B-1a 가드는 이미 args parse 직후에서 차단됨. 여기 도달했으면 UPDATE_BASELINE_ALLOWED=1.
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, currentBuf);
    console.log(JSON.stringify({ section: opts.section, viewport: opts.viewport, status: "BASELINE_UPDATED", baseline: baselinePath, allowedBy: "UPDATE_BASELINE_ALLOWED" }));
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
  const l1 = {
    status: pass ? "PASS" : "FAIL",
    reason: pass ? null : `L1 ${dpct.toFixed(2)}% > ${opts["threshold-l1"]}%`,
    diffPercent: Number(dpct.toFixed(3)),
    thresholdEffective: opts["threshold-l1"],
    thresholdTarget: opts["threshold-l1-target"],
    enforcingTarget: process.env.G1_ENFORCE_L1_TARGET === "1",
    targetGap: Number(Math.max(0, dpct - opts["threshold-l1-target"]).toFixed(3)),
    diffPath,
  };
  const iteration = appendG1Iteration({
    section: opts.section,
    viewport: opts.viewport,
    status: pass ? "PASS" : "FAIL",
    reason: l1.reason,
    l1,
    l2: null,
  });
  console.log(JSON.stringify({
    section: opts.section,
    viewport: opts.viewport,
    status: pass ? "PASS" : "FAIL",
    diffPercent: l1.diffPercent,
    threshold: l1.thresholdEffective,
    thresholdEffective: l1.thresholdEffective,
    thresholdTarget: l1.thresholdTarget,
    enforcingTarget: l1.enforcingTarget,
    targetGap: l1.targetGap,
    diffPath: l1.diffPath,
    baseline: baselinePath,
    iteration,
  }));
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
    const provenancePath = `${png}.provenance.json`;
    if (!existsSync(provenancePath)) {
      evalPlan.push({ v, status: "INVALID_BASELINE_PROVENANCE", reason: `missing baseline provenance: ${provenancePath}` });
      continue;
    }
    try {
      const provenance = readJsonFile(provenancePath);
      const actualSha = sha256File(png);
      if (provenance.source !== "figma-rest") {
        evalPlan.push({ v, status: "INVALID_BASELINE_PROVENANCE", reason: `baseline provenance source=${provenance.source || "<missing>"}; expected figma-rest` });
        continue;
      }
      if (!provenance.sha256 || provenance.sha256 !== actualSha) {
        evalPlan.push({ v, status: "INVALID_BASELINE_PROVENANCE", reason: `baseline provenance sha256 mismatch for ${png}` });
        continue;
      }
    } catch (error) {
      evalPlan.push({ v, status: "INVALID_BASELINE_PROVENANCE", reason: `invalid baseline provenance ${provenancePath}: ${error.message}` });
      continue;
    }
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

  const blockingInvalidProvenance = evalPlan.filter((e) => e.status === "INVALID_BASELINE_PROVENANCE");
  if (blockingInvalidProvenance.length) {
    console.log(JSON.stringify({ section: opts.section, status: "FAIL", strictEffective: false, reason: blockingInvalidProvenance[0].reason, viewports: {} }));
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
    let scale = 1;
    let rootOriginX = 0;
    let rootOriginY = 0;
    let rootMeasuredBox = null;
    if (!l2skip) {
      const manifest = readManifest(am);
      if (manifest.source !== "figma-node-tree") {
        return {
          viewport,
          status: "FAIL",
          reason: `invalid anchor manifest source=${manifest.source || "<missing>"}; expected figma-node-tree`,
          l1: null,
          l2: { status: "FAIL", reason: "invalid anchor manifest provenance" },
        };
      }
      const rootOnly = manifest.anchors.length <= 1 &&
        manifest.anchors.every((anchor) => anchor.role === ROLES.SECTION_ROOT || /\/(?:root|section-\d+)$/i.test(anchor.id || ""));
      if (rootOnly) {
        return {
          viewport,
          status: "FAIL",
          reason: `anchor manifest coverage too low: ${manifest.anchors.length} root-only anchor(s). Extract anchors from Figma node tree; do not hand-author root-only manifests.`,
          l1: null,
          l2: { status: "FAIL", reason: "anchor manifest coverage too low", anchorsTotal: manifest.anchors.length },
        };
      }
      const ids = manifest.anchors.map((a) => a.id);
      const bboxes = await page.evaluate((ids) => {
        const GENERIC = new Set(["serif", "sans-serif", "monospace", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "cursive", "fantasy", "inherit", "initial", "revert", "unset", "-apple-system", "blinkmacsystemfont"]);
        const stripQuotes = (s) => s.trim().replace(/^['"]|['"]$/g, "");
        const splitFontFamilies = (value) => {
          const out = [];
          let cur = "";
          let quote = null;
          for (const ch of value || "") {
            if ((ch === '"' || ch === "'") && !quote) {
              quote = ch;
              cur += ch;
              continue;
            }
            if (quote && ch === quote) {
              quote = null;
              cur += ch;
              continue;
            }
            if (ch === "," && !quote) {
              out.push(stripQuotes(cur));
              cur = "";
              continue;
            }
            cur += ch;
          }
          if (cur.trim()) out.push(stripQuotes(cur));
          return out.filter(Boolean);
        };
        const primaryFontFamily = (fontFamily) =>
          splitFontFamilies(fontFamily).find((name) => !GENERIC.has(name.toLowerCase())) || null;
        const cssString = (value) => {
          if (globalThis.CSS?.escape) return CSS.escape(value);
          return String(value).replace(/["\\]/g, "\\$&");
        };
        const tokenHasAnchor = (value, id) => String(value || "").split(/\s+/).filter(Boolean).includes(id);
        const findAnchorElement = (id) => {
          const single = document.querySelector(`[data-anchor="${cssString(id)}"]`);
          if (single) return single;
          for (const candidate of document.querySelectorAll("[data-anchors]")) {
            if (tokenHasAnchor(candidate.getAttribute("data-anchors"), id)) return candidate;
          }
          return null;
        };
        const out = {};
        for (const id of ids) {
          const el = findAnchorElement(id);
          if (el) {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            out[id] = {
              x: r.x,
              y: r.y,
              w: r.width,
              h: r.height,
              tag: el.tagName,
              semantic: ["H1","H2","H3","H4","H5","H6","P","SPAN","LI","DT","DD","STRONG","EM"].includes(el.tagName),
              text: (el.textContent || "").replace(/\s+/g, " ").trim(),
              fontFamily: cs.fontFamily,
              primaryFontFamily: primaryFontFamily(cs.fontFamily),
              fontSize: Number.parseFloat(cs.fontSize),
              fontWeight: cs.fontWeight,
            };
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
      if (rootAnchor && rootAnchor.bbox && measuredRoot && measuredRoot.w > 0 && rootAnchor.bbox.w > 0) {
        scale = measuredRoot.w / rootAnchor.bbox.w;
        rootOriginX = measuredRoot.x;
        rootOriginY = measuredRoot.y;
        rootMeasuredBox = { x: measuredRoot.x, y: measuredRoot.y, w: measuredRoot.w, h: measuredRoot.h };
        normalizeMeta = {
          scale: Number(scale.toFixed(4)),
          rootMeasuredW: Math.round(measuredRoot.w),
          rootMeasuredH: Math.round(measuredRoot.h),
          rootFigmaW: rootAnchor.bbox.w,
          rootFigmaH: rootAnchor.bbox?.h,
        };
      } else if (manifest.figmaPageWidth && rootAnchor && bboxes[rootAnchor.id]) {
        // fallback — root bbox 없을 때 figmaPageWidth 와 viewport 비율
        const measured = bboxes[rootAnchor.id];
        scale = measured.w / manifest.figmaPageWidth;
        rootOriginX = measured.x;
        rootOriginY = measured.y;
        rootMeasuredBox = { x: measured.x, y: measured.y, w: measured.w, h: measured.h };
        normalizeMeta = {
          scale: Number(scale.toFixed(4)),
          fallback: "figmaPageWidth",
          rootMeasuredW: Math.round(measured.w),
          rootMeasuredH: Math.round(measured.h),
        };
      }
      // scale ≈ 1 이면 normalize 사실상 무관

      let maxDelta = 0;
      let bboxFail = null;
      const bboxFailures = [];
      const anchorDeltas = [];
      const typographyFailures = [];
      for (const a of manifest.anchors) {
        const m = bboxes[a.id];
        if (!m) continue;
        if (!a.bbox) {
          // optional anchor without stored bbox: still mask if text-block, but skip delta check
          if (shouldMaskTextForL1(a, m)) {
            pushMaskRect(maskRects, { x: m.x, y: m.y, w: m.w, h: m.h });
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
            pushMaskRect(maskRects, { x: m.x, y: m.y, w: m.w, h: m.h });
          }
          continue;
        }
        const dx = Math.abs(measuredRelX - figmaNormalizedX);
        const dy = Math.abs(measuredRelY - figmaNormalizedY);
        maxDelta = Math.max(maxDelta, dx, dy);
        const categories = classifyAnchorDelta({
          anchor: a,
          measured: m,
          dx,
          dy,
          figmaW: figmaNormalizedW,
          figmaH: figmaNormalizedH,
        });
        anchorDeltas.push({
          id: a.id,
          role: a.role,
          dx: Number(dx.toFixed(1)),
          dy: Number(dy.toFixed(1)),
          deltaX: round1(measuredRelX - figmaNormalizedX),
          deltaY: round1(measuredRelY - figmaNormalizedY),
          measured: roundBox({ x: measuredRelX, y: measuredRelY, w: m.w, h: m.h }),
          figma: roundBox({ x: figmaNormalizedX, y: figmaNormalizedY, w: figmaNormalizedW, h: figmaNormalizedH }),
          expectedText: normalizeText(a.typography?.characters) || null,
          actualText: normalizeText(m.text) || null,
          anchorNameText: readableAnchorName(a.id) || null,
          textMatchesExpected: a.typography?.characters ? textMatches(m.text, a.typography.characters) : null,
          textMatchesAnchorName: readableAnchorName(a.id) ? fuzzyTextMatches(m.text, readableAnchorName(a.id)) : null,
          relativeToRoot: true,
          categories,
        });
        if (dx > tolX || dy > tolY) {
          bboxFailures.push({
            id: a.id,
            figma: roundBox({ x: figmaNormalizedX, y: figmaNormalizedY, w: figmaNormalizedW, h: figmaNormalizedH }),
            reason: `${a.id} delta x=${dx.toFixed(0)} y=${dy.toFixed(0)} tol(${tolX.toFixed(0)},${tolY.toFixed(0)}) [scale=${scale.toFixed(3)}]`,
          });
        }
        // text-block 은 실제 text-bearing element 인지 검사
        if (a.role === ROLES.TEXT_BLOCK && !m.semantic) {
          bboxFail = bboxFail || `${a.id} role:text-block on non-text element <${m.tag}>`;
        }
        const typographyFailure = compareTypography(a, m);
        if (typographyFailure) {
          typographyFailures.push(typographyFailure);
          bboxFail = bboxFail || `${a.id} typography mismatch: ${typographyFailure.failures[0]}`;
        }
        // mask 영역 누적 (mask 는 viewport 절대좌표 그대로)
        if (shouldMaskTextForL1(a, m)) {
          pushMaskRect(maskRects, { x: m.x, y: m.y, w: m.w, h: m.h });
          pushMaskRect(maskRects, {
            x: rootOriginX + figmaNormalizedX,
            y: rootOriginY + figmaNormalizedY,
            w: figmaNormalizedW,
            h: figmaNormalizedH,
          });
        }
      }
      const deltaSummary = summarizeAnchorDeltas(anchorDeltas);
      const nonActionableRootResidualIds = new Set((deltaSummary.nonActionableRootResiduals || []).map((item) => item.targetSection));
      const nonActionableRootResidualSections = (deltaSummary.sectionDeltas || [])
        .filter((item) => nonActionableRootResidualIds.has(item.id))
        .filter((item) => item.figma && item.measured);
      const sectionL1ById = new Map((deltaSummary.sectionL1Diffs || []).map((item) => [item.sectionId, item]));
      const localL1CleanSections = (deltaSummary.sectionDeltas || [])
        .filter((item) => {
          const sectionL1 = sectionL1ById.get(item.id);
          return item.figma && item.measured &&
            sectionL1 &&
            Number(sectionL1.diffPercent || 0) <= 0.5 &&
            Math.abs(item.dy || 0) >= 8;
        });
      const nonActionableRootResidualBoxes = nonActionableRootResidualSections
        .map((item) => item.figma)
        .filter(Boolean);
      const lowConfidenceReviewOnlyTextIds = new Set(
        (deltaSummary.lowConfidenceTextContentAnchorMismatches || [])
          .filter((item) => item.reviewOnly && !item.expectedText)
          .map((item) => item.id)
      );
      const deltaById = new Map((deltaSummary.allDeltas || []).map((item) => [item.id, item]));
      const sameBbox = (a, b) =>
        a && b &&
        Math.abs((a.x || 0) - (b.x || 0)) <= 2 &&
        Math.abs((a.y || 0) - (b.y || 0)) <= 2 &&
        Math.abs((a.w || 0) - (b.w || 0)) <= 2 &&
        Math.abs((a.h || 0) - (b.h || 0)) <= 2;
      const containsBbox = (outer, inner) =>
        outer && inner &&
        (inner.x || 0) >= (outer.x || 0) - 2 &&
        (inner.y || 0) >= (outer.y || 0) - 2 &&
        ((inner.x || 0) + (inner.w || 0)) <= ((outer.x || 0) + (outer.w || 0)) + 2 &&
        ((inner.y || 0) + (inner.h || 0)) <= ((outer.y || 0) + (outer.h || 0)) + 2;
      const inheritsNonActionableSectionResidual = (failure) => {
        const delta = deltaById.get(failure.id);
        if (!delta) return false;
        return [...nonActionableRootResidualSections, ...localL1CleanSections].some((section) =>
          containsBbox(section.figma, failure.figma) &&
          Math.abs((delta.deltaY || 0) - (section.deltaY || 0)) <= 3 &&
          Math.abs((delta.dy || 0) - (section.dy || 0)) <= 3
        );
      };
      const isNonActionableResidualFailure = (failure) =>
        nonActionableRootResidualIds.has(failure.id) ||
        lowConfidenceReviewOnlyTextIds.has(failure.id) ||
        localL1CleanSections.some((section) => section.id === failure.id) ||
        nonActionableRootResidualBoxes.some((box) => sameBbox(failure.figma, box)) ||
        inheritsNonActionableSectionResidual(failure);
      const actionableBboxFailure = bboxFailures.find((failure) => !isNonActionableResidualFailure(failure));
      const ignoredBboxFailures = bboxFailures.filter((failure) => isNonActionableResidualFailure(failure));
      bboxFail = bboxFail || actionableBboxFailure?.reason || null;
      l2 = {
        status: rule.pass && !bboxFail ? "PASS" : "FAIL",
        anchorsMatched: matched.size,
        anchorsTotal: manifest.anchors.length,
        requiredMatched: required.filter((a) => matched.has(a.id)).length,
        requiredTotal: required.length,
        optionalMatched: optional.filter((a) => matched.has(a.id)).length,
        optionalTotal: optional.length,
        optionalMissing: rule.missingOptional?.length || 0,
        maxDeltaPx: Math.round(maxDelta),
        normalize: normalizeMeta,
        reason: rule.pass ? bboxFail : rule.reason,
        warnings: rule.warnings || [],
        diagnostics: {
          categories: unique([
            ...(rule.pass ? [] : [rule.reason?.startsWith("required anchor missing") ? "required-anchor-missing" : "optional-anchor-missing"]),
            ...(rule.missingOptional?.length ? ["optional-anchor-missing"] : []),
            ...(typographyFailures.length ? ["text-metric-mismatch"] : []),
            ...(ignoredBboxFailures.length ? ["non-actionable-root-residual-waived"] : []),
            ...(ignoredBboxFailures.some((failure) => lowConfidenceReviewOnlyTextIds.has(failure.id)) ? ["low-confidence-text-anchor-bbox-waived"] : []),
            ...deltaSummary.categories,
          ]),
          allDeltas: deltaSummary.allDeltas,
          topDeltas: deltaSummary.topDeltas,
          sectionDeltas: deltaSummary.sectionDeltas,
          sectionGapDeltas: deltaSummary.sectionGapDeltas,
          sectionOffsetPropagation: deltaSummary.sectionOffsetPropagation,
          nonActionableRootResiduals: deltaSummary.nonActionableRootResiduals,
          allBboxFailures: bboxFailures,
          ignoredBboxFailures,
          sharedResidualOffsetSources: deltaSummary.sharedResidualOffsetSources,
          repeatedHeightGroups: deltaSummary.repeatedHeightGroups,
          anchorTargetMismatches: deltaSummary.anchorTargetMismatches,
          fullBboxAnchorGroups: deltaSummary.fullBboxAnchorGroups,
          sectionBackgroundAnchorTargetMismatches: deltaSummary.sectionBackgroundAnchorTargetMismatches,
          wrapperTargetMismatches: deltaSummary.wrapperTargetMismatches,
          duplicateTextBboxGroups: deltaSummary.duplicateTextBboxGroups,
          logoBrandScaleDrifts: deltaSummary.logoBrandScaleDrifts,
          textContentAnchorMismatches: deltaSummary.textContentAnchorMismatches,
          highConfidenceTextContentAnchorMismatches: deltaSummary.highConfidenceTextContentAnchorMismatches,
          lowConfidenceTextContentAnchorMismatches: deltaSummary.lowConfidenceTextContentAnchorMismatches,
          textContentAnchorMismatchSummary: deltaSummary.textContentAnchorMismatchSummary,
          textMetricDrifts: deltaSummary.textMetricDrifts,
          trueTextMetricDrifts: deltaSummary.trueTextMetricDrifts,
          sharedTextYOffsetGroups: deltaSummary.sharedTextYOffsetGroups,
          repeatedSlotSequenceDrifts: deltaSummary.repeatedSlotSequenceDrifts,
          internalSectionDriftGroups: deltaSummary.internalSectionDriftGroups,
          layoutModelMismatches: deltaSummary.layoutModelMismatches,
          actionabilitySummary: deltaSummary.actionabilitySummary,
          typographyFailures: typographyFailures.slice(0, 10),
        },
      };
      if (l2.requiredTotal > 0 && l2.requiredMatched === 0) {
        return {
          viewport,
          status: "FAIL",
          reason: `ANCHOR_MAPPING_REQUIRED: matched 0/${l2.requiredTotal} required anchors`,
          l1: null,
          l2,
        };
      }
    }

    // L1 측정 (mask 적용)
    const buf = await page.screenshot({ fullPage: true });
    const baselineSha = sha256File(png);
    const currentSha = sha256Buffer(buf);
    if (baselineSha === currentSha) {
      return {
        viewport,
        status: "FAIL",
        reason: "self_baseline_suspected: current preview screenshot is byte-identical to the baseline PNG. Baselines must come from Figma REST, never from implementation preview.",
        l1: null,
        l2,
      };
    }
    const viewportCur = ensurePngData(PNG.sync.read(buf), "current screenshot");
    const baselineOriginal = ensurePngData(PNG.sync.read(readFileSync(png)), "baseline");
    let cur = viewportCur;
    let base = baselineOriginal;
    let comparisonMode = "viewport";
    let comparisonRect = { x: 0, y: 0, w: viewportCur.width, h: viewportCur.height };
    let rootAlignedApplied = false;
    if (rootMeasuredBox?.w > 0 && rootMeasuredBox?.h > 0) {
      const rootW = Math.min(viewportCur.width, Math.max(1, Math.round(rootMeasuredBox.w)));
      const availableRootH = viewportCur.height - Math.max(0, Math.round(rootMeasuredBox.y));
      const rootH = Math.min(viewportCur.height, Math.max(1, Math.round(Math.min(rootMeasuredBox.h, availableRootH))));
      if (rootW > 0 && rootH > 0 && rootW < viewportCur.width) {
        comparisonMode = "root-aligned";
        comparisonRect = {
          x: Math.round(rootMeasuredBox.x),
          y: Math.round(rootMeasuredBox.y),
          w: rootW,
          h: rootH,
        };
        cur = cropPng(viewportCur, comparisonRect);
        base = resizePngNearest(baselineOriginal, rootW, rootH);
        rootAlignedApplied = true;
      }
    }
    // B-1b L1 resize: dimension mismatch 시 baseline 을 current 폭/높이로 nearest-neighbor resize.
    // figma export (scale=2) 와 preview viewport (1×) 차이 자동 흡수 → 워커 self-capture 회피 동기 제거.
    // % budget 안에서 antialiasing 차이 흡수.
    let resizeApplied = false;
    if (cur.width !== base.width || cur.height !== base.height) {
      // baseline 을 current 폭으로 resize (nearest-neighbor, height 비율 보존)
      const heightAfterRatio = Math.round(base.height * (cur.width / base.width));
      // height 도 current 와 일치시키기 위해 추가 resize (stretch — 비율 보존 X 단순화)
      base = resizePngNearest(base, cur.width, cur.height);
      ensurePngData(base, "resized baseline");
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
        const xOffset = comparisonMode === "root-aligned" ? comparisonRect.x : 0;
        const yOffset = comparisonMode === "root-aligned" ? comparisonRect.y : 0;
        const x0 = Math.max(0, Math.floor(r.x - xOffset));
        const y0 = Math.max(0, Math.floor(r.y - yOffset));
        const x1 = Math.min(cur.width, Math.floor(r.x + r.w - xOffset));
        const y1 = Math.min(cur.height, Math.floor(r.y + r.h - yOffset));
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
    const diff = ensurePngData(new PNG({ width: cur.width, height: cur.height }), "diff");
    const dp = pixelmatch(cur.data, base.data, diff.data, cur.width, cur.height, { threshold: 0.1 });
    const dpct = (dp / totalArea) * 100;
    const sectionL1Diffs = l2?.diagnostics?.sectionDeltas?.length
      ? computeSectionL1Diffs({
          cur,
          base,
          sections: l2.diagnostics.sectionDeltas,
          rootOriginX: comparisonMode === "root-aligned" ? 0 : rootOriginX,
          rootOriginY: comparisonMode === "root-aligned" ? 0 : rootOriginY,
          textSignals: [
            ...(l2.diagnostics.highConfidenceTextContentAnchorMismatches || []),
            ...(l2.diagnostics.lowConfidenceTextContentAnchorMismatches || []),
            ...(l2.diagnostics.trueTextMetricDrifts || []),
            ...(l2.diagnostics.textMetricDrifts || []),
            ...(l2.diagnostics.topDeltas || []),
          ],
          imageSignals: [
            ...(l2.diagnostics.allDeltas || []),
            ...(l2.diagnostics.topDeltas || []),
            ...(l2.diagnostics.anchorTargetMismatches || []),
            ...(l2.diagnostics.sectionBackgroundAnchorTargetMismatches || []),
            ...(l2.diagnostics.repeatedSlotSequenceDrifts || []).flatMap((group) => group.anchors || []),
            ...(l2.diagnostics.internalSectionDriftGroups || []).flatMap((group) => group.anchors || []),
          ],
        })
      : [];
    if (sectionL1Diffs.length && l2?.diagnostics) {
      l2.diagnostics.sectionL1Diffs = sectionL1Diffs;
      const sectionL1Failures = sectionL1Diffs
        .filter((item) =>
          Number(item.diffPercent || 0) > opts["threshold-section-l1"] &&
          Number(item.diffPixels || 0) > opts["threshold-section-l1-pixels"]
        )
        .sort((a, b) => Number(b.diffPixels || 0) - Number(a.diffPixels || 0));
      l2.diagnostics.sectionL1Failures = sectionL1Failures;
      const localL1CleanSectionIds = new Set(
        sectionL1Diffs
          .filter((item) => Number(item.diffPercent || 0) <= 0.5)
          .map((item) => item.sectionId)
      );
      const existingIgnoredIds = new Set((l2.diagnostics.ignoredBboxFailures || []).map((item) => item.id));
      const newlyIgnoredCleanSections = (l2.diagnostics.allBboxFailures || [])
        .filter((failure) => localL1CleanSectionIds.has(failure.id))
        .filter((failure) => !existingIgnoredIds.has(failure.id));
      if (newlyIgnoredCleanSections.length) {
        l2.diagnostics.ignoredBboxFailures = [
          ...(l2.diagnostics.ignoredBboxFailures || []),
          ...newlyIgnoredCleanSections,
        ];
      }
      const ignoredIds = new Set((l2.diagnostics.ignoredBboxFailures || []).map((item) => item.id));
      const remainingBboxFailure = (l2.diagnostics.allBboxFailures || [])
        .find((failure) => !ignoredIds.has(failure.id));
      if (l2.status === "FAIL" && l2.reason && /\bdelta x=/.test(l2.reason) && !remainingBboxFailure) {
        l2.status = "PASS";
        l2.reason = null;
      } else if (l2.status === "FAIL" && l2.reason && /\bdelta x=/.test(l2.reason) && remainingBboxFailure) {
        l2.reason = remainingBboxFailure.reason;
      }
      l2.diagnostics.categories = unique([
        ...(l2.diagnostics.categories || []),
        ...(newlyIgnoredCleanSections.length ? ["local-l1-clean-section-bbox-waived"] : []),
        ...(sectionL1Failures.length ? ["section-local-l1-hotspot-fail"] : []),
        ...sectionL1Diffs.flatMap((item) => item.categories || []),
      ]);
    }
    mkdirSync(opts["diff-dir"], { recursive: true });
    const diffPath = join(opts["diff-dir"], `${opts.section}-${viewport}.diff.png`);
    writeFileSync(diffPath, PNG.sync.write(diff));
    const sectionL1Failure = l2?.diagnostics?.sectionL1Failures?.[0] || null;
    const pageL1Failure = dpct > opts["threshold-l1"];
    const sectionL1Reason = sectionL1Failure
      ? `Section L1 hotspot ${sectionL1Failure.sectionId} ${Number(sectionL1Failure.diffPercent || 0).toFixed(2)}% > ${opts["threshold-section-l1"]}% and ${Math.round(Number(sectionL1Failure.diffPixels || 0))}px > ${opts["threshold-section-l1-pixels"]}px`
      : null;
    const l1 = {
      status: !pageL1Failure && !sectionL1Failure ? "PASS" : "FAIL",
      reason: pageL1Failure ? `L1 ${dpct.toFixed(2)}% > ${opts["threshold-l1"]}%` : sectionL1Reason,
      diffPercent: Number(dpct.toFixed(3)),
      thresholdEffective: opts["threshold-l1"],
      thresholdTarget: opts["threshold-l1-target"],
      enforcingTarget: process.env.G1_ENFORCE_L1_TARGET === "1",
      targetGap: Number(Math.max(0, dpct - opts["threshold-l1-target"]).toFixed(3)),
      maskArea: Number(((maskArea / totalArea) * 100).toFixed(1)),
      resizeApplied,
      comparisonMode,
      rootAlignedApplied,
      comparisonRect,
      diffPath,
      sectionL1Diffs,
      sectionL1Failures: l2?.diagnostics?.sectionL1Failures || [],
    };
    const overallFail = l1.status === "FAIL" || l2.status === "FAIL";
    const iteration = appendG1Iteration({
      section: opts.section,
      viewport,
      status: overallFail ? "FAIL" : "PASS",
      reason: overallFail ? (l1.status === "FAIL" ? l1.reason : l2.reason) : null,
      l1,
      l2,
    });
    return {
      viewport,
      status: overallFail ? "FAIL" : "PASS",
      reason: overallFail ? (l1.status === "FAIL" ? l1.reason : l2.reason) : null,
      l1,
      l2,
      iteration,
    };
  } catch (e) {
    const reason = `평가 실패 (${e.message.split("\n")[0]})`;
    const iteration = appendG1Iteration({
      section: opts.section,
      viewport,
      status: "FAIL",
      reason,
      l1: null,
      l2: null,
    });
    return { viewport, status: "FAIL", reason, iteration };
  } finally {
    await ctx.close().catch(() => {});
  }
}

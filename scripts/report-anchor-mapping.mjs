#!/usr/bin/env node
/**
 * Report anchor mapping work from a Figma anchor manifest and optional quality
 * result. This is a worker-facing diagnostic, not a completion gate.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { readManifest } from "./_lib/anchor-manifest.mjs";

function parseArgs(argv) {
  const opts = { limit: 40, format: "text" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      opts[key] = next;
      i++;
    } else {
      opts[key] = true;
    }
  }
  return opts;
}

function usage() {
  console.error("usage: node scripts/report-anchor-mapping.mjs --manifest baselines/Home/anchors-desktop.json [--quality tests/quality/Home.json] [--limit 40] [--format text|json]");
}

function readJson(path) {
  if (!path || !existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function shortText(value, max = 64) {
  const text = normalizeText(value);
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function round1(value) {
  return Number(Number(value || 0).toFixed(1));
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

function sizeRatio(measured, figma) {
  return {
    widthRatio: figma?.w > 0 ? measured.w / figma.w : 1,
    heightRatio: figma?.h > 0 ? measured.h / figma.h : 1,
  };
}

function deltaDistance(item) {
  const dx = Number.isFinite(item.deltaX) ? item.deltaX : item.dx;
  const dy = Number.isFinite(item.deltaY) ? item.deltaY : item.dy;
  return Math.sqrt((dx || 0) ** 2 + (dy || 0) ** 2);
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
  const figma = item?.figma || item?.bbox || {};
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
    const figma = representative.figma || representative.bbox;
    collapsed.push({
      ...representative,
      figma,
      measured: representative.measured || measured,
      duplicateVariantIds: ordered.map((item) => item.id),
    });
    if (ordered.length >= 2) {
      duplicateVariantGroups.push({
        ids: ordered.map((item) => item.id),
        representative: representative.id,
        figma,
        measuredCount: ordered.filter((item) => item.measured).length,
        suggestedAction: `if these ids represent one visible slot, use data-anchors="${ordered.map((item) => item.id).join(" ")}"`,
        categories: ["duplicate-slot-variant-group", "repeated-slot-duplicates-collapsed"],
      });
    }
  }
  return { collapsed, duplicateVariantGroups };
}

function isLikelyRepeatedSlotAnchor(item) {
  const id = String(item?.id || "");
  const role = item?.role || "";
  const figma = item?.figma || item?.bbox || {};
  if (!figma.w || !figma.h) return false;
  if (role === "section-root" || role === "primary-heading" || role === "text-block") return false;
  if (figma.w >= 900 && figma.h >= 400) return false;
  if (figma.w < 90 || figma.h < 90) return false;
  return (
    role === "primary-media" ||
    role === "decorative" ||
    role === "primary-cta" ||
    role === "unknown" ||
    /\/(?:rectangle|frame|card|review|item)(?:-|$)/i.test(id)
  );
}

function buildRepeatedSlotSequenceDriftsForSection(sectionId, anchors = [], options = {}) {
  const allowMissingCardinality = options.allowMissingCardinality !== false;
  const candidates = anchors.filter(isLikelyRepeatedSlotAnchor);
  const grouped = new Map();
  for (const anchor of candidates) {
    const figma = anchor.figma || anchor.bbox || {};
    const wBucket = Math.round((figma.w || 0) / 32);
    const hBucket = Math.round((figma.h || 0) / 32);
    const yBucket = Math.round((figma.y || 0) / 80);
    const key = `${wBucket}:${hBucket}:${yBucket}`;
    const group = grouped.get(key) || [];
    group.push({ ...anchor, figma });
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
      if ((allowMissingCardinality && measuredPresent.length < ordered.length) || distinctMeasuredXCount < measuredPresent.length) {
        categories.push("card-row-cardinality-mismatch");
      }
      if (medianFigmaGap !== null && medianMeasuredGap !== null && Math.abs(medianMeasuredGap - medianFigmaGap) >= 32) {
        categories.push("centered-grid-vs-figma-slot-row");
      }
      const hasCompleteMeasuredSequence = measuredPresent.length >= distinctFigmaXCount;
      const actionable =
        maxDeltaX >= 80 ||
        (allowMissingCardinality && measuredPresent.length < ordered.length) ||
        distinctMeasuredXCount < measuredPresent.length ||
        (hasCompleteMeasuredSequence && medianFigmaGap !== null && medianMeasuredGap !== null && Math.abs(medianMeasuredGap - medianFigmaGap) >= 32);
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
        categories: [...new Set(categories)],
        actionable,
      };
    })
    .filter((group) => group.actionable && group.measuredCount >= (allowMissingCardinality ? 1 : 3))
    .slice(0, 8);
}

function enrichInternalGroup(group) {
  const anchors = (group.anchors || []).map((anchor) => {
    const deltaX = Number.isFinite(anchor.deltaX)
      ? anchor.deltaX
      : Number.isFinite(anchor.measured?.x) && Number.isFinite(anchor.figma?.x)
        ? round1(anchor.measured.x - anchor.figma.x)
        : anchor.dx;
    const deltaY = Number.isFinite(anchor.deltaY)
      ? anchor.deltaY
      : Number.isFinite(anchor.measured?.y) && Number.isFinite(anchor.figma?.y)
        ? round1(anchor.measured.y - anchor.figma.y)
        : anchor.dy;
    return { ...anchor, deltaX, deltaY };
  });
  if (!anchors.length) return group;
  const distances = anchors.map(deltaDistance);
  const medianDx = median(anchors.map((a) => a.deltaX));
  const medianDy = median(anchors.map((a) => a.deltaY));
  const residuals = anchors.map((a) => ({
    x: a.deltaX - (medianDx || 0),
    y: a.deltaY - (medianDy || 0),
  }));
  const normalizedMaxDeltaAfterSharedOffset = Math.max(...residuals.map((d) => Math.max(Math.abs(d.x), Math.abs(d.y))));
  const placementSpread = Math.max(...residuals.map((d) => Math.sqrt(d.x ** 2 + d.y ** 2)));
  const maxDelta = Math.max(group.maxDelta || 0, ...anchors.map((a) => Math.max(a.dx || 0, a.dy || 0)));
  const medianDelta = median(distances);
  const residualSharedOffsetLikely =
    anchors.length >= 4 &&
    maxDelta >= 70 &&
    normalizedMaxDeltaAfterSharedOffset <= Math.max(32, maxDelta * 0.35) &&
    placementSpread <= Math.max(48, (medianDelta || maxDelta) * 0.45);
  const categories = new Set(group.categories || []);
  if (residualSharedOffsetLikely) {
    categories.delete("semantic-grid-vs-figma-freeform");
    categories.add("residual-shared-section-offset");
  }
  const repeatedSlotSequenceDrifts =
    group.repeatedSlotSequenceDrifts?.length
      ? group.repeatedSlotSequenceDrifts
      : buildRepeatedSlotSequenceDriftsForSection(group.sectionId, anchors);
  for (const drift of repeatedSlotSequenceDrifts) {
    for (const category of drift.categories || []) categories.add(category);
  }
  const meanDelta = mean(distances);
  return {
    ...group,
    anchors,
    maxDelta: round1(maxDelta),
    medianDelta: group.medianDelta ?? (medianDelta === null ? null : round1(medianDelta)),
    meanDelta: group.meanDelta ?? (meanDelta === null ? null : round1(meanDelta)),
    medianDx: group.medianDx ?? (medianDx === null ? null : round1(medianDx)),
    medianDy: group.medianDy ?? (medianDy === null ? null : round1(medianDy)),
    residualSharedOffsetLikely: group.residualSharedOffsetLikely ?? residualSharedOffsetLikely,
    residualSharedOffset: group.residualSharedOffset || {
      dx: medianDx === null ? null : round1(medianDx),
      dy: medianDy === null ? null : round1(medianDy),
    },
    normalizedMaxDeltaAfterSharedOffset: group.normalizedMaxDeltaAfterSharedOffset ?? round1(normalizedMaxDeltaAfterSharedOffset),
    placementSpread: group.placementSpread ?? round1(placementSpread),
    repeatedSlotSequenceDrifts,
    categories: [...categories],
  };
}

function decisionForInternalGroup(group) {
  if (group.residualSharedOffsetLikely) return "rewrite-effective-residual-offset";
  const largePlacementDeltaCount = (group.anchors || []).filter((a) => Math.max(a.dx || 0, a.dy || 0) >= 200).length;
  if ((group.count || 0) >= 4 && (group.maxDelta || 0) >= 200 && largePlacementDeltaCount >= 4) return "rewrite-required";
  if (largePlacementDeltaCount >= 4) return "ask-human";
  return "continue-small-tuning";
}

function buildSectionOffsetPropagation(sectionDeltas = [], sectionGapDeltas = []) {
  const byId = new Map(sectionDeltas.map((delta) => [delta.id, delta]));
  return sectionGapDeltas.map((gap) => {
    const from = byId.get(gap.from);
    const to = byId.get(gap.to);
    const fromYDelta = round1(Number.isFinite(from?.deltaY)
      ? from.deltaY
      : Number.isFinite(from?.measured?.y) && Number.isFinite(from?.figma?.y)
        ? from.measured.y - from.figma.y
        : from?.dy || 0);
    const actualToYDelta = round1(Number.isFinite(to?.deltaY)
      ? to.deltaY
      : Number.isFinite(to?.measured?.y) && Number.isFinite(to?.figma?.y)
        ? to.measured.y - to.figma.y
        : to?.dy || gap.toYDelta || 0);
    const fromHeightDelta = round1(Number.isFinite(gap.fromHeightDelta) ? gap.fromHeightDelta : from?.heightDelta || 0);
    const gapDelta = round1(gap.gapDelta || 0);
    const fromBottomDelta = round1(fromYDelta + fromHeightDelta);
    const predictedToYDelta = round1(fromBottomDelta + gapDelta);
    const residual = round1(actualToYDelta - predictedToYDelta);
    const confidence = Math.abs(residual) <= 8
      ? "high"
      : Math.abs(residual) <= 24
        ? "medium"
        : "low";
    const categories = new Set(gap.categories || []);
    if (Math.abs(predictedToYDelta) >= 24 && confidence !== "low") {
      categories.add("section-offset-propagation");
      categories.add("upstream-section-offset-propagation");
    }
    return {
      from: gap.from,
      to: gap.to,
      fromYDelta,
      fromHeightDelta,
      fromBottomDelta,
      gapDelta,
      predictedToYDelta,
      actualToYDelta,
      residual,
      confidence,
      categories: [...categories],
    };
  });
}

function attachSharedOffsetSources(diagnostics) {
  const propagation = diagnostics.sectionOffsetPropagation || [];
  const sources = [];
  diagnostics.internalSectionDriftGroups = (diagnostics.internalSectionDriftGroups || []).map((group) => {
    if (!group.residualSharedOffsetLikely || !Number.isFinite(group.residualSharedOffset?.dy)) return group;
    const sharedDy = group.residualSharedOffset.dy;
    const source = propagation
      .filter((entry) => entry.to === group.sectionId)
      .map((entry) => {
        const predictedResidual = Math.abs((entry.predictedToYDelta || 0) - sharedDy);
        const actualResidual = Math.abs((entry.actualToYDelta || 0) - sharedDy);
        const residual = Math.min(predictedResidual, actualResidual);
        return {
          ...entry,
          sharedOffsetDy: sharedDy,
          sharedOffsetResidual: round1(residual),
          confidence: residual <= 8 ? "high" : residual <= 24 ? "medium" : "low",
        };
      })
      .sort((a, b) => a.sharedOffsetResidual - b.sharedOffsetResidual)[0];
    if (!source || source.confidence === "low") return group;
    const nextGroup = {
      ...group,
      sourceSection: source.from,
      sourcePair: { from: source.from, to: source.to },
      offsetPropagation: source,
      categories: [...new Set([...(group.categories || []), "upstream-section-offset-propagation"])],
    };
    sources.push({
      sectionId: group.sectionId,
      sourceSection: source.from,
      sourcePair: { from: source.from, to: source.to },
      sharedOffset: group.residualSharedOffset,
      propagation: source,
      reason: "previous section bottom drift plus pair gap predicts this section's shared residual offset",
      categories: ["upstream-section-offset-propagation", "residual-shared-section-offset"],
    });
    return nextGroup;
  });
  diagnostics.sharedResidualOffsetSources = diagnostics.sharedResidualOffsetSources || sources;
  return diagnostics;
}

function buildNonActionableRootResiduals(diagnostics = {}, reason = null) {
  const reasonTarget = firstSectionRootResidualReason(reason);
  return (diagnostics.sectionOffsetPropagation || [])
    .filter((entry) =>
      (!reasonTarget || entry.to === reasonTarget.id) &&
      Math.abs(entry.actualToYDelta || 0) >= 8 &&
      Math.abs(entry.residual || 0) <= 4 &&
      Math.abs(entry.gapDelta || 0) <= 8 &&
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

function textDriftCategories(delta) {
  const categories = new Set(delta.categories || []);
  const ratios = sizeRatio(delta.measured || {}, delta.figma || {});
  const widthRatio = ratios.widthRatio;
  const heightRatio = ratios.heightRatio;
  const id = String(delta.id || "");
  const actualText = normalizeText(delta.actualText);
  const expectedText = normalizeText(delta.expectedText);
  const anchorNameText = normalizeText(delta.anchorNameText || readableAnchorName(id));
  const textLikely =
    delta.role === "primary-heading" ||
    delta.role === "text-block" ||
    /title|heading|say|clients|energy|support|focus|sale|product|sellers/i.test(id);
  if (!textLikely) return [];
  if (categories.has("anchor-target-too-wide") || categories.has("text-anchor-wrapper-mismatch")) return [];
  if (Math.max(delta.dx || 0, delta.dy || 0) < 24) return [];
  const widthOff = widthRatio <= 0.8 || (widthRatio >= 1.25 && widthRatio < 2);
  const heightOff = heightRatio <= 0.8 || heightRatio >= 1.25;
  if (widthOff || heightOff) {
    categories.add("text-metric-drift");
    if (widthRatio <= 0.5) {
      categories.add("text-bbox-too-small");
      categories.add("text-size-too-small");
      categories.add("wrapping-width-too-narrow");
    } else if (widthRatio <= 0.8) {
      categories.add("wrapping-width-too-narrow");
    }
    if (heightRatio <= 0.6) {
      categories.add("text-bbox-too-small");
      categories.add("text-line-height-too-small");
    } else if (heightRatio <= 0.8) {
      categories.add("text-line-height-too-small");
    }
    if (widthRatio >= 1.25 && widthRatio < 2) {
      categories.add("text-wrapping-width-drift");
      categories.add("text-anchor-resolved-wrapper-mismatch");
    }
    if (heightRatio >= 1.25) categories.add("text-line-height-drift");
  }
  if ((delta.dx || 0) >= 24 || (delta.dy || 0) >= 24) categories.add("text-placement-drift");
  if (
    (delta.dx || 0) >= 24 || (delta.dy || 0) >= 24
  ) {
    if (widthRatio >= 0.9 && widthRatio <= 1.1 && heightRatio >= 0.9 && heightRatio <= 1.1 && Math.max(delta.dx || 0, delta.dy || 0) <= 40) {
      categories.add("text-micro-placement-drift");
      categories.add("text-placement-residual");
    }
  }
  const expectedMatches = expectedText ? textMatches(actualText, expectedText) : null;
  const anchorNameMatches = anchorNameText ? fuzzyTextMatches(actualText, anchorNameText) : null;
  if (actualText && expectedMatches === false) {
    categories.add("text-content-mismatch");
    categories.add("possible-wrong-anchor-target");
  }
  if (actualText && !expectedText && anchorNameMatches === false) {
    if (isGenericLayerName(anchorNameText)) {
      categories.add("expected-text-missing");
      categories.add("generic-layer-name-text-mismatch");
      categories.add("low-confidence-anchor-name-mismatch");
    } else if (isSemanticLayerName(anchorNameText)) {
      categories.add("expected-text-missing");
      categories.add("semantic-layer-name-text-mismatch");
      categories.add("low-confidence-semantic-layer-name");
      if (/^@/.test(actualText)) categories.add("duplicate-social-handle-anchor");
    } else {
      categories.add("anchor-name-text-mismatch");
      categories.add("possible-wrong-anchor-target");
    }
  } else if (actualText && !expectedText && anchorNameMatches === true && !textMatches(actualText, anchorNameText)) {
    const typoMatch = typoTextMatchesTokens(textTokens(actualText), textTokens(anchorNameText));
    categories.add(typoMatch ? "text-anchor-name-typo-match" : "text-anchor-name-partial-match");
    categories.add(typoMatch ? "anchor-name-spelling-typo" : "punctuation-normalization-mismatch");
  }
  return [...categories].filter((c) =>
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
    c === "text-anchor-name-typo-match"
  );
}

function readableAnchorName(id) {
  return String(id || "")
    .split("/")
    .pop()
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

function isSectionAnchorId(id) {
  return /\/section-\d+$/i.test(String(id || ""));
}

function sectionForManifestAnchor(anchor, sections) {
  const box = anchor?.bbox;
  if (!box) return null;
  const containing = sections
    .filter((section) => section.bbox && box.y >= section.bbox.y && box.y <= section.bbox.y + section.bbox.h)
    .sort((a, b) => (a.bbox.h || 0) - (b.bbox.h || 0))[0];
  if (containing) return containing.id;
  const nearest = [...sections]
    .filter((section) => section.bbox)
    .sort((a, b) => Math.abs((a.bbox.y || 0) - box.y) - Math.abs((b.bbox.y || 0) - box.y))[0];
  return nearest?.id || null;
}

function buildRepeatedSlotSequenceDriftsFromManifest(anchors = [], diagnostics = {}) {
  const measuredById = new Map();
  const collect = (items = []) => {
    for (const item of items) {
      if (!item?.id || measuredById.has(item.id)) continue;
      measuredById.set(item.id, item);
    }
  };
  collect(diagnostics.topDeltas);
  collect(diagnostics.sectionDeltas);
  collect(diagnostics.textMetricDrifts);
  collect(diagnostics.trueTextMetricDrifts);
  for (const group of diagnostics.internalSectionDriftGroups || []) collect(group.anchors);

  const sections = anchors.filter((anchor) => isSectionAnchorId(anchor.id) && anchor.bbox);
  const bySection = new Map();
  for (const anchor of anchors) {
    if (!anchor.bbox || !isLikelyRepeatedSlotAnchor(anchor)) continue;
    const sectionId = sectionForManifestAnchor(anchor, sections);
    if (!sectionId) continue;
    const measured = measuredById.get(anchor.id);
    const group = bySection.get(sectionId) || [];
    group.push({
      id: anchor.id,
      role: anchor.role,
      figma: anchor.bbox,
      measured: measured?.measured || null,
      dx: measured?.dx || 0,
      dy: measured?.dy || 0,
      deltaX: measured?.deltaX,
      deltaY: measured?.deltaY,
    });
    bySection.set(sectionId, group);
  }

  return [...bySection.entries()]
    .flatMap(([sectionId, sectionAnchors]) => buildRepeatedSlotSequenceDriftsForSection(sectionId, sectionAnchors, { allowMissingCardinality: false }))
    .slice(0, 12);
}

function isLargeFigmaBox(box) {
  return (box?.w || 0) >= 500 && (box?.h || 0) >= 200;
}

function isTextishAnchor(item) {
  const id = String(item?.id || "");
  const role = item?.role || "";
  if (role === "primary-heading" || role === "text-block") return true;
  if (item?.typography?.characters || item?.expectedText || item?.actualText) return true;
  if (/\/(?:section-\d+|rectangle|frame|background|bg|container|wrapper)(?:-|$)/i.test(id)) return false;
  return /title|heading|text|copy|paragraph|seller|sale|energy|boost|support|focus|review|client|logoname/i.test(id);
}

function isLikelyFullBboxDuplicateGroup(group) {
  return group.some((item) =>
    isLargeFigmaBox(item.figma || item.bbox) &&
    (
      isFrameLikeAnchorId(item.id) ||
      item.role === "section-root" ||
      item.role === "decorative" ||
      item.role === "primary-media"
    )
  );
}

function hasCategory(item, category) {
  return (item.categories || []).includes(category);
}

function buildLogoBrandScaleDrifts(deltas = []) {
  return deltas
    .filter((delta) =>
      (hasCategory(delta, "repeated-logo-scale-drift") || hasCategory(delta, "footer-wordmark-target")) &&
      !hasCategory(delta, "wrapper-target-too-large") &&
      !hasCategory(delta, "possible-wrong-wrapper-target")
    )
    .map((delta) => {
      const ratios = sizeRatio(delta.measured || {}, delta.figma || {});
      const targetRisk = delta.actualText && !textMatches(delta.actualText, delta.expectedText || delta.anchorNameText);
      return {
        id: delta.id,
        role: delta.role,
        dx: delta.dx,
        dy: delta.dy,
        deltaX: delta.deltaX,
        deltaY: delta.deltaY,
        measured: delta.measured,
        figma: delta.figma,
        widthRatio: round1(ratios.widthRatio),
        heightRatio: round1(ratios.heightRatio),
        actualText: delta.actualText || null,
        expectedText: delta.expectedText || null,
        anchorNameText: delta.anchorNameText || readableAnchorName(delta.id),
        suggestedAction: targetRisk
          ? "verify logo/wordmark anchor target; if target is correct, tune logo fit box / optical scale"
          : "if target is correct, tune logo fit box / optical scale; do not treat as text content mismatch without expectedText evidence",
        categories: [...new Set([...(delta.categories || []), "logo-brand-scale-drift"])],
      };
    })
    .sort((a, b) => Math.max(b.dx || 0, b.dy || 0) - Math.max(a.dx || 0, a.dy || 0))
    .slice(0, 20);
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
    .filter((item) => !isTextContentAnchorMismatch(item))
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
      return enrichSharedTextYOffsetGroup({
        signedDeltaY: Number(band),
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

function buildWrapperTargetMismatches(deltas = []) {
  return deltas
    .map((delta) => {
      const categories = new Set(delta.categories || []);
      const ratios = sizeRatio(delta.measured || {}, delta.figma || {});
      const actualText = normalizeText(delta.actualText);
      const logoNamed = /(?:logo|brand|mark|wordmark|logoname)/i.test(delta.id || "");
      if (logoNamed && actualText.length >= 60 && (ratios.widthRatio >= 1.8 || ratios.heightRatio >= 2)) {
        categories.delete("repeated-logo-scale-drift");
        categories.add("wrapper-target-too-large");
        categories.add("possible-wrong-wrapper-target");
      }
      if (!categories.has("wrapper-target-too-large") && !categories.has("possible-wrong-wrapper-target")) return null;
      return {
        id: delta.id,
        role: delta.role,
        dx: delta.dx,
        dy: delta.dy,
        deltaX: delta.deltaX,
        deltaY: delta.deltaY,
        measured: delta.measured,
        figma: delta.figma,
        widthRatio: round1(ratios.widthRatio),
        heightRatio: round1(ratios.heightRatio),
        actualText: actualText || null,
        anchorNameText: delta.anchorNameText || readableAnchorName(delta.id),
        suggestedAction: "move anchor from section/wrapper to the visible logo/wordmark/text element, or document intentional wrapper mapping",
        categories: [...categories],
      };
    })
    .filter(Boolean)
    .sort((a, b) => Math.max(b.dx || 0, b.dy || 0) - Math.max(a.dx || 0, a.dy || 0))
    .slice(0, 20);
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

function buildMeasuredDeltaMap(diagnostics = {}) {
  const map = new Map();
  const lists = [
    diagnostics.topDeltas,
    diagnostics.sectionDeltas,
    diagnostics.textMetricDrifts,
    diagnostics.trueTextMetricDrifts,
    diagnostics.wrapperTargetMismatches,
    diagnostics.anchorTargetMismatches,
    diagnostics.sectionBackgroundAnchorTargetMismatches,
    diagnostics.logoBrandScaleDrifts,
  ];
  for (const list of lists) {
    for (const item of list || []) {
      if (item?.id && !map.has(item.id)) map.set(item.id, item);
    }
  }
  return map;
}

function buildDuplicateTextBboxGroupsFromManifest(anchors = [], diagnostics = {}) {
  const deltaById = buildMeasuredDeltaMap(diagnostics);
  const byKey = new Map();
  for (const anchor of anchors) {
    if (!anchor.bbox) continue;
    const key = bboxKey(anchor.bbox, 6);
    if (!key) continue;
    const group = byKey.get(key) || [];
    group.push(anchor);
    byKey.set(key, group);
  }
  return [...byKey.values()]
    .filter((group) => group.length >= 2 && !isLikelyFullBboxDuplicateGroup(group) && group.some(isTextishAnchor))
    .map((group) => {
      const ids = group.map((anchor) => anchor.id);
      const measured = ids.map((id) => ({ id, measured: deltaById.get(id)?.measured || null }));
      const measuredSpread = bboxSpread(measured.filter((item) => item.measured), "measured");
      const wrapperTargetIds = ids.filter((id) => {
        const delta = deltaById.get(id);
        return (delta?.categories || []).some((c) => c === "wrapper-target-too-large" || c === "possible-wrong-wrapper-target");
      });
      const matchedIds = measured.filter((item) => item.measured).map((item) => item.id);
      const resolved = ids.length > 0 && matchedIds.length === ids.length && measuredSpread.max <= 8;
      const suggestedAction = wrapperTargetIds.length
        ? `use data-anchors="${ids.join(" ")}" on the visible text element if these are duplicate text layers`
        : `if these ids represent the same visible text layer, use data-anchors="${ids.join(" ")}"`;
      return {
        ids,
        roles: [...new Set(group.map((anchor) => anchor.role || "unknown"))],
        figma: group[0].bbox,
        measured,
        measuredSpread,
        matchedIds,
        unmatchedIds: ids.filter((id) => !matchedIds.includes(id)),
        wrapperTargetIds,
        resolved,
        suggestedAction,
        categories: [
          "duplicate-text-bbox-group",
          resolved ? "duplicate-text-bbox-group-resolved" : "duplicate-text-bbox-group-unresolved",
          wrapperTargetIds.length ? "duplicate-text-wrapper-target-candidate" : null,
        ].filter(Boolean),
      };
    })
    .sort((a, b) => (b.wrapperTargetIds.length - a.wrapperTargetIds.length) || b.ids.length - a.ids.length)
    .slice(0, 12);
}

function buildTextMetricDrifts(deltas = []) {
  return deltas
    .map((delta) => {
      const categories = textDriftCategories(delta);
      if (!categories.length) return null;
      const ratios = sizeRatio(delta.measured || {}, delta.figma || {});
      const suggestedCause = [];
      if (categories.some((c) => c === "text-content-mismatch" || c === "anchor-name-text-mismatch" || c === "possible-wrong-anchor-target")) {
        suggestedCause.push("content/anchor mismatch");
      } else if (categories.some((c) => c === "generic-layer-name-text-mismatch" || c === "low-confidence-anchor-name-mismatch")) {
        suggestedCause.push("generic layer-name mismatch");
      } else if (categories.some((c) => c === "semantic-layer-name-text-mismatch" || c === "low-confidence-semantic-layer-name")) {
        suggestedCause.push("semantic layer-name mismatch");
      } else if (categories.some((c) => c === "anchor-name-spelling-typo" || c === "text-anchor-name-typo-match")) {
        suggestedCause.push("anchor-name spelling typo");
      }
      if (categories.includes("text-wrapping-width-drift")) suggestedCause.push("wrapping width");
      if (categories.includes("wrapping-width-too-narrow")) suggestedCause.push("wrapping box too narrow");
      if (categories.includes("text-line-height-drift")) suggestedCause.push("line-height");
      if (categories.includes("text-line-height-too-small")) suggestedCause.push("line-height too small");
      if (categories.includes("text-size-too-small")) suggestedCause.push("text size too small");
      if (categories.includes("text-micro-placement-drift")) suggestedCause.push("micro placement tune");
      else if (categories.includes("text-placement-drift")) suggestedCause.push("placement");
      if (!suggestedCause.length) suggestedCause.push("font-size or text metrics");
      return {
        id: delta.id,
        role: delta.role,
        dx: delta.dx,
        dy: delta.dy,
        measured: delta.measured,
        figma: delta.figma,
        widthRatio: round1(ratios.widthRatio),
        heightRatio: round1(ratios.heightRatio),
        expectedText: delta.expectedText || null,
        actualText: delta.actualText || null,
        anchorNameText: delta.anchorNameText || readableAnchorName(delta.id),
        textMatchesExpected: delta.textMatchesExpected ?? (delta.expectedText ? textMatches(delta.actualText, delta.expectedText) : null),
        textMatchesAnchorName: delta.textMatchesAnchorName ?? fuzzyTextMatches(delta.actualText, delta.anchorNameText || readableAnchorName(delta.id)),
        suggestedCause: suggestedCause.join(", "),
        suggestedAction: categories.some((c) => c === "text-bbox-too-small" || c === "text-size-too-small" || c === "wrapping-width-too-narrow" || c === "text-line-height-too-small")
          ? "increase font-size/line-height/wrapping box, then tune placement"
          : categories.some((c) => c === "text-micro-placement-drift" || c === "text-placement-residual")
            ? "micro placement tune after larger text metric issues"
          : null,
        warning: categories.some((c) => c === "anchor-name-spelling-typo" || c === "text-anchor-name-typo-match")
          ? "do not change app copy to match a likely Figma layer-name typo; tune size/placement only if needed"
          : null,
        categories,
      };
    })
    .filter(Boolean)
    .sort((a, b) => Math.max(b.dx || 0, b.dy || 0) - Math.max(a.dx || 0, a.dy || 0))
    .slice(0, 20);
}

function isTextContentAnchorMismatch(item) {
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

function isMicroTextPlacement(item) {
  return (item.categories || []).some((c) => c === "text-micro-placement-drift" || c === "text-placement-residual");
}

function textMetricPriority(item) {
  const categories = item.categories || [];
  if (categories.some((c) => c === "text-bbox-too-small" || c === "text-size-too-small" || c === "wrapping-width-too-narrow" || c === "text-line-height-too-small")) return 0;
  if (isMicroTextPlacement(item)) return 2;
  return 1;
}

function normalizeTextDriftItem(item) {
  const categories = new Set([...(item.categories || []), ...textDriftCategories(item)]);
  const actualText = normalizeText(item.actualText);
  const expectedText = normalizeText(item.expectedText);
  const anchorNameText = normalizeText(item.anchorNameText || readableAnchorName(item.id));
  const fuzzyAnchorNameMatches = fuzzyTextMatches(actualText, anchorNameText);
  const anchorNameMatches = fuzzyAnchorNameMatches ?? item.textMatchesAnchorName;
  if (actualText && !expectedText && anchorNameMatches === false && isGenericLayerName(anchorNameText)) {
    categories.delete("anchor-name-text-mismatch");
    categories.delete("possible-wrong-anchor-target");
    categories.add("expected-text-missing");
    categories.add("generic-layer-name-text-mismatch");
    categories.add("low-confidence-anchor-name-mismatch");
  } else if (actualText && !expectedText && anchorNameMatches === false && isSemanticLayerName(anchorNameText)) {
    categories.delete("anchor-name-text-mismatch");
    categories.delete("possible-wrong-anchor-target");
    categories.add("expected-text-missing");
    categories.add("semantic-layer-name-text-mismatch");
    categories.add("low-confidence-semantic-layer-name");
    if (/^@/.test(actualText)) categories.add("duplicate-social-handle-anchor");
  }
  if (actualText && !expectedText && anchorNameMatches === true && item.textMatchesAnchorName === false) {
    categories.delete("anchor-name-text-mismatch");
    categories.delete("possible-wrong-anchor-target");
    const typoMatch = typoTextMatchesTokens(textTokens(actualText), textTokens(anchorNameText));
    categories.add(typoMatch ? "text-anchor-name-typo-match" : "text-anchor-name-partial-match");
    categories.add(typoMatch ? "anchor-name-spelling-typo" : "punctuation-normalization-mismatch");
  }
  return {
    ...item,
    anchorNameText: item.anchorNameText || anchorNameText,
    textMatchesAnchorName: anchorNameMatches,
    deltaX: Number.isFinite(item.deltaX)
      ? item.deltaX
      : Number.isFinite(item.measured?.x) && Number.isFinite(item.figma?.x)
        ? round1(item.measured.x - item.figma.x)
        : null,
    deltaY: Number.isFinite(item.deltaY)
      ? item.deltaY
      : Number.isFinite(item.measured?.y) && Number.isFinite(item.figma?.y)
        ? round1(item.measured.y - item.figma.y)
        : null,
    suggestedCause: categories.has("text-bbox-too-small") || categories.has("text-size-too-small") || categories.has("wrapping-width-too-narrow") || categories.has("text-line-height-too-small")
      ? [
          categories.has("text-size-too-small") ? "text size too small" : null,
          categories.has("wrapping-width-too-narrow") ? "wrapping box too narrow" : null,
          categories.has("text-line-height-too-small") ? "line-height too small" : null,
          categories.has("text-placement-drift") ? "placement" : null,
        ].filter(Boolean).join(", ")
      : isMicroTextPlacement({ categories: [...categories] })
        ? "micro placement tune"
      : item.suggestedCause,
    suggestedAction: item.suggestedAction || (categories.has("text-bbox-too-small") || categories.has("text-size-too-small") || categories.has("wrapping-width-too-narrow") || categories.has("text-line-height-too-small")
      ? "increase font-size/line-height/wrapping box, then tune placement"
      : isMicroTextPlacement({ categories: [...categories] })
        ? "micro placement tune after larger text metric issues"
      : null),
    warning: item.warning || (categories.has("anchor-name-spelling-typo") || categories.has("text-anchor-name-typo-match")
      ? "do not change app copy to match a likely Figma layer-name typo; tune size/placement only if needed"
      : null),
    categories: [...categories],
  };
}

function mismatchConfidence(item) {
  return (item.categories || []).some((c) =>
    c === "generic-layer-name-text-mismatch" ||
    c === "low-confidence-anchor-name-mismatch" ||
    c === "semantic-layer-name-text-mismatch" ||
    c === "low-confidence-semantic-layer-name"
  )
    ? "low"
    : "high";
}

function mismatchReason(item) {
  const categories = item.categories || [];
  if (categories.some((c) => c === "semantic-layer-name-text-mismatch" || c === "low-confidence-semantic-layer-name")) {
    return "expected text is missing and anchor name looks like a semantic Figma layer name";
  }
  if (categories.some((c) => c === "generic-layer-name-text-mismatch" || c === "low-confidence-anchor-name-mismatch")) {
    return "expected text is missing and anchor name looks like a generic Figma layer name";
  }
  return "actual text conflicts with expected text or a non-generic anchor name";
}

function mismatchWarning(item) {
  const categories = item.categories || [];
  if (categories.some((c) => c === "semantic-layer-name-text-mismatch" || c === "low-confidence-semantic-layer-name")) {
    return "do not move anchor solely from semantic layer-name mismatch; inspect overlapping text anchors and surrounding context";
  }
  if (categories.some((c) => c === "generic-layer-name-text-mismatch" || c === "low-confidence-anchor-name-mismatch")) {
    return "review only: do not move anchor, change copy, or tune text metrics solely from a generic layer-name mismatch; inspect expected text or surrounding context";
  }
  return "do not tune text metrics until anchor/content mapping is verified";
}

function isSectionBackgroundAnchorMismatch(item) {
  return (item.categories || []).some((c) =>
    c === "text-on-background-anchor" ||
    c === "background-anchor-wrong-target" ||
    c === "section-background-anchor-target-mismatch"
  );
}

function buildSectionBackgroundAnchorTargetMismatches(deltas = [], resolvedIds = new Set(), unresolvedIds = null) {
  return deltas
    .map((delta) => {
      const actualText = normalizeText(delta.actualText);
      const categories = new Set(delta.categories || []);
      const sectionRootLike = isSectionAnchorId(delta.id) || delta.role === "section-root";
      if (actualText && !sectionRootLike && isFrameLikeAnchorId(delta.id) && isLargeFigmaBox(delta.figma)) {
        categories.add("text-on-background-anchor");
        categories.add("background-anchor-wrong-target");
        categories.add("section-background-anchor-target-mismatch");
        categories.add("possible-wrong-anchor-target");
      }
      if (!["text-on-background-anchor", "background-anchor-wrong-target", "section-background-anchor-target-mismatch"].some((c) => categories.has(c))) {
        return null;
      }
      if (resolvedIds.has(delta.id)) return null;
      if (unresolvedIds && !unresolvedIds.has(delta.id)) return null;
      return {
        id: delta.id,
        role: delta.role,
        dx: delta.dx,
        dy: delta.dy,
        measured: delta.measured,
        figma: delta.figma,
        actualText: delta.actualText || null,
        anchorNameText: delta.anchorNameText || readableAnchorName(delta.id),
        warning: "do not tune text; move anchor to visible section/background/frame box or document missing visual mapping",
        categories: [...categories],
      };
    })
    .filter(Boolean)
    .sort((a, b) => Math.max(b.dx || 0, b.dy || 0) - Math.max(a.dx || 0, a.dy || 0))
    .slice(0, 20);
}

function buildFullBboxAnchorGroups(deltas = []) {
  const byKey = new Map();
  for (const delta of deltas) {
    if (!isLargeFigmaBox(delta.figma)) continue;
    if (!isFrameLikeAnchorId(delta.id) && delta.role !== "section-root" && delta.role !== "decorative" && delta.role !== "primary-media") continue;
    const key = bboxKey(delta.figma);
    if (!key) continue;
    const group = byKey.get(key) || [];
    group.push(delta);
    byKey.set(key, group);
  }
  return [...byKey.values()]
    .filter((group) => group.length >= 2)
    .map((group) => enrichFullBboxGroup({
      ids: group.map((d) => d.id),
      roles: [...new Set(group.map((d) => d.role))],
      figma: (group.find((d) => d.role === "section-root") || group[0]).figma,
      measured: group.map((d) => ({ id: d.id, measured: d.measured })),
      representative: (group.find((d) => d.role === "section-root") || group[0]).id,
      likelyMeaning: "section/background/frame variants",
      categories: ["full-bbox-anchor-group", "section-background-frame-variants"],
    }));
}

function enrichFullBboxGroup(group) {
  const measuredItems = (group.measured || []).map((item) => ({
    id: item.id,
    measured: item.measured,
  }));
  const measuredSpread = bboxSpread(measuredItems, "measured");
  const matchedCount = measuredItems.filter((item) => item.measured).length;
  const total = (group.ids || []).length;
  const resolved = total > 0 && matchedCount === total && measuredSpread.max <= 8;
  const unresolvedIds = resolved ? [] : (group.ids || []).filter((id) => {
    const item = measuredItems.find((candidate) => candidate.id === id);
    return !item?.measured;
  });
  const categories = new Set(group.categories || ["full-bbox-anchor-group", "section-background-frame-variants"]);
  categories.add(resolved ? "full-bbox-anchor-group-resolved" : "full-bbox-anchor-group-unresolved");
  return {
    ...group,
    resolved,
    resolution: resolved ? "same-measured-bbox" : "unresolved",
    measuredSpread,
    maxMeasuredDelta: measuredSpread.max,
    unresolvedIds,
    suggestedAction: resolved
      ? "resolved: same measured bbox / data-anchors likely OK"
      : `if these ids represent the same full-bbox layer, use data-anchors="${(group.ids || []).join(" ")}" on the visible section/background/root box; do not attach them to gallery/media/text children`,
    categories: [...categories],
  };
}

function splitTextDrifts(diagnostics) {
  const textDrifts = (diagnostics.textMetricDrifts || []).map(normalizeTextDriftItem);
  diagnostics.textMetricDrifts = textDrifts;
  diagnostics.textContentAnchorMismatches = diagnostics.textContentAnchorMismatches?.length
    ? diagnostics.textContentAnchorMismatches
        .map(normalizeTextDriftItem)
        .filter(isTextContentAnchorMismatch)
        .map((item) => ({
          ...item,
          confidence: mismatchConfidence(item),
          reason: mismatchReason(item),
          warning: mismatchWarning(item),
        }))
    : textDrifts
        .filter(isTextContentAnchorMismatch)
        .map((item) => ({
          ...item,
          confidence: mismatchConfidence(item),
          reason: mismatchReason(item),
          warning: mismatchWarning(item),
        }));
  diagnostics.highConfidenceTextContentAnchorMismatches = diagnostics.textContentAnchorMismatches
    .filter((item) => (item.confidence || mismatchConfidence(item)) === "high");
  diagnostics.lowConfidenceTextContentAnchorMismatches = diagnostics.textContentAnchorMismatches
    .filter((item) => (item.confidence || mismatchConfidence(item)) === "low")
    .map((item) => ({
      ...item,
      reviewOnly: true,
      warning: item.warning || "review only: expected text is missing and anchor name is a weak hint",
    }));
  diagnostics.textContentAnchorMismatchSummary = {
    total: diagnostics.textContentAnchorMismatches.length,
    highConfidence: diagnostics.highConfidenceTextContentAnchorMismatches.length,
    lowConfidence: diagnostics.lowConfidenceTextContentAnchorMismatches.length,
    expectedTextMissing: diagnostics.textContentAnchorMismatches.filter((item) => !item.expectedText).length,
    reviewOnly: diagnostics.lowConfidenceTextContentAnchorMismatches.length,
  };
  diagnostics.trueTextMetricDrifts = diagnostics.trueTextMetricDrifts?.length
    ? diagnostics.trueTextMetricDrifts.map(normalizeTextDriftItem).filter((item) => !isTextContentAnchorMismatch(item))
    : textDrifts.filter((item) => !isTextContentAnchorMismatch(item));
  diagnostics.trueTextMetricDrifts = diagnostics.trueTextMetricDrifts
    .sort((a, b) => textMetricPriority(a) - textMetricPriority(b) || Math.max(b.dx || 0, b.dy || 0) - Math.max(a.dx || 0, a.dy || 0));
  diagnostics.sharedTextYOffsetGroups = diagnostics.sharedTextYOffsetGroups?.length
    ? diagnostics.sharedTextYOffsetGroups.map((group) => enrichSharedTextYOffsetGroup(group, diagnostics.sectionDeltas || []))
    : buildSharedTextYOffsetGroups(diagnostics.trueTextMetricDrifts, diagnostics.sectionDeltas || []);
  diagnostics.actionabilitySummary = buildActionabilitySummary(diagnostics);
  return diagnostics;
}

function buildActionabilitySummary(diagnostics = {}) {
  const layoutModelMismatches = diagnostics.layoutModelMismatches || [];
  const summary = {
    highConfidenceContentMismatch: (diagnostics.highConfidenceTextContentAnchorMismatches || []).length,
    trueTextMetricDrift: (diagnostics.trueTextMetricDrifts || []).length,
    wrapperTargetMismatch: (diagnostics.wrapperTargetMismatches || []).length,
    anchorTargetMismatch: (diagnostics.anchorTargetMismatches || []).length,
    sectionBackgroundAnchorTargetMismatch: (diagnostics.sectionBackgroundAnchorTargetMismatches || []).length,
    repeatedSlotSequenceDrift: (diagnostics.repeatedSlotSequenceDrifts || []).length,
    repeatedHeightDrift: (diagnostics.repeatedHeightGroups || []).length,
    internalSectionDrift: (diagnostics.internalSectionDriftGroups || []).length,
    rewriteRequired: layoutModelMismatches.filter((item) => item.decision === "rewrite-required").length,
    reviewOnlyTextMismatch: (diagnostics.lowConfidenceTextContentAnchorMismatches || []).length,
  };
  summary.actionableRemaining = [
    summary.highConfidenceContentMismatch,
    summary.trueTextMetricDrift,
    summary.wrapperTargetMismatch,
    summary.anchorTargetMismatch,
    summary.sectionBackgroundAnchorTargetMismatch,
    summary.repeatedSlotSequenceDrift,
    summary.repeatedHeightDrift,
    summary.internalSectionDrift,
    summary.rewriteRequired,
  ].some((count) => count > 0);
  return summary;
}

function strictViewportResult(quality) {
  const viewports = quality?.G1_visual_regression?.viewports;
  if (!viewports || typeof viewports !== "object") return null;
  return viewports.desktop || Object.values(viewports)[0] || null;
}

function missingIdsFromQuality(quality) {
  const reason = strictViewportResult(quality)?.l2?.reason || "";
  const prefix = "required anchor missing:";
  if (!reason.startsWith(prefix)) return new Set();
  return new Set(reason.slice(prefix.length).split(",").map((s) => s.trim()).filter(Boolean));
}

function withDerivedDiagnostics(l2) {
  if (!l2?.diagnostics) return l2;
  const diagnostics = { ...l2.diagnostics };
  if (diagnostics.internalSectionDriftGroups?.length) {
    diagnostics.internalSectionDriftGroups = diagnostics.internalSectionDriftGroups.map(enrichInternalGroup);
    diagnostics.repeatedSlotSequenceDrifts = diagnostics.repeatedSlotSequenceDrifts?.length
      ? diagnostics.repeatedSlotSequenceDrifts
      : diagnostics.internalSectionDriftGroups.flatMap((group) => group.repeatedSlotSequenceDrifts || []);
    if (diagnostics.repeatedSlotSequenceDrifts?.length) {
      diagnostics.categories = [...new Set([
        ...(diagnostics.categories || []),
        ...diagnostics.repeatedSlotSequenceDrifts.flatMap((group) => group.categories || []),
      ])];
    }
  }
  if (!diagnostics.sectionOffsetPropagation && diagnostics.sectionDeltas?.length && diagnostics.sectionGapDeltas?.length) {
    diagnostics.sectionOffsetPropagation = buildSectionOffsetPropagation(diagnostics.sectionDeltas, diagnostics.sectionGapDeltas);
  }
  diagnostics.nonActionableRootResiduals = diagnostics.nonActionableRootResiduals?.length
    ? diagnostics.nonActionableRootResiduals
    : buildNonActionableRootResiduals(diagnostics, l2.reason);
  const reasonTarget = firstSectionRootResidualReason(l2.reason);
  if (reasonTarget && diagnostics.nonActionableRootResiduals?.length) {
    const targetItems = diagnostics.nonActionableRootResiduals.filter((item) =>
      item.targetSection === reasonTarget.id ||
      item.sourcePair?.to === reasonTarget.id
    );
    if (targetItems.length) diagnostics.nonActionableRootResiduals = targetItems;
  }
  attachSharedOffsetSources(diagnostics);
  if (!diagnostics.textMetricDrifts?.length && diagnostics.topDeltas?.length) {
    diagnostics.textMetricDrifts = buildTextMetricDrifts(diagnostics.topDeltas);
  }
  const allDeltasForDerived = [
    ...(diagnostics.topDeltas || []),
    ...(diagnostics.sectionDeltas || []),
  ];
  if (!diagnostics.fullBboxAnchorGroups?.length && allDeltasForDerived.length) {
    diagnostics.fullBboxAnchorGroups = buildFullBboxAnchorGroups(allDeltasForDerived);
  } else if (diagnostics.fullBboxAnchorGroups?.length) {
    diagnostics.fullBboxAnchorGroups = diagnostics.fullBboxAnchorGroups.map(enrichFullBboxGroup);
  }
  const resolvedFullBboxIds = new Set((diagnostics.fullBboxAnchorGroups || []).filter((g) => g.resolved).flatMap((g) => g.ids || []));
  const unresolvedFullBboxIds = new Set((diagnostics.fullBboxAnchorGroups || []).filter((g) => !g.resolved).flatMap((g) => g.ids || []));
  if (allDeltasForDerived.length) {
    diagnostics.sectionBackgroundAnchorTargetMismatches = buildSectionBackgroundAnchorTargetMismatches(
      allDeltasForDerived,
      resolvedFullBboxIds,
      unresolvedFullBboxIds.size ? unresolvedFullBboxIds : null
    );
  }
  if (!diagnostics.logoBrandScaleDrifts?.length && allDeltasForDerived.length) {
    diagnostics.wrapperTargetMismatches = buildWrapperTargetMismatches(allDeltasForDerived);
    const wrapperIds = new Map((diagnostics.wrapperTargetMismatches || []).map((item) => [item.id, item]));
    const enrichedDeltas = allDeltasForDerived.map((delta) => {
      const wrapper = wrapperIds.get(delta.id);
      if (!wrapper) return delta;
      return {
        ...delta,
        categories: wrapper.categories,
      };
    });
    diagnostics.logoBrandScaleDrifts = buildLogoBrandScaleDrifts(enrichedDeltas);
  } else if (allDeltasForDerived.length) {
    diagnostics.wrapperTargetMismatches = diagnostics.wrapperTargetMismatches?.length
      ? diagnostics.wrapperTargetMismatches
      : buildWrapperTargetMismatches(allDeltasForDerived);
    const wrapperIds = new Set((diagnostics.wrapperTargetMismatches || []).map((item) => item.id));
    diagnostics.logoBrandScaleDrifts = (diagnostics.logoBrandScaleDrifts || [])
      .filter((item) => !wrapperIds.has(item.id) && !hasCategory(item, "wrapper-target-too-large") && !hasCategory(item, "possible-wrong-wrapper-target"));
  }
  if (diagnostics.wrapperTargetMismatches?.length) {
    const wrapperById = new Map(diagnostics.wrapperTargetMismatches.map((item) => [item.id, item]));
    diagnostics.topDeltas = (diagnostics.topDeltas || []).map((delta) => {
      const wrapper = wrapperById.get(delta.id);
      if (!wrapper) return delta;
      const categories = new Set([...(delta.categories || []), ...(wrapper.categories || [])]);
      categories.delete("repeated-logo-scale-drift");
      return { ...delta, categories: [...categories] };
    });
  }
  if (diagnostics.textMetricDrifts?.length) {
    const textById = new Map(diagnostics.textMetricDrifts.map((item) => [item.id, item]));
    diagnostics.topDeltas = (diagnostics.topDeltas || []).map((delta) => {
      const textDrift = textById.get(delta.id);
      if (!textDrift) return delta;
      return {
        ...delta,
        categories: [...new Set([...(delta.categories || []), ...(textDrift.categories || [])])],
      };
    });
    diagnostics.categories = [...new Set([
      ...(diagnostics.categories || []),
      ...diagnostics.textMetricDrifts.flatMap((item) => item.categories || []),
    ])];
  }
  if (diagnostics.sectionBackgroundAnchorTargetMismatches?.length) {
    const bgById = new Map(diagnostics.sectionBackgroundAnchorTargetMismatches.map((item) => [item.id, item]));
    diagnostics.topDeltas = (diagnostics.topDeltas || []).map((delta) => {
      const bgMismatch = bgById.get(delta.id);
      if (!bgMismatch) return delta;
      return {
        ...delta,
        categories: [...new Set([...(delta.categories || []), ...(bgMismatch.categories || [])])],
      };
    });
    diagnostics.categories = [...new Set([
      ...(diagnostics.categories || []),
      ...diagnostics.sectionBackgroundAnchorTargetMismatches.flatMap((item) => item.categories || []),
      ...(diagnostics.fullBboxAnchorGroups || []).flatMap((item) => item.categories || []),
      ...(diagnostics.logoBrandScaleDrifts || []).flatMap((item) => item.categories || []),
    ])];
  }
  if (diagnostics.logoBrandScaleDrifts?.length || diagnostics.wrapperTargetMismatches?.length) {
    diagnostics.categories = [...new Set([
      ...(diagnostics.categories || []),
      ...diagnostics.logoBrandScaleDrifts.flatMap((item) => item.categories || []),
      ...(diagnostics.wrapperTargetMismatches || []).flatMap((item) => item.categories || []),
      ...(diagnostics.sharedTextYOffsetGroups || []).flatMap((item) => item.categories || []),
    ])];
  }
  splitTextDrifts(diagnostics);
  if (!diagnostics.layoutModelMismatches && diagnostics.internalSectionDriftGroups?.length) {
    diagnostics.layoutModelMismatches = diagnostics.internalSectionDriftGroups.map((group) => {
      const decision = decisionForInternalGroup(group);
      const rewriteLikely = decision === "rewrite-required";
      return {
        sectionId: group.sectionId,
        decision,
        sectionRootDelta: null,
        internalAnchorCount: group.count || 0,
        largePlacementDeltaCount: (group.anchors || []).filter((a) => Math.max(a.dx || 0, a.dy || 0) >= 200).length,
        residualSharedOffsetLikely: group.residualSharedOffsetLikely,
        residualSharedOffset: group.residualSharedOffset,
        sourceSection: group.sourceSection,
        sourcePair: group.sourcePair,
        offsetPropagation: group.offsetPropagation,
        normalizedMaxDeltaAfterSharedOffset: group.normalizedMaxDeltaAfterSharedOffset,
        placementSpread: group.placementSpread,
        medianWidthRatio: null,
        medianHeightRatio: null,
        dominantCategories: group.categories || [],
        currentDomModel: decision === "rewrite-effective-residual-offset" ? "rewritten-or-close-layout" : "semantic-grid-or-stack",
        figmaModel: rewriteLikely ? "freeform-or-staggered" : decision === "rewrite-effective-residual-offset" ? "shared-root-offset" : "unknown",
        orderMismatchLikely: rewriteLikely,
        reason: decision === "rewrite-effective-residual-offset"
          ? "derived from internal section drift group: anchors share a common residual offset after local placement converged"
          : rewriteLikely
          ? "derived from internal section drift group: multiple internal anchors have large placement deltas"
          : "derived from internal section drift group: human review recommended",
      };
    });
  } else if (diagnostics.layoutModelMismatches?.length) {
    diagnostics.layoutModelMismatches = diagnostics.layoutModelMismatches.map((item) => {
      const group = diagnostics.internalSectionDriftGroups?.find((candidate) => candidate.sectionId === item.sectionId);
      if (!group) return item;
      const decision = group.residualSharedOffsetLikely && item.decision !== "rewrite-required"
        ? "rewrite-effective-residual-offset"
        : item.decision;
      const residualReason = "derived from internal section drift group: anchors share a common residual offset after local placement converged";
      return {
        ...item,
        decision,
        residualSharedOffsetLikely: item.residualSharedOffsetLikely ?? group.residualSharedOffsetLikely,
        residualSharedOffset: item.residualSharedOffset || group.residualSharedOffset,
        sourceSection: item.sourceSection || group.sourceSection,
        sourcePair: item.sourcePair || group.sourcePair,
        offsetPropagation: item.offsetPropagation || group.offsetPropagation,
        normalizedMaxDeltaAfterSharedOffset: item.normalizedMaxDeltaAfterSharedOffset ?? group.normalizedMaxDeltaAfterSharedOffset,
        placementSpread: item.placementSpread ?? group.placementSpread,
        currentDomModel: decision === "rewrite-effective-residual-offset" ? "rewritten-or-close-layout" : item.currentDomModel,
        figmaModel: decision === "rewrite-effective-residual-offset" ? "shared-root-offset" : item.figmaModel,
        reason: decision === "rewrite-effective-residual-offset" ? residualReason : item.reason,
      };
    });
  }
  diagnostics.actionabilitySummary = buildActionabilitySummary(diagnostics);
  return { ...l2, diagnostics };
}

function groupName(anchor) {
  const id = anchor.id || "";
  const name = id.split("/").pop() || id;
  if (/root$/.test(id)) return "00-root";
  if (/section-1\b|logo|overview|benefits|features|quality|ingredients|reviews|cart/i.test(name)) return "01-header";
  if (/section-2\b|boost|rectangle-1\b|shop-all-flavors/i.test(name)) return "02-hero";
  if (/section-(\d+)/i.test(name)) return `section-${name.match(/section-(\d+)/i)?.[1]?.padStart(2, "0") || "xx"}`;
  if (/rectangle|image|svg|ellipse/i.test(name)) return "media-and-decor";
  if (anchor.typography || /title|sale|bundle|energy|support|focus|reviews|drinks|product/i.test(name)) return "text";
  return "other";
}

function hint(anchor) {
  const parts = [];
  if (anchor.required) parts.push("required");
  parts.push(anchor.role || "unknown");
  if (anchor.typography?.characters) {
    parts.push(`text="${anchor.typography.characters.replace(/\s+/g, " ").trim().slice(0, 80)}"`);
  }
  if (anchor.typography?.fontFamily) {
    parts.push(`font=${anchor.typography.fontFamily}`);
  }
  if (anchor.bbox) {
    parts.push(`bbox=${anchor.bbox.x},${anchor.bbox.y},${anchor.bbox.w}x${anchor.bbox.h}`);
  }
  return parts.join(" | ");
}

function summarize(manifest, quality, limit) {
  const viewport = strictViewportResult(quality);
  const normalizedL2 = withDerivedDiagnostics(viewport?.l2);
  const matched = new Set(Object.keys(normalizedL2?.matched || {}));
  const missingRequired = missingIdsFromQuality(quality);
  const anchors = manifest.anchors || [];
  if (normalizedL2?.diagnostics) {
    normalizedL2.diagnostics.duplicateTextBboxGroups = buildDuplicateTextBboxGroupsFromManifest(anchors, normalizedL2.diagnostics);
    if (!Object.prototype.hasOwnProperty.call(normalizedL2.diagnostics, "repeatedSlotSequenceDrifts")) {
      normalizedL2.diagnostics.repeatedSlotSequenceDrifts = buildRepeatedSlotSequenceDriftsFromManifest(anchors, normalizedL2.diagnostics);
    }
    if (normalizedL2.diagnostics.duplicateTextBboxGroups?.length || normalizedL2.diagnostics.repeatedSlotSequenceDrifts?.length) {
      normalizedL2.diagnostics.categories = [...new Set([
        ...(normalizedL2.diagnostics.categories || []),
        ...normalizedL2.diagnostics.duplicateTextBboxGroups.flatMap((group) => group.categories || []),
        ...(normalizedL2.diagnostics.repeatedSlotSequenceDrifts || []).flatMap((group) => group.categories || []),
      ])];
    }
  }
  const required = anchors.filter((a) => a.required);
  const optional = anchors.filter((a) => !a.required);
  const grouped = new Map();
  for (const anchor of anchors) {
    const group = groupName(anchor);
    const entry = grouped.get(group) || { group, total: 0, required: 0, optional: 0, anchors: [] };
    entry.total += 1;
    if (anchor.required) entry.required += 1;
    else entry.optional += 1;
    entry.anchors.push(anchor);
    grouped.set(group, entry);
  }

  const l2 = normalizedL2;
  const requiredComplete =
    typeof l2?.requiredMatched === "number" &&
    typeof l2?.requiredTotal === "number" &&
    l2.requiredTotal > 0 &&
    l2.requiredMatched >= l2.requiredTotal;
  const missingRequiredAnchors = missingRequired.size
    ? required.filter((a) => missingRequired.has(a.id))
    : requiredComplete
      ? []
      : required;

  return {
    manifest: {
      section: manifest.section,
      viewport: manifest.viewport,
      file: basename(process.cwd()),
      anchorsTotal: anchors.length,
      requiredTotal: required.length,
      optionalTotal: optional.length,
    },
    quality: quality
      ? {
          status: quality.G1_status || quality.G1_visual_regression?.status || null,
          l1: viewport?.l1 || null,
          l2: normalizedL2 || null,
        }
      : null,
    groups: [...grouped.values()].sort((a, b) => a.group.localeCompare(b.group)),
    missingRequired: missingRequiredAnchors.slice(0, limit).map((a) => ({
      id: a.id,
      figmaNodeId: a.figmaNodeId,
      role: a.role,
      hint: hint(a),
    })),
    requiredMappingPlan: required.slice(0, limit).map((a) => ({
      id: a.id,
      figmaNodeId: a.figmaNodeId,
      group: groupName(a),
      role: a.role,
      hint: hint(a),
    })),
    warnings: [
      "Map required anchors first; optional anchors are diagnostics.",
      "If requiredMatched is 0, do not tune L1 pixel diff yet.",
      "Attach anchors to visible DOM boxes, not hidden dummy nodes.",
    ],
  };
}

function formatDelta(delta) {
  const cats = delta.categories?.length ? ` | ${delta.categories.join(", ")}` : "";
  const measured = delta.measured
    ? ` measured=${delta.measured.x ?? "?"},${delta.measured.y ?? "?"},${delta.measured.w}x${delta.measured.h}`
    : "";
  const figma = delta.figma
    ? ` figma=${delta.figma.x ?? "?"},${delta.figma.y ?? "?"},${delta.figma.w}x${delta.figma.h}`
    : "";
  return `${delta.id} dx=${delta.dx} dy=${delta.dy}${measured}${figma}${cats}`;
}

function absMax(items, field) {
  return Math.max(0, ...(items || []).map((item) => Math.abs(Number(item[field]) || 0)));
}

function firstSectionRootResidualReason(reason) {
  const match = String(reason || "").match(/([A-Za-z0-9_-]+\/(?:root|section-\d+)) delta x=([0-9.]+) y=([0-9.]+)/);
  if (!match) return null;
  return {
    id: match[1],
    dx: Number(match[2]),
    dy: Number(match[3]),
  };
}

function sectionL1HotspotAction(hotspot) {
  const categories = hotspot?.categories || [];
  const imageIds = (hotspot?.imageSignals || []).slice(0, 3).map((signal) => signal.id).filter(Boolean);
  const suffix = imageIds.length ? `: ${imageIds.join(", ")}` : "";
  if (categories.includes("overlay-text-content-drift-candidate") && categories.includes("image-content-mismatch-candidate")) {
    return `inspect image/assets and overlay text content/order${suffix}`;
  }
  if (categories.includes("overlay-text-content-drift-candidate")) {
    return "inspect overlay text content/order";
  }
  if (categories.includes("solid-background-color-drift")) {
    return "fix solid background color drift";
  }
  if (categories.includes("image-content-mismatch-candidate")) {
    return `inspect image content/order/crop mismatch${suffix}`;
  }
  return "inspect L1 hotspot";
}

function nextBestAction(report) {
  const l2 = report.quality?.l2;
  const diagnostics = l2?.diagnostics || {};
  const l1 = report.quality?.l1;
  if (!l2) return "run quality with G1 diagnostics";
  if ((l2.requiredTotal || 0) > 0 && l2.requiredMatched === 0) return "map required anchors first";
  if ((l2.requiredMatched || 0) < (l2.requiredTotal || 0)) return "finish required anchor mapping";
  const rewriteRequired = (diagnostics.layoutModelMismatches || []).find((item) => item.decision === "rewrite-required");
  if (rewriteRequired) return `rewrite section layout or ask human: ${rewriteRequired.sectionId}`;
  const propagationSource = (diagnostics.sharedResidualOffsetSources || [])[0];
  if (propagationSource) return `fix upstream section height/root or source pair gap: ${propagationSource.sourcePair.from} -> ${propagationSource.sourcePair.to}`;
  const residualOffset = (diagnostics.layoutModelMismatches || []).find((item) => item.decision === "rewrite-effective-residual-offset")
    || (diagnostics.internalSectionDriftGroups || []).find((item) => item.residualSharedOffsetLikely);
  if (residualOffset) return `fix upstream/root/stack offset before further section rewrite: ${residualOffset.sectionId}`;
  if (absMax(diagnostics.sectionGapDeltas, "gapDelta") >= 40) return "fix section gap/normal flow spacing";
  if ((diagnostics.repeatedHeightGroups || []).length) return "fix repeated row/section height";
  if ((diagnostics.anchorTargetMismatches || []).length) return "fix anchor target wrapper";
  const backgroundMismatch = (diagnostics.sectionBackgroundAnchorTargetMismatches || [])[0];
  if (backgroundMismatch) return `verify section/background anchor target: ${backgroundMismatch.id} actual="${backgroundMismatch.actualText || ""}"`;
  const contentMismatch = (diagnostics.highConfidenceTextContentAnchorMismatches || diagnostics.textContentAnchorMismatches || [])
    .find((item) => (item.confidence || mismatchConfidence(item)) === "high");
  if (contentMismatch) {
    return `verify content/anchor mapping: ${contentMismatch.id} actual="${contentMismatch.actualText || ""}" anchorName="${contentMismatch.anchorNameText || ""}"`;
  }
  const slotSequenceDrift = (diagnostics.repeatedSlotSequenceDrifts || [])[0];
  if (slotSequenceDrift) {
    if ((slotSequenceDrift.duplicateVariantGroups || []).length && slotSequenceDrift.figmaCountRaw !== slotSequenceDrift.figmaCount) {
      return `map duplicate slot variants with data-anchors: ${slotSequenceDrift.sectionId}`;
    }
    return `match repeated card/item count, order, and slot spacing: ${slotSequenceDrift.sectionId}`;
  }
  const textMetricItems = diagnostics.trueTextMetricDrifts || diagnostics.textMetricDrifts || [];
  const sharedTextYOffset = (diagnostics.sharedTextYOffsetGroups || []).find((group) => (group.count || 0) >= 2 && Math.abs(group.signedDeltaY || 0) >= 40);
  if (sharedTextYOffset && !textMetricItems.some((item) => textMetricPriority(item) === 0)) {
    if (Math.abs(sharedTextYOffset.residualVsSection || 0) >= 32) {
      return "inspect section internal wrapper offset before per-text tuning";
    }
    return "inspect upstream flow/section offset before per-text tuning";
  }
  if (textMetricItems.some((item) => !isMicroTextPlacement(item))) return "fix text metric/wrapping/placement";
  if (textMetricItems.length) return "micro tune text placement residuals";
  if ((diagnostics.internalSectionDriftGroups || []).length) return "review section layout model; semantic grid may not match Figma freeform";
  const nonActionableRootResidual = (diagnostics.nonActionableRootResiduals || [])[0];
  if (nonActionableRootResidual) {
    const p = nonActionableRootResidual;
    const hotspot = (diagnostics.sectionL1Diffs || report.quality?.l1?.sectionL1Diffs || [])[0];
    if (hotspot) {
      const color = sectionL1HotspotAction(hotspot);
      return `do not move target section; ${color}: ${hotspot.sectionId} diff=${hotspot.diffPercent}% pixels=${hotspot.diffPixels}`;
    }
    return `do not move target section; inspect upstream residual source or L1-dominant diff: ${p.sourcePair.from} -> ${p.sourcePair.to} predicted=${p.predictedToYDelta} actual=${p.actualToYDelta} gapDelta=${p.gapDelta}`;
  }
  const rootResidual = firstSectionRootResidualReason(l2.reason);
  if (rootResidual) return `inspect residual section/root drift: ${rootResidual.id} dx=${rootResidual.dx} dy=${rootResidual.dy}`;
  const hotspot = (diagnostics.sectionL1Diffs || l1?.sectionL1Diffs || [])[0];
  if (hotspot) {
    const color = sectionL1HotspotAction(hotspot);
    return `${color}: ${hotspot.sectionId} diff=${hotspot.diffPercent}% pixels=${hotspot.diffPixels}`;
  }
  if (l1?.status === "FAIL") return `inspect L1-dominant visual diff / screenshot crop: diff=${l1.diffPercent}%`;
  const lowConfidenceMismatch = (diagnostics.lowConfidenceTextContentAnchorMismatches || [])[0];
  if (lowConfidenceMismatch) return "review expected text extraction / generic or semantic layer names";
  return "visual tuning / residual L1";
}

function printText(report) {
  console.log(`# Anchor Mapping Report: ${report.manifest.section} (${report.manifest.viewport})`);
  console.log("");
  console.log(`anchors: ${report.manifest.anchorsTotal} total, ${report.manifest.requiredTotal} required, ${report.manifest.optionalTotal} optional`);
  if (report.quality?.l2) {
    const l2 = report.quality.l2;
    console.log(`quality L2: ${l2.status || "?"}, matched ${l2.anchorsMatched ?? "?"}/${l2.anchorsTotal ?? "?"}, required ${l2.requiredMatched ?? "?"}/${l2.requiredTotal ?? "?"}`);
    if (l2.reason) console.log(`quality L2 reason: ${l2.reason}`);
    if (l2.optionalTotal != null) {
      console.log(`quality optional: matched ${l2.optionalMatched ?? "?"}/${l2.optionalTotal}, missing ${l2.optionalMissing ?? "?"}`);
    }
    const categories = l2.diagnostics?.categories || [];
    if (categories.length) console.log(`quality categories: ${categories.join(", ")}`);
    if (report.quality.l1) {
      console.log(`quality L1: ${report.quality.l1.status} diff=${report.quality.l1.diffPercent}%`);
    }
    const actionability = l2.diagnostics?.actionabilitySummary;
    if (actionability) {
      console.log(
        `actionability: actionableRemaining=${actionability.actionableRemaining} ` +
        `highContent=${actionability.highConfidenceContentMismatch} trueText=${actionability.trueTextMetricDrift} ` +
        `wrapper=${actionability.wrapperTargetMismatch} slot=${actionability.repeatedSlotSequenceDrift} ` +
        `internal=${actionability.internalSectionDrift} reviewOnlyText=${actionability.reviewOnlyTextMismatch} ` +
        `nonActionableRoot=${l2.diagnostics?.nonActionableRootResiduals?.length || 0}`
      );
    }
  }
  console.log("");
  console.log("## Groups");
  for (const group of report.groups) {
    console.log(`- ${group.group}: ${group.total} anchors (${group.required} required, ${group.optional} optional)`);
  }
  console.log("");
  if (report.missingRequired.length) {
    console.log("## Missing Required");
    for (const item of report.missingRequired) {
      console.log(`- ${item.id} (${item.figmaNodeId || "no figma node"})`);
      console.log(`  ${item.hint}`);
    }
  } else if (report.quality?.l2?.requiredMatched >= report.quality?.l2?.requiredTotal) {
    console.log("## Missing Required");
    console.log("- none");
  } else {
    console.log("## Required Mapping Plan");
    for (const item of report.requiredMappingPlan) {
      console.log(`- ${item.id} (${item.figmaNodeId || "no figma node"})`);
      console.log(`  ${item.hint}`);
    }
  }
  console.log("");
  const diagnostics = report.quality?.l2?.diagnostics || {};
  if (diagnostics.sectionDeltas?.length) {
    console.log("## Section / Root Deltas");
    for (const delta of diagnostics.sectionDeltas) {
      const h = delta.heightDelta != null ? ` heightDelta=${delta.heightDelta}` : "";
      const w = delta.widthDelta != null ? ` widthDelta=${delta.widthDelta}` : "";
      console.log(`- ${formatDelta(delta)}${h}${w}`);
    }
    console.log("");
  }
  if (diagnostics.sectionGapDeltas?.length) {
    console.log("## Section Gap Deltas");
    for (const gap of diagnostics.sectionGapDeltas) {
      const cats = gap.categories?.length ? ` | ${gap.categories.join(", ")}` : "";
      console.log(`- ${gap.from} -> ${gap.to} figmaGap=${gap.figmaGap} measuredGap=${gap.measuredGap} gapDelta=${gap.gapDelta} fromHeightDelta=${gap.fromHeightDelta} toYDelta=${gap.toYDelta}${cats}`);
    }
    console.log("");
  }
  if (diagnostics.sectionOffsetPropagation?.length) {
    console.log("## Section Offset Propagation");
    for (const item of diagnostics.sectionOffsetPropagation) {
      const cats = item.categories?.length ? ` | ${item.categories.join(", ")}` : "";
      console.log(`- ${item.from} -> ${item.to} fromYDelta=${item.fromYDelta} fromHeightDelta=${item.fromHeightDelta} fromBottomDelta=${item.fromBottomDelta} gapDelta=${item.gapDelta} predictedToYDelta=${item.predictedToYDelta} actualToYDelta=${item.actualToYDelta} residual=${item.residual} confidence=${item.confidence}${cats}`);
    }
    console.log("");
  }
  if (diagnostics.sharedResidualOffsetSources?.length) {
    console.log("## Shared Residual Offset Sources");
    for (const item of diagnostics.sharedResidualOffsetSources) {
      const p = item.propagation || {};
      console.log(`- ${item.sectionId}: source=${item.sourcePair?.from} -> ${item.sourcePair?.to} sharedOffset=${item.sharedOffset?.dx},${item.sharedOffset?.dy} predicted=${p.predictedToYDelta} actual=${p.actualToYDelta} residual=${p.sharedOffsetResidual ?? p.residual} confidence=${p.confidence}`);
      console.log(`  math: ${p.from} yDelta ${p.fromYDelta} + heightDelta ${p.fromHeightDelta} + gapDelta ${p.gapDelta} = ${p.predictedToYDelta}`);
      console.log(`  reason: ${item.reason}`);
    }
    console.log("");
  }
  if (diagnostics.nonActionableRootResiduals?.length) {
    console.log("## Non-actionable Root Residuals");
    for (const item of diagnostics.nonActionableRootResiduals) {
      const cats = item.categories?.length ? ` | ${item.categories.join(", ")}` : "";
      console.log(`- ${item.targetSection}: source=${item.sourcePair?.from} -> ${item.sourcePair?.to} predicted=${item.predictedToYDelta} actual=${item.actualToYDelta} gapDelta=${item.gapDelta} residual=${item.residual} confidence=${item.confidence}${cats}`);
      console.log(`  action: ${item.suggestedAction}`);
    }
    console.log("");
  }
  const sectionL1Diffs = diagnostics.sectionL1Diffs || report.quality?.l1?.sectionL1Diffs || [];
  if (sectionL1Diffs.length) {
    console.log("## Section L1 Diff Hotspots");
    for (const item of sectionL1Diffs) {
      const cats = item.categories?.length ? ` | ${item.categories.join(", ")}` : "";
      console.log(`- #${item.rank} ${item.sectionId} diff=${item.diffPercent}% pixels=${item.diffPixels}/${item.totalPixels} bbox=${item.bbox?.x ?? "?"},${item.bbox?.y ?? "?"},${item.bbox?.w}x${item.bbox?.h} currentAvg=${item.currentAverageColor || "?"} baselineAvg=${item.baselineAverageColor || "?"} colorDistance=${item.colorDistance ?? "?"} bgCurrent=${item.backgroundSampleCurrent || "?"} bgBaseline=${item.backgroundSampleBaseline || "?"} bgDistance=${item.backgroundColorDistance ?? "?"}${cats}`);
      const printSignals = (label, signals) => {
        if (!signals?.length) return;
        console.log(`  ${label}:`);
        for (const signal of signals) {
          const signalCats = signal.categories?.length ? ` | ${signal.categories.join(", ")}` : "";
          const texts = [
            signal.expectedText ? `expected="${shortText(signal.expectedText)}"` : null,
            signal.actualText ? `actual="${shortText(signal.actualText)}"` : null,
            signal.anchorNameText ? `anchor="${shortText(signal.anchorNameText)}"` : null,
          ].filter(Boolean).join(" ");
          const kind = signal.signalKind ? ` kind=${signal.signalKind}` : "";
          const flags = [
            signal.actionable ? "actionable" : null,
            signal.reviewOnly ? "reviewOnly" : null,
          ].filter(Boolean).join(",");
          console.log(`  - ${signal.id} dx=${signal.dx ?? "?"} dy=${signal.dy ?? "?"} confidence=${signal.confidence || "?"}${kind}${flags ? ` ${flags}` : ""} ${texts}${signalCats}`);
        }
      };
      printSignals("actionableTextSignals", item.actionableTextSignals);
      printSignals("reviewOnlyTextSignals", item.reviewOnlyTextSignals);
      if (!item.actionableTextSignals?.length && !item.reviewOnlyTextSignals?.length) {
        printSignals("textSignals", item.textSignals);
      }
      if (item.imageSignals?.length) {
        console.log("  imageSignals:");
        for (const signal of item.imageSignals) {
          const signalCats = signal.categories?.length ? ` | ${signal.categories.join(", ")}` : "";
          const reasons = signal.candidateReason?.length ? ` reason=${signal.candidateReason.join(",")}` : "";
          console.log(`  - ${signal.id} role=${signal.role || "?"} dx=${signal.dx ?? "?"} dy=${signal.dy ?? "?"} ratio=${signal.widthRatio ?? "?"}x${signal.heightRatio ?? "?"}${reasons} measured=${signal.measured?.x ?? "?"},${signal.measured?.y ?? "?"},${signal.measured?.w}x${signal.measured?.h} figma=${signal.figma?.x ?? "?"},${signal.figma?.y ?? "?"},${signal.figma?.w}x${signal.figma?.h}${signalCats}`);
        }
      }
    }
    console.log("");
  }
  if (diagnostics.repeatedHeightGroups?.length) {
    console.log("## Repeated Height Drift");
    for (const group of diagnostics.repeatedHeightGroups) {
      console.log(`- ${group.ids.join(", ")} heightDelta≈${group.heightDelta} measured=${(group.measuredHeights || []).join(",")} figma=${(group.figmaHeights || []).join(",")} | ${(group.categories || []).join(", ")}`);
    }
    console.log("");
  }
  if (diagnostics.fullBboxAnchorGroups?.length) {
    console.log("## Full BBox Anchor Groups");
    for (const group of diagnostics.fullBboxAnchorGroups) {
      const state = group.resolved ? "resolved" : "unresolved";
      console.log(`- ${group.representative}: ${state} ids=${(group.ids || []).join(", ")} roles=${(group.roles || []).join(", ")} figma=${group.figma?.x ?? "?"},${group.figma?.y ?? "?"},${group.figma?.w}x${group.figma?.h} measuredSpread=${group.measuredSpread?.max ?? "?"} meaning=${group.likelyMeaning}`);
      console.log(`  ${group.suggestedAction || (group.resolved ? "resolved: same measured bbox / data-anchors likely OK" : `mapping hint: if these ids share one visible box, use data-anchors="${(group.ids || []).join(" ")}"` )}`);
      if (!group.resolved) {
        console.log(`  mapping hint: if these ids share one visible box, use data-anchors="${(group.ids || []).join(" ")}"`);
      }
    }
    console.log("");
  }
  if (diagnostics.anchorTargetMismatches?.length) {
    console.log("## Anchor Target Mismatches");
    for (const item of diagnostics.anchorTargetMismatches) {
      const cats = item.categories?.length ? ` | ${item.categories.join(", ")}` : "";
      console.log(`- ${item.id} widthRatio=${item.widthRatio} heightRatio=${item.heightRatio} measured=${item.measured?.x ?? "?"},${item.measured?.y ?? "?"},${item.measured?.w}x${item.measured?.h} figma=${item.figma?.x ?? "?"},${item.figma?.y ?? "?"},${item.figma?.w}x${item.figma?.h}${cats}`);
    }
    console.log("");
  }
  if (diagnostics.sectionBackgroundAnchorTargetMismatches?.length) {
    console.log("## Section / Background Anchor Target Mismatch");
    for (const item of diagnostics.sectionBackgroundAnchorTargetMismatches) {
      const cats = item.categories?.length ? ` | ${item.categories.join(", ")}` : "";
      console.log(`- ${item.id} role=${item.role || "?"} dx=${item.dx} dy=${item.dy} measured=${item.measured?.x ?? "?"},${item.measured?.y ?? "?"},${item.measured?.w}x${item.measured?.h} figma=${item.figma?.x ?? "?"},${item.figma?.y ?? "?"},${item.figma?.w}x${item.figma?.h} actual="${item.actualText || ""}"${cats}`);
      console.log(`  warning: ${item.warning || "do not tune text; move anchor to visible section/background/frame box or document missing visual mapping"}`);
    }
    console.log("");
  }
  if (diagnostics.duplicateTextBboxGroups?.length) {
    console.log("## Duplicate Text BBox Groups");
    for (const group of diagnostics.duplicateTextBboxGroups) {
      const state = group.resolved ? "resolved" : "unresolved";
      const cats = group.categories?.length ? ` | ${group.categories.join(", ")}` : "";
      console.log(`- ${state} ids=${(group.ids || []).join(", ")} roles=${(group.roles || []).join(", ")} figma=${group.figma?.x ?? "?"},${group.figma?.y ?? "?"},${group.figma?.w}x${group.figma?.h} matched=${(group.matchedIds || []).length}/${(group.ids || []).length} measuredSpread=${group.measuredSpread?.max ?? "?"}${cats}`);
      if (group.wrapperTargetIds?.length) console.log(`  wrapper-target ids: ${group.wrapperTargetIds.join(", ")}`);
      if (group.unmatchedIds?.length) console.log(`  unmatched ids: ${group.unmatchedIds.join(", ")}`);
      console.log(`  action: ${group.suggestedAction || `if these ids represent one visible text layer, use data-anchors="${(group.ids || []).join(" ")}"`}`);
    }
    console.log("");
  }
  if (diagnostics.wrapperTargetMismatches?.length) {
    console.log("## Wrapper Target Mismatches");
    for (const item of diagnostics.wrapperTargetMismatches) {
      const cats = item.categories?.length ? ` | ${item.categories.join(", ")}` : "";
      console.log(`- ${item.id} widthRatio=${item.widthRatio} heightRatio=${item.heightRatio} dx=${item.dx} dy=${item.dy} measured=${item.measured?.x ?? "?"},${item.measured?.y ?? "?"},${item.measured?.w}x${item.measured?.h} figma=${item.figma?.x ?? "?"},${item.figma?.y ?? "?"},${item.figma?.w}x${item.figma?.h} actual="${item.actualText || ""}"${cats}`);
      const duplicateGroup = (diagnostics.duplicateTextBboxGroups || []).find((group) => (group.ids || []).includes(item.id));
      console.log(`  action: ${duplicateGroup?.suggestedAction || item.suggestedAction || "move anchor from wrapper to the visible target element"}`);
    }
    console.log("");
  }
  if (diagnostics.logoBrandScaleDrifts?.length) {
    console.log("## Logo / Brand Scale Drift");
    for (const item of diagnostics.logoBrandScaleDrifts) {
      const cats = item.categories?.length ? ` | ${item.categories.join(", ")}` : "";
      console.log(`- ${item.id} widthRatio=${item.widthRatio} heightRatio=${item.heightRatio} dx=${item.dx} dy=${item.dy} measured=${item.measured?.x ?? "?"},${item.measured?.y ?? "?"},${item.measured?.w}x${item.measured?.h} figma=${item.figma?.x ?? "?"},${item.figma?.y ?? "?"},${item.figma?.w}x${item.figma?.h} actual="${item.actualText || ""}"${cats}`);
      console.log(`  action: ${item.suggestedAction || "verify logo/wordmark anchor target; if target is correct, tune logo fit box / optical scale"}`);
    }
    console.log("");
  }
  const textMismatchCount = diagnostics.textContentAnchorMismatches?.length || 0;
  const trueTextMetricCount = diagnostics.trueTextMetricDrifts?.length || 0;
  if (textMismatchCount || trueTextMetricCount) {
    const mismatchSummary = diagnostics.textContentAnchorMismatchSummary || {};
    console.log("## Text Drift Summary");
    console.log(`- content/anchor mismatches: ${textMismatchCount}`);
    console.log(`- high-confidence content mismatches: ${mismatchSummary.highConfidence ?? (diagnostics.highConfidenceTextContentAnchorMismatches || []).length}`);
    console.log(`- low-confidence review-only mismatches: ${mismatchSummary.lowConfidence ?? (diagnostics.lowConfidenceTextContentAnchorMismatches || []).length}`);
    console.log(`- expectedText missing: ${mismatchSummary.expectedTextMissing ?? "?"}`);
    console.log(`- true text metric/placement drifts: ${trueTextMetricCount}`);
    console.log("");
  }
  if (diagnostics.highConfidenceTextContentAnchorMismatches?.length) {
    console.log("## Text Content / Anchor Mismatch");
    for (const item of diagnostics.highConfidenceTextContentAnchorMismatches) {
      const cats = item.categories?.length ? ` | ${item.categories.join(", ")}` : "";
      const texts = ` expected="${item.expectedText || ""}" actual="${item.actualText || ""}" anchorName="${item.anchorNameText || ""}"`;
      console.log(`- ${item.id} confidence=${item.confidence || mismatchConfidence(item)} dx=${item.dx} dy=${item.dy} measured=${item.measured?.x ?? "?"},${item.measured?.y ?? "?"},${item.measured?.w}x${item.measured?.h} figma=${item.figma?.x ?? "?"},${item.figma?.y ?? "?"},${item.figma?.w}x${item.figma?.h}${texts} matchesExpected=${item.textMatchesExpected ?? "?"} matchesAnchorName=${item.textMatchesAnchorName ?? "?"}${cats}`);
      console.log(`  reason: ${item.reason || mismatchReason(item)}`);
      console.log(`  warning: ${item.warning || mismatchWarning(item)}`);
    }
    console.log("");
  }
  if (diagnostics.lowConfidenceTextContentAnchorMismatches?.length) {
    console.log("## Low Confidence Text Mismatches");
    for (const item of diagnostics.lowConfidenceTextContentAnchorMismatches) {
      const cats = item.categories?.length ? ` | ${item.categories.join(", ")}` : "";
      const texts = ` expected="${item.expectedText || ""}" actual="${item.actualText || ""}" anchorName="${item.anchorNameText || ""}"`;
      console.log(`- ${item.id} reviewOnly=true dx=${item.dx} dy=${item.dy} measured=${item.measured?.x ?? "?"},${item.measured?.y ?? "?"},${item.measured?.w}x${item.measured?.h} figma=${item.figma?.x ?? "?"},${item.figma?.y ?? "?"},${item.figma?.w}x${item.figma?.h}${texts}${cats}`);
      console.log(`  reason: ${item.reason || mismatchReason(item)}`);
      console.log(`  warning: ${item.warning || mismatchWarning(item)}`);
    }
    console.log("");
  }
  if (diagnostics.trueTextMetricDrifts?.length) {
    console.log("## Text Metric / Placement Drift");
    for (const item of diagnostics.trueTextMetricDrifts) {
      const cats = item.categories?.length ? ` | ${item.categories.join(", ")}` : "";
      const texts = ` expected="${item.expectedText || ""}" actual="${item.actualText || ""}" anchorName="${item.anchorNameText || ""}"`;
      const signed = ` deltaX=${item.deltaX ?? "?"} deltaY=${item.deltaY ?? "?"}`;
      console.log(`- ${item.id} widthRatio=${item.widthRatio} heightRatio=${item.heightRatio} dx=${item.dx} dy=${item.dy}${signed} measured=${item.measured?.x ?? "?"},${item.measured?.y ?? "?"},${item.measured?.w}x${item.measured?.h} figma=${item.figma?.x ?? "?"},${item.figma?.y ?? "?"},${item.figma?.w}x${item.figma?.h}${texts} matchesExpected=${item.textMatchesExpected ?? "?"} matchesAnchorName=${item.textMatchesAnchorName ?? "?"} cause=${item.suggestedCause}${cats}`);
      if (item.suggestedAction) console.log(`  action: ${item.suggestedAction}`);
      if (item.warning) console.log(`  warning: ${item.warning}`);
    }
    console.log("");
  }
  if (diagnostics.sharedTextYOffsetGroups?.length) {
    console.log("## Shared Text Y Offset");
    for (const group of diagnostics.sharedTextYOffsetGroups) {
      const cats = group.categories?.length ? ` | ${group.categories.join(", ")}` : "";
      const section = group.sectionId
        ? ` section=${group.sectionId} sectionDeltaY=${group.sectionDeltaY ?? "?"} residualVsSection=${group.residualVsSection ?? "?"}`
        : "";
      console.log(`- deltaY≈${group.signedDeltaY} count=${group.count} maxAbsDeltaY=${group.maxAbsDeltaY}${section}${cats}`);
      console.log(`  action: ${group.suggestedAction || "inspect upstream flow/section height before tuning each text individually"}`);
      for (const anchor of group.anchors || []) {
        console.log(`  - ${anchor.id} deltaY=${anchor.deltaY ?? "?"} dx=${anchor.dx} dy=${anchor.dy} measured=${anchor.measured?.x ?? "?"},${anchor.measured?.y ?? "?"},${anchor.measured?.w}x${anchor.measured?.h} figma=${anchor.figma?.x ?? "?"},${anchor.figma?.y ?? "?"},${anchor.figma?.w}x${anchor.figma?.h}`);
      }
    }
    console.log("");
  }
  if (diagnostics.repeatedSlotSequenceDrifts?.length) {
    console.log("## Repeated Slot / Card Sequence Drift");
    for (const group of diagnostics.repeatedSlotSequenceDrifts) {
      const cats = group.categories?.length ? ` | ${group.categories.join(", ")}` : "";
      const raw = group.figmaCountRaw != null && group.figmaCountRaw !== group.figmaCount
        ? ` rawFigmaCount=${group.figmaCountRaw} collapsedFigmaCount=${group.figmaCount}`
        : ` figmaCount=${group.figmaCount}`;
      console.log(`- ${group.sectionId}:${raw} measuredCount=${group.measuredCount} distinctMeasured=${group.distinctMeasuredXCount} figmaGap=${group.medianFigmaGap ?? "?"} measuredGap=${group.medianMeasuredGap ?? "?"} maxDeltaX=${group.maxDeltaX}${cats}`);
      console.log(`  figmaX: ${(group.figmaXSequence || []).join(", ")}`);
      console.log(`  measuredX: ${(group.measuredXSequence || []).map((value) => value ?? "?").join(", ")}`);
      console.log(`  ids: ${(group.idsInFigmaOrder || []).join(", ")}`);
      for (const duplicate of group.duplicateVariantGroups || []) {
        console.log(`  duplicate slot variants: ${(duplicate.ids || []).join(", ")} -> ${duplicate.suggestedAction}`);
      }
      console.log(`  action: ${group.suggestedAction || "match repeated card/item count, order, and slot spacing before tuning individual anchors"}`);
    }
    console.log("");
  }
  if (diagnostics.internalSectionDriftGroups?.length) {
    console.log("## Internal Section Drift Groups");
    for (const group of diagnostics.internalSectionDriftGroups) {
      const shared = group.residualSharedOffsetLikely
        ? ` sharedOffset=${group.residualSharedOffset?.dx},${group.residualSharedOffset?.dy} normalizedMax=${group.normalizedMaxDeltaAfterSharedOffset} spread=${group.placementSpread}`
        : "";
      console.log(`- ${group.sectionId}: ${group.count} anchors, maxDelta=${group.maxDelta}, medianDelta=${group.medianDelta ?? "?"}, meanDelta=${group.meanDelta ?? "?"}, medianDx=${group.medianDx ?? "?"}, medianDy=${group.medianDy ?? "?"}${shared} | ${(group.categories || []).join(", ")}`);
      for (const anchor of group.anchors || []) {
        console.log(`  - ${formatDelta(anchor)}`);
      }
    }
    console.log("");
  }
  if (diagnostics.layoutModelMismatches?.length) {
    console.log("## Layout Model Mismatches");
    for (const item of diagnostics.layoutModelMismatches) {
      const root = item.sectionRootDelta
        ? ` root dx=${item.sectionRootDelta.dx} dy=${item.sectionRootDelta.dy} widthDelta=${item.sectionRootDelta.widthDelta} heightDelta=${item.sectionRootDelta.heightDelta}`
        : "";
      console.log(`- ${item.sectionId}: ${item.decision}${root}`);
      console.log(`  internalAnchors=${item.internalAnchorCount} largePlacement=${item.largePlacementDeltaCount} medianRatio=${item.medianWidthRatio}x${item.medianHeightRatio}`);
      if (item.residualSharedOffsetLikely) {
        console.log(`  sharedOffset=${item.residualSharedOffset?.dx},${item.residualSharedOffset?.dy} normalizedMax=${item.normalizedMaxDeltaAfterSharedOffset} spread=${item.placementSpread}`);
        if (item.sourcePair) {
          console.log(`  sourcePair=${item.sourcePair.from} -> ${item.sourcePair.to}`);
        }
      }
      console.log(`  model=${item.currentDomModel} vs ${item.figmaModel}; orderMismatchLikely=${item.orderMismatchLikely}`);
      console.log(`  reason: ${item.reason}`);
      if (item.decision === "rewrite-required") {
        console.log("  next action: rewrite section layout or ask human; small tuning is unlikely to converge");
      } else if (item.decision === "rewrite-effective-residual-offset") {
        console.log("  next action: inspect upstream/root/stack offset before rewriting this section again");
      }
    }
    console.log("");
  }
  if (diagnostics.topDeltas?.length) {
    console.log("## Top Deltas");
    const reviewOnlyIds = new Set((diagnostics.lowConfidenceTextContentAnchorMismatches || []).map((item) => item.id));
    for (const delta of diagnostics.topDeltas) {
      console.log(`- ${formatDelta(delta)}`);
      if (reviewOnlyIds.has(delta.id)) {
        console.log("  note: low-confidence review-only text mismatch; do not tune this before stronger diagnostics");
      }
    }
    console.log("");
  }
  if (diagnostics.typographyFailures?.length) {
    console.log("## Typography Failures");
    for (const item of diagnostics.typographyFailures) {
      console.log(`- ${item.id}: ${item.failures.join("; ")}`);
    }
    console.log("");
  }
  console.log("## Next Best Action");
  console.log(`- ${nextBestAction(report)}`);
  console.log("");
  console.log("## Notes");
  for (const warning of report.warnings) console.log(`- ${warning}`);
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.manifest) {
  usage();
  process.exit(2);
}

const manifest = readManifest(opts.manifest);
const quality = readJson(opts.quality);
const report = summarize(manifest, quality, Number(opts.limit) || 40);

if (opts.format === "json") {
  console.log(JSON.stringify(report, null, 2));
} else {
  printText(report);
}

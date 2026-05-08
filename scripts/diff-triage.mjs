#!/usr/bin/env node
/**
 * G1 refinement triage.
 *
 * Reads the latest quality JSON plus the G1 iteration trajectory and emits a
 * small, worker-oriented "next action" object. This is intentionally narrower
 * than report-anchor-mapping.mjs: workers should use it before each visual
 * patch so G1 refinement becomes a measured loop instead of screenshot guessing.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
  const opts = { viewport: "desktop", format: "text" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (key === "json") {
        opts.format = "json";
        continue;
      }
      opts[key] = argv[i + 1];
      i++;
    }
  }
  return opts;
}

function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function iterationPath(section, viewport) {
  const safeSection = String(section || "section").replace(/[^A-Za-z0-9_.-]+/g, "_");
  const safeViewport = String(viewport || "desktop").replace(/[^A-Za-z0-9_.-]+/g, "_");
  return join("tests", "quality", "iterations", `${safeSection}-${safeViewport}.json`);
}

function getViewportResult(quality, viewport) {
  const g1 = quality?.G1_visual_regression;
  if (!g1 || typeof g1 !== "object") return null;
  if (g1.viewports?.[viewport]) return g1.viewports[viewport];
  if (g1.l1 || g1.l2) return g1;
  return null;
}

function gateFailures(quality) {
  const gates = [
    ["G10", "G10_write_protection"],
    ["G4", "G4_token_usage"],
    ["G11", "G11_layout_escapes"],
    ["G12", "G12_reusability"],
    ["G5", "G5_semantic_html"],
    ["G6", "G6_text_image_ratio"],
    ["G8", "G8_i18n"],
    ["G7", "G7_lighthouse"],
  ];
  return gates
    .map(([gate, field]) => ({ gate, field, status: quality?.[field] || "MISSING" }))
    .filter((item) => !String(item.status).startsWith("PASS"));
}

function first(items) {
  return Array.isArray(items) && items.length ? items[0] : null;
}

function topSectionHotspots(l1, diagnostics) {
  const items = diagnostics?.sectionL1Failures?.length
    ? diagnostics.sectionL1Failures
    : diagnostics?.sectionL1Diffs?.length
      ? diagnostics.sectionL1Diffs
      : l1?.sectionL1Failures?.length
        ? l1.sectionL1Failures
        : l1?.sectionL1Diffs || [];
  return [...items]
    .sort((a, b) => Number(b.diffPixels || 0) - Number(a.diffPixels || 0))
    .slice(0, 5);
}

function hotspotAction(hotspot) {
  const categories = hotspot?.categories || [];
  const imageSignals = (hotspot?.imageSignals || []).slice(0, 3).map((item) => item.id).filter(Boolean);
  const suffix = imageSignals.length ? ` (${imageSignals.join(", ")})` : "";
  if (!hotspot) return null;
  if (categories.includes("solid-background-color-drift")) {
    return `fix visible background/token color in ${hotspot.sectionId}`;
  }
  if (categories.includes("overlay-text-content-drift-candidate")) {
    return `inspect overlay text content/order in ${hotspot.sectionId}${suffix}`;
  }
  if (categories.includes("image-content-mismatch-candidate") || categories.includes("asset-order-mismatch-candidate")) {
    return `inspect image asset/order/crop/object-position in ${hotspot.sectionId}${suffix}`;
  }
  return `inspect section L1 hotspot ${hotspot.sectionId}`;
}

function chooseNextAction({ quality, viewportResult, iterations }) {
  const nonG1Failures = gateFailures(quality);
  if (nonG1Failures.length) {
    const item = nonG1Failures[0];
    return {
      kind: "non-g1-gate",
      priority: 0,
      summary: `fix ${item.gate} before G1 refinement`,
      hints: [`${item.gate} is ${item.status}; do not tune pixels until non-G1 gates pass.`],
    };
  }
  const trajectory = Array.isArray(iterations?.iterations) ? iterations.iterations : [];
  if (iterations?.summary?.stalled || iterations?.summary?.outcome === "stalled") {
    return {
      kind: "trajectory-stalled",
      priority: 0,
      summary: "L1 refinement is stalled; stop repeating the same tuning path",
      hints: [
        `Iteration summary outcome=${iterations.summary.outcome || "stalled"} latest=${iterations.summary.latestL1 ?? "?"} previous=${iterations.summary.previousL1 ?? "?"} improvement=${iterations.summary.improvement ?? "?"}.`,
        "Re-check layout model, baseline/asset correctness, or ask reviewer before another patch.",
      ],
    };
  }
  const recentL1 = trajectory
    .map((item) => Number(item.l1?.diffPercent))
    .filter((value) => Number.isFinite(value))
    .slice(-4);
  if (recentL1.length >= 4) {
    const improvements = [
      recentL1[0] - recentL1[1],
      recentL1[1] - recentL1[2],
      recentL1[2] - recentL1[3],
    ];
    const stallThreshold = Number(process.env.G1_STALL_THRESHOLD || 0.5);
    const stalled = improvements.every((value) => value < stallThreshold);
    if (stalled) {
      return {
        kind: "trajectory-stalled",
        priority: 0,
        summary: "L1 refinement is stalled; stop repeating the same tuning path",
        hints: [
          `Recent L1 trajectory ${recentL1.join(" -> ")} has improvements ${improvements.map((value) => value.toFixed(3)).join(", ")} below ${stallThreshold}%p.`,
          "Re-check layout model, baseline/asset correctness, or ask reviewer before another patch.",
        ],
      };
    }
  }

  const l1 = viewportResult?.l1 || null;
  const l2 = viewportResult?.l2 || null;
  const diagnostics = l2?.diagnostics || {};
  if (!viewportResult) {
    return {
      kind: "missing-g1-result",
      priority: 0,
      summary: "run quality to generate G1 diagnostics",
      hints: ["Run npm.cmd run quality -- <section> <section-dir> before visual refinement."],
    };
  }
  if (!l2 || l2.status === "SKIPPED") {
    return {
      kind: "l2-not-effective",
      priority: 1,
      summary: "make L2 anchor diagnostics effective",
      hints: ["Prepare Figma anchor manifest and ensure G1 strict mode can match visible data-anchor/data-anchors."],
    };
  }
  if ((l2.requiredTotal || 0) > 0 && (l2.requiredMatched || 0) === 0) {
    return {
      kind: "required-anchor-zero",
      priority: 1,
      summary: "map required anchors first",
      hints: ["Attach required Figma anchors to visible DOM boxes before changing visual spacing."],
    };
  }
  if ((l2.requiredMatched || 0) < (l2.requiredTotal || 0)) {
    return {
      kind: "required-anchor-missing",
      priority: 1,
      summary: "finish required anchor mapping",
      hints: [`Required anchors matched ${l2.requiredMatched}/${l2.requiredTotal}. Add visible DOM anchors for the missing required nodes.`],
    };
  }
  const gap = first(diagnostics.sectionGapDeltas?.filter((item) => Math.abs(Number(item.gapDelta || 0)) >= 40));
  if (gap) {
    return {
      kind: "section-gap-drift",
      priority: 2,
      summary: `fix section gap ${gap.from} -> ${gap.to}`,
      hints: [`Figma gap=${gap.figmaGap}, measured gap=${gap.measuredGap}, delta=${gap.gapDelta}. Adjust normal-flow spacing, not individual anchors.`],
    };
  }
  const repeatedHeight = first(diagnostics.repeatedHeightGroups);
  if (repeatedHeight) {
    return {
      kind: "repeated-height-drift",
      priority: 3,
      summary: "fix repeated row/section height drift",
      hints: [`Repeated anchors ${repeatedHeight.ids?.join(", ")} share heightDelta≈${repeatedHeight.heightDelta}. Fix shared component sizing.`],
    };
  }
  const anchorTarget = first(diagnostics.anchorTargetMismatches);
  if (anchorTarget) {
    return {
      kind: "anchor-target-mismatch",
      priority: 4,
      summary: `fix anchor target wrapper: ${anchorTarget.id}`,
      hints: [`Measured bbox is ${anchorTarget.widthRatio}x/${anchorTarget.heightRatio}x Figma. Move data-anchor to the visible inner target, not a hidden node.`],
    };
  }
  const backgroundTarget = first(diagnostics.sectionBackgroundAnchorTargetMismatches);
  if (backgroundTarget) {
    return {
      kind: "section-background-target-mismatch",
      priority: 5,
      summary: `verify section/background target: ${backgroundTarget.id}`,
      hints: [`Anchor has actual text "${backgroundTarget.actualText || ""}" but looks like a section/background node. Move it to the visible frame/background box.`],
    };
  }
  const highContent = first(diagnostics.highConfidenceTextContentAnchorMismatches);
  if (highContent) {
    return {
      kind: "text-content-anchor-mismatch",
      priority: 6,
      summary: `verify content/anchor mapping: ${highContent.id}`,
      hints: [`actual="${highContent.actualText || ""}", anchorName="${highContent.anchorNameText || ""}". Do not tune text metrics until mapping/content is correct.`],
    };
  }
  const slot = first(diagnostics.repeatedSlotSequenceDrifts);
  if (slot) {
    return {
      kind: "repeated-slot-sequence-drift",
      priority: 7,
      summary: `match repeated item count/order/slot spacing: ${slot.sectionId}`,
      hints: ["Fix the repeated row/card model before tuning individual item bboxes."],
    };
  }
  const textMetric = first(diagnostics.trueTextMetricDrifts || diagnostics.textMetricDrifts);
  if (textMetric) {
    return {
      kind: "text-metric-placement-drift",
      priority: 8,
      summary: `fix text metric/wrapping/placement: ${textMetric.id}`,
      hints: ["Adjust visible text width, font size, line-height, wrapping, or local placement. Do not rasterize the text."],
    };
  }
  const layoutMismatch = first(diagnostics.layoutModelMismatches);
  if (layoutMismatch) {
    return {
      kind: "layout-model-mismatch",
      priority: 9,
      summary: `${layoutMismatch.decision || "review layout model"}: ${layoutMismatch.sectionId}`,
      hints: ["If rewrite-required, stop micro-tuning and restructure the section layout to match Figma's model."],
    };
  }
  const hotspot = first(topSectionHotspots(l1, diagnostics));
  if (hotspot) {
    return {
      kind: "section-l1-hotspot",
      priority: 10,
      summary: hotspotAction(hotspot),
      hints: [`${hotspot.sectionId}: diff=${hotspot.diffPercent}% pixels=${hotspot.diffPixels}. Inspect screenshot crop, asset/order/crop, background, decor, and stacking.`],
    };
  }
  if (l1?.status === "FAIL") {
    return {
      kind: "l1-residual",
      priority: 11,
      summary: `inspect residual L1 diff ${l1.diffPercent}%`,
      hints: [`Diff path: ${l1.diffPath || "<missing>"}. Use Figma baseline and current screenshot; do not add full-section raster.`],
    };
  }
  if (viewportResult.status === "PASS") {
    return {
      kind: "converged",
      priority: 99,
      summary: "G1 converged for this viewport",
      hints: ["No G1 visual action needed for this viewport."],
    };
  }
  return {
    kind: "unknown-g1-failure",
    priority: 12,
    summary: viewportResult.reason || "inspect G1 failure",
    hints: ["Open the G1 JSON and diff artifact; if diagnostics are missing, rerun quality."],
  };
}

function buildReport({ section, viewport, qualityPath, iterationFile, quality, iterations }) {
  const viewportResult = getViewportResult(quality, viewport);
  const l1 = viewportResult?.l1 || null;
  const l2 = viewportResult?.l2 || null;
  const trajectory = Array.isArray(iterations?.iterations) ? iterations.iterations : [];
  const action = chooseNextAction({ quality, viewportResult, iterations });
  return {
    section,
    viewport,
    qualityPath,
    iterationPath: iterationFile,
    status: viewportResult?.status || quality?.G1_status || "UNKNOWN",
    l1: l1
      ? {
          status: l1.status,
          diffPercent: l1.diffPercent,
          thresholdTarget: l1.thresholdTarget,
          targetGap: l1.targetGap,
          diffPath: l1.diffPath,
        }
      : null,
    l2: l2
      ? {
          status: l2.status,
          reason: l2.reason || null,
          anchorsMatched: l2.anchorsMatched,
          anchorsTotal: l2.anchorsTotal,
          requiredMatched: l2.requiredMatched,
          requiredTotal: l2.requiredTotal,
          categories: l2.diagnostics?.categories || [],
        }
      : null,
    trajectory: {
      attempts: trajectory.length,
      latest: iterations?.summary?.latestL1 ?? null,
      previous: iterations?.summary?.previousL1 ?? null,
      improvement: iterations?.summary?.improvement ?? null,
      monotonic: iterations?.summary?.monotonic ?? null,
      outcome: iterations?.summary?.outcome ?? null,
      stalled: iterations?.summary?.stalled ?? false,
      regressed: iterations?.summary?.regressed ?? false,
      converged: iterations?.summary?.converged ?? false,
      abandoned: iterations?.summary?.abandoned ?? false,
      entries: trajectory.slice(-5).map((item) => ({
        i: item.i,
        status: item.status,
        l1: item.l1?.diffPercent ?? null,
        targetGap: item.l1?.targetGap ?? null,
        reason: item.reason,
      })),
    },
    topHotspots: topSectionHotspots(l1, l2?.diagnostics || {}).map((item) => ({
      sectionId: item.sectionId,
      diffPercent: item.diffPercent,
      diffPixels: item.diffPixels,
      categories: item.categories || [],
    })),
    nextAction: action,
    workerInstructions: [
      "Fix exactly one nextAction item before rerunning quality.",
      "Do not add full-section/full-page raster, hidden anchors, or probe text.",
      "After patching, rerun npm.cmd run quality -- <section> <section-dir> and inspect the updated trajectory.",
    ],
  };
}

function printText(report) {
  console.log(`# G1 Diff Triage: ${report.section} (${report.viewport})`);
  console.log("");
  console.log(`status: ${report.status}`);
  if (report.l1) {
    console.log(`L1: ${report.l1.status} diff=${report.l1.diffPercent}% target=${report.l1.thresholdTarget}% gap=${report.l1.targetGap}%`);
    if (report.l1.diffPath) console.log(`diff: ${report.l1.diffPath}`);
  }
  if (report.l2) {
    console.log(`L2: ${report.l2.status} required=${report.l2.requiredMatched}/${report.l2.requiredTotal} anchors=${report.l2.anchorsMatched}/${report.l2.anchorsTotal}`);
    if (report.l2.reason) console.log(`L2 reason: ${report.l2.reason}`);
  }
  console.log(`trajectory: attempts=${report.trajectory.attempts} latest=${report.trajectory.latest ?? "?"} previous=${report.trajectory.previous ?? "?"} improvement=${report.trajectory.improvement ?? "?"} monotonic=${report.trajectory.monotonic ?? "?"}`);
  if (report.trajectory.outcome) console.log(`trajectory outcome: ${report.trajectory.outcome}`);
  console.log("");
  console.log(`nextAction: ${report.nextAction.kind}`);
  console.log(`summary: ${report.nextAction.summary}`);
  for (const hint of report.nextAction.hints || []) {
    console.log(`- ${hint}`);
  }
  if (report.topHotspots.length) {
    console.log("");
    console.log("topHotspots:");
    for (const item of report.topHotspots) {
      console.log(`- ${item.sectionId}: diff=${item.diffPercent}% pixels=${item.diffPixels} ${(item.categories || []).join(", ")}`);
    }
  }
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.section) {
  console.error("usage: node scripts/diff-triage.mjs --section <section> [--viewport desktop] [--quality tests/quality/<section>.json] [--json]");
  process.exit(2);
}

const qualityPath = opts.quality || join("tests", "quality", `${opts.section}.json`);
if (!existsSync(qualityPath)) {
  console.error(`quality result not found: ${qualityPath}`);
  process.exit(2);
}
const quality = readJson(qualityPath);
const iterPath = opts.iterations || iterationPath(opts.section, opts.viewport);
const iterations = readJson(iterPath, { iterations: [], summary: {} });
const report = buildReport({
  section: opts.section,
  viewport: opts.viewport,
  qualityPath,
  iterationFile: iterPath,
  quality,
  iterations,
});

if (opts.format === "json" || opts.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printText(report);
}

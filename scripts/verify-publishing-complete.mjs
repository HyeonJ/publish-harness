#!/usr/bin/env node
/**
 * Final publishing verifier.
 *
 * This catches workflow omissions that individual gates cannot catch when they
 * were never run. It is intentionally stricter than status/why diagnostics:
 * every non-skipped page/section must be done, have quality JSON, recorded gate
 * results, and required visual baseline artifacts.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
  const opts = { json: false, allowG7Skip: process.env.ALLOW_G7_SKIP === "1" };
  for (const arg of argv) {
    if (arg === "--json") opts.json = true;
    if (arg === "--allow-g7-skip") opts.allowG7Skip = true;
  }
  return opts;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readText(path) {
  try { return readFileSync(path, "utf8"); } catch { return ""; }
}

function gateStatus(raw) {
  if (typeof raw !== "string") return "MISSING";
  const value = raw.trim();
  if (value.startsWith("PASS")) return "PASS";
  if (value.startsWith("FAIL")) return "FAIL";
  if (value.startsWith("SKIP") || value.startsWith("NO_BASELINE") || value.startsWith("SKIPPED")) return "SKIP";
  return value || "MISSING";
}

function fail(failures, code, message, file = null) {
  failures.push({ code, message, ...(file ? { file } : {}) });
}

function qualityPath(sectionName) {
  return join("tests", "quality", `${sectionName}.json`);
}

function getViewportEntries(g1) {
  if (!g1 || typeof g1 !== "object") return [];
  if (g1.viewports && typeof g1.viewports === "object") return Object.entries(g1.viewports);
  if (g1.l2) return [[g1.viewport || "desktop", g1]];
  return [];
}

function hasG12Code(quality, codes) {
  const detail = quality?.G12_detail;
  if (!detail || typeof detail !== "object") return false;
  const items = [...(detail.failures || []), ...(detail.warnings || [])];
  return items.some((item) => codes.has(item.code));
}

function hasNonEmptyField(text, label) {
  const re = new RegExp(`^-\\s*${label}:\\s*(.+)$`, "im");
  const match = text.match(re);
  if (!match) return false;
  const value = match[1].trim();
  return value.length > 0 && !/^<.*>$/.test(value);
}

function defectLogNeedsStructuredFields(text) {
  if (!text.trim()) return false;
  if (/!\[[^\]]*]\([^)]+\)/.test(text)) return true;
  if (/^###\s+D-\d+:\s+(?!<short title>)/im.test(text)) return true;
  return false;
}

const opts = parseArgs(process.argv.slice(2));
const cwd = process.cwd();
const failures = [];
const warnings = [];

const progressPath = join(cwd, "progress.json");
if (!existsSync(progressPath)) {
  fail(failures, "MISSING_PROGRESS", "progress.json is required for final publishing verification.", "progress.json");
}

let progress = null;
if (existsSync(progressPath)) {
  try {
    progress = readJson(progressPath);
  } catch (error) {
    fail(failures, "INVALID_PROGRESS", `progress.json is not valid JSON: ${error.message}`, "progress.json");
  }
}

const publishingLogPath = join(cwd, "docs", "publishing-log.md");
if (!existsSync(publishingLogPath)) {
  fail(failures, "MISSING_PUBLISHING_LOG", "docs/publishing-log.md is required.", "docs/publishing-log.md");
}

const defectPath = join(cwd, "docs", "defect.md");
if (!existsSync(defectPath)) {
  fail(failures, "MISSING_DEFECT_LOG", "docs/defect.md is required.", "docs/defect.md");
} else {
  const defectText = readText(defectPath);
  if (defectLogNeedsStructuredFields(defectText)) {
    for (const label of ["Root cause", "Fix plan", "Verification", "Harness follow-up"]) {
      if (!hasNonEmptyField(defectText, label)) {
        fail(
          failures,
          "INCOMPLETE_DEFECT_LOG",
          `docs/defect.md has defect evidence but missing non-empty "${label}" field.`,
          "docs/defect.md",
        );
      }
    }
  }
}

const template = progress?.project?.template || "vite-react-ts";
const mode = progress?.project?.mode || "figma";
const isReactTemplate = template === "vite-react-ts" || template === "nextjs-app-router";

if (isReactTemplate && existsSync(join(cwd, "src", "routes", "HomePlaceholder.tsx"))) {
  fail(
    failures,
    "SCAFFOLD_PLACEHOLDER_PRESENT",
    "src/routes/HomePlaceholder.tsx remains; published React output must remove scaffold placeholders.",
    "src/routes/HomePlaceholder.tsx",
  );
}

if (progress) {
  const activePages = (progress.pages || []).filter((page) => page.status !== "skipped");
  const activeSections = (progress.sections || []).filter((section) => section.status !== "skipped");

  if (activeSections.length === 0) {
    fail(failures, "NO_ACTIVE_SECTIONS", "No non-skipped sections exist; final publishing verification has nothing to verify.", "progress.json");
  }

  for (const page of activePages) {
    if (page.status !== "done") {
      fail(
        failures,
        "PAGE_NOT_DONE",
        `Page "${page.name}" is ${page.status || "MISSING"}; final publishing requires every non-skipped page to be done.`,
        "progress.json",
      );
    }
    if (!Array.isArray(page.sections) || page.sections.length === 0) {
      fail(
        failures,
        "PAGE_WITHOUT_SECTIONS",
        `Page "${page.name}" has no linked sections; route/page work must be represented in progress.json before final verification.`,
        "progress.json",
      );
    }
  }

  for (const section of activeSections) {
    if (section.status !== "done") {
      fail(
        failures,
        "SECTION_NOT_DONE",
        `Section "${section.name}" is ${section.status || "MISSING"}; final publishing requires every non-skipped section to be done.`,
        "progress.json",
      );
    }

    const qp = join(cwd, qualityPath(section.name));
    if (!existsSync(qp)) {
      fail(
        failures,
        "MISSING_QUALITY_RESULT",
        `Section "${section.name}" has no ${qualityPath(section.name)}. Run measure-quality.sh for every route/page before final verification.`,
        qualityPath(section.name),
      );
      continue;
    }

    let quality = null;
    try {
      quality = readJson(qp);
    } catch (error) {
      fail(failures, "INVALID_QUALITY_RESULT", `${qualityPath(section.name)} is not valid JSON: ${error.message}`, qualityPath(section.name));
      continue;
    }

    const requiredGates = template === "html-static"
      ? ["G1_status", "G4_token_usage", "G5_semantic_html", "G6_text_image_ratio", "G8_i18n", "G10_write_protection", "G11_layout_escapes"]
      : ["G1_status", "G4_token_usage", "G5_semantic_html", "G6_text_image_ratio", "G8_i18n", "G10_write_protection", "G11_layout_escapes", "G12_reusability"];

    for (const field of requiredGates) {
      if (!(field in quality)) {
        fail(failures, "MISSING_GATE_FIELD", `${qualityPath(section.name)} is missing ${field}.`, qualityPath(section.name));
        continue;
      }
      const status = gateStatus(quality[field]);
      if (status !== "PASS") {
        fail(failures, "GATE_NOT_PASSING", `${section.name} ${field} is ${status}; final publishing requires PASS.`, qualityPath(section.name));
      }
    }

    if (isReactTemplate && hasG12Code(quality, new Set([
      "PIXEL_MIRROR_FINAL_BLOCKED",
      "SECTION_RASTER_FINAL_BLOCKED",
      "CSS_SECTION_RASTER_FINAL_BLOCKED",
      "HIDDEN_ANCHOR_LAYER_FINAL_BLOCKED",
      "FIGMA_ANCHOR_OVERLAY_FINAL_BLOCKED",
      "RASTER_BACKDROP_WITHOUT_OPT_IN",
      "CSS_RASTER_BACKDROP_WITHOUT_OPT_IN",
      "HIDDEN_ANCHOR_WITHOUT_OPT_IN",
    ]))) {
      fail(
        failures,
        "G12_PIXEL_MIRROR_OR_HIDDEN_ANCHOR_DEBT",
        `${section.name} contains pixel-mirror/full-section raster or hidden-overlay anchor debt. Final publishing requires reusable visible React DOM/CSS with appropriate leaf rasters only.`,
        qualityPath(section.name),
      );
    }

    if ("G7_lighthouse" in quality && gateStatus(quality.G7_lighthouse) === "FAIL") {
      fail(failures, "G7_FAILING", `${section.name} G7_lighthouse is FAIL.`, qualityPath(section.name));
    } else if ("G7_lighthouse" in quality && gateStatus(quality.G7_lighthouse) !== "PASS") {
      const message = `${section.name} G7_lighthouse is ${gateStatus(quality.G7_lighthouse)}; install lighthouse/@lhci or rerun verifier with --allow-g7-skip for an explicit local exception.`;
      if (opts.allowG7Skip) warnings.push({ code: "G7_NOT_PASS", message });
      else fail(failures, "G7_NOT_PASS", message, qualityPath(section.name));
    }

    if (mode === "figma") {
      const baseDir = join(cwd, "baselines", section.name);
      const desktopPng = join(baseDir, "desktop.png");
      const desktopAnchors = join(baseDir, "anchors-desktop.json");
      if (!existsSync(desktopPng)) {
        fail(failures, "MISSING_FIGMA_BASELINE", `${section.name} is done in figma mode but baselines/${section.name}/desktop.png is missing.`, desktopPng);
      }
      if (!existsSync(desktopAnchors)) {
        fail(failures, "MISSING_FIGMA_ANCHORS", `${section.name} is done in figma mode but baselines/${section.name}/anchors-desktop.json is missing.`, desktopAnchors);
      }

      const g1 = quality.G1_visual_regression;
      for (const [viewport, result] of getViewportEntries(g1)) {
        const l1 = result?.l1;
        if (l1 && Number(l1.targetGap || 0) > 0) {
          fail(
            failures,
            "G1_L1_TARGET_NOT_MET",
            `${section.name} ${viewport} L1 diff is ${l1.diffPercent}% with target ${l1.thresholdTarget}%; reduce the remaining ${l1.targetGap}% target gap before final figma publishing.`,
            qualityPath(section.name),
          );
        }
        const l2 = result?.l2;
        if (!l2 || l2.status === "SKIPPED") {
          fail(
            failures,
            "G1_L2_NOT_EFFECTIVE",
            `${section.name} ${viewport} has no effective L2 anchor result; final figma publishing requires strict anchor matching.`,
            qualityPath(section.name),
          );
          continue;
        }
        if (typeof l2.anchorsTotal === "number" && l2.anchorsTotal === 0) {
          fail(
            failures,
            "G1_EMPTY_ANCHOR_MANIFEST",
            `${section.name} ${viewport} has anchorsTotal=0; final figma publishing requires a Figma-derived anchor manifest with meaningful anchors.`,
            qualityPath(section.name),
          );
        }
        if (typeof l2.requiredTotal === "number" && l2.requiredTotal === 0) {
          fail(
            failures,
            "G1_NO_REQUIRED_ANCHORS",
            `${section.name} ${viewport} has requiredTotal=0; final figma publishing requires required anchors from the Figma node tree.`,
            qualityPath(section.name),
          );
        }
        if (typeof l2.requiredMatched === "number" && typeof l2.requiredTotal === "number" && l2.requiredMatched < l2.requiredTotal) {
          fail(
            failures,
            "G1_REQUIRED_ANCHORS_MISSING",
            `${section.name} ${viewport} matched ${l2.requiredMatched}/${l2.requiredTotal} required anchors.`,
            qualityPath(section.name),
          );
        }
        if (typeof l2.anchorsMatched === "number" && l2.anchorsMatched === 0 && typeof l2.anchorsTotal === "number" && l2.anchorsTotal > 0) {
          fail(
            failures,
            "G1_NO_ANCHORS_MATCHED",
            `${section.name} ${viewport} has anchorsTotal=${l2.anchorsTotal} but anchorsMatched=0; data-anchor attributes were not applied to the DOM.`,
            qualityPath(section.name),
          );
        }
      }
    }

    const gates = section.lastGateResult?.gates || null;
    if (!gates) {
      fail(failures, "MISSING_RECORDED_GATE_RESULT", `Section "${section.name}" has no lastGateResult in progress.json. Run measure-quality.sh; it records gate results automatically.`, "progress.json");
    } else {
      for (const gate of ["G1", "G4", "G5", "G6", "G8", "G10", "G11", ...(template === "html-static" ? [] : ["G12"])]) {
        if (gates[gate] !== "PASS") {
          fail(failures, "RECORDED_GATE_NOT_PASSING", `progress.json records ${section.name} ${gate} as ${gates[gate] || "MISSING"}.`, "progress.json");
        }
      }
    }
  }

  const qualityDir = join(cwd, "tests", "quality");
  if (!existsSync(qualityDir) || readdirSync(qualityDir).filter((file) => file.endsWith(".json")).length === 0) {
    fail(failures, "NO_QUALITY_RESULTS", "tests/quality has no quality result JSON files. Run measure-quality.sh before completion.", "tests/quality");
  }
}

const result = {
  status: failures.length ? "FAIL" : "PASS",
  failures,
  warnings,
};

if (opts.json) {
  console.log(JSON.stringify(result, null, 2));
} else if (failures.length) {
  console.error("Publishing verification failed:");
  for (const item of failures) {
    console.error(`- [${item.code}] ${item.message}${item.file ? ` (${item.file})` : ""}`);
  }
  for (const item of warnings) {
    console.error(`- [warning:${item.code}] ${item.message}`);
  }
} else {
  console.log("Publishing verification passed.");
  for (const item of warnings) {
    console.log(`warning: [${item.code}] ${item.message}`);
  }
}

process.exit(failures.length ? 1 : 0);

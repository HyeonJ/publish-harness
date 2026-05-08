import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const script = resolve("scripts/diff-triage.mjs");

function makeProject(quality, iterations = null) {
  const dir = mkdtempSync(join(tmpdir(), "diff-triage-"));
  mkdirSync(join(dir, "tests", "quality", "iterations"), { recursive: true });
  writeFileSync(join(dir, "tests", "quality", "Home.json"), JSON.stringify(quality, null, 2), "utf8");
  if (iterations) {
    writeFileSync(join(dir, "tests", "quality", "iterations", "Home-desktop.json"), JSON.stringify(iterations, null, 2), "utf8");
  }
  return dir;
}

function baseQuality(overrides = {}) {
  return {
    section: "Home",
    G1_status: "FAIL",
    G10_write_protection: "PASS",
    G4_token_usage: "PASS",
    G11_layout_escapes: "PASS",
    G12_reusability: "PASS",
    G5_semantic_html: "PASS",
    G6_text_image_ratio: "PASS",
    G8_i18n: "PASS",
    G7_lighthouse: "PASS",
    G1_visual_regression: {
      status: "FAIL",
      viewports: {
        desktop: {
          status: "FAIL",
          reason: "L1 24.00% > 5%",
          l1: {
            status: "FAIL",
            diffPercent: 24,
            thresholdTarget: 5,
            targetGap: 19,
            diffPath: "tests/quality/diffs/Home-desktop.diff.png",
          },
          l2: {
            status: "PASS",
            anchorsMatched: 10,
            anchorsTotal: 10,
            requiredMatched: 6,
            requiredTotal: 6,
            diagnostics: {
              categories: [],
              sectionL1Failures: [
                { sectionId: "Home/section-3", diffPercent: 52, diffPixels: 800000, categories: ["image-content-mismatch-candidate"] },
              ],
            },
          },
        },
      },
    },
    ...overrides,
  };
}

test("prioritizes non-G1 gate failures before visual tuning", () => {
  const cwd = makeProject(baseQuality({ G12_reusability: "FAIL" }));
  const result = spawnSync(process.execPath, [script, "--section", "Home", "--json"], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout);
  assert.equal(json.nextAction.kind, "non-g1-gate");
  assert.match(json.nextAction.summary, /G12/);
});

test("prioritizes required anchor mapping before L1 hotspots", () => {
  const quality = baseQuality();
  quality.G1_visual_regression.viewports.desktop.l2.requiredMatched = 0;
  quality.G1_visual_regression.viewports.desktop.l2.requiredTotal = 6;
  const cwd = makeProject(quality);
  const result = spawnSync(process.execPath, [script, "--section", "Home", "--json"], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout);
  assert.equal(json.nextAction.kind, "required-anchor-zero");
});

test("uses section L1 hotspot when anchors and non-G1 gates are clean", () => {
  const cwd = makeProject(baseQuality(), {
    summary: { attempts: 2, latestL1: 24, previousL1: 29, improvement: 5, monotonic: true },
    iterations: [
      { i: 0, status: "FAIL", l1: { diffPercent: 29, targetGap: 24 } },
      { i: 1, status: "FAIL", l1: { diffPercent: 24, targetGap: 19 } },
    ],
  });
  const result = spawnSync(process.execPath, [script, "--section", "Home", "--json"], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout);
  assert.equal(json.nextAction.kind, "section-l1-hotspot");
  assert.equal(json.trajectory.improvement, 5);
  assert.equal(json.topHotspots[0].sectionId, "Home/section-3");
});

test("escalates when recent L1 trajectory is stalled", () => {
  const cwd = makeProject(baseQuality(), {
    summary: { attempts: 4, latestL1: 23.5, previousL1: 23.7, improvement: 0.2, monotonic: true, outcome: "stalled", stalled: true },
    iterations: [
      { i: 0, status: "FAIL", l1: { diffPercent: 24, targetGap: 19 } },
      { i: 1, status: "FAIL", l1: { diffPercent: 23.8, targetGap: 18.8 } },
      { i: 2, status: "FAIL", l1: { diffPercent: 23.7, targetGap: 18.7 } },
      { i: 3, status: "FAIL", l1: { diffPercent: 23.5, targetGap: 18.5 } },
    ],
  });
  const result = spawnSync(process.execPath, [script, "--section", "Home", "--json"], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout);
  assert.equal(json.nextAction.kind, "trajectory-stalled");
});

test("trusts stored stalled summary before recomputing trajectory", () => {
  const cwd = makeProject(baseQuality(), {
    summary: { attempts: 2, latestL1: 21, previousL1: 30, improvement: 9, monotonic: true, outcome: "stalled", stalled: true },
    iterations: [
      { i: 0, status: "FAIL", l1: { diffPercent: 30, targetGap: 25 } },
      { i: 1, status: "FAIL", l1: { diffPercent: 21, targetGap: 16 } },
    ],
  });
  const result = spawnSync(process.execPath, [script, "--section", "Home", "--json"], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout);
  assert.equal(json.nextAction.kind, "trajectory-stalled");
  assert.equal(json.nextAction.hints[0].includes("outcome=stalled"), true);
});

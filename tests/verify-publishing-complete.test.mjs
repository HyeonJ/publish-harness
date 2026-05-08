import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const script = resolve("scripts/verify-publishing-complete.mjs");

function makeProject({ quality = true, placeholder = false, defect = "template", pageStatus = "done", sectionStatus = "done", g7 = "PASS", g12Detail = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "verify-publishing-"));
  mkdirSync(join(dir, "docs"), { recursive: true });
  mkdirSync(join(dir, "tests", "quality"), { recursive: true });
  mkdirSync(join(dir, "baselines", "home"), { recursive: true });
  mkdirSync(join(dir, "src", "routes"), { recursive: true });

  writeFileSync(join(dir, "docs", "publishing-log.md"), "# Publishing Log\n", "utf8");
  const defectText = defect === "image-only"
    ? "### Defect\n\n### 이미지 크기 다름\n\n![figma](img.png)\n"
    : "# Defect Log\n\n## Defect Template\n\n### D-001: <short title>\n\n- Root cause:\n- Fix plan:\n- Verification:\n- Harness follow-up:\n";
  writeFileSync(join(dir, "docs", "defect.md"), defectText, "utf8");

  if (placeholder) {
    writeFileSync(join(dir, "src", "routes", "HomePlaceholder.tsx"), "export default function HomePlaceholder(){return null}\n", "utf8");
  }

  writeFileSync(join(dir, "baselines", "home", "desktop.png"), "png", "utf8");
  writeFileSync(join(dir, "baselines", "home", "anchors-desktop.json"), "{}", "utf8");

  const gates = {
    G1: "PASS",
    G4: "PASS",
    G5: "PASS",
    G6: "PASS",
    G7: g7,
    G8: "PASS",
    G10: "PASS",
    G11: "PASS",
    G12: "PASS",
  };
  const progress = {
    version: 1,
    project: { name: "demo", mode: "figma", template: "vite-react-ts", source: {}, canvas: {} },
    phase: { current: 4, completed: [1, 2, 3] },
    pages: [{ name: "home", route: "/", nodeId: "1:1", nodeIdTablet: null, nodeIdMobile: null, status: pageStatus, sections: ["home"] }],
    sections: [{
      name: "home",
      page: "home",
      kind: "section",
      status: sectionStatus,
      retryCount: 0,
      lastGateResult: { passed: true, gates, timestamp: "2026-05-06T00:00:00.000Z" },
      failureHistory: [],
    }],
    updatedAt: "2026-05-06T00:00:00.000Z",
  };
  writeFileSync(join(dir, "progress.json"), JSON.stringify(progress, null, 2) + "\n", "utf8");

  if (quality) {
    const result = {
      section: "home",
      dir: "src/pages",
      viewport: "desktop",
      G1_status: "PASS",
      G4_token_usage: "PASS",
      G5_semantic_html: "PASS",
      G6_text_image_ratio: "PASS",
      G7_lighthouse: g7,
      G8_i18n: "PASS",
      G10_write_protection: "PASS",
      G11_layout_escapes: "PASS",
      G12_reusability: "PASS",
      G12_detail: g12Detail || { status: "PASS", failures: [], warnings: [] },
      G1_visual_regression: {
        status: "PASS",
        strictEffective: true,
        viewports: {
          desktop: {
            status: "PASS",
            l2: {
              status: "PASS",
              anchorsMatched: 3,
              anchorsTotal: 3,
              requiredMatched: 2,
              requiredTotal: 2,
            },
          },
        },
      },
    };
    writeFileSync(join(dir, "tests", "quality", "home.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
  }

  return dir;
}

function runVerifier(cwd) {
  return spawnSync(process.execPath, [script, "--json"], { cwd, encoding: "utf8" });
}

test("passes a complete figma React project", () => {
  const cwd = makeProject();
  const result = runVerifier(cwd);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "PASS");
});

test("fails when a done section has no quality JSON", () => {
  const cwd = makeProject({ quality: false });
  const result = runVerifier(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /MISSING_QUALITY_RESULT/);
});

test("fails when a page or section is not done even if implementation files exist", () => {
  const cwd = makeProject({ pageStatus: "pending", sectionStatus: "in_progress" });
  const result = runVerifier(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /PAGE_NOT_DONE/);
  assert.match(result.stdout, /SECTION_NOT_DONE/);
});

test("fails when scaffold placeholder remains", () => {
  const cwd = makeProject({ placeholder: true });
  const result = runVerifier(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /SCAFFOLD_PLACEHOLDER_PRESENT/);
});

test("fails when defect evidence lacks root cause fields", () => {
  const cwd = makeProject({ defect: "image-only" });
  const result = runVerifier(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /INCOMPLETE_DEFECT_LOG/);
});

test("fails when strict G1 has no matched anchors", () => {
  const cwd = makeProject();
  const qualityPath = join(cwd, "tests", "quality", "home.json");
  const quality = JSON.parse(readFileSync(qualityPath, "utf8"));
  quality.G1_visual_regression.viewports.desktop.l2.anchorsMatched = 0;
  quality.G1_visual_regression.viewports.desktop.l2.requiredMatched = 0;
  writeFileSync(qualityPath, JSON.stringify(quality, null, 2) + "\n", "utf8");

  const result = runVerifier(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /G1_REQUIRED_ANCHORS_MISSING/);
  assert.match(result.stdout, /G1_NO_ANCHORS_MATCHED/);
});

test("fails G7 skip unless explicitly allowed", () => {
  const cwd = makeProject({ g7: "SKIP" });
  const result = runVerifier(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /G7_NOT_PASS/);

  const allowed = spawnSync(process.execPath, [script, "--json", "--allow-g7-skip"], { cwd, encoding: "utf8" });
  assert.equal(allowed.status, 0, allowed.stderr);
  const json = JSON.parse(allowed.stdout);
  assert.equal(json.status, "PASS");
  assert.ok(json.warnings.some((warning) => warning.code === "G7_NOT_PASS"));
});

test("fails final verifier when G12 detail contains pixel mirror debt", () => {
  const cwd = makeProject({
    g12Detail: {
      status: "PASS",
      failures: [],
      warnings: [{ code: "PIXEL_MIRROR_FINAL_BLOCKED", message: "pixel mirror present" }],
    },
  });
  const result = runVerifier(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /G12_PIXEL_MIRROR_OR_HIDDEN_ANCHOR_DEBT/);
});

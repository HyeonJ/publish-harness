import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const script = resolve("scripts/assert-completion-contract.mjs");
const verifierScript = resolve("scripts/verify-publishing-complete.mjs");

function makeProject({ g1 = "PASS", g7 = "PASS", pageStatus = "done", sectionStatus = "done" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "completion-contract-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "docs"), { recursive: true });
  mkdirSync(join(dir, "tests", "quality"), { recursive: true });
  mkdirSync(join(dir, "baselines", "home"), { recursive: true });
  mkdirSync(join(dir, "src"), { recursive: true });

  writeFileSync(join(dir, "scripts", "verify-publishing-complete.mjs"), `import "${pathToFileURL(verifierScript).href}";\n`, "utf8");
  writeFileSync(join(dir, "docs", "publishing-log.md"), "# Publishing Log\n", "utf8");
  writeFileSync(join(dir, "docs", "defect.md"), "# Defect Log\n\n## Defect Template\n\n### D-001: <short title>\n\n- Root cause:\n- Fix plan:\n- Verification:\n- Harness follow-up:\n", "utf8");
  writeFileSync(join(dir, "baselines", "home", "desktop.png"), "png", "utf8");
  writeFileSync(join(dir, "baselines", "home", "anchors-desktop.json"), JSON.stringify({ version: 2, anchors: [] }), "utf8");

  const gates = {
    G1: g1,
    G4: "PASS",
    G5: "PASS",
    G6: "PASS",
    G7: g7,
    G8: "PASS",
    G10: "PASS",
    G11: "PASS",
    G12: "PASS",
  };
  const allPass = Object.values(gates).every((value) => value === "PASS");
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
      lastGateResult: { passed: allPass, gates, timestamp: "2026-05-06T00:00:00.000Z" },
      failureHistory: [],
    }],
    updatedAt: "2026-05-06T00:00:00.000Z",
  };
  writeFileSync(join(dir, "progress.json"), JSON.stringify(progress, null, 2) + "\n", "utf8");

  const quality = {
    section: "home",
    dir: "src",
    viewport: "desktop",
    G1_status: g1,
    G4_token_usage: "PASS",
    G5_semantic_html: "PASS",
    G6_text_image_ratio: "PASS",
    G7_lighthouse: g7,
    G8_i18n: "PASS",
    G10_write_protection: "PASS",
    G11_layout_escapes: "PASS",
    G12_reusability: "PASS",
    G1_visual_regression: {
      status: g1,
      strictEffective: g1 === "PASS",
      viewports: {
        desktop: {
          status: g1,
          l2: {
            status: g1,
            anchorsMatched: 1,
            anchorsTotal: 1,
            requiredMatched: g1 === "PASS" ? 1 : 0,
            requiredTotal: 1,
          },
        },
      },
    },
  };
  writeFileSync(join(dir, "tests", "quality", "home.json"), JSON.stringify(quality, null, 2) + "\n", "utf8");
  return dir;
}

function run(cwd) {
  return spawnSync(process.execPath, [script, "--json"], { cwd, encoding: "utf8" });
}

test("passes when final verifier and progress gates pass", () => {
  const cwd = makeProject();
  mkdirSync(join(cwd, ".publish-harness"), { recursive: true });
  writeFileSync(join(cwd, ".publish-harness", "INCOMPLETE.json"), JSON.stringify({ status: "BLOCKED_INCOMPLETE" }), "utf8");
  const result = run(cwd);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "PASS");
  assert.equal(existsSync(join(cwd, ".publish-harness", "INCOMPLETE.json")), false);
});

test("fails when G1 is not passing even if normal build checks could pass", () => {
  const cwd = makeProject({ g1: "FAIL" });
  const result = run(cwd);
  assert.notEqual(result.status, 0);
  const json = JSON.parse(result.stdout);
  assert.equal(json.status, "FAIL");
  assert.match(json.message, /^BLOCKED\/INCOMPLETE/);
  assert.ok(json.failures.some((failure) => failure.code === "PUBLISHING_VERIFIER_NOT_PASSING"));
  const sentinel = JSON.parse(readFileSync(join(cwd, ".publish-harness", "INCOMPLETE.json"), "utf8"));
  assert.equal(sentinel.status, "BLOCKED_INCOMPLETE");
  assert.match(sentinel.requiredFinalPrefix, /^BLOCKED\/INCOMPLETE/);
  assert.ok(sentinel.forbiddenCompletionClaims.includes("\uBC18\uC601\uD588\uC2B5\uB2C8\uB2E4"));
  assert.match(sentinel.blockedIsTerminalOnlyWhen, /otherwise continue fixing/);
});

test("fails when G7 is skipped", () => {
  const cwd = makeProject({ g7: "SKIP" });
  const result = run(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /G7_NOT_PASS|PUBLISHING_VERIFIER_NOT_PASSING/);
});

test("fails when progress is not done", () => {
  const cwd = makeProject({ pageStatus: "pending", sectionStatus: "in_progress" });
  const result = run(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /PAGE_NOT_DONE/);
  assert.match(result.stdout, /SECTION_NOT_DONE/);
});

test("fails with explicit G1 refinement contract failures", () => {
  const cwd = makeProject({ pageStatus: "in_progress", sectionStatus: "iterating" });
  const progressPath = join(cwd, "progress.json");
  const progress = JSON.parse(readFileSync(progressPath, "utf8"));
  progress.sections[0].iteration = { outcome: "converging", latestL1: 11.8, attempts: 3 };
  writeFileSync(progressPath, JSON.stringify(progress, null, 2) + "\n", "utf8");

  const result = run(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /SECTION_G1_ITERATING/);
  const sentinel = JSON.parse(readFileSync(join(cwd, ".publish-harness", "INCOMPLETE.json"), "utf8"));
  assert.ok(sentinel.failures.some((failure) => failure.code === "SECTION_G1_ITERATING"));
});

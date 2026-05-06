import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const checkScript = resolve("scripts/check-write-protection.mjs");
const baselineScript = resolve("scripts/write-protection-baseline.mjs");

function makeProject() {
  const dir = mkdtempSync(join(tmpdir(), "g10-baseline-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "src", "styles"), { recursive: true });
  writeFileSync(join(dir, "scripts", "write-protected-paths.json"), JSON.stringify({
    version: 2,
    paths: ["src/styles/tokens.css"],
    protected_dirs: ["src/styles/"],
  }, null, 2) + "\n", "utf8");
  writeFileSync(join(dir, "src", "styles", "tokens.css"), ":root { --color: #000; }\n", "utf8");
  return dir;
}

function run(cwd, script, args = []) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
}

test("G10 uses baseline manifest when git HEAD does not exist", () => {
  const cwd = makeProject();
  assert.equal(run(cwd, baselineScript).status, 0);
  spawnSync("git", ["init", "-q"], { cwd });

  const result = run(cwd, checkScript);
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout);
  assert.equal(json.status, "PASS");
  assert.equal(json.mode, "baseline-manifest");
});

test("G10 baseline manifest detects protected file edits without git HEAD", () => {
  const cwd = makeProject();
  assert.equal(run(cwd, baselineScript).status, 0);
  spawnSync("git", ["init", "-q"], { cwd });
  writeFileSync(join(cwd, "src", "styles", "tokens.css"), ":root { --color: red; }\n", "utf8");

  const result = run(cwd, checkScript);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /src\/styles\/tokens\.css/);
  const json = JSON.parse(result.stdout);
  assert.equal(json.mode, "baseline-manifest");
  assert.equal(json.status, "FAIL");
});

test("G10 fails clearly when neither git HEAD nor baseline manifest exists", () => {
  const cwd = makeProject();
  spawnSync("git", ["init", "-q"], { cwd });

  const result = run(cwd, checkScript);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /NO_GIT_HEAD/);
  assert.match(result.stdout, /missing write-protection baseline manifest/);
});

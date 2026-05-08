import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const script = resolve("scripts/check-text-ratio.mjs");

function makeFixture(source) {
  const dir = mkdtempSync(join(tmpdir(), "g6-text-"));
  mkdirSync(join(dir, "src", "pages"), { recursive: true });
  writeFileSync(join(dir, "src", "pages", "Home.tsx"), source, "utf8");
  return dir;
}

test("fails raster page when text exists only in aria-hidden probe", () => {
  const cwd = makeFixture(`
export function Home(){
  return <main>
    <img src="./figma-section-home.png" alt="" aria-hidden="true" />
    <div className="font-text-probe" aria-hidden="true">Reusable text should not be counted from hidden probes.</div>
  </main>;
}
`);
  const result = spawnSync(process.execPath, [script, "src/pages"], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  const json = JSON.parse(result.stdout);
  assert.equal(json.g6, "FAIL");
  assert.equal(json.g8, "FAIL");
  assert.equal(json.textChars, 0);
});

test("counts visible JSX text for reusable DOM", () => {
  const cwd = makeFixture(`
export function Home(){
  return <main>
    <h1>Visible reusable heading</h1>
    <p>Visible paragraph copy rendered as DOM.</p>
  </main>;
}
`);
  const result = spawnSync(process.execPath, [script, "src/pages"], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout);
  assert.equal(json.g6, "PASS");
  assert.equal(json.g8, "PASS");
  assert.ok(json.textChars > 20);
});

test("ignores inline hidden text probes", () => {
  const cwd = makeFixture(`
export function Home(){
  return <main>
    <img src="./figma-section-home.png" alt="" aria-hidden="true" />
    <div style={{ opacity: 0 }}>Hidden probe text should not satisfy text gates.</div>
  </main>;
}
`);
  const result = spawnSync(process.execPath, [script, "src/pages"], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  const json = JSON.parse(result.stdout);
  assert.equal(json.textChars, 0);
  assert.equal(json.g6, "FAIL");
});

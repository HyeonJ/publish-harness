import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { PNG } from "pngjs";

const script = resolve("scripts/export-baseline-assets.mjs");

test("exports selected anchor crops from baseline PNG", () => {
  const cwd = mkdtempSync(join(tmpdir(), "baseline-assets-"));
  mkdirSync(join(cwd, "baselines", "hero"), { recursive: true });
  const png = new PNG({ width: 10, height: 10 });
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      const idx = (y * 10 + x) * 4;
      png.data[idx] = x * 20;
      png.data[idx + 1] = y * 20;
      png.data[idx + 2] = 0;
      png.data[idx + 3] = 255;
    }
  }
  writeFileSync(join(cwd, "baselines", "hero", "desktop.png"), PNG.sync.write(png));
  writeFileSync(join(cwd, "baselines", "hero", "anchors-desktop.json"), JSON.stringify({
    version: 2,
    section: "hero",
    viewport: "desktop",
    anchors: [
      { id: "hero/root", role: "section-root", required: true, bbox: { x: 0, y: 0, w: 10, h: 10 } },
      { id: "hero/image", role: "primary-media", required: true, bbox: { x: 2, y: 3, w: 4, h: 5 } },
    ],
  }, null, 2));

  const result = spawnSync(process.execPath, [script, "--section", "hero", "--ids", "hero/image", "--out-dir", "assets"], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const out = PNG.sync.read(readFileSync(join(cwd, "assets", "image.png")));
  assert.equal(out.width, 4);
  assert.equal(out.height, 5);
});

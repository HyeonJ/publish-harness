import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

for (const template of ["vite-react-ts", "nextjs-app-router", "html-static"]) {
  test(`${template} maps verify:publishing to completion contract`, () => {
    const pkg = JSON.parse(readFileSync(resolve("templates", template, "package.json"), "utf8"));
    assert.equal(pkg.scripts["verify:gates"], "node scripts/verify-publishing-complete.mjs");
    assert.equal(pkg.scripts["verify:publishing"], "node scripts/assert-completion-contract.mjs");
    assert.equal(pkg.scripts["complete:publishing"], "node scripts/assert-completion-contract.mjs");
  });
}

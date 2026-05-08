#!/usr/bin/env node
/**
 * Node entrypoint for bootstrap.sh. This lets Windows users start bootstrap
 * from PowerShell even when `bash` resolves to a broken WSL launcher.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const launcher = join(__dirname, "run-bash-script.mjs");
const bootstrap = join(__dirname, "bootstrap.sh");

const result = spawnSync(process.execPath, [launcher, bootstrap, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);

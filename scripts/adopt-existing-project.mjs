#!/usr/bin/env node
/**
 * Adopt an existing project into publish-harness without copying an app
 * template over user files.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { agent: "codex", mode: "figma", template: "vite-react-ts" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      opts[key] = next;
      i++;
    } else {
      opts[key] = true;
    }
  }
  return opts;
}

function copyIfMissing(src, dst) {
  if (!existsSync(src) || existsSync(dst)) return false;
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  return true;
}

function copyRequired(src, dst) {
  if (!existsSync(src)) throw new Error(`missing harness file: ${src}`);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
}

function renderProjectContext({ projectName, mode, template, figmaUrl, fileKey }) {
  return `# Project Context

project: ${projectName}
mode: ${mode}
template: ${template}
figma_url: ${figmaUrl || "N/A"}
file_key: ${fileKey || "N/A"}
preview_base_url: http://127.0.0.1:5173

## Adoption Note

This project was adopted into publish-harness after files already existed.
Do not treat template direct-copy as a completed bootstrap. Keep progress,
route discovery, reusable React structure, and gate results current.
`;
}

const opts = parseArgs(process.argv.slice(2));
const cwd = process.cwd();
const harnessDir = resolve(opts["harness-dir"] || process.env.HARNESS_DIR || join(__dirname, ".."));
const packagePath = join(cwd, "package.json");
const packageName = existsSync(packagePath)
  ? JSON.parse(readFileSync(packagePath, "utf8")).name
  : null;
const projectName = opts["project-name"] || packageName || cwd.split(/[\\/]/).filter(Boolean).at(-1);
const figmaUrl = opts["figma-url"] || "";
let fileKey = opts["file-key"] || "";
if (!fileKey && figmaUrl) {
  const match = figmaUrl.match(/figma\.com\/(?:design|file)\/([^/]+)/);
  if (match) fileKey = match[1];
}

const scripts = [
  "_lib/anchor-manifest.mjs",
  "_lib/color-tokens.mjs",
  "_lib/escape-detect.mjs",
  "_lib/escape-runtime-sweep.mjs",
  "_lib/legacy-manifest.mjs",
  "_lib/load-figma-token.sh",
  "_lib/node-shim.sh",
  "_lib/playwright-stable.mjs",
  "_lib/progress-store.mjs",
  "_lib/text-ratio-judge.mjs",
  "_lib/walk.mjs",
  "adopt-existing-project.mjs",
  "assemble-page-preview.mjs",
  "check-layout-escapes.mjs",
  "check-legacy-additions.mjs",
  "check-react-reusability.mjs",
  "check-text-ratio-html.mjs",
  "check-text-ratio.mjs",
  "check-token-usage-html.mjs",
  "check-token-usage.mjs",
  "check-visual-regression.mjs",
  "check-write-protection.mjs",
  "discover-figma-pages.mjs",
  "doctor.sh",
  "extract-figma-anchors.mjs",
  "extract-text-content.mjs",
  "figma-rest-image.sh",
  "measure-quality.sh",
  "migrate-baselines.mjs",
  "next.mjs",
  "prepare-baseline.mjs",
  "progress-render.mjs",
  "progress-update.mjs",
  "setup-figma-token.sh",
  "status.mjs",
  "why.mjs",
  "write-protected-paths.json",
];

for (const script of scripts) {
  copyRequired(join(harnessDir, "scripts", script), join(cwd, "scripts", script));
}

copyRequired(join(harnessDir, "docs", "workflow.md"), join(cwd, "docs", "workflow.md"));
copyRequired(join(harnessDir, "docs", "team-playbook.md"), join(cwd, "docs", "team-playbook.md"));
copyRequired(join(harnessDir, "docs", "responsive-figma-generator.md"), join(cwd, "docs", "responsive-figma-generator.md"));
copyRequired(join(harnessDir, "docs", "reusable-react-publishing.md"), join(cwd, "docs", "reusable-react-publishing.md"));
copyRequired(join(harnessDir, "docs", "windows-command-policy.md"), join(cwd, "docs", "windows-command-policy.md"));
copyIfMissing(join(harnessDir, "docs", "publishing-log.md.tmpl"), join(cwd, "docs", "publishing-log.md"));
copyIfMissing(join(harnessDir, "docs", "codex-section-worker.md"), join(cwd, "docs", "codex-section-worker.md"));
copyIfMissing(join(harnessDir, "docs", "codex-model-policy.md"), join(cwd, "docs", "codex-model-policy.md"));

if (!existsSync(join(cwd, "docs", "project-context.md"))) {
  mkdirSync(join(cwd, "docs"), { recursive: true });
  writeFileSync(join(cwd, "docs", "project-context.md"), renderProjectContext({
    projectName,
    mode: opts.mode,
    template: opts.template,
    figmaUrl,
    fileKey,
  }));
}

if (opts.agent === "codex" || opts.agent === "both") {
  copyIfMissing(join(harnessDir, "AGENTS.md"), join(cwd, "AGENTS.md"));
}
if (opts.agent === "claude" || opts.agent === "both") {
  copyIfMissing(join(harnessDir, "CLAUDE.md"), join(cwd, "CLAUDE.md"));
}

if (!existsSync(join(cwd, "progress.json"))) {
  const args = [
    join(cwd, "scripts", "progress-update.mjs"),
    "init",
    "--name", projectName,
    "--mode", opts.mode,
    "--template", opts.template,
  ];
  if (figmaUrl) args.push("--figma-url", figmaUrl);
  if (fileKey) args.push("--file-key", fileKey);
  const init = spawnSync(process.execPath, args, { cwd, stdio: "inherit" });
  if (init.status !== 0) process.exit(init.status || 1);
}

const render = spawnSync(process.execPath, [join(cwd, "scripts", "progress-render.mjs")], { cwd, stdio: "inherit" });
if (render.status !== 0) process.exit(render.status || 1);

if (fileKey && !existsSync(join(cwd, "docs", "figma-pages.md"))) {
  spawnSync(process.execPath, [
    join(cwd, "scripts", "discover-figma-pages.mjs"),
    "--file-key", fileKey,
    "--out", "docs/figma-pages.md",
    "--apply",
  ], { cwd, stdio: "inherit", env: process.env });
}

console.log("publish-harness adoption complete.");

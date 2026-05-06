#!/usr/bin/env node
/**
 * Create a file-hash baseline for G10 write-protection.
 *
 * This is used when a freshly bootstrapped project cannot create an initial git
 * commit because user.name/user.email is not configured. G10 can still compare
 * protected files against this manifest instead of relying only on HEAD.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

function parseArgs(argv) {
  const opts = {
    paths: "scripts/write-protected-paths.json",
    out: ".publish-harness/write-protection-baseline.json",
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--paths") opts.paths = argv[++i];
    else if (argv[i] === "--out") opts.out = argv[++i];
    else if (argv[i] === "-h" || argv[i] === "--help") {
      console.error("usage: write-protection-baseline.mjs [--paths <json>] [--out <json>]");
      process.exit(2);
    } else {
      console.error(`ERROR: unknown arg: ${argv[i]}`);
      process.exit(2);
    }
  }
  return opts;
}

function normalize(path) {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

function loadProtected(path) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  return {
    paths: Array.isArray(data.paths) ? data.paths.map(normalize) : [],
    protectedDirs: Array.isArray(data.protected_dirs) ? data.protected_dirs.map(normalize) : [],
  };
}

const opts = parseArgs(process.argv.slice(2));
const root = process.cwd();
const protectedConfig = loadProtected(opts.paths);
const tracked = new Set();

for (const path of protectedConfig.paths) {
  if (existsSync(path)) tracked.add(normalize(path));
}
for (const dir of protectedConfig.protectedDirs) {
  for (const file of walk(dir)) {
    tracked.add(normalize(relative(root, file)));
  }
}

const files = {};
for (const path of [...tracked].sort()) {
  if (existsSync(path) && statSync(path).isFile()) {
    files[path] = { sha256: sha256(path) };
  }
}

const manifest = {
  version: 1,
  createdAt: new Date().toISOString(),
  createdBy: "publish-harness",
  protectedConfig: normalize(opts.paths),
  files,
};

mkdirSync(dirname(opts.out), { recursive: true });
writeFileSync(opts.out, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ status: "PASS", out: opts.out, files: Object.keys(files).length }, null, 2));

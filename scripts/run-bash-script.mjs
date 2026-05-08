#!/usr/bin/env node
/**
 * Windows-safe Bash launcher for publish-harness shell gates.
 *
 * Some Windows hosts resolve `bash` to the WSL launcher even when no Linux
 * distribution is installed. This wrapper verifies that a candidate can run a
 * tiny shell command, then executes the requested script with that Bash.
 */

import { existsSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const OK_MARKER = "__publish_harness_bash_ok__";

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function splitPathEnv(value) {
  return value ? value.split(delimiter).filter(Boolean) : [];
}

function pathCandidatesFromWhere(command) {
  const result = spawnSync("where.exe", [command], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function gitRootFromGitExe(gitExe) {
  const dir = dirname(gitExe);
  if (/\\cmd$/i.test(dir) || /\/cmd$/i.test(dir)) return dirname(dir);
  if (/\\bin$/i.test(dir) || /\/bin$/i.test(dir)) return dirname(dir);
  return null;
}

function bashCandidates() {
  const envCandidates = [
    process.env.PUBLISH_HARNESS_BASH,
    process.env.HARNESS_BASH,
    process.env.BASH,
  ];

  if (process.platform !== "win32") {
    return unique([...envCandidates, "bash"]);
  }

  const programFiles = [
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs"),
  ].filter(Boolean);

  const gitRoots = pathCandidatesFromWhere("git")
    .map(gitRootFromGitExe)
    .filter(Boolean);

  const gitBashes = unique([...programFiles.map((base) => join(base, "Git")), ...gitRoots])
    .flatMap((root) => [
      join(root, "bin", "bash.exe"),
      join(root, "usr", "bin", "bash.exe"),
    ]);

  const pathBashes = [
    ...pathCandidatesFromWhere("bash"),
    ...splitPathEnv(process.env.PATH).map((entry) => join(entry, "bash.exe")),
  ];

  return unique([
    ...envCandidates,
    ...gitBashes,
    ...pathBashes,
    "bash",
  ]);
}

function works(candidate) {
  const result = spawnSync(candidate, ["-lc", `printf ${OK_MARKER}`], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0 && result.stdout.includes(OK_MARKER);
}

function findBash() {
  const attempted = [];
  for (const candidate of bashCandidates()) {
    if (candidate.includes("\\") || candidate.includes("/")) {
      if (!existsSync(candidate)) continue;
    }
    attempted.push(candidate);
    if (works(candidate)) return { bash: candidate, attempted };
  }
  return { bash: null, attempted };
}

function normalizeScriptArg(scriptArg) {
  if (process.platform !== "win32") return scriptArg;
  const resolved = isAbsolute(scriptArg) ? scriptArg : resolve(process.cwd(), scriptArg);
  return resolved.replaceAll("\\", "/");
}

const [scriptArg, ...scriptArgs] = process.argv.slice(2);
if (!scriptArg) {
  console.error("usage: node scripts/run-bash-script.mjs <script.sh> [...args]");
  process.exit(2);
}

const { bash, attempted } = findBash();
if (!bash) {
  console.error("publish-harness could not find a working Bash.");
  if (attempted.length) {
    console.error(`Attempted: ${attempted.join(", ")}`);
  }
  if (process.platform === "win32") {
    console.error("Install Git for Windows, then reopen the terminal:");
    console.error("  winget install --id Git.Git -e --source winget");
    console.error("Or set PUBLISH_HARNESS_BASH to the full bash.exe path, for example:");
    console.error('  $env:PUBLISH_HARNESS_BASH="C:\\Program Files\\Git\\bin\\bash.exe"');
  } else {
    console.error("Install bash with your system package manager and rerun the command.");
  }
  process.exit(127);
}

const result = spawnSync(bash, [normalizeScriptArg(scriptArg), ...scriptArgs], {
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

#!/usr/bin/env node
/**
 * Final completion contract guard.
 *
 * This is intentionally stricter than build/lint/route smoke checks. A
 * publishing worker may only report completion after this script exits 0.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REQUIRED_FINAL_PREFIX = "BLOCKED/INCOMPLETE: publish-harness completion contract failed.";
const FORBIDDEN_COMPLETION_CLAIMS = [
  "completed",
  "done",
  "finished",
  "implemented",
  "published",
  "\uC644\uB8CC",
  "\uC644\uB8CC\uD588\uC2B5\uB2C8\uB2E4",
  "\uAD6C\uD604 \uC644\uB8CC",
  "\uD37C\uBE14\uB9AC\uC2F1 \uC644\uB8CC",
  "\uBC18\uC601\uD588\uC2B5\uB2C8\uB2E4",
];
const BLOCKED_POLICY = "external blocker or explicit user stop; otherwise continue fixing until completion contract passes";
const sentinelPath = join(process.cwd(), ".publish-harness", "INCOMPLETE.json");

function parseArgs(argv) {
  const opts = { json: false, allowG7Skip: process.env.ALLOW_G7_SKIP === "1" };
  for (const arg of argv) {
    if (arg === "--json") opts.json = true;
    if (arg === "--allow-g7-skip") opts.allowG7Skip = true;
  }
  return opts;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fail(failures, code, message, file = null) {
  failures.push({ code, message, ...(file ? { file } : {}) });
}

function writeIncompleteSentinel(result) {
  mkdirSync(join(process.cwd(), ".publish-harness"), { recursive: true });
  writeFileSync(sentinelPath, JSON.stringify({
    status: "BLOCKED_INCOMPLETE",
    requiredFinalPrefix: REQUIRED_FINAL_PREFIX,
    forbiddenCompletionClaims: FORBIDDEN_COMPLETION_CLAIMS,
    blockedIsTerminalOnlyWhen: BLOCKED_POLICY,
    message: result.message,
    failures: result.failures,
    warnings: result.warnings,
    updatedAt: new Date().toISOString(),
  }, null, 2) + "\n", "utf8");
}

function clearIncompleteSentinel() {
  rmSync(sentinelPath, { force: true });
}

const opts = parseArgs(process.argv.slice(2));
const failures = [];
const warnings = [];

const verifierArgs = ["scripts/verify-publishing-complete.mjs", "--json"];
if (opts.allowG7Skip) verifierArgs.push("--allow-g7-skip");
const verifier = spawnSync(process.execPath, verifierArgs, { cwd: process.cwd(), encoding: "utf8" });
if (verifier.error) {
  fail(failures, "VERIFIER_EXEC_ERROR", `Could not run verify-publishing-complete.mjs: ${verifier.error.message}`, "scripts/verify-publishing-complete.mjs");
}
if (verifier.stderr?.trim()) {
  warnings.push({
    code: "VERIFIER_STDERR",
    message: verifier.stderr.trim(),
  });
}

let verifierJson = null;
try {
  verifierJson = JSON.parse(verifier.stdout || "{}");
} catch {
  fail(failures, "VERIFIER_OUTPUT_INVALID", "verify-publishing-complete.mjs did not emit valid JSON.", "scripts/verify-publishing-complete.mjs");
}

if (!failures.some((item) => item.code === "VERIFIER_EXEC_ERROR") && (verifier.status !== 0 || verifierJson?.status !== "PASS")) {
  fail(
    failures,
    "PUBLISHING_VERIFIER_NOT_PASSING",
    "Publishing is incomplete. Do not report completion until node scripts/verify-publishing-complete.mjs exits 0.",
    "scripts/verify-publishing-complete.mjs",
  );
  for (const item of verifierJson?.failures || []) failures.push({ ...item, source: "verify-publishing-complete" });
  for (const item of verifierJson?.warnings || []) warnings.push({ ...item, source: "verify-publishing-complete" });
}

if (!existsSync(join(process.cwd(), "progress.json"))) {
  fail(failures, "MISSING_PROGRESS", "progress.json is required before completion.", "progress.json");
} else {
  try {
    const progress = readJson(join(process.cwd(), "progress.json"));
    for (const page of progress.pages || []) {
      if (page.status !== "skipped" && page.status !== "done") {
        fail(failures, "PAGE_NOT_DONE", `Page "${page.name}" is ${page.status || "MISSING"}.`, "progress.json");
      }
    }
    for (const section of progress.sections || []) {
      if (section.status !== "skipped" && section.status !== "done") {
        fail(failures, "SECTION_NOT_DONE", `Section "${section.name}" is ${section.status || "MISSING"}.`, "progress.json");
      }
      if (section.status === "done" && section.lastGateResult?.passed !== true) {
        fail(failures, "SECTION_DONE_WITHOUT_PASSING_GATES", `Section "${section.name}" is done but lastGateResult.passed is not true.`, "progress.json");
      }
    }
  } catch (error) {
    fail(failures, "INVALID_PROGRESS", `progress.json could not be read: ${error.message}`, "progress.json");
  }
}

if (!existsSync(join(process.cwd(), "docs", "publishing-log.md"))) {
  fail(failures, "MISSING_PUBLISHING_LOG", "docs/publishing-log.md is required before completion.", "docs/publishing-log.md");
}

if (existsSync(sentinelPath) && failures.length === 0) {
  try {
    const sentinel = readJson(sentinelPath);
    if (sentinel?.status === "BLOCKED_INCOMPLETE") {
      warnings.push({
        code: "STALE_INCOMPLETE_SENTINEL_CLEARED",
        message: ".publish-harness/INCOMPLETE.json existed but all completion checks now pass; sentinel was cleared.",
      });
    }
  } catch {
    warnings.push({
      code: "INVALID_INCOMPLETE_SENTINEL_CLEARED",
      message: ".publish-harness/INCOMPLETE.json was invalid but all completion checks now pass; sentinel was cleared.",
    });
  }
}

const result = {
  status: failures.length ? "FAIL" : "PASS",
  message: failures.length
    ? `${REQUIRED_FINAL_PREFIX} Do not make completion claims. Blocked is not a terminal state unless there is an external blocker or explicit user stop; continue fixing gate/verifier failures first.`
    : "Publishing completion contract passed.",
  failures,
  warnings,
};

if (failures.length) {
  writeIncompleteSentinel(result);
} else {
  clearIncompleteSentinel();
}

if (opts.json) {
  console.log(JSON.stringify(result, null, 2));
} else if (failures.length) {
  console.error(result.message);
  console.error(`Required final response prefix: ${REQUIRED_FINAL_PREFIX}`);
  console.error(`Blocked is terminal only when: ${BLOCKED_POLICY}`);
  for (const item of failures) {
    console.error(`- [${item.code}] ${item.message}${item.file ? ` (${item.file})` : ""}`);
  }
  for (const item of warnings) {
    console.error(`- [warning:${item.code}] ${item.message}`);
  }
} else {
  console.log(result.message);
}

process.exit(failures.length ? 1 : 0);

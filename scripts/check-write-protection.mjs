#!/usr/bin/env node
/**
 * G10 — write-protected paths 게이트.
 *
 * Usage:
 *   node scripts/check-write-protection.mjs [options]
 *     --paths <json>   SSoT JSON 경로 (default: scripts/write-protected-paths.json)
 *     --base <commit>  비교 기준 (default: HEAD)
 *     --head <commit>  검사 대상 (생략 시 working tree)
 *
 * 동작:
 *   - 기본: working tree 의 변경 (staged + unstaged + commit since base) 을 HEAD 기준 검사
 *   - --base / --head 동시 명시 시 두 commit 사이 diff 검사
 *
 * 종료 코드: 0 PASS, 1 FAIL, 2 usage error.
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    paths: "scripts/write-protected-paths.json",
    base: "HEAD",
    head: null,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--paths") opts.paths = args[++i];
    else if (args[i] === "--base") opts.base = args[++i];
    else if (args[i] === "--head") opts.head = args[++i];
    else if (args[i] === "-h" || args[i] === "--help") {
      console.error("usage: check-write-protection.mjs [--paths <json>] [--base <commit>] [--head <commit>]");
      process.exit(2);
    } else {
      console.error(`ERROR: unknown arg: ${args[i]}`);
      process.exit(2);
    }
  }
  return opts;
}

function loadProtected(jsonPath) {
  let data;
  try {
    data = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch (e) {
    console.error(`ERROR: cannot read SSoT JSON ${jsonPath}: ${e.message}`);
    process.exit(2);
  }
  if (!Array.isArray(data.paths)) {
    console.error(`ERROR: invalid SSoT — 'paths' must be array`);
    process.exit(2);
  }
  // schema v2 (B-2): protected_dirs — 안 신규 파일 추가 차단 (sneak path 봉쇄).
  // schema v1 호환 — protected_dirs 부재 시 빈 배열.
  const protectedDirs = Array.isArray(data.protected_dirs)
    ? data.protected_dirs.map((d) => d.replace(/\\/g, "/"))
    : [];
  return {
    paths: new Set(data.paths.map((p) => p.replace(/\\/g, "/"))),
    protectedDirs,
  };
}

function git(args) {
  try {
    return execSync(`git ${args}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    return "";
  }
}

function changedFiles(base, head) {
  let lines;
  if (head) {
    // 두 commit 사이 명시 비교
    lines = git(`diff ${base} ${head} --name-only`).split("\n");
  } else {
    // working tree 케이스: git status --porcelain 한 번으로 staged + unstaged + untracked 모두 커버.
    // base 가 HEAD 가 아니면 base..HEAD 의 commit 변경도 추가로 합산.
    const status = git("status --porcelain=v1").split("\n");
    const fromStatus = status
      .map((s) => s.replace(/^.{2}\s+/, ""))
      .flatMap((s) => (s.includes(" -> ") ? s.split(" -> ") : [s]));
    const fromBase = base !== "HEAD" ? git(`diff ${base} HEAD --name-only`).split("\n") : [];
    lines = [...fromStatus, ...fromBase];
  }
  return new Set(lines.map((s) => s.trim().replace(/\\/g, "/")).filter(Boolean));
}

function main() {
  const opts = parseArgs();
  const { paths: protectedSet, protectedDirs } = loadProtected(opts.paths);
  const changed = changedFiles(opts.base, opts.head);

  // 1) exact match (schema v1 호환) — 정확 path 가 changed 에 있으면 violation
  const exactViolations = [...protectedSet].filter((p) => changed.has(p));
  // 2) protected_dirs (schema v2) — 안 신규 파일 추가 차단
  //    changed 의 path 가 protected_dir 안에 있으면서 protectedSet 의 exact path 가 아니면 violation
  //    (sneak path: tokens.css 옆에 section-vars.css 같은 신규 파일 추가)
  const dirViolations = [...changed].filter((c) =>
    protectedDirs.some((d) => c.startsWith(d) && !protectedSet.has(c))
  );
  const violations = [...new Set([...exactViolations, ...dirViolations])];

  const report = {
    base: opts.base,
    head: opts.head ?? "WORKING_TREE",
    protected_count: protectedSet.size,
    protected_dirs_count: protectedDirs.length,
    changed_count: changed.size,
    violations,
    status: violations.length === 0 ? "PASS" : "FAIL",
  };
  console.log(JSON.stringify(report, null, 2));

  if (violations.length > 0) {
    const exactList = exactViolations.length ? exactViolations.map((v) => `  - ${v} (exact protected)`).join("\n") : "";
    const dirList = dirViolations.length ? dirViolations.map((v) => `  - ${v} (sneak path — protected dir 안 신규 파일)`).join("\n") : "";
    console.error(
      `\n❌ G10 FAIL — write-protected paths 변경 발견 (${violations.length}):\n` +
        [exactList, dirList].filter(Boolean).join("\n") +
        `\n워커 §금지 위반. 정당한 변경이면 오케스트레이터 직접 수정.`,
    );
    process.exit(1);
  }
  console.error(`✓ G10 PASS — write-protected paths/dirs 변경 없음`);
  process.exit(0);
}

main();

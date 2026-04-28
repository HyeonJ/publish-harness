#!/usr/bin/env node
/**
 * check-legacy-additions.mjs — CI 용.
 * PR diff 검사: 신규 legacy.json 추가 + 코드 변경(.tsx/.jsx 등) 동시 포함이면 FAIL.
 *
 * Usage (CI):
 *   node scripts/check-legacy-additions.mjs --base origin/main --head HEAD
 */

import { execSync } from "node:child_process";

function parseArgs(argv) {
  const o = { base: "origin/main", head: "HEAD" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { o[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  return o;
}
const opts = parseArgs(process.argv.slice(2));

let added, changed;
try {
  added = execSync(`git diff --diff-filter=A --name-only ${opts.base}..${opts.head}`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  changed = execSync(`git diff --name-only ${opts.base}..${opts.head}`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
} catch (e) {
  console.error(`ERROR: git diff failed (${e.message.split("\n")[0]})`);
  process.exit(2);
}

const addedLegacy = added.filter((f) => /^baselines\/[^/]+\/legacy\.json$/.test(f));
const codeChanges = changed.filter((f) =>
  /\.(tsx|jsx|ts|js|css|html)$/.test(f) ||
  /^src\//.test(f) ||
  /^public\//.test(f)
);

if (addedLegacy.length === 0) {
  console.log(JSON.stringify({ status: "PASS", reason: "no new legacy.json" }));
  process.exit(0);
}

if (codeChanges.length === 0) {
  console.log(JSON.stringify({ status: "PASS", reason: "migration-only PR (legacy added but no code changes)", addedLegacy }));
  process.exit(0);
}

console.log(JSON.stringify({
  status: "FAIL",
  reason: "구현 PR 에 신규 legacy.json 추가 — migrate-baselines 단독 PR 로 분리하세요",
  addedLegacy,
  codeChanges: codeChanges.slice(0, 10),
}));
process.exit(1);

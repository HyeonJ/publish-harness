#!/usr/bin/env node
import { read } from './_lib/progress-store.mjs';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function aggregate({ progress, gitStatus = '', gateResults = {} }) {
  const sections = progress.sections;
  const totals = {
    sections: sections.length,
    done: sections.filter((s) => s.status === 'done').length,
    pending: sections.filter((s) => s.status === 'pending').length,
    in_progress: sections.filter((s) => s.status === 'in_progress').length,
    blocked: sections.filter((s) => s.status === 'blocked' || s.needsHuman).length,
    skipped: sections.filter((s) => s.status === 'skipped').length,
  };

  const blockers = [];
  for (const s of sections) {
    if (s.status === 'blocked' || s.needsHuman) {
      blockers.push({
        kind: 'section_blocked',
        section: s.name,
        retryCount: s.retryCount,
        lastCategories: s.failureHistory.at(-1)?.categories || [],
      });
    }
  }
  if (
    progress.phase.current === 1 &&
    !progress.project.source?.fileKey &&
    progress.project.mode === 'figma' &&
    (progress.pages.length > 0 || progress.sections.length > 0)
  ) {
    blockers.push({ kind: 'missing_token_source', message: 'figma 모드인데 fileKey 없음 → bootstrap 미완' });
  }

  const nextActionable = sections.filter((s) => s.status === 'pending' || s.status === 'in_progress');

  // phase recommendation
  let recommendedPhase = progress.phase.current;
  if (totals.sections > 0 && totals.done === totals.sections - totals.skipped) {
    recommendedPhase = 4;
  }

  return {
    phase: progress.phase,
    recommendedPhase,
    totals,
    blockers,
    canProceed: blockers.length === 0,
    nextActionable: nextActionable.slice(0, 5),
    git: {
      dirty: gitStatus.trim().length > 0,
      raw: gitStatus.trim(),
    },
    gateResults,
    project: progress.project,
    updatedAt: progress.updatedAt,
  };
}

function readGateResults(cwd) {
  const dir = join(cwd, 'tests/quality');
  if (!existsSync(dir)) return {};
  const out = {};
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      out[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    } catch {}
  }
  return out;
}

// CLI entry — Windows-safe self-detect
if (process.argv[1] && process.argv[1].endsWith('status.mjs')) {
  const cwd = process.cwd();
  const progress = read(join(cwd, 'progress.json'));
  let gitStatus = '';
  try { gitStatus = execSync('git status --porcelain', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch {}
  const gateResults = readGateResults(cwd);
  const result = aggregate({ progress, gitStatus, gateResults });

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    // human-readable summary
    const p = result.project;
    console.log(`📍 ${p.name} [${p.mode}/${p.template}]  Phase ${result.phase.current} (recommended: ${result.recommendedPhase})`);
    console.log(`   섹션: ${result.totals.done}/${result.totals.sections} done · ${result.totals.in_progress} in-progress · ${result.totals.blocked} blocked`);
    if (result.blockers.length) {
      console.log(`   ⚠ blockers:`);
      for (const b of result.blockers) console.log(`     - ${b.kind}${b.section ? `: ${b.section}` : ''}`);
    }
    if (result.nextActionable.length) {
      console.log(`   ▶ 다음:`);
      for (const s of result.nextActionable.slice(0, 3)) console.log(`     - ${s.name} (${s.status})`);
    }
    if (result.git.dirty) console.log(`   📝 작업 트리 변경 있음`);
  }
}

#!/usr/bin/env node
import { read } from './_lib/progress-store.mjs';
import { aggregate } from './status.mjs';
import { diagnose } from './why.mjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function suggest({ progress, env = {}, cwd = process.cwd() }) {
  if (!progress) {
    return { action: 'bash scripts/bootstrap.sh <figma-url>', code: 'BOOTSTRAP', target: null };
  }
  const diag = diagnose({ progress, env, cwd });
  if (diag.code !== 'OK_PROCEED' && diag.code !== 'OK_NEXT_PHASE') {
    return { action: diag.recommendations[0] || diag.message, code: diag.code, target: null };
  }
  if (diag.code === 'OK_NEXT_PHASE') {
    return {
      action: `Phase ${progress.phase.current + 1} (통합 검증) 진입`,
      code: 'PHASE_TRANSITION',
      target: progress.phase.current + 1,
    };
  }
  // OK_PROCEED → 다음 actionable
  const status = aggregate({ progress, gitStatus: '', gateResults: {} });
  const next = status.nextActionable[0];
  if (!next) {
    return { action: 'progress-update add-section 으로 작업 단위 추가 필요', code: 'EMPTY_QUEUE', target: null };
  }
  return {
    action: `다음 작업: '${next.name}' (${next.kind}, page=${next.page || 'none'}, status=${next.status}). section-worker 스폰.`,
    code: 'WORK_NEXT',
    target: next.name,
  };
}

if (process.argv[1] && process.argv[1].endsWith('next.mjs')) {
  const cwd = process.cwd();
  const progressPath = join(cwd, 'progress.json');
  const progress = existsSync(progressPath) ? read(progressPath) : null;
  const out = suggest({ progress, env: process.env, cwd });

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`▶ ${out.action}`);
  }
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnose } from '../../scripts/why.mjs';
import { readFileSync } from 'node:fs';

function load(name) {
  return JSON.parse(readFileSync(new URL(`./fixtures/scenarios/${name}/progress.json`, import.meta.url), 'utf8'));
}

test('diagnose missing progress.json', () => {
  const d = diagnose({ progress: null, env: {} });
  assert.equal(d.code, 'BOOTSTRAP_REQUIRED');
});

test('diagnose figma mode missing FIGMA_TOKEN', () => {
  const d = diagnose({ progress: load('empty'), env: {} });
  assert.equal(d.code, 'FIGMA_TOKEN_MISSING');
});

test('diagnose phase2 with no pages', () => {
  const fx = load('empty');
  fx.phase.current = 2;
  fx.project.mode = 'spec';
  fx.project.source = { fileKey: 'X' };
  const d = diagnose({ progress: fx, env: { FIGMA_TOKEN: 'x' } });
  assert.equal(d.code, 'DECOMPOSE_REQUIRED');
});

test('diagnose blocked section with repeated category triggers anti-loop', () => {
  const fx = load('empty');
  fx.phase.current = 3;
  fx.project.mode = 'spec';
  fx.project.source = { fileKey: 'X' };
  fx.sections = [{
    name: 'Bad', page: null, kind: 'component', status: 'blocked',
    retryCount: 3, needsHuman: true, lastGateResult: null,
    failureHistory: [
      { attempt: 0, categories: ['TOKEN_DRIFT'], count: 3 },
      { attempt: 1, categories: ['TOKEN_DRIFT'], count: 3 },
      { attempt: 2, categories: ['TOKEN_DRIFT'], count: 3 },
    ],
  }];
  const d = diagnose({ progress: fx, env: { FIGMA_TOKEN: 'x' } });
  assert.equal(d.code, 'ANTI_LOOP_TRIGGERED');
  assert.match(d.recommendations.join(' '), /재분할/);
});

test('diagnose all-done returns OK_NEXT_PHASE', () => {
  const fx = load('all-done');
  fx.phase.current = 3;
  fx.phase.completed = [1, 2];
  fx.project.mode = 'spec';
  const d = diagnose({ progress: fx, env: { FIGMA_TOKEN: 'x' } });
  assert.equal(d.code, 'OK_NEXT_PHASE');
});

test('diagnose phase3-mid with normal pending → OK_PROCEED', () => {
  const fx = load('phase3-mid');
  fx.project.mode = 'spec';
  const d = diagnose({ progress: fx, env: { FIGMA_TOKEN: 'x' } });
  assert.equal(d.code, 'OK_PROCEED');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggest } from '../../scripts/next.mjs';
import { readFileSync } from 'node:fs';

function load(name) {
  return JSON.parse(readFileSync(new URL(`./fixtures/scenarios/${name}/progress.json`, import.meta.url), 'utf8'));
}

test('suggest empty → bootstrap', () => {
  const out = suggest({ progress: load('empty'), env: {} });
  assert.match(out.action, /figma[_-]?token/i);
});

test('suggest phase3-mid → next pending section', () => {
  const fx = load('phase3-mid');
  fx.project.mode = 'spec';
  const out = suggest({ progress: fx, env: { FIGMA_TOKEN: 'x' } });
  assert.match(out.action, /home-features/);
  assert.equal(out.target, 'home-features');
});

test('suggest all-done → integrate phase', () => {
  const fx = load('all-done');
  fx.phase.current = 3;
  fx.phase.completed = [1, 2];
  fx.project.mode = 'spec';
  const out = suggest({ progress: fx, env: { FIGMA_TOKEN: 'x' } });
  assert.match(out.action, /Phase 4|통합/);
});

test('suggest blocked → human intervention', () => {
  const fx = load('phase3-blocked');
  fx.project.mode = 'spec';
  const out = suggest({ progress: fx, env: { FIGMA_TOKEN: 'x' } });
  assert.match(out.action, /재분할|수동|개입|blocked|재시도|skipped/i);
});

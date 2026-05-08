import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from '../../scripts/status.mjs';
import { readFileSync } from 'node:fs';

function load(name) {
  return JSON.parse(readFileSync(new URL(`./fixtures/scenarios/${name}/progress.json`, import.meta.url), 'utf8'));
}

test('aggregate empty → phase 1 in_progress, no sections', () => {
  const s = aggregate({ progress: load('empty'), gitStatus: '', gateResults: {} });
  assert.equal(s.phase.current, 1);
  assert.equal(s.totals.sections, 0);
  assert.equal(s.totals.done, 0);
  assert.equal(s.canProceed, true);
});

test('aggregate phase3-mid → 1 done / 1 pending', () => {
  const s = aggregate({ progress: load('phase3-mid'), gitStatus: '', gateResults: {} });
  assert.equal(s.totals.sections, 2);
  assert.equal(s.totals.done, 1);
  assert.equal(s.totals.pending, 1);
  assert.equal(s.nextActionable[0].name, 'home-features');
});

test('aggregate phase3-blocked → canProceed false, blockers listed', () => {
  const s = aggregate({ progress: load('phase3-blocked'), gitStatus: '', gateResults: {} });
  assert.equal(s.canProceed, false);
  assert.ok(s.blockers.length >= 1);
  assert.equal(s.blockers[0].kind, 'section_blocked');
});

test('aggregate all-done → phase 4', () => {
  const s = aggregate({ progress: load('all-done'), gitStatus: '', gateResults: {} });
  assert.equal(s.totals.done, s.totals.sections);
  assert.equal(s.recommendedPhase, 4);
});

test('aggregate detects uncommitted changes from gitStatus', () => {
  const s = aggregate({ progress: load('phase3-mid'), gitStatus: ' M src/components/sections/home/HomeHero.tsx', gateResults: {} });
  assert.equal(s.git.dirty, true);
});

test('aggregate exposes iterating sections as actionable and stalled sections as blockers', () => {
  const fx = load('phase3-mid');
  fx.sections[1].status = 'iterating';
  fx.sections[1].iteration = { outcome: 'converging', latestL1: 12.5, attempts: 2 };
  const iterating = aggregate({ progress: fx, gitStatus: '', gateResults: {} });
  assert.equal(iterating.totals.iterating, 1);
  assert.equal(iterating.totals.in_progress, 0);
  assert.equal(iterating.nextActionable[0].name, 'home-features');
  assert.equal(iterating.canProceed, true);

  fx.sections[1].status = 'stalled';
  fx.sections[1].needsHuman = true;
  fx.sections[1].iteration = { outcome: 'stalled', latestL1: 12.1, attempts: 5 };
  const stalled = aggregate({ progress: fx, gitStatus: '', gateResults: {} });
  assert.equal(stalled.totals.stalled, 1);
  assert.equal(stalled.totals.blocked, 0);
  assert.equal(stalled.canProceed, false);
  assert.equal(stalled.blockers[0].kind, 'g1_refinement_stalled');
});

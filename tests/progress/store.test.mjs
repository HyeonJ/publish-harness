import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmpty, read, write, validate } from '../../scripts/_lib/progress-store.mjs';
import { addPage, addSection, setSectionStatus, recordGateResult } from '../../scripts/_lib/progress-store.mjs';

test('createEmpty returns valid v1 skeleton', () => {
  const obj = createEmpty({ name: 'foo', mode: 'figma', template: 'vite-react-ts' });
  assert.equal(obj.version, 1);
  assert.equal(obj.project.name, 'foo');
  assert.deepEqual(obj.pages, []);
  assert.deepEqual(obj.sections, []);
  assert.equal(obj.phase.current, 1);
});

test('validate accepts well-formed progress', () => {
  const fx = JSON.parse(readFileSync(new URL('./fixtures/empty.json', import.meta.url), 'utf8'));
  assert.doesNotThrow(() => validate(fx));
});

test('validate rejects missing version', () => {
  assert.throws(() => validate({}), /version/);
});

test('validate rejects unknown status', () => {
  const bad = { version: 1, project: {}, phase: { current: 1, completed: [] }, pages: [],
    sections: [{ name: 'x', kind: 'section', status: 'foo', retryCount: 0, failureHistory: [] }],
    updatedAt: '' };
  assert.throws(() => validate(bad), /status/);
});

test('read/write roundtrip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'progress-'));
  const p = join(dir, 'progress.json');
  const obj = createEmpty({ name: 'x', mode: 'spec', template: 'vite-react-ts' });
  write(p, obj);
  const back = read(p);
  assert.equal(back.project.name, 'x');
  assert.equal(back.project.mode, 'spec');
});

test('addPage appends and validates', () => {
  const obj = createEmpty({ name: 'x', mode: 'figma', template: 'vite-react-ts' });
  addPage(obj, { name: 'home', nodeId: '1:1' });
  assert.equal(obj.pages.length, 1);
  assert.equal(obj.pages[0].status, 'pending');
});

test('addPage rejects duplicate name', () => {
  const obj = createEmpty({ name: 'x', mode: 'figma', template: 'vite-react-ts' });
  addPage(obj, { name: 'home', nodeId: '1:1' });
  assert.throws(() => addPage(obj, { name: 'home', nodeId: '1:2' }), /duplicate/);
});

test('addSection links to page and appends to page.sections', () => {
  const obj = createEmpty({ name: 'x', mode: 'figma', template: 'vite-react-ts' });
  addPage(obj, { name: 'home', nodeId: '1:1' });
  addSection(obj, { name: 'home-hero', page: 'home', kind: 'section' });
  assert.equal(obj.sections.length, 1);
  assert.deepEqual(obj.pages[0].sections, ['home-hero']);
});

test('addSection without page (component mode) is allowed', () => {
  const obj = createEmpty({ name: 'x', mode: 'spec', template: 'vite-react-ts' });
  addSection(obj, { name: 'Button', page: null, kind: 'component' });
  assert.equal(obj.sections[0].page, null);
});

test('setSectionStatus updates status', () => {
  const obj = createEmpty({ name: 'x', mode: 'spec', template: 'vite-react-ts' });
  addSection(obj, { name: 'Button', page: null, kind: 'component' });
  setSectionStatus(obj, 'Button', 'done');
  assert.equal(obj.sections[0].status, 'done');
});

test('recordGateResult appends failureHistory and increments retryCount on FAIL', () => {
  const obj = createEmpty({ name: 'x', mode: 'spec', template: 'vite-react-ts' });
  addSection(obj, { name: 'Button', page: null, kind: 'component' });
  recordGateResult(obj, 'Button', {
    passed: false,
    gates: { G4: 'FAIL' },
    failures: [{ category: 'TOKEN_DRIFT', gate: 'G4', message: 'hex literal' }],
  });
  const s = obj.sections[0];
  assert.equal(s.retryCount, 1);
  assert.equal(s.failureHistory.length, 1);
  assert.deepEqual(s.failureHistory[0].categories, ['TOKEN_DRIFT']);
  assert.equal(s.lastGateResult.passed, false);
});

test('recordGateResult on PASS sets status=done and clears needsHuman', () => {
  const obj = createEmpty({ name: 'x', mode: 'spec', template: 'vite-react-ts' });
  addSection(obj, { name: 'Button', page: null, kind: 'component' });
  obj.sections[0].needsHuman = true;
  recordGateResult(obj, 'Button', { passed: true, gates: { G4: 'PASS' }, failures: [] });
  assert.equal(obj.sections[0].status, 'done');
  assert.equal(obj.sections[0].needsHuman, undefined);
});

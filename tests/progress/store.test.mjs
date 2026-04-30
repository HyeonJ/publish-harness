import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEmpty, read, write, validate } from '../../scripts/_lib/progress-store.mjs';

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

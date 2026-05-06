import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, writeFileSync as fsWrite } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/progress-update.mjs', import.meta.url));

function run(cwd, args) {
  return execFileSync('node', [SCRIPT, ...args], { cwd, encoding: 'utf8' });
}

test('init creates progress.json in cwd', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pu-'));
  run(dir, ['init', '--name', 'demo', '--mode', 'figma', '--template', 'vite-react-ts']);
  assert.ok(existsSync(join(dir, 'progress.json')));
  const obj = JSON.parse(readFileSync(join(dir, 'progress.json'), 'utf8'));
  assert.equal(obj.project.name, 'demo');
});

test('init refuses to overwrite existing progress.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pu-'));
  run(dir, ['init', '--name', 'demo', '--mode', 'figma', '--template', 'vite-react-ts']);
  assert.throws(() =>
    run(dir, ['init', '--name', 'demo', '--mode', 'figma', '--template', 'vite-react-ts'])
  );
});

test('add-page + add-section', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pu-'));
  run(dir, ['init', '--name', 'demo', '--mode', 'figma', '--template', 'vite-react-ts']);
  run(dir, ['add-page', '--name', 'home', '--route', '/', '--node-id', '1:1']);
  run(dir, ['add-section', '--name', 'home-hero', '--page', 'home', '--kind', 'section']);
  const obj = JSON.parse(readFileSync(join(dir, 'progress.json'), 'utf8'));
  assert.equal(obj.pages[0].name, 'home');
  assert.equal(obj.pages[0].route, '/');
  assert.equal(obj.sections[0].name, 'home-hero');
});

test('record-gate-result with --result-file (PASS)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pu-'));
  run(dir, ['init', '--name', 'demo', '--mode', 'spec', '--template', 'vite-react-ts']);
  run(dir, ['add-section', '--name', 'Button', '--kind', 'component']);
  const resPath = join(dir, 'gate-result.json');
  fsWrite(resPath, JSON.stringify({ passed: true, gates: { G4: 'PASS' }, failures: [] }));
  run(dir, ['record-gate-result', '--section', 'Button', '--result-file', resPath]);
  const obj = JSON.parse(readFileSync(join(dir, 'progress.json'), 'utf8'));
  assert.equal(obj.sections[0].status, 'done');
});

test('set-section direct status update', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pu-'));
  run(dir, ['init', '--name', 'demo', '--mode', 'spec', '--template', 'vite-react-ts']);
  run(dir, ['add-section', '--name', 'Button', '--kind', 'component']);
  run(dir, ['set-section', '--name', 'Button', '--status', 'skipped']);
  const obj = JSON.parse(readFileSync(join(dir, 'progress.json'), 'utf8'));
  assert.equal(obj.sections[0].status, 'skipped');
});

test('parallel add-section commands keep progress.json valid', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pu-'));
  run(dir, ['init', '--name', 'demo', '--mode', 'figma', '--template', 'vite-react-ts']);
  run(dir, ['add-page', '--name', 'home', '--route', '/', '--node-id', '1:1']);

  const children = Array.from({ length: 8 }, (_, index) => new Promise((resolvePromise) => {
    const child = spawn('node', [
      SCRIPT,
      'add-section',
      '--name', `section-${index}`,
      '--page', 'home',
      '--kind', 'section',
    ], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('exit', (code) => resolvePromise({ code, stderr }));
  }));

  const results = await Promise.all(children);
  assert.deepEqual(results.map((r) => r.code), Array(8).fill(0), JSON.stringify(results));
  const obj = JSON.parse(readFileSync(join(dir, 'progress.json'), 'utf8'));
  assert.equal(obj.sections.length, 8);
  assert.equal(obj.pages[0].sections.length, 8);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render } from '../../scripts/progress-render.mjs';

const fx = JSON.parse(readFileSync(new URL('./fixtures/done-mixed.json', import.meta.url), 'utf8'));

test('render outputs project meta header', () => {
  const md = render(fx);
  assert.match(md, /# PROGRESS — demo/);
  assert.match(md, /\*\*mode\*\*: figma/);
  assert.match(md, /\*\*template\*\*: vite-react-ts/);
  assert.match(md, /\*\*Figma URL\*\*: https:\/\/figma.com\/design\/ABC/);
});

test('render shows phase progress', () => {
  const md = render(fx);
  assert.match(md, /## Phase 1.*완료/);
  assert.match(md, /## Phase 2.*완료/);
  assert.match(md, /## Phase 3.*진행 중/);
});

test('render lists sections with status icons', () => {
  const md = render(fx);
  assert.match(md, /- \[x\] home-hero/);
  assert.match(md, /- \[ \] home-features.*retry 1/);
  assert.match(md, /- \[!\] home-cta.*needs human/i);
});

test('render shows fixture date in footer', () => {
  const md = render(fx);
  assert.match(md, /updated: 2026-04-30/);
});

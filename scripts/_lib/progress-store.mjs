import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

const VALID_STATUS = new Set(['pending', 'in_progress', 'done', 'blocked', 'skipped']);
const VALID_KIND = new Set(['section', 'component']);
const VALID_MODE = new Set(['figma', 'spec']);
const VALID_TEMPLATE = new Set(['vite-react-ts', 'html-static', 'nextjs-app-router']);

export function createEmpty({ name, mode, template, source = {} }) {
  if (!VALID_MODE.has(mode)) throw new Error(`invalid mode: ${mode}`);
  if (!VALID_TEMPLATE.has(template)) throw new Error(`invalid template: ${template}`);
  return {
    version: 1,
    project: { name, mode, template, source, canvas: {} },
    phase: { current: 1, completed: [] },
    pages: [],
    sections: [],
    updatedAt: new Date().toISOString(),
  };
}

export function validate(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('not an object');
  if (obj.version !== 1) throw new Error(`unsupported version: ${obj.version}`);
  if (!obj.project) throw new Error('missing project');
  if (!Array.isArray(obj.pages)) throw new Error('pages must be array');
  if (!Array.isArray(obj.sections)) throw new Error('sections must be array');
  for (const s of obj.sections) {
    if (!VALID_STATUS.has(s.status)) throw new Error(`invalid status: ${s.status}`);
    if (!VALID_KIND.has(s.kind)) throw new Error(`invalid kind: ${s.kind}`);
    if (typeof s.retryCount !== 'number') throw new Error(`retryCount missing for ${s.name}`);
    if (!Array.isArray(s.failureHistory)) throw new Error(`failureHistory missing for ${s.name}`);
  }
}

export function read(path) {
  const obj = JSON.parse(readFileSync(path, 'utf8'));
  validate(obj);
  return obj;
}

export function write(path, obj) {
  validate(obj);
  obj.updatedAt = new Date().toISOString();
  // atomic: write to .tmp then rename
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
}

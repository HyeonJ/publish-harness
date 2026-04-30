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

export function addPage(obj, { name, nodeId, nodeIdTablet = null, nodeIdMobile = null }) {
  if (obj.pages.find((p) => p.name === name)) {
    throw new Error(`duplicate page: ${name}`);
  }
  obj.pages.push({ name, nodeId, nodeIdTablet, nodeIdMobile, status: 'pending', sections: [] });
}

export function addSection(obj, { name, page, kind }) {
  if (obj.sections.find((s) => s.name === name)) {
    throw new Error(`duplicate section: ${name}`);
  }
  obj.sections.push({
    name, page: page || null, kind,
    status: 'pending', retryCount: 0,
    lastGateResult: null, failureHistory: [],
  });
  if (page) {
    const p = obj.pages.find((x) => x.name === page);
    if (!p) throw new Error(`page not found: ${page}`);
    if (!p.sections.includes(name)) p.sections.push(name);
  }
}

export function setSectionStatus(obj, name, status) {
  const s = obj.sections.find((x) => x.name === name);
  if (!s) throw new Error(`section not found: ${name}`);
  if (!['pending', 'in_progress', 'done', 'blocked', 'skipped'].includes(status)) {
    throw new Error(`invalid status: ${status}`);
  }
  s.status = status;
}

export function recordGateResult(obj, name, result) {
  const s = obj.sections.find((x) => x.name === name);
  if (!s) throw new Error(`section not found: ${name}`);
  s.lastGateResult = {
    passed: !!result.passed,
    gates: result.gates || {},
    timestamp: new Date().toISOString(),
  };
  if (result.passed) {
    s.status = 'done';
    delete s.needsHuman;
  } else {
    const categories = [...new Set((result.failures || []).map((f) => f.category))];
    s.failureHistory.push({ attempt: s.retryCount, categories, count: (result.failures || []).length });
    s.retryCount += 1;
    if (s.retryCount >= 3) {
      s.status = 'blocked';
      s.needsHuman = true;
    } else {
      s.status = 'in_progress';
    }
  }
}

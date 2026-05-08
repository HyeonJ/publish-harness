import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const VALID_STATUS = new Set(['pending', 'in_progress', 'iterating', 'stalled', 'done', 'blocked', 'skipped']);
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
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function withProgressLock(path, fn, { timeoutMs = 10000, staleMs = 30000 } = {}) {
  const lockDir = `${path}.lock`;
  const started = Date.now();
  while (true) {
    try {
      mkdirSync(lockDir);
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const age = Date.now() - statSync(lockDir).mtimeMs;
        if (age > staleMs) {
          rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error(`timed out waiting for progress lock: ${lockDir}`);
      }
      sleep(50);
    }
  }

  try {
    return fn();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

export function addPage(obj, { name, nodeId, nodeIdTablet = null, nodeIdMobile = null, route = null }) {
  if (obj.pages.find((p) => p.name === name)) {
    throw new Error(`duplicate page: ${name}`);
  }
  obj.pages.push({ name, route, nodeId, nodeIdTablet, nodeIdMobile, status: 'pending', sections: [] });
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
  if (!VALID_STATUS.has(status)) {
    throw new Error(`invalid status: ${status}`);
  }
  s.status = status;
  syncPageStatuses(obj);
}

export function syncPageStatuses(obj) {
  for (const page of obj.pages || []) {
    const sections = (page.sections || [])
      .map((name) => obj.sections.find((section) => section.name === name))
      .filter(Boolean);
    if (!sections.length) continue;
    if (sections.every((section) => section.status === 'done' || section.status === 'skipped')) {
      page.status = 'done';
    } else if (sections.some((section) => section.status === 'blocked' || section.status === 'stalled')) {
      page.status = 'blocked';
    } else if (sections.some((section) => section.status === 'in_progress' || section.status === 'iterating')) {
      page.status = 'in_progress';
    } else {
      page.status = 'pending';
    }
  }
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
    delete s.iteration;
  } else if (result.iteration?.g1Only) {
    s.iteration = {
      ...(s.iteration || {}),
      ...result.iteration,
      updatedAt: new Date().toISOString(),
    };
    s.lastGateResult = {
      passed: false,
      gates: result.gates || {},
      timestamp: new Date().toISOString(),
    };
    if (result.iteration.stalled || result.iteration.outcome === 'stalled' || result.iteration.outcome === 'abandoned') {
      s.status = 'stalled';
      s.needsHuman = true;
    } else {
      s.status = 'iterating';
      delete s.needsHuman;
    }
  } else {
    delete s.iteration;
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
  syncPageStatuses(obj);
}

// ---- measure-quality.sh JSON 어댑터 -----------------------------------------
// measure-quality.sh 가 작성하는 tests/quality/<section>.json 의 형식은
//   { section, dir, viewport, G1_status, G4_token_usage, ..., G11_layout_escapes }
// 으로 recordGateResult 가 기대하는 { passed, gates, failures } 와 다르다.
// 이 어댑터는 G* 필드를 읽어 표준 형식으로 변환한 뒤 recordGateResult 에 넘긴다.

const GATE_FIELD_TO_KEY = {
  G1_status: 'G1',
  G4_token_usage: 'G4',
  G5_semantic_html: 'G5',
  G6_text_image_ratio: 'G6',
  G7_lighthouse: 'G7',
  G8_i18n: 'G8',
  G10_write_protection: 'G10',
  G11_layout_escapes: 'G11',
  G12_reusability: 'G12',
};

const GATE_TO_CATEGORY = {
  G1: 'VISUAL_REGRESSION',
  G4: 'TOKEN_DRIFT',
  G5: 'A11Y',
  G6: 'TEXT_RATIO',
  G7: 'LIGHTHOUSE',
  G8: 'I18N',
  G10: 'WRITE_PROTECTION',
  G11: 'LAYOUT_ESCAPE',
  G12: 'REUSABILITY',
};

// measure-quality 출력 형식 감지: G1_status 등 G* 필드가 있고 passed 필드는 없음.
export function isMeasureQualityResult(result) {
  if (!result || typeof result !== 'object') return false;
  if ('passed' in result) return false;
  return Object.keys(GATE_FIELD_TO_KEY).some((k) => k in result);
}

// G* 상태 문자열을 PASS/FAIL/SKIP 으로 정규화.
// "PASS (a11y=98, seo=92)" 같은 prefix 도 PASS 로 처리.
// SCRIPT_ERROR / NO_BASELINE / BASELINE_UPDATED / SKIPPED 등은 SKIP 으로 묶음 (FAIL 아님).
function normalizeGateStatus(raw) {
  if (typeof raw !== 'string') return 'SKIP';
  const s = raw.trim();
  if (s.startsWith('PASS')) return 'PASS';
  if (s.startsWith('FAIL')) return 'FAIL';
  return 'SKIP';
}

// measure-quality 결과를 { passed, gates, failures } 로 변환.
export function adaptMeasureQualityResult(mqResult) {
  const gates = {};
  const failures = [];
  for (const [field, key] of Object.entries(GATE_FIELD_TO_KEY)) {
    if (!(field in mqResult)) continue;
    const raw = mqResult[field];
    // G1 은 객체일 수도 있음 (G1_visual_regression). 여기선 G1_status 만 본다.
    const status = normalizeGateStatus(typeof raw === 'string' ? raw : raw?.status);
    gates[key] = status;
    if (status === 'FAIL') {
      failures.push({
        category: GATE_TO_CATEGORY[key] || key,
        gate: key,
        message: typeof raw === 'string' ? raw : `${key} FAIL`,
      });
    }
  }
  const viewportResults = mqResult.G1_visual_regression?.viewports
    ? Object.values(mqResult.G1_visual_regression.viewports)
    : mqResult.G1_visual_regression?.l1 || mqResult.G1_visual_regression?.l2 || mqResult.G1_visual_regression?.iteration
      ? [mqResult.G1_visual_regression]
      : [];
  const g1IterationSource = viewportResults.find((item) => item?.iteration) || null;
  const g1Iteration = g1IterationSource?.iteration || null;
  const g1Only = failures.length === 1 && failures[0].gate === 'G1';
  return {
    passed: failures.length === 0,
    gates,
    failures,
    ...(g1Only && g1Iteration ? {
      iteration: {
        g1Only: true,
        viewport: g1IterationSource.viewport || mqResult.viewport || 'desktop',
        outcome: g1Iteration.outcome || g1Iteration.summary?.outcome || null,
        attempts: g1Iteration.attempts ?? g1Iteration.summary?.attempts ?? null,
        latestL1: g1Iteration.latestL1 ?? g1Iteration.summary?.latestL1 ?? null,
        previousL1: g1Iteration.previousL1 ?? g1Iteration.summary?.previousL1 ?? null,
        improvement: g1Iteration.improvement ?? g1Iteration.summary?.improvement ?? null,
        monotonic: g1Iteration.monotonic ?? g1Iteration.summary?.monotonic ?? null,
        stallThreshold: g1Iteration.stallThreshold ?? g1Iteration.summary?.stallThreshold ?? null,
        maxIterations: g1Iteration.maxIterations ?? g1Iteration.summary?.maxIterations ?? null,
        stalled: g1Iteration.stalled ?? g1Iteration.summary?.stalled ?? false,
        regressed: g1Iteration.regressed ?? g1Iteration.summary?.regressed ?? false,
        converged: g1Iteration.converged ?? g1Iteration.summary?.converged ?? false,
        abandoned: g1Iteration.abandoned ?? g1Iteration.summary?.abandoned ?? false,
        path: g1Iteration.path || null,
      },
    } : {}),
  };
}

// CLI 진입점에서 두 형식을 자동 감지하여 호출하는 헬퍼.
export function recordGateResultAuto(obj, name, result) {
  if (isMeasureQualityResult(result)) {
    return recordGateResult(obj, name, adaptMeasureQualityResult(result));
  }
  return recordGateResult(obj, name, result);
}

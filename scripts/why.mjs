#!/usr/bin/env node
import { read } from './_lib/progress-store.mjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const RULES = [
  {
    code: 'BOOTSTRAP_REQUIRED',
    when: ({ progress }) => !progress,
    message: () => 'progress.json 이 없음. bootstrap.sh 가 실행되지 않았거나 잘못된 디렉토리입니다.',
    recommendations: () => ['bash scripts/bootstrap.sh <figma-url> 또는 --mode spec --from-handoff <dir>'],
  },
  {
    code: 'FIGMA_TOKEN_MISSING',
    when: ({ progress, env }) => progress.project.mode === 'figma' && !env.FIGMA_TOKEN,
    message: () => 'figma 모드인데 FIGMA_TOKEN 환경변수 없음.',
    recommendations: () => ['bash scripts/setup-figma-token.sh', 'export FIGMA_TOKEN=...'],
  },
  {
    code: 'TOKENS_MISSING',
    when: ({ progress, cwd }) => progress.project.mode === 'figma' && !existsSync(join(cwd || '.', 'src/styles/tokens.css')),
    message: () => 'src/styles/tokens.css 없음 — extract-tokens 미실행 / bootstrap 미완.',
    recommendations: ({ progress }) => [`bash scripts/extract-tokens.sh ${progress.project.source?.fileKey || '<fileKey>'}`],
  },
  {
    code: 'DECOMPOSE_REQUIRED',
    when: ({ progress }) => progress.phase.current === 2 && progress.pages.length === 0 && progress.sections.length === 0,
    message: () => 'Phase 2 — 분해가 필요합니다. 페이지/컴포넌트가 등록되지 않았습니다.',
    recommendations: ({ progress }) => progress.project.mode === 'figma'
      ? ['오케스트레이터: get_metadata 로 페이지 트리 추출 → progress-update add-page/add-section']
      : ['오케스트레이터: docs/components-spec.md 읽고 컴포넌트 분류 → progress-update add-section'],
  },
  {
    code: 'ANTI_LOOP_TRIGGERED',
    when: ({ progress }) => {
      const blocked = progress.sections.find((s) => {
        if (!s.needsHuman || s.failureHistory.length < 3) return false;
        const last3 = s.failureHistory.slice(-3);
        const cats = last3.map((h) => JSON.stringify([...h.categories].sort()));
        return new Set(cats).size === 1;
      });
      return !!blocked;
    },
    message: ({ progress }) => {
      const s = progress.sections.find((x) => x.needsHuman);
      return `섹션 '${s.name}' 이 동일 카테고리 (${s.failureHistory.at(-1).categories.join(',')}) 로 3회 반복 실패 — 구조적 문제.`;
    },
    recommendations: () => [
      '섹션 재분할 (서브섹션으로 쪼개기)',
      'docs/components-spec.md 의 해당 컴포넌트 spec 검토',
      '수동 리팩터 후 progress-update set-section --status pending 으로 재시작',
    ],
  },
  {
    code: 'SECTION_BLOCKED',
    when: ({ progress }) => progress.sections.some((s) => s.needsHuman),
    message: ({ progress }) => {
      const s = progress.sections.find((x) => x.needsHuman);
      return `섹션 '${s.name}' 이 ${s.retryCount}회 시도 후 needs_human 상태입니다.`;
    },
    recommendations: () => [
      'lastGateResult 확인 후 drift 분석',
      '수동 수정 → progress-update set-section --status pending 으로 재시도',
      '또는 progress-update set-section --status skipped (다음으로 넘기기)',
    ],
  },
  {
    code: 'OK_NEXT_PHASE',
    when: ({ progress }) => {
      const total = progress.sections.length;
      const done = progress.sections.filter((s) => s.status === 'done').length;
      const skipped = progress.sections.filter((s) => s.status === 'skipped').length;
      return total > 0 && done + skipped === total && progress.phase.current < 4;
    },
    message: () => '모든 섹션 완료. 다음 phase 진입 가능.',
    recommendations: ({ progress }) => [`progress-update 로 phase.current 를 ${progress.phase.current + 1} 로 진행`],
  },
  {
    code: 'OK_PROCEED',
    when: () => true,
    message: () => '진행 가능 상태. 다음 actionable 섹션을 처리하세요.',
    recommendations: () => ['bash scripts/next.mjs 로 다음 행동 확인'],
  },
];

export function diagnose(ctx) {
  for (const rule of RULES) {
    if (rule.when(ctx)) {
      return {
        code: rule.code,
        message: rule.message(ctx),
        recommendations: rule.recommendations(ctx),
      };
    }
  }
  return { code: 'UNKNOWN', message: '진단 불가', recommendations: [] };
}

// CLI entry — Windows-safe self-detect
if (process.argv[1] && process.argv[1].endsWith('why.mjs')) {
  const cwd = process.cwd();
  const progressPath = join(cwd, 'progress.json');
  const progress = existsSync(progressPath) ? read(progressPath) : null;
  const result = diagnose({ progress, env: process.env, cwd });

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`[${result.code}] ${result.message}`);
    if (result.recommendations.length) {
      console.log('해결:');
      for (const r of result.recommendations) console.log(`  - ${r}`);
    }
  }
  process.exit(result.code.startsWith('OK_') ? 0 : 1);
}

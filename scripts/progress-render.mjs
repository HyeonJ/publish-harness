#!/usr/bin/env node
import { read } from './_lib/progress-store.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PHASE_LABEL = {
  1: '부트스트랩',
  2: '분해',
  3: '구현',
  4: '통합 검증',
};

function statusIcon(s) {
  if (s.status === 'done') return '[x]';
  if (s.status === 'blocked' || s.needsHuman) return '[!]';
  if (s.status === 'skipped') return '[~]';
  return '[ ]';
}

function sectionLine(s) {
  const icon = statusIcon(s);
  const meta = [];
  if (s.retryCount > 0 && s.status !== 'done') meta.push(`retry ${s.retryCount}`);
  if (s.needsHuman) meta.push('needs human');
  const suffix = meta.length ? ` _(${meta.join(', ')})_` : '';
  return `- ${icon} ${s.name}${suffix}`;
}

export function render(progress) {
  const lines = [];
  const p = progress.project;
  lines.push(`# PROGRESS — ${p.name}`, '');
  lines.push('> 자동 생성: progress.json 에서 렌더링됨. 직접 수정 금지.', '');
  lines.push('## 프로젝트 메타');
  lines.push(`- **mode**: ${p.mode}`);
  lines.push(`- **template**: ${p.template}`);
  if (p.source?.figmaUrl) lines.push(`- **Figma URL**: ${p.source.figmaUrl}`);
  if (p.source?.fileKey) lines.push(`- **fileKey**: ${p.source.fileKey}`);
  if (p.canvas?.desktop) lines.push(`- **Desktop 캔버스**: ${p.canvas.desktop}px`);
  if (p.canvas?.mobile) lines.push(`- **Mobile 캔버스**: ${p.canvas.mobile}px`);
  lines.push('');

  for (let i = 1; i <= 4; i++) {
    const status = progress.phase.completed.includes(i) ? '완료'
      : progress.phase.current === i ? '진행 중' : '대기';
    lines.push(`## Phase ${i} — ${PHASE_LABEL[i]} (${status})`);

    if (i === 3) {
      // sections by page
      for (const page of progress.pages) {
        lines.push(`### ${page.name}`);
        for (const sname of page.sections) {
          const s = progress.sections.find((x) => x.name === sname);
          if (s) lines.push(sectionLine(s));
        }
        lines.push('');
      }
      // page-less components (spec 모드)
      const orphan = progress.sections.filter((s) => !s.page);
      if (orphan.length) {
        lines.push('### 컴포넌트 (no page)');
        for (const s of orphan) lines.push(sectionLine(s));
        lines.push('');
      }
    } else {
      lines.push('');
    }
  }

  lines.push(`---`, `_updated: ${progress.updatedAt}_`, '');
  return lines.join('\n');
}

// CLI entry — Windows-safe self-detect
if (process.argv[1] && process.argv[1].endsWith('progress-render.mjs')) {
  const progressPath = join(process.cwd(), 'progress.json');
  const outPath = join(process.cwd(), 'PROGRESS.md');
  const md = render(read(progressPath));
  writeFileSync(outPath, md, 'utf8');
  console.log(`PROGRESS.md rendered (${md.length} bytes)`);
}

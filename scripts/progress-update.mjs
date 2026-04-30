#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEmpty, read, write, addPage, addSection, setSectionStatus, recordGateResultAuto } from './_lib/progress-store.mjs';

const PROGRESS_PATH = join(process.cwd(), 'progress.json');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i].replace(/^--/, '');
    out[k] = argv[i + 1];
  }
  return out;
}

function die(msg, code = 2) {
  console.error(`progress-update: ${msg}`);
  process.exit(code);
}

const [, , subcmd, ...rest] = process.argv;
const args = parseArgs(rest);

switch (subcmd) {
  case 'init': {
    if (existsSync(PROGRESS_PATH)) die(`progress.json already exists at ${PROGRESS_PATH}`);
    const obj = createEmpty({ name: args.name, mode: args.mode, template: args.template });
    if (args['figma-url']) obj.project.source.figmaUrl = args['figma-url'];
    if (args['file-key']) obj.project.source.fileKey = args['file-key'];
    write(PROGRESS_PATH, obj);
    console.log(`progress.json initialized at ${PROGRESS_PATH}`);
    break;
  }
  case 'add-page': {
    const obj = read(PROGRESS_PATH);
    addPage(obj, {
      name: args.name,
      nodeId: args['node-id'],
      nodeIdTablet: args['node-id-tablet'] || null,
      nodeIdMobile: args['node-id-mobile'] || null,
    });
    write(PROGRESS_PATH, obj);
    console.log(`page added: ${args.name}`);
    break;
  }
  case 'add-section': {
    const obj = read(PROGRESS_PATH);
    addSection(obj, { name: args.name, page: args.page || null, kind: args.kind });
    write(PROGRESS_PATH, obj);
    console.log(`section added: ${args.name}`);
    break;
  }
  case 'set-section': {
    const obj = read(PROGRESS_PATH);
    setSectionStatus(obj, args.name, args.status);
    write(PROGRESS_PATH, obj);
    console.log(`section ${args.name} → ${args.status}`);
    break;
  }
  case 'record-gate-result': {
    const obj = read(PROGRESS_PATH);
    if (!args['result-file']) die('--result-file required');
    const result = JSON.parse(readFileSync(args['result-file'], 'utf8'));
    // measure-quality.sh 출력 형식 ({G1_status, G4_token_usage, ...}) 과
    // 표준 형식 ({passed, gates, failures}) 모두 지원.
    recordGateResultAuto(obj, args.section, result);
    write(PROGRESS_PATH, obj);
    const s = obj.sections.find((x) => x.name === args.section);
    console.log(`recorded ${args.section}: status=${s.status} retryCount=${s.retryCount}`);
    break;
  }
  default:
    die(`unknown subcommand: ${subcmd || '(none)'}\nUsage: progress-update <init|add-page|add-section|set-section|record-gate-result> [args]`);
}

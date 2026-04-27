#!/usr/bin/env node
/**
 * G6 텍스트:이미지 비율 + G8 i18n 가능성 측정.
 *
 * 섹션 디렉토리의 .tsx 파일을 AST 파싱해서:
 *   - JSX 텍스트 노드 길이 합 (text chars)
 *   - img alt / aria-label 길이 합 (alt chars)
 *   - 한글 문자열 리터럴 존재 여부 (i18n 가능성)
 *
 * 판정:
 *   G6 PASS: text/alt >= 3  (또는 alt == 0)
 *   G6 FAIL: text/alt <  3
 *   G8 PASS: JSX 텍스트 노드에 한글/영문 문자 존재 (alt/aria 제외)
 *   G8 FAIL: 모든 사용자용 텍스트가 alt/aria에만 존재
 *
 * Usage:
 *   node scripts/check-text-ratio.mjs <section-dir>
 *   node scripts/check-text-ratio.mjs src/components/sections/MainHero
 */

import { readFileSync } from "node:fs";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import { walkByExt } from "./_lib/walk.mjs";
import { judge, writeReport } from "./_lib/text-ratio-judge.mjs";

const traverse = traverseModule.default ?? traverseModule;

const TSX_JSX_EXTS = new Set([".tsx", ".jsx"]);
const walk = (target, out) => walkByExt(target, TSX_JSX_EXTS, out);

function analyzeFile(file) {
  const code = readFileSync(file, "utf8");
  const ast = parse(code, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });

  let textChars = 0;
  let altChars = 0;
  let hasLiteralText = false;
  let imgCount = 0;

  traverse(ast, {
    JSXOpeningElement(path) {
      const name = path.node.name;
      if (name?.type === "JSXIdentifier" && name.name === "img") imgCount++;
    },
    JSXText(path) {
      const raw = path.node.value.trim();
      if (raw.length === 0) return;
      textChars += raw.length;
      if (/[가-힣a-zA-Z]/.test(raw)) hasLiteralText = true;
    },
    JSXAttribute(path) {
      const name = path.node.name?.name;
      if (name !== "alt" && name !== "aria-label" && name !== "title") return;
      const v = path.node.value;
      if (!v) return;
      if (v.type === "StringLiteral") altChars += v.value.length;
      else if (v.type === "JSXExpressionContainer" && v.expression?.type === "StringLiteral") {
        altChars += v.expression.value.length;
      }
    },
    // 객체 프로퍼티의 문자열 값:
    //   - key가 alt/ariaLabel/aria-label → altChars (접근성 우회 텍스트)
    //   - 그 외 string 값 (제목·설명 등 rendering될 data) → textChars
    // `title`은 제외 — HTML title attr와 data property가 구분 안 되는 ambiguous key
    ObjectProperty(path) {
      const k = path.node.key;
      const kname = k?.type === "Identifier" ? k.name : k?.type === "StringLiteral" ? k.value : null;
      if (!kname) return;
      const v = path.node.value;
      const isAltKey = kname === "alt" || kname === "ariaLabel" || kname === "aria-label";

      const collect = (val) => {
        if (val?.type === "StringLiteral") return val.value;
        if (val?.type === "TemplateLiteral") {
          return val.quasis.map((q) => q.value.cooked ?? "").join("");
        }
        return null;
      };

      const s = collect(v);
      if (s === null) return;
      const trimmed = s.trim();
      if (trimmed.length === 0) return;
      if (!/[가-힣a-zA-Z]/.test(trimmed)) return; // URL·경로 등 제외

      if (isAltKey) {
        altChars += trimmed.length;
      } else {
        textChars += trimmed.length;
        hasLiteralText = true;
      }
    },
    // 배열 요소의 string literal도 렌더링되는 data일 가능성 높음 (체크리스트 등)
    ArrayExpression(path) {
      for (const el of path.node.elements) {
        if (el?.type === "StringLiteral") {
          const t = el.value.trim();
          if (t.length > 0 && /[가-힣a-zA-Z]/.test(t)) {
            textChars += t.length;
            hasLiteralText = true;
          }
        }
      }
    },
    JSXExpressionContainer(path) {
      const expr = path.node.expression;
      if (expr?.type === "StringLiteral") {
        const raw = expr.value.trim();
        if (raw.length > 0 && /[가-힣a-zA-Z]/.test(raw)) {
          textChars += raw.length;
          hasLiteralText = true;
        }
      }
    },
  });

  return { file, textChars, altChars, hasLiteralText, imgCount };
}

function main() {
  // 여러 target (파일 또는 디렉토리) 수용 — 섹션 격리용
  const targets = process.argv.slice(2);
  if (targets.length === 0) {
    console.error("usage: check-text-ratio.mjs <path> [<path> ...]");
    console.error("  path: 파일 또는 디렉토리. 여러 개 허용");
    process.exit(2);
  }

  const files = [];
  for (const t of targets) walk(t, files);
  if (files.length === 0) {
    console.error(`no .tsx/.jsx in: ${targets.join(", ")}`);
    process.exit(2);
  }
  // 리포트에는 첫 target 을 대표로 (여러 개면 "multi" 로 표기)
  const target = targets.length === 1 ? targets[0] : "multi";

  let totalText = 0;
  let totalAlt = 0;
  let anyLiteral = false;
  let totalImg = 0;

  for (const f of files) {
    const r = analyzeFile(f);
    totalText += r.textChars;
    totalAlt += r.altChars;
    totalImg += r.imgCount;
    if (r.hasLiteralText) anyLiteral = true;
  }

  const verdict = judge({ totalText, totalAlt, totalImg, anyLiteral, section: target, files: files.length });
  const ok = writeReport(verdict, { totalText, totalAlt, totalImg });
  process.exit(ok ? 0 : 1);
}

main();

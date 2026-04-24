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

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default ?? traverseModule;

const RATIO_THRESHOLD = 3;
// alt 총량이 이 미만이면 ratio 체크 스킵 — 로고·아이콘 등 정당한 짧은 alt만 있는 경우.
// 80자 이상 alt는 "대체 텍스트를 위한 설명"이 아니라 "문장을 alt에 밀어넣은" 의심 시그널.
const ALT_FLOOR_CHARS = 80;
// C-4: raster 면적 휴리스틱 — 섹션 컴포넌트의 <img> 개수가 많고 text가 적으면
// "단일 raster 대체" 안티패턴 의심 (certification-flatten-bottom 같은 G6 floor bypass 보완).
const RASTER_HEAVY_IMG_COUNT = 1; // 섹션에 img 1개 + text 10자 미만 = "이미지만" 섹션 의심
const RASTER_HEAVY_TEXT_MIN = 10;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (extname(full) === ".tsx" || extname(full) === ".jsx") out.push(full);
  }
  return out;
}

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
  const target = process.argv[2];
  if (!target) {
    console.error("usage: check-text-ratio.mjs <section-dir>");
    process.exit(2);
  }

  const files = walk(target);
  if (files.length === 0) {
    console.error(`no .tsx/.jsx under ${target}`);
    process.exit(2);
  }

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

  const ratio = totalAlt === 0 ? Infinity : totalText / totalAlt;

  // C-4 raster 면적 휴리스틱: 섹션에 img 있고 text 10자 미만 = "이미지만" 섹션 안티패턴.
  // certification-flatten-bottom 같이 alt 짧아도 flatten raster 판별 가능하게.
  const rasterHeavy =
    totalImg >= RASTER_HEAVY_IMG_COUNT && totalText < RASTER_HEAVY_TEXT_MIN;

  // G6 판정:
  //   - raster heavy (img 있고 text 부족) → FAIL
  //   - alt 총량이 floor 미만 && raster heavy 아님 → PASS (decorative)
  //   - 그 외 → ratio >= 3 필요
  const g6Pass = rasterHeavy
    ? false
    : totalAlt === 0 || totalAlt < ALT_FLOOR_CHARS || ratio >= RATIO_THRESHOLD;
  // G8 판정: 컴포넌트 파일에 literal text가 존재하는지
  // (단, decorative-only 섹션은 G8 강제하지 않음 — AboutOrganizationLogos 같이 의도적 pure-image)
  const g8Pass = anyLiteral || totalAlt < ALT_FLOOR_CHARS;

  const report = {
    section: target,
    files: files.length,
    textChars: totalText,
    altChars: totalAlt,
    imgCount: totalImg,
    ratio: totalAlt === 0 ? "∞ (no alt)" : ratio.toFixed(2),
    rasterHeavy,
    g6: g6Pass ? "PASS" : "FAIL",
    g8: g8Pass ? "PASS" : "FAIL",
    threshold: RATIO_THRESHOLD,
  };

  console.log(JSON.stringify(report, null, 2));
  if (!g6Pass || !g8Pass) {
    const reason = rasterHeavy
      ? `raster-heavy 섹션 (img ${totalImg}개 + text ${totalText}자 < ${RASTER_HEAVY_TEXT_MIN})`
      : `text/alt=${report.ratio}, 임계 ${RATIO_THRESHOLD}:1`;
    console.error(
      `\n❌ G6/G8 FAIL — text-bearing raster 의심. ${reason}. ` +
        `docs/tech-debt.md에 부채 등록 또는 리팩터.`,
    );
    process.exit(1);
  }
  console.error(`✓ G6/G8 PASS (ratio ${report.ratio})`);
  process.exit(0);
}

main();

/**
 * G11 정적 escape 검사 + dependency closure 추출.
 *
 * 카테고리:
 *   A. positioning (absolute/fixed/sticky)
 *   B. transform (translate/translate-x/translate-y px)
 *   C. negative margin (-m{x}-/-mt-{x}/-ml-{x})
 *   D. arbitrary px ([<n>px], inline style px)
 *   E. breakpoint divergence (md:left-[..], lg:translate-x-[..])
 *   F. positioning helpers (inset-{n}px / top-{n}px / left-{n}px / right-{n}px / bottom-{n}px)
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, extname, join } from "node:path";
import * as parser from "@babel/parser";
import _traverse from "@babel/traverse";

const traverse = _traverse.default || _traverse;

// PATTERNS are shared /g regex literals consumed via String.prototype.match() (which uses an internal copy of lastIndex).
// Switching to RegExp.prototype.exec() would require fresh regex instances per call to avoid lastIndex carryover.
// 정규식 (className/style 문자열 검색용). AST 가 안 닿는 동적 합성 외에는 정규식이 단순/빠름.
const PATTERNS = {
  positioning: /\b(?:absolute|fixed|sticky)\b/g,
  positioningInline: /position\s*:\s*(?:absolute|fixed|sticky)/g,
  transformTw: /\btranslate-(?:x|y)-\[\d+(?:\.\d+)?(?:px|em|rem)?\]/g,
  transformInline: /transform\s*:\s*translate/g,
  negativeMargin: /(?<![A-Za-z0-9_])-m[trblxy]?-(?:\[\d+(?:\.\d+)?(?:px|em|rem)?\]|\d+)/g,
  arbitraryPx: /\[(\d+(?:\.\d+)?)px\]/g,
  breakpoint: /\b(?:sm|md|lg|xl|2xl):(?:left|right|top|bottom|inset|translate-[xy])-\[\d+(?:\.\d+)?px\]/g,
  positioningHelper: /\b(?:inset|top|left|right|bottom)-\[\d+(?:\.\d+)?px\]/g,
};

const TOKEN_VALUES_ALLOWED = new Set([0, 1, 2, 4, 8, 16, 24, 32, 48, 64, 96, 128, 256]); // 토큰 가능성 있는 단위

/**
 * 주석 영역을 공백으로 치환 (라인 카운트 보존).
 * - 블록 주석 `/* ... *\/` (멀티라인 OK), JSX `{/* ... *\/}`
 * - 라인 주석 `//` (단 문자열 안 // 는 보존 — backtick/quote 짝수 카운트 휴리스틱)
 *
 * N5 (modern-retro-strict §F8) — G11 이 코드 주석의 "absolute" 키워드를 false-positive
 * 차단하던 회귀 차단. AST 파싱 대신 정규식으로 단순 처리, 라인 번호는 그대로 보존.
 */
function stripComments(src) {
  // 1. 블록 주석 `/* ... */` — 내용을 newline 만 보존하면서 공백 치환
  let result = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  // 2. 라인 주석 `//` 부터 라인 끝까지. 단 문자열 안 // 는 보존
  result = result.split("\n").map((line) => {
    let inStr = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inStr) {
        if (c === inStr && line[i - 1] !== "\\") inStr = null;
      } else if (c === '"' || c === "'" || c === "`") {
        inStr = c;
      } else if (c === "/" && line[i + 1] === "/") {
        return line.slice(0, i) + " ".repeat(line.length - i);
      }
    }
    return line;
  }).join("\n");
  return result;
}

/**
 * 파일에서 escape 카운트 추출 (정적 축).
 */
export function detectEscapesInFile(filePath) {
  const rawSrc = readFileSync(filePath, "utf8");
  // N5 — 주석 strip 으로 false-positive 제거
  const src = stripComments(rawSrc);
  const result = {
    file: filePath,
    positioning: [],
    transform: [],
    negativeMargin: [],
    arbitraryPx: [],
    breakpointDivergence: [],
    positioningHelper: [],
  };
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const collect = (cat, regex) => {
      const matches = line.match(regex);
      if (matches) {
        for (const m of matches) {
          // arbitraryPx 는 토큰 가능 값 제외
          if (cat === "arbitraryPx") {
            const numMatch = m.match(/\[(\d+(?:\.\d+)?)px\]/);
            if (numMatch && TOKEN_VALUES_ALLOWED.has(Number(numMatch[1]))) continue;
          }
          result[cat].push({ line: i + 1, pattern: m });
        }
      }
    };
    collect("positioning", PATTERNS.positioning);
    collect("positioning", PATTERNS.positioningInline);
    collect("transform", PATTERNS.transformTw);
    collect("transform", PATTERNS.transformInline);
    collect("negativeMargin", PATTERNS.negativeMargin);
    collect("arbitraryPx", PATTERNS.arbitraryPx);
    collect("breakpointDivergence", PATTERNS.breakpoint);
    collect("positioningHelper", PATTERNS.positioningHelper);
  }
  return result;
}

/**
 * data-allow-escape 의 subtree 추출 — JSX AST.
 * 반환: data-allow-escape 가 박힌 element 의 subtree 안에 있는 라인 번호 집합.
 */
export function detectAllowedEscapeRanges(filePath) {
  const ext = extname(filePath);
  if (![".tsx", ".jsx", ".ts", ".js"].includes(ext)) return { ranges: [], reasons: [] };
  const src = readFileSync(filePath, "utf8");
  let ast;
  try {
    ast = parser.parse(src, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
    });
  } catch (e) {
    return { ranges: [], reasons: [], parseError: e.message };
  }
  const ranges = [];
  const reasons = [];
  traverse(ast, {
    JSXElement(path) {
      const open = path.node.openingElement;
      const attr = open.attributes.find(
        (a) => a.type === "JSXAttribute" && a.name.name === "data-allow-escape"
      );
      if (!attr) return;
      // value 가 string literal 인 경우만 valid (사유 enum)
      const reason = attr.value && attr.value.type === "StringLiteral" ? attr.value.value : null;
      const start = path.node.loc.start.line;
      const end = path.node.loc.end.line;
      ranges.push({ start, end });
      reasons.push({ line: start, reason });
    },
  });
  return { ranges, reasons };
}

/**
 * import 그래프 추출 — first-party 만 재귀.
 */
export function extractDependencyClosure(entryFile, projectRoot) {
  // projectRoot reserved for future containment guard (e.g. stop traversal outside root). Current BFS walks the full graph from entry.
  const visited = new Set();
  const queue = [entryFile];
  while (queue.length) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    if (!existsSync(file)) continue;
    const ext = extname(file);
    if (![".tsx", ".jsx", ".ts", ".js"].includes(ext)) continue;
    const src = readFileSync(file, "utf8");
    let ast;
    try {
      ast = parser.parse(src, {
        sourceType: "module",
        plugins: ["jsx", "typescript"],
      });
    } catch {
      continue;
    }
    const importDir = dirname(file);
    traverse(ast, {
      ImportDeclaration(path) {
        const src = path.node.source.value;
        if (!src.startsWith(".") && !src.startsWith("/")) return; // 외부 패키지 제외
        const candidates = [];
        const resolved = resolve(importDir, src);
        candidates.push(resolved);
        candidates.push(resolved + ".tsx");
        candidates.push(resolved + ".ts");
        candidates.push(resolved + ".jsx");
        candidates.push(resolved + ".js");
        candidates.push(join(resolved, "index.tsx"));
        candidates.push(join(resolved, "index.ts"));
        for (const c of candidates) {
          if (existsSync(c)) {
            queue.push(c);
            break;
          }
        }
      },
    });
  }
  visited.delete(entryFile); // entry 는 closure 외 (별도 직접 검사)
  return [...visited];
}

/**
 * data-allow-escape 의 reason enum.
 */
export const ALLOWED_ESCAPE_REASONS = new Set([
  "decorative-overlap",
  "connector-line",
  "badge-offset",
  "sticky-nav",
  "animation-anchor",
  // B-7 (beverage-product §retro-phase1-4): figma scattered/masonry layout 의
  // 정당한 absolute positioning. analyze-page-structure.mjs 가 자동 detect 한
  // tier1-scattered 섹션에서 사용. flex column 단순화 금지 (figma 의도 보존).
  "figma-scattered-layout",
]);

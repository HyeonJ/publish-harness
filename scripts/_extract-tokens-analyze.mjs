#!/usr/bin/env node
/**
 * _extract-tokens-analyze.mjs — extract-tokens.sh의 Node 워커.
 *
 * 입력: tmp/figma-raw.json (REST /v1/files 또는 /v1/files/nodes 응답)
 * 인자:
 *   argv[2] = input JSON 경로 (필수)
 *   argv[3] = mode ("full" | "component")  (선택, default: "full")
 *             "component": 레이어 이름 활용해 토큰 네이밍 시도
 * 출력:
 *   src/styles/tokens.css
 *   src/styles/fonts.css
 *   docs/token-audit.md
 *
 * 방식: DFS로 모든 노드 traverse → fills/strokes/style/cornerRadius/effects tally
 *       → 빈도 기반 정규화 → CSS 생성.
 *       component 모드에서는 레이어명(color/primary 등)도 함께 수집해 네이밍 품질 향상.
 */

import { readFileSync, writeFileSync } from "node:fs";

const [, , inputPath, modeArg] = process.argv;
if (!inputPath) {
  console.error("usage: _extract-tokens-analyze.mjs <figma-raw.json> [full|component]");
  process.exit(2);
}

const MODE = modeArg === "component" ? "component" : "full";

const raw = JSON.parse(readFileSync(inputPath, "utf8"));

// 루트 문서 추출 (REST /v1/files vs /v1/files/nodes 응답 형태 차이)
const docRoots = [];
if (raw.document) {
  docRoots.push(raw.document);
} else if (raw.nodes) {
  for (const k of Object.keys(raw.nodes)) {
    if (raw.nodes[k] && raw.nodes[k].document) docRoots.push(raw.nodes[k].document);
  }
}
if (docRoots.length === 0) {
  console.error("ERROR: 응답에서 document 노드 못 찾음.");
  process.exit(3);
}

// ---------- 수집기 ----------
// colorTally: hex → { count, names: Set<string> }  (names = 조상 레이어명 경로)
const colorTally = new Map();
const fontTally = new Map(); // "family|weight" -> { count, sample }
const spacingTally = new Map(); // number -> count
const radiusTally = new Map(); // number -> count

function rgbaToHex({ r, g, b, a = 1 }) {
  const ch = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
  const hex = `#${ch(r)}${ch(g)}${ch(b)}`.toUpperCase();
  if (a < 1) {
    return `${hex}${ch(a)}`;
  }
  return hex;
}

function recordColor(hex, contextName) {
  const cur = colorTally.get(hex) ?? { count: 0, names: new Set() };
  cur.count += 1;
  if (contextName) cur.names.add(contextName);
  colorTally.set(hex, cur);
}

function tallyColor(paintArr, contextName) {
  if (!Array.isArray(paintArr)) return;
  for (const p of paintArr) {
    if (p.type === "SOLID" && p.color) {
      const hex = rgbaToHex({ ...p.color, a: p.opacity ?? p.color.a ?? 1 });
      recordColor(hex, contextName);
    }
  }
}

/**
 * 레이어명 정규화. Figma 관례:
 *   "color/brand/primary"  → "brand-primary"
 *   "Brand/Primary 500"    → "brand-primary-500"
 *   "surface-elevated"     → "surface-elevated"
 *   "Rectangle 123"        → null (자동 생성 이름은 무시)
 */
function normalizeLayerName(name) {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  // Figma 자동 이름 필터
  if (/^(Rectangle|Ellipse|Vector|Frame|Group|Line|Polygon|Star|Instance|Component)\s*\d*$/i.test(trimmed)) {
    return null;
  }
  // 슬래시 구분 카테고리/이름 → 케밥 연결
  const segments = trimmed
    .toLowerCase()
    .split(/[\/\s·_]+/)
    .filter((s) => s.length > 0 && !/^\d+$/.test(s))
    .map((s) => s.replace(/[^a-z0-9-]/g, ""))
    .filter(Boolean);
  if (segments.length === 0) return null;
  const candidate = segments.join("-");
  // 너무 일반적인 이름은 제외 (예: "color", "fill")
  if (/^(color|fill|stroke|background|bg|text|primary|secondary)$/.test(candidate)) {
    return candidate; // 이런 건 유지 (primary 같은 건 유효)
  }
  if (candidate.length > 40) return null; // 너무 긴 이름
  return candidate;
}

function walk(node, ancestry = []) {
  if (!node || typeof node !== "object") return;

  // 조상명 경로 (component 모드에서만 유의미)
  const myName = normalizeLayerName(node.name);
  const contextPath = [...ancestry, myName].filter(Boolean).slice(-3).join("-");

  // color: fills / strokes / backgroundColor
  if (node.fills) tallyColor(node.fills, MODE === "component" ? contextPath : null);
  if (node.strokes) tallyColor(node.strokes, MODE === "component" ? contextPath : null);
  if (node.backgroundColor) {
    const hex = rgbaToHex(node.backgroundColor);
    recordColor(hex, MODE === "component" ? contextPath : null);
  }

  // typography
  if (node.type === "TEXT" && node.style) {
    const s = node.style;
    const family = s.fontFamily ?? "Unknown";
    const weight = s.fontWeight ?? 400;
    const key = `${family}|${weight}`;
    const cur = fontTally.get(key) ?? {
      count: 0,
      sample: {
        family,
        weight,
        size: s.fontSize,
        lineHeight: s.lineHeightPx,
        letterSpacing: s.letterSpacing,
      },
    };
    cur.count += 1;
    fontTally.set(key, cur);
  }

  // spacing (Auto Layout)
  for (const k of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "itemSpacing"]) {
    const v = node[k];
    if (typeof v === "number" && v > 0 && v < 400) {
      spacingTally.set(v, (spacingTally.get(v) ?? 0) + 1);
    }
  }

  // corner radius
  if (typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
    radiusTally.set(node.cornerRadius, (radiusTally.get(node.cornerRadius) ?? 0) + 1);
  }
  if (Array.isArray(node.rectangleCornerRadii)) {
    for (const r of node.rectangleCornerRadii) {
      if (r > 0) radiusTally.set(r, (radiusTally.get(r) ?? 0) + 1);
    }
  }

  const children = node.children;
  if (Array.isArray(children)) {
    const nextAncestry = myName ? [...ancestry, myName] : ancestry;
    for (const c of children) walk(c, nextAncestry);
  }
}

for (const root of docRoots) walk(root);

// ---------- 정규화 / 네이밍 ----------

function topN(map, n) {
  return [...map.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, n);
}

/**
 * 색상 토큰 네이밍.
 * component 모드: 레이어명에서 가장 긴/의미있는 이름 선택
 * full 모드: 휴리스틱 (밝기·채도)으로 brand/surface/text/border 분류
 */
function classifyColors(sorted) {
  const tokens = [];
  const usedNames = new Set();
  const heurCounters = { brand: 0, surface: 0, text: 0, border: 0 };

  for (const [hex, entry] of sorted) {
    let name = null;

    if (MODE === "component" && entry.names && entry.names.size > 0) {
      // 레이어명 후보 중 가장 구체적인 것 선택
      const candidates = [...entry.names]
        .filter((n) => n && n.length >= 3 && n.length <= 40)
        .sort((a, b) => b.length - a.length); // 긴 이름 우선
      for (const c of candidates) {
        if (!usedNames.has(c)) {
          name = c;
          break;
        }
      }
    }

    // 레이어명 선택 실패 또는 full 모드 → 휴리스틱
    if (!name) {
      const clean = hex.slice(0, 7);
      const r = parseInt(clean.slice(1, 3), 16) / 255;
      const g = parseInt(clean.slice(3, 5), 16) / 255;
      const b = parseInt(clean.slice(5, 7), 16) / 255;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const sat = Math.max(r, g, b) - Math.min(r, g, b);

      let cat;
      if (lum > 0.92 && sat < 0.1) cat = "surface";
      else if (lum < 0.2 && sat < 0.15) cat = "text";
      else if (sat > 0.15) cat = "brand";
      else cat = "border";

      heurCounters[cat] += 1;
      name = `${cat}-${heurCounters[cat]}`;
    }

    usedNames.add(name);
    tokens.push({ name, hex, count: entry.count, source: entry.names && entry.names.size > 0 ? "layer-name" : "heuristic" });
  }
  return tokens;
}

const colorTokens = classifyColors(topN(colorTally, 18));

// 폰트: family별 groupby → 가중치 목록 집계
function groupFonts(tally) {
  const families = new Map();
  for (const [key, val] of tally.entries()) {
    const [family, weight] = key.split("|");
    if (!families.has(family)) {
      families.set(family, { weights: [], count: 0, samples: [] });
    }
    const g = families.get(family);
    g.weights.push(Number(weight));
    g.count += val.count;
    g.samples.push(val.sample);
  }
  return [...families.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([family, g]) => ({
      family,
      weights: [...new Set(g.weights)].sort((a, b) => a - b),
      count: g.count,
      samples: g.samples,
    }));
}
const fontFamilies = groupFonts(fontTally);

// spacing: 상위 12개
function topSpacing() {
  const sorted = [...spacingTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  return sorted.map(([v, count]) => ({ value: v, count }));
}
const spacingTokens = topSpacing();

// radius: 상위 7개
function topRadius() {
  return [...radiusTally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([v, count]) => ({ value: v, count }));
}
const radiusTokens = topRadius();

// ---------- CSS 생성 ----------

function buildTokensCss() {
  let out = `/* tokens.css — Figma에서 자동 추출 (mode: ${MODE}). bootstrap.sh / extract-tokens.sh 재실행 시 덮어써집니다. */\n\n:root {\n`;
  out += "  /* Colors (빈도순) */\n";
  for (const t of colorTokens) {
    out += `  --${t.name}: ${t.hex.toLowerCase()};\n`;
  }
  out += "\n  /* Spacing (Auto Layout padding/gap 빈도순) */\n";
  for (const s of spacingTokens) {
    out += `  --space-${s.value}: ${s.value}px;\n`;
  }
  out += "\n  /* Radius */\n";
  for (const r of radiusTokens) {
    out += `  --radius-${r.value}: ${r.value}px;\n`;
  }

  // typography scale
  const allFontSizes = [];
  for (const fam of fontFamilies) {
    for (const s of fam.samples) {
      if (typeof s.size === "number") allFontSizes.push(s.size);
    }
  }
  const uniqSizes = [...new Set(allFontSizes)].sort((a, b) => b - a);
  if (uniqSizes.length > 0) {
    out += "\n  /* Typography (감지된 font-size) */\n";
    for (const sz of uniqSizes.slice(0, 10)) {
      out += `  --text-${sz}: ${sz}px;\n`;
    }
  }
  out += "}\n";
  return out;
}

function buildFontsCss() {
  let out = "/* fonts.css — 감지된 폰트 family. self-host 원칙 시 public/fonts/ 에 파일 배치 후 src 수정. */\n\n";
  for (const fam of fontFamilies) {
    const safeFam = fam.family.replace(/\s+/g, "_");
    for (const weight of fam.weights) {
      out += `@font-face {\n`;
      out += `  font-family: '${fam.family}';\n`;
      out += `  font-weight: ${weight};\n`;
      out += `  font-style: normal;\n`;
      out += `  font-display: swap;\n`;
      out += `  src: local('${fam.family}'),\n`;
      out += `       url('/fonts/${safeFam}-${weight}.woff2') format('woff2');\n`;
      out += `}\n\n`;
    }
  }
  return out;
}

function buildAuditMd() {
  const lines = [];
  lines.push("# Token Audit");
  lines.push("");
  lines.push(`> ${new Date().toISOString()} 자동 생성 (mode: \`${MODE}\`). \`scripts/extract-tokens.sh\` 재실행 시 갱신.`);
  if (MODE === "component") {
    lines.push(`> **Component 페이지 모드**: Figma 레이어명 기반 네이밍을 우선 적용.`);
  } else {
    lines.push(`> **전체 스캔 모드**: Figma 전체 파일에서 빈도 기반 추출 + 휴리스틱 네이밍.`);
    lines.push(`> Component 페이지가 따로 있다면 \`extract-tokens.sh <fileKey> --component-page <nodeId>\` 로 재실행하면 네이밍 품질 향상.`);
  }
  lines.push("");
  lines.push(`## 요약`);
  lines.push(`- 색상: ${colorTokens.length}`);
  lines.push(`- 폰트 family: ${fontFamilies.length}`);
  lines.push(`- spacing 값: ${spacingTokens.length}`);
  lines.push(`- radius 값: ${radiusTokens.length}`);
  lines.push("");

  lines.push(`## 색상 (빈도순)`);
  lines.push(`| 토큰 | hex | 빈도 | 네이밍 소스 |`);
  lines.push(`|------|-----|------|-------------|`);
  for (const t of colorTokens) {
    lines.push(`| \`--${t.name}\` | ${t.hex.toLowerCase()} | ${t.count} | ${t.source} |`);
  }

  lines.push("");
  lines.push(`## 폰트 family`);
  lines.push(`| family | weights | 등장 수 |`);
  lines.push(`|--------|---------|---------|`);
  for (const f of fontFamilies) {
    lines.push(`| ${f.family} | ${f.weights.join(", ")} | ${f.count} |`);
  }

  lines.push("");
  lines.push(`## Spacing (Auto Layout padding / itemSpacing)`);
  lines.push(`| 값 | 빈도 |`);
  lines.push(`|----|------|`);
  for (const s of spacingTokens) {
    lines.push(`| ${s.value}px | ${s.count} |`);
  }

  lines.push("");
  lines.push(`## Radius`);
  lines.push(`| 값 | 빈도 |`);
  lines.push(`|----|------|`);
  for (const r of radiusTokens) {
    lines.push(`| ${r.value}px | ${r.count} |`);
  }

  lines.push("");
  lines.push(`## 검토 체크리스트`);
  lines.push(`- [ ] 색상 토큰 네이밍이 브랜드 의도와 맞는지 (네이밍 소스 \`heuristic\` 은 수동 rename 고려)`);
  lines.push(`- [ ] 미사용 색상이 섞여있지 않은지 (프로토타이핑 잔재)`);
  lines.push(`- [ ] 폰트가 실제로 self-host 가능한지 (라이선스 확인)`);
  lines.push(`- [ ] spacing 값이 4의 배수가 아니면 의도된 것인지`);
  if (MODE === "full") {
    lines.push(`- [ ] Figma에 Component/Design System 페이지가 있다면 \`--component-page\` 모드로 재실행 권장`);
  }
  return lines.join("\n") + "\n";
}

writeFileSync("src/styles/tokens.css", buildTokensCss());
writeFileSync("src/styles/fonts.css", buildFontsCss());
writeFileSync("docs/token-audit.md", buildAuditMd());

console.log(`[extract-tokens] mode=${MODE} colors=${colorTokens.length} fonts=${fontFamilies.length} spacing=${spacingTokens.length} radius=${radiusTokens.length}`);

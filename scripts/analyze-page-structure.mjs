#!/usr/bin/env node
/**
 * analyze-page-structure.mjs — Phase 2 분해 단계 자동 분석.
 *
 * B-3 + B-7 통합 (분석 결정 4):
 *   - **B-3**: Phase 2a 4분기 자동 분기 — get_metadata 응답에서 desktop frame 의
 *     자식 노드들의 layoutMode 사용 비율 측정. ≥ 50% Auto Layout → use_figma 추천,
 *     < 50% → Tier 1 휴리스틱 추천.
 *   - **B-7**: layout topology — 각 섹션 자식 노드의 좌표 분포 분석. 동일 y±50px
 *     라인 자식 비율 ≥ 70% → "linear", < 70% → "scattered/masonry".
 *
 * 산출물: docs/page-structure.md
 *   섹션별 layoutTopology / autoLayoutRatio / phase2Recommendation 표.
 *
 * Usage:
 *   node scripts/analyze-page-structure.mjs \
 *     --file-key <key> \
 *     --page-node <id> \
 *     --out docs/page-structure.md
 *
 * 환경변수: FIGMA_TOKEN
 *
 * 워커 통합:
 *   - section-worker.md / workflow.md 가 Phase 3 진입 시 docs/page-structure.md Read
 *   - "scattered" 표기 섹션은 brand_guardrails 자동 추가 (flex column 단순화 금지,
 *     CSS Grid template areas 또는 absolute positioning 으로 figma 좌표 비율 보존,
 *     data-allow-escape="figma-scattered-layout")
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        opts[key] = next;
        i++;
      } else {
        opts[key] = true;
      }
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const required = ["file-key", "page-node", "out"];
for (const r of required) {
  if (!opts[r]) {
    console.error(`ERROR: --${r} required`);
    process.exit(2);
  }
}

const TOKEN = process.env.FIGMA_TOKEN;
if (!TOKEN) {
  console.error("ERROR: FIGMA_TOKEN env required");
  process.exit(2);
}

// page node — depth=4 면 page > section > section 자식까지 (B-7 의 자식 좌표 분포 분석용)
const url = `https://api.figma.com/v1/files/${opts["file-key"]}/nodes?ids=${encodeURIComponent(opts["page-node"])}&depth=4`;
const res = await fetch(url, { headers: { "X-Figma-Token": TOKEN } });
if (!res.ok) {
  console.error(`ERROR: Figma REST failed ${res.status}`);
  process.exit(1);
}
const json = await res.json();
const pageNode = Object.values(json.nodes)[0]?.document;
if (!pageNode) {
  console.error("ERROR: page node not found");
  process.exit(1);
}

/**
 * 섹션별 분석:
 *   - autoLayoutRatio: 자식 중 layoutMode !== "NONE" 비율 (B-3)
 *   - layoutTopology: 자식 좌표 분포 (B-7)
 *     · linear: 동일 y±50px 라인 자식 ≥ 70%
 *     · scattered: < 70% (masonry / 자유배치)
 */
function analyzeSection(sectionNode) {
  const children = sectionNode.children || [];
  const totalChildren = children.length;
  if (totalChildren === 0) {
    return {
      childCount: 0,
      autoLayoutRatio: 0,
      layoutTopology: "empty",
      phase2Recommendation: "tier1",
    };
  }

  // B-3: Auto Layout 비율
  const autoLayoutChildren = children.filter(
    (c) => c.layoutMode === "VERTICAL" || c.layoutMode === "HORIZONTAL"
  );
  const autoLayoutRatio = autoLayoutChildren.length / totalChildren;

  // B-7: 좌표 분포 — 자식 y 좌표 클러스터링 (±50px 같은 라인 간주)
  const ys = children
    .map((c) => c.absoluteBoundingBox?.y)
    .filter((y) => typeof y === "number");
  let layoutTopology = "linear";
  if (ys.length >= 2) {
    // 가장 큰 y 클러스터 (±50px) 의 자식 비율
    let maxClusterSize = 0;
    for (let i = 0; i < ys.length; i++) {
      const cluster = ys.filter((y) => Math.abs(y - ys[i]) <= 50).length;
      if (cluster > maxClusterSize) maxClusterSize = cluster;
    }
    const linearRatio = maxClusterSize / ys.length;
    layoutTopology = linearRatio >= 0.7 ? "linear" : "scattered";
  }

  // B-3 + B-7 종합: phase2 추천
  // - autoLayoutRatio ≥ 0.5 → use_figma (자동 frame 생성에 친화)
  // - 그 외 → tier1 (휴리스틱 또는 수동)
  // - scattered 면 use_figma 자체가 부정확 → 항상 tier1 + B-7 brand_guardrails
  let phase2Recommendation;
  if (layoutTopology === "scattered") {
    phase2Recommendation = "tier1-scattered"; // tier 1 + scattered guard
  } else if (autoLayoutRatio >= 0.5) {
    phase2Recommendation = "use_figma";
  } else {
    phase2Recommendation = "tier1";
  }

  return {
    childCount: totalChildren,
    autoLayoutRatio: Number(autoLayoutRatio.toFixed(2)),
    layoutTopology,
    phase2Recommendation,
  };
}

// page 의 직속 자식 (FRAME) 들이 section 후보
const sections = [];
const pageChildren = pageNode.children || [];
for (const child of pageChildren) {
  if (child.type !== "FRAME") continue;
  const a = analyzeSection(child);
  sections.push({
    nodeId: child.id,
    name: child.name || "(unnamed)",
    figmaWidth: child.absoluteBoundingBox?.width || null,
    ...a,
  });
}

// markdown 출력
const lines = [];
lines.push("# Page Structure — figma 자동 분석");
lines.push("");
lines.push(`> 생성: ${new Date().toISOString()}`);
lines.push(`> page-node: \`${opts["page-node"]}\``);
lines.push(`> 총 섹션: ${sections.length}`);
lines.push("");
lines.push("**B-3 + B-7 (beverage-product §retro-phase1-4)** Phase 2 분해 자동 분석:");
lines.push("- `autoLayoutRatio`: 자식 노드 중 layoutMode (VERTICAL/HORIZONTAL) 비율");
lines.push("- `layoutTopology`: 자식 좌표 분포 — `linear` (동일 y±50px 라인 ≥ 70%) | `scattered`");
lines.push("- `phase2Recommendation`:");
lines.push("  - `use_figma`: autoLayout ≥ 50% — figma `use_figma` MCP 자동 frame 생성 친화");
lines.push("  - `tier1`: < 50% — Tier 1 휴리스틱 또는 수동");
lines.push("  - `tier1-scattered`: scattered/masonry — Tier 1 + 추가 brand_guardrails (flex 단순화 금지)");
lines.push("");
lines.push("**워커 통합**:");
lines.push("- 각 섹션 워커는 자기 nodeId 의 row 를 보고 `phase2Recommendation` 에 따라 흡수");
lines.push("- `tier1-scattered` 섹션은 추가 brand_guardrails 자동 적용:");
lines.push("  > scattered layout — flex column 단순화 금지. CSS Grid template areas 또는");
lines.push("  > absolute positioning 으로 figma 좌표 비율 보존. `data-allow-escape=\"figma-scattered-layout\"`");
lines.push("");
lines.push("| nodeId | name | figmaWidth | childCount | autoLayoutRatio | layoutTopology | phase2Recommendation |");
lines.push("|---|---|---|---|---|---|---|");
for (const s of sections) {
  const nameEsc = s.name.replace(/\|/g, "\\|");
  lines.push(
    `| \`${s.nodeId}\` | ${nameEsc} | ${s.figmaWidth || "-"} | ${s.childCount} | ${s.autoLayoutRatio} | ${s.layoutTopology} | ${s.phase2Recommendation} |`
  );
}

const outPath = resolve(opts.out);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, lines.join("\n") + "\n");

const scattered = sections.filter((s) => s.layoutTopology === "scattered").length;
const useFigma = sections.filter((s) => s.phase2Recommendation === "use_figma").length;
console.log(JSON.stringify({
  out: opts.out,
  totalSections: sections.length,
  scattered,
  useFigmaRecommended: useFigma,
  tier1Recommended: sections.length - useFigma,
}));

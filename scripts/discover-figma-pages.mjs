#!/usr/bin/env node
/**
 * discover-figma-pages.mjs — Figma 파일의 route/page 후보를 자동 발견.
 *
 * node-id 없는 Figma URL에서 대표 프레임 1개만 구현하는 실수를 막고,
 * top-level SECTION/FRAME 중 실제 라우트 페이지 후보를 Phase 2 입력으로 만든다.
 *
 * Usage:
 *   node scripts/discover-figma-pages.mjs --file-key <key> --out docs/figma-pages.md
 *   node scripts/discover-figma-pages.mjs --figma-url <url> --json
 *   node scripts/discover-figma-pages.mjs --file-key <key> --apply
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { addPage, read, write } from "./_lib/progress-store.mjs";

function parseArgs(argv) {
  const opts = { json: false, apply: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") { opts.json = true; continue; }
    if (arg === "--apply") { opts.apply = true; continue; }
    if (arg.startsWith("--")) {
      opts[arg.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return opts;
}

function fileKeyFromUrl(input) {
  if (!input) return null;
  const m = input.match(/figma\.com\/(?:design|file)\/([^/?#]+)/);
  return m ? m[1] : input;
}

function slugifyName(name) {
  const clean = name.trim().replace(/^\/+/, "");
  if (!clean || /^home$/i.test(clean)) return "Home";
  return clean
    .split(/[\/\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function routeForName(name) {
  const clean = name.trim();
  if (!clean || /^home$/i.test(clean)) return "/";
  if (clean.startsWith("/")) return clean.replace(/\/+$/, "") || "/";
  return `/${clean.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`;
}

function isExcludedName(name) {
  return /^(thumbnail|styles?|components?|tokens?|foundations?|design system|ui kit|ds)$/i.test(name.trim());
}

function viewportOf(node) {
  const name = node.name || "";
  const width = node.absoluteBoundingBox?.width;
  if (/mobile|phone|375|390|360/i.test(name) || (width && width <= 480)) return "mobile";
  if (/tablet|768|820|1024/i.test(name) || (width && width > 480 && width <= 1100)) return "tablet";
  if (/desktop|1440|1280|1920/i.test(name) || (width && width > 1100)) return "desktop";
  return null;
}

function directViewportFrames(node) {
  const frames = { desktop: null, tablet: null, mobile: null };
  for (const child of node.children || []) {
    if (child.type !== "FRAME" && child.type !== "COMPONENT" && child.type !== "INSTANCE") continue;
    const vp = viewportOf(child);
    if (vp && !frames[vp]) frames[vp] = child;
  }
  return frames;
}

function looksLikeRouteCandidate(node) {
  if (!node || isExcludedName(node.name || "")) return false;
  if (node.type !== "SECTION" && node.type !== "FRAME") return false;
  const routeLikeName = node.name === "Home" || node.name.startsWith("/");
  const frames = directViewportFrames(node);
  const hasDesktopFrame = !!frames.desktop;
  const frameIsPage = node.type === "FRAME" && viewportOf(node) === "desktop";
  return routeLikeName || hasDesktopFrame || frameIsPage;
}

function candidateFromNode(node, canvasName) {
  const frames = directViewportFrames(node);
  const desktop = frames.desktop || (node.type === "FRAME" ? node : null);
  if (!desktop) return null;
  return {
    name: slugifyName(node.name),
    route: routeForName(node.name),
    canvasName,
    sourceNodeId: node.id,
    sourceNodeName: node.name,
    sourceNodeType: node.type,
    desktopNodeId: desktop.id,
    tabletNodeId: frames.tablet?.id || null,
    mobileNodeId: frames.mobile?.id || null,
    desktopSize: {
      width: desktop.absoluteBoundingBox?.width || null,
      height: desktop.absoluteBoundingBox?.height || null,
    },
    responsiveStatus:
      frames.tablet && frames.mobile ? "complete" :
      frames.tablet || frames.mobile ? "partial" :
      "desktop-only",
  };
}

function discover(document) {
  const candidates = [];
  for (const canvas of document.children || []) {
    if (canvas.type !== "CANVAS") continue;
    for (const child of canvas.children || []) {
      if (!looksLikeRouteCandidate(child)) continue;
      const candidate = candidateFromNode(child, canvas.name);
      if (candidate) candidates.push(candidate);
    }
  }
  const seenRoutes = new Set();
  const unique = candidates.filter((candidate) => {
    if (seenRoutes.has(candidate.route)) return false;
    seenRoutes.add(candidate.route);
    return true;
  });
  return unique.sort((a, b) => {
    if (a.route === "/") return -1;
    if (b.route === "/") return 1;
    return 0;
  });
}

function renderMarkdown({ fileName, fileKey, routes }) {
  const lines = [
    "# Figma Page Discovery",
    "",
    `- **Figma file**: ${fileName}`,
    `- **fileKey**: ${fileKey}`,
    "",
    "## Route Candidates",
    "",
    "| # | Page | Route | Source Node | Desktop Node | Tablet Node | Mobile Node | Status | Size |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  routes.forEach((route, index) => {
    const size = route.desktopSize.width && route.desktopSize.height
      ? `${Math.round(route.desktopSize.width)}x${Math.round(route.desktopSize.height)}`
      : "-";
    lines.push(`| ${index + 1} | ${route.name} | \`${route.route}\` | ${route.sourceNodeName} (${route.sourceNodeId}) | ${route.desktopNodeId} | ${route.tabletNodeId || "-"} | ${route.mobileNodeId || "-"} | ${route.responsiveStatus} | ${size} |`);
  });
  lines.push("", "## progress-update commands", "", "```bash");
  for (const route of routes) {
    lines.push(
      `node scripts/progress-update.mjs add-page --name ${route.name} --node-id ${route.desktopNodeId}` +
      ` --route ${route.route}` +
      `${route.tabletNodeId ? ` --node-id-tablet ${route.tabletNodeId}` : ""}` +
      `${route.mobileNodeId ? ` --node-id-mobile ${route.mobileNodeId}` : ""}`
    );
  }
  lines.push("```", "");
  return lines.join("\n");
}

const opts = parseArgs(process.argv.slice(2));
const fileKey = fileKeyFromUrl(opts["file-key"] || opts["figma-url"]);
if (!fileKey) {
  console.error("ERROR: --file-key or --figma-url required");
  process.exit(2);
}
if (!process.env.FIGMA_TOKEN) {
  console.error("ERROR: FIGMA_TOKEN env required");
  process.exit(2);
}

const res = await fetch(`https://api.figma.com/v1/files/${fileKey}?depth=3`, {
  headers: { "X-Figma-Token": process.env.FIGMA_TOKEN },
});
if (!res.ok) {
  console.error(`ERROR: Figma REST failed ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const file = await res.json();
const routes = discover(file.document);
const result = { fileKey, fileName: file.name, lastModified: file.lastModified, routes };

if (opts.apply) {
  const progressPath = join(process.cwd(), "progress.json");
  if (!existsSync(progressPath)) {
    console.error("ERROR: --apply requires progress.json in current project");
    process.exit(2);
  }
  const progress = read(progressPath);
  for (const route of routes) {
    if (progress.pages.some((page) => page.name === route.name)) continue;
    addPage(progress, {
      name: route.name,
      route: route.route,
      nodeId: route.desktopNodeId,
      nodeIdTablet: route.tabletNodeId,
      nodeIdMobile: route.mobileNodeId,
    });
  }
  write(progressPath, progress);
}

if (opts.out) {
  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, renderMarkdown({ fileName: file.name, fileKey, routes }), "utf8");
}

if (opts.json || !opts.out) {
  console.log(JSON.stringify(result, null, 2));
}

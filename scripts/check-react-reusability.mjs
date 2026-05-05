#!/usr/bin/env node
/**
 * G12 React reusability check.
 *
 * Catches the highest-cost publishing mistakes:
 * - multi-page Figma projects rendered as a single monolithic App.tsx
 * - repeated layout/page concepts not split into src/components/layout + src/pages
 * - all CSS concentrated in one large stylesheet instead of page/component files
 * - scaffold leftovers, mojibake text, and reusable logo/decor layering gaps
 * - oversized section/component files that should be decomposed before commit
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

function parseArgs(argv) {
  const opts = { files: "" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      opts[arg.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return opts;
}

function readText(path) {
  try { return readFileSync(path, "utf8"); } catch { return ""; }
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

function lineCount(text) {
  return text ? text.split(/\r?\n/).length : 0;
}

function hasReactFiles(dir) {
  return walk(dir).some((file) => /\.(tsx|jsx)$/.test(file));
}

function hasCssFiles(dir) {
  return walk(dir).some((file) => /\.css$/.test(file));
}

function isImportOnlyCss(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .every((line) => line.startsWith("@import "));
}

function findMojibake(text) {
  const strongMarkers = ["\uFFFD", "?셫", "I?셫"];
  const weakMarkers = ["챕", "짤", "遺", "硫"];
  const strong = strongMarkers.find((marker) => text.includes(marker));
  if (strong) return { marker: strong, severity: "failure" };
  const weak = weakMarkers.find((marker) => text.includes(marker));
  if (weak) return { marker: weak, severity: "warning" };
  return null;
}

function reportMojibake({ file, marker, severity }) {
  return {
    code: "MOJIBAKE_TEXT",
    message: `${file} contains possible mojibake marker "${marker}". Fix text encoding before publishing.`,
    file,
    severity,
  };
}

function parseNumericZIndex(cssBlock) {
  const match = cssBlock.match(/z-index\s*:\s*(-?\d+)/);
  return match ? Number(match[1]) : null;
}

function findDecorLayerWarnings(cssText, rel) {
  const warnings = [];
  const blockPattern = /([^{]*(?:decor|ornament|floating|egg|pizza)[^{]*)\{([^}]*)\}/gi;
  let match;
  while ((match = blockPattern.exec(cssText))) {
    const selector = match[1].trim();
    const body = match[2];
    if (!/position\s*:\s*absolute/.test(body)) continue;
    const z = parseNumericZIndex(body);
    if (z !== null && z > 0) {
      warnings.push({
        code: "DECOR_LAYER_ABOVE_CONTENT",
        message: `${rel} selector "${selector}" looks like an absolute decorative layer with z-index ${z}; decorative assets should sit behind content and use pointer-events: none.`,
        file: rel,
      });
    }
    if (!/pointer-events\s*:\s*none/.test(body)) {
      warnings.push({
        code: "DECOR_LAYER_POINTER_EVENTS",
        message: `${rel} selector "${selector}" looks decorative but does not set pointer-events: none.`,
        file: rel,
      });
    }
  }
  return warnings;
}

const opts = parseArgs(process.argv.slice(2));
const root = process.cwd();
const progress = existsSync(join(root, "progress.json"))
  ? JSON.parse(readText(join(root, "progress.json")))
  : null;
const pages = progress?.pages || [];
const pageCount = pages.length;
const failures = [];
const warnings = [];

const appPath = join(root, "src", "App.tsx");
const appText = readText(appPath);
const appLines = lineCount(appText);
const hasRoutes = /<Routes\b|createBrowserRouter|RouterProvider/.test(appText);

if (existsSync(join(root, "src", "routes", "HomePlaceholder.tsx"))) {
  failures.push({
    code: "SCAFFOLD_PLACEHOLDER_PRESENT",
    message: "src/routes/HomePlaceholder.tsx is a bootstrap placeholder and must be removed from published React output.",
    file: "src/routes/HomePlaceholder.tsx",
  });
}

if (pageCount > 1) {
  if (!hasRoutes) {
    failures.push({
      code: "MULTI_PAGE_NO_ROUTER",
      message: "progress.json has multiple pages but src/App.tsx does not define React routes.",
      file: "src/App.tsx",
    });
  }
  if (!hasReactFiles(join(root, "src", "components", "layout"))) {
    failures.push({
      code: "MISSING_SHARED_LAYOUT",
      message: "multi-page React output must extract shared Header/Footer/SiteLayout into src/components/layout.",
      file: "src/components/layout",
    });
  }
  if (!hasReactFiles(join(root, "src", "pages")) && !hasReactFiles(join(root, "src", "app"))) {
    failures.push({
      code: "MISSING_PAGE_COMPONENTS",
      message: "multi-page React output must keep route pages in src/pages or framework page files.",
      file: "src/pages",
    });
  }

  const stylesDir = join(root, "src", "styles");
  if (existsSync(stylesDir)) {
    if (!hasCssFiles(join(stylesDir, "components"))) {
      failures.push({
        code: "MISSING_COMPONENT_STYLES",
        message: "multi-page React output must split reusable component CSS into src/styles/components.",
        file: "src/styles/components",
      });
    }
    if (!hasCssFiles(join(stylesDir, "pages"))) {
      failures.push({
        code: "MISSING_PAGE_STYLES",
        message: "multi-page React output must split page-specific CSS into src/styles/pages.",
        file: "src/styles/pages",
      });
    }
  }
}

if (appLines > 220 && !hasRoutes) {
  failures.push({
    code: "MONOLITHIC_APP",
    message: `src/App.tsx is ${appLines} lines without routing; split layout, pages, and reusable components.`,
    file: "src/App.tsx",
  });
}

const targetFiles = opts.files
  ? opts.files.split(/\s+/).filter(Boolean)
  : walk(opts.dir || "").filter((file) => /\.(tsx|jsx)$/.test(file));

for (const file of targetFiles) {
  const text = readText(file);
  const lines = lineCount(text);
  const mojibake = findMojibake(text);
  if (mojibake) {
    const item = reportMojibake({ file, marker: mojibake.marker, severity: mojibake.severity });
    if (mojibake.severity === "failure") failures.push(item);
    else warnings.push(item);
  }
  if (lines > 260) {
    failures.push({
      code: "OVERSIZED_COMPONENT",
      message: `${file} is ${lines} lines; split repeated pieces into local subcomponents or shared components.`,
      file,
    });
  } else if (lines > 180) {
    warnings.push({
      code: "LARGE_COMPONENT",
      message: `${file} is ${lines} lines; verify it has clear subcomponents and data extraction.`,
      file,
    });
  }
}

const sourceTextFiles = walk(join(root, "src", "data")).filter((file) => /\.(ts|tsx|js|jsx)$/.test(file));
for (const file of sourceTextFiles) {
  const text = readText(file);
  const mojibake = findMojibake(text);
  if (mojibake) {
    const item = reportMojibake({ file, marker: mojibake.marker, severity: mojibake.severity });
    if (mojibake.severity === "failure") failures.push(item);
    else warnings.push(item);
  }
}

const cssFiles = walk(join(root, "src", "styles")).filter((file) => /\.css$/.test(file));
for (const file of cssFiles) {
  const text = readText(file);
  const lines = lineCount(text);
  const rel = relative(root, file).replaceAll("\\", "/");
  if (basename(file) === "index.css" && lines > 60 && !isImportOnlyCss(text)) {
    failures.push({
      code: "MONOLITHIC_INDEX_CSS",
      message: "src/styles/index.css should only compose imports; move rules into base, typography, components, pages, and responsive files.",
      file: rel,
    });
  } else if (lines > 260) {
    failures.push({
      code: "OVERSIZED_STYLESHEET",
      message: `${rel} is ${lines} lines; split page/component styles into smaller CSS files.`,
      file: rel,
    });
  } else if (lines > 180) {
    warnings.push({
      code: "LARGE_STYLESHEET",
      message: `${rel} is ${lines} lines; verify styles are grouped by ownership boundary.`,
      file: rel,
    });
  }
  warnings.push(...findDecorLayerWarnings(text, rel));
}

const projectCardPath = join(root, "src", "components", "ui", "ProjectCard.tsx");
const projectDataPath = join(root, "src", "data", "projects.ts");
if (existsSync(projectCardPath) && existsSync(projectDataPath)) {
  const projectCard = readText(projectCardPath);
  const projectData = readText(projectDataPath);
  const rendersImage = /<img\b/.test(projectCard);
  const hasLogoNormalization = /logo(?:Scale|ClassName|Fit|Offset|MaxWidth)|--logo-/.test(projectCard + projectData);
  if (rendersImage && !hasLogoNormalization) {
    warnings.push({
      code: "PROJECT_CARD_NO_LOGO_NORMALIZATION",
      message: "ProjectCard renders logos but no logoScale/logoClassName/logoFit metadata or --logo-* CSS variable was found; varied logo assets may appear visually inconsistent.",
      file: "src/components/ui/ProjectCard.tsx",
    });
  }
}

const result = {
  status: failures.length ? "FAIL" : "PASS",
  pageCount,
  failures,
  warnings,
};

console.log(JSON.stringify(result, null, 2));
process.exit(failures.length ? 1 : 0);

#!/usr/bin/env node
/**
 * G12 React reusability check.
 *
 * Catches the highest-cost publishing mistakes:
 * - multi-page Figma projects rendered as a single monolithic App.tsx
 * - repeated layout/page concepts not split into src/components/layout + src/pages
 * - all CSS concentrated in one large stylesheet instead of page/component files
 * - scaffold leftovers, mojibake text, and reusable logo/decor layering gaps
 * - content-fit controls such as pills/chips/tags stretched to full width
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

function uniqueFiles(files) {
  return [...new Set(files.filter(Boolean))];
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
  const strongMarkers = ["\uFFFD", "I?\uC157"];
  const weakMarkers = ["\uCC55", "\uC9E4", "\u907A", "\uF98E"];
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
  const hasStackingContext = /isolation\s*:\s*isolate/.test(cssText);
  let match;
  while ((match = blockPattern.exec(cssText))) {
    const selector = match[1].trim();
    const body = match[2];
    if (!/position\s*:\s*absolute/.test(body)) continue;
    const z = parseNumericZIndex(body);
    if (z === null) {
      warnings.push({
        code: "DECOR_LAYER_NO_Z_INDEX",
        message: `${rel} selector "${selector}" looks like an absolute decorative layer but has no explicit z-index. Decorative layer order must be intentional.`,
        file: rel,
      });
    }
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
    if (!hasStackingContext && z !== null && z >= 0) {
      warnings.push({
        code: "DECOR_LAYER_NO_STACKING_CONTEXT",
        message: `${rel} selector "${selector}" uses non-negative z-index without an isolation context in this stylesheet. The page shell should define isolation: isolate so decor cannot cover content unexpectedly.`,
        file: rel,
      });
    }
    if (/display\s*:\s*none/.test(body) || /visibility\s*:\s*hidden/.test(body) || /opacity\s*:\s*0(?:[;\s]|$)/.test(body)) {
      warnings.push({
        code: "DECOR_LAYER_HIDDEN",
        message: `${rel} selector "${selector}" looks decorative but is hidden. Decorative assets must be behind content, not removed from the visual result.`,
        file: rel,
      });
    }
    if (z !== null && z < -10) {
      warnings.push({
        code: "DECOR_LAYER_TOO_FAR_BEHIND",
        message: `${rel} selector "${selector}" uses z-index ${z}. Decorative assets should remain visible behind content, not buried behind the page background.`,
        file: rel,
      });
    }
    if (/transform\s*:[^;}]*translate(?:3d|X|Y)?\([^)]*-\d{3,}/.test(body)) {
      warnings.push({
        code: "DECOR_LAYER_OFFSCREEN",
        message: `${rel} selector "${selector}" appears translated far offscreen. Decorative assets must remain visible when present in Figma.`,
        file: rel,
      });
    }
  }
  return warnings;
}

function findContentFitControlWarnings(cssText, rel) {
  const warnings = [];
  const blockPattern = /([^{}]+)\{([^}]*)\}/g;
  let match;
  while ((match = blockPattern.exec(cssText))) {
    const selector = match[1].trim();
    const body = match[2];
    const isContentFitControl =
      /\.(?:[A-Za-z0-9_-]*(?:pill|chip|tag|badge)[A-Za-z0-9_-]*|[A-Za-z0-9_-]*(?:--label|__label)\b)/i.test(selector);
    if (!isContentFitControl) continue;

    if (/\bwidth\s*:\s*100%/.test(body) || /\bflex\s*:\s*1\b/.test(body) || /(?:align|justify)-self\s*:\s*stretch/.test(body)) {
      warnings.push({
        code: "CONTENT_FIT_CONTROL_STRETCH",
        message: `${rel} selector "${selector}" looks like a pill/chip/tag/label but can stretch. Figma hug-content controls should use inline-flex, width: fit-content, and start self-alignment.`,
        file: rel,
      });
    }

    const hasInlineDisplay = /display\s*:\s*inline-(?:flex|grid|block)/.test(body);
    const hasFitWidth = /width\s*:\s*(?:fit-content|max-content)/.test(body);
    const hasStretchyDisplay = /display\s*:\s*(?:flex|grid|block)/.test(body);
    if (hasStretchyDisplay && !hasInlineDisplay && !hasFitWidth) {
      warnings.push({
        code: "CONTENT_FIT_CONTROL_NOT_HUGGING",
        message: `${rel} selector "${selector}" looks like a Figma hug-content control but does not declare inline display or fit-content width.`,
        file: rel,
      });
    }
  }
  return warnings;
}

function findLogoMediaWarnings(cssText, rel) {
  const warnings = [];
  const blockPattern = /([^{}]+)\{([^}]*)\}/g;
  let match;
  while ((match = blockPattern.exec(cssText))) {
    const selector = match[1].trim();
    const body = match[2];
    const normalized = `${selector} ${body}`;
    const looksLikeLogoMedia =
      /(?:logo|brand|mark|wordmark|project-card|case-card|work-card)/i.test(normalized) &&
      /(?:img|image|media|thumb|visual|asset)/i.test(normalized);
    if (!looksLikeLogoMedia) continue;

    const hasObjectFitContain = /object-fit\s*:\s*contain/.test(body);
    const hasFitBox =
      /(?:width|height|max-width|max-height|aspect-ratio)\s*:\s*(?:var\(--logo-|var\(--mark-|clamp\(|min\(|max\(|\d)/.test(body) ||
      /(?:inline-size|block-size)\s*:/.test(body);
    const usesAutoHeight = /height\s*:\s*auto/.test(body);

    if (usesAutoHeight && !/max-height\s*:/.test(body) && !/block-size\s*:/.test(body)) {
      warnings.push({
        code: "LOGO_MEDIA_HEIGHT_AUTO",
        message: `${rel} selector "${selector}" uses height:auto for logo/card media without a max-height or block-size. Repeated logo cards should size marks from a fit box, not natural asset ratio.`,
        file: rel,
      });
    }

    if (!hasFitBox) {
      warnings.push({
        code: "LOGO_MEDIA_NO_FIT_BOX",
        message: `${rel} selector "${selector}" looks like reusable logo/card media but has no explicit fit box. Use bbox-driven width/height/max-size or --logo-* variables.`,
        file: rel,
      });
    }

    if (!hasObjectFitContain && /(?:img|image|media|thumb|visual|asset)/i.test(selector)) {
      warnings.push({
        code: "LOGO_MEDIA_NO_OBJECT_FIT",
        message: `${rel} selector "${selector}" looks like logo/card media but does not declare object-fit: contain.`,
        file: rel,
      });
    }
  }
  return warnings;
}

const opts = parseArgs(process.argv.slice(2));
const root = process.cwd();
const strictWarnings = process.env.G12_STRICT === "1" || process.env.STRICT === "1";
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

const cssFiles = uniqueFiles([
  ...walk(join(root, "src", "styles")).filter((file) => /\.css$/.test(file)),
  ...walk(opts.dir || "").filter((file) => /\.css$/.test(file)),
  ...walk(join(root, "src", "components")).filter((file) => /\.css$/.test(file)),
]);
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
  warnings.push(...findContentFitControlWarnings(text, rel));
  const logoMediaWarnings = findLogoMediaWarnings(text, rel);
  for (const item of logoMediaWarnings) {
    if (item.code === "LOGO_MEDIA_HEIGHT_AUTO" || item.code === "LOGO_MEDIA_NO_FIT_BOX") {
      failures.push({
        ...item,
        message: `${item.message} Repeated logo/card media must be normalized before publishing.`,
      });
    } else {
      warnings.push(item);
    }
  }
}

const projectCardPath = join(root, "src", "components", "ui", "ProjectCard.tsx");
const projectDataPath = join(root, "src", "data", "projects.ts");
if (existsSync(projectCardPath) && existsSync(projectDataPath)) {
  const projectCard = readText(projectCardPath);
  const projectData = readText(projectDataPath);
  const rendersImage = /<img\b/.test(projectCard);
  const combined = projectCard + projectData;
  const hasOnlyClassName = /logoClassName/.test(combined);
  const hasLogoNormalization = /logo(?:Scale|Fit|Offset|MaxWidth|MaxHeight|Width|Height|BBox|Box|W|H)\b|--logo-(?:w|h|width|height|max-width|max-height|scale|fit|box)|logo\s*:\s*\{/.test(combined);
  if (rendersImage && !hasLogoNormalization) {
    failures.push({
      code: "PROJECT_CARD_NO_LOGO_NORMALIZATION",
      message: `ProjectCard renders logos but no bbox/size normalization metadata such as logoScale, logoFit, logoWidth/logoHeight, logoBBox, or --logo-* variables was found.${hasOnlyClassName ? " logoClassName alone is not enough because it can still be ad hoc percentage sizing." : ""} Repeated logo/card media must be normalized before publishing.`,
      file: "src/components/ui/ProjectCard.tsx",
    });
  }
}

if (strictWarnings && warnings.length) {
  failures.push(...warnings.map((warning) => ({
    ...warning,
    code: `STRICT_${warning.code}`,
    message: `${warning.message} (strict warning treated as failure)`,
  })));
}

const result = {
  status: failures.length ? "FAIL" : "PASS",
  pageCount,
  strictWarnings,
  failures,
  warnings,
};

console.log(JSON.stringify(result, null, 2));
process.exit(failures.length ? 1 : 0);

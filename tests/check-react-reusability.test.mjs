import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const script = resolve("scripts/check-react-reusability.mjs");

function makeFixture(css) {
  const dir = mkdtempSync(join(tmpdir(), "g12-reuse-"));
  mkdirSync(join(dir, "src", "components", "sections"), { recursive: true });
  mkdirSync(join(dir, "src", "components", "ui"), { recursive: true });
  mkdirSync(join(dir, "src", "styles", "pages"), { recursive: true });
  mkdirSync(join(dir, "src", "data"), { recursive: true });
  writeFileSync(join(dir, "src", "components", "sections", "Hero.tsx"), "export function Hero(){return <div />}\n", "utf8");
  writeFileSync(join(dir, "src", "styles", "pages", "home.css"), css, "utf8");
  return dir;
}

test("warns when decorative assets are hidden", () => {
  const cwd = makeFixture(".pizza-decor { position: absolute; display: none; }\n");
  const result = spawnSync(process.execPath, [script, "--section", "hero", "--dir", "src/components/sections"], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout);
  assert.equal(json.status, "PASS");
  assert.ok(json.warnings.some((warning) => warning.code === "DECOR_LAYER_HIDDEN"));
});

test("strict mode fails hidden decorative assets", () => {
  const cwd = makeFixture(".pizza-decor { position: absolute; opacity: 0; }\n");
  const result = spawnSync(process.execPath, [script, "--section", "hero", "--dir", "src/components/sections"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, G12_STRICT: "1" },
  });
  assert.notEqual(result.status, 0);
  const json = JSON.parse(result.stdout);
  assert.equal(json.status, "FAIL");
  assert.ok(json.failures.some((failure) => failure.code === "STRICT_DECOR_LAYER_HIDDEN"));
});

test("warns when decorative assets lack explicit layer policy", () => {
  const cwd = makeFixture(".pizza-decor { position: absolute; pointer-events: none; }\n");
  const result = spawnSync(process.execPath, [script, "--section", "hero", "--dir", "src/components/sections"], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout);
  assert.ok(json.warnings.some((warning) => warning.code === "DECOR_LAYER_NO_Z_INDEX"));
});

test("fails when reusable logo card media relies on natural image ratio", () => {
  const cwd = makeFixture(".project-card__logo img { width: 100%; height: auto; }\n");
  const result = spawnSync(process.execPath, [script, "--section", "work", "--dir", "src/components/sections"], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  const json = JSON.parse(result.stdout);
  assert.equal(json.status, "FAIL");
  assert.ok(json.failures.some((failure) => failure.code === "LOGO_MEDIA_HEIGHT_AUTO"));
  assert.ok(json.warnings.some((warning) => warning.code === "LOGO_MEDIA_NO_OBJECT_FIT"));
});

test("does not warn when logo card media has a contain fit box", () => {
  const cwd = makeFixture(".project-card__logo img { width: var(--logo-width); max-height: var(--logo-max-height); object-fit: contain; }\n");
  const result = spawnSync(process.execPath, [script, "--section", "work", "--dir", "src/components/sections"], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout);
  assert.ok(!json.warnings.some((warning) => warning.code.startsWith("LOGO_MEDIA_")));
});

test("scans component-owned CSS outside src/styles", () => {
  const cwd = makeFixture("");
  writeFileSync(join(cwd, "src", "components", "portfolio.css"), ".project-card__logo img { width: 100%; height: auto; }\n", "utf8");
  const result = spawnSync(process.execPath, [script, "--section", "work", "--dir", "src"], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  const json = JSON.parse(result.stdout);
  assert.ok(json.failures.some((failure) => failure.code === "LOGO_MEDIA_HEIGHT_AUTO" && failure.file === "src/components/portfolio.css"));
});

test("fails when ProjectCard only has logoClassName without bbox sizing metadata", () => {
  const cwd = makeFixture(".project-card__logo img { width: var(--logo-width); max-height: var(--logo-max-height); object-fit: contain; }\n");
  writeFileSync(join(cwd, "src", "components", "ui", "ProjectCard.tsx"), "export function ProjectCard({logoClassName}){return <img className={logoClassName} />}\n", "utf8");
  writeFileSync(join(cwd, "src", "data", "projects.ts"), "export const projects = [{ logoClassName: 'project-card__logo--wide' }];\n", "utf8");
  const result = spawnSync(process.execPath, [script, "--section", "work", "--dir", "src"], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  const json = JSON.parse(result.stdout);
  assert.ok(json.failures.some((failure) => failure.code === "PROJECT_CARD_NO_LOGO_NORMALIZATION"));
});

test("accepts ProjectCard with explicit logo sizing metadata", () => {
  const cwd = makeFixture(".project-card__logo img { width: var(--logo-width); max-height: var(--logo-max-height); object-fit: contain; }\n");
  writeFileSync(join(cwd, "src", "components", "ui", "ProjectCard.tsx"), "export function ProjectCard({logoWidth, logoHeight}){return <img style={{'--logo-width': logoWidth, '--logo-height': logoHeight}} />}\n", "utf8");
  writeFileSync(join(cwd, "src", "data", "projects.ts"), "export const projects = [{ logoWidth: '76px', logoHeight: '98px' }];\n", "utf8");
  const result = spawnSync(process.execPath, [script, "--section", "work", "--dir", "src"], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout);
  assert.ok(!json.failures.some((failure) => failure.code === "PROJECT_CARD_NO_LOGO_NORMALIZATION"));
});

test("fails full-section Figma raster backdrops without structural pixel mirror opt-in", () => {
  const cwd = makeFixture("");
  writeFileSync(join(cwd, "src", "components", "sections", "Hero.tsx"), `
import sectionRaster from "./figma-section-home.png";
export function Hero(){
  return <section><img src={sectionRaster} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} /></section>;
}
`, "utf8");
  const result = spawnSync(process.execPath, [script, "--section", "home", "--dir", "src/components/sections"], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  const json = JSON.parse(result.stdout);
  assert.ok(json.failures.some((failure) => failure.code === "SECTION_RASTER_FINAL_BLOCKED"));
});

test("does not let one pixel mirror boundary exempt unrelated sibling hidden anchors", () => {
  const cwd = makeFixture("");
  writeFileSync(join(cwd, "src", "components", "sections", "Hero.tsx"), `
export function Hero(){
  return <>
    <PixelMirrorSection data-pixel-mirror="Home/section-1" pixelMirrorReason="temporary mirror"><div /></PixelMirrorSection>
    <span data-anchor="Home/title" style={{ opacity: 0 }}>Title</span>
  </>;
}
`, "utf8");
  const result = spawnSync(process.execPath, [script, "--section", "home", "--dir", "src/components/sections"], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  const json = JSON.parse(result.stdout);
  assert.ok(json.failures.some((failure) => failure.code === "HIDDEN_ANCHOR_WITHOUT_OPT_IN"));
});

test("fails hidden anchor geometry inside a structural pixel mirror boundary by default", () => {
  const cwd = makeFixture("");
  writeFileSync(join(cwd, "src", "components", "sections", "Hero.tsx"), `
export function Hero(){
  return <PixelMirrorSection data-pixel-mirror="Home/section-1" pixelMirrorReason="temporary mirror">
    <HiddenAnchorLayer>
      <span data-anchor="Home/title" style={{ opacity: 0 }}>Title</span>
    </HiddenAnchorLayer>
  </PixelMirrorSection>;
}
`, "utf8");
  const result = spawnSync(process.execPath, [script, "--section", "home", "--dir", "src/components/sections"], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  const json = JSON.parse(result.stdout);
  assert.ok(json.failures.some((failure) => failure.code === "PIXEL_MIRROR_FINAL_BLOCKED"));
  assert.ok(json.failures.some((failure) => failure.code === "HIDDEN_ANCHOR_LAYER_FINAL_BLOCKED"));
});

test("fails full-section raster inside a pixel mirror boundary by default", () => {
  const cwd = makeFixture("");
  writeFileSync(join(cwd, "src", "components", "sections", "Hero.tsx"), `
import sectionRaster from "./figma-section-home.png";
export function Hero(){
  return <PixelMirrorSection data-pixel-mirror="Home/section-1">
    <img src={sectionRaster} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
  </PixelMirrorSection>;
}
`, "utf8");
  const result = spawnSync(process.execPath, [script, "--section", "home", "--dir", "src/components/sections"], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  const json = JSON.parse(result.stdout);
  assert.ok(json.failures.some((failure) => failure.code === "PIXEL_MIRROR_FINAL_BLOCKED"));
  assert.ok(json.failures.some((failure) => failure.code === "SECTION_RASTER_FINAL_BLOCKED"));
});

test("fails full-section raster imports even without pixel mirror naming", () => {
  const cwd = makeFixture("");
  writeFileSync(join(cwd, "src", "components", "sections", "Hero.tsx"), `
import pageShot from "./figma-section-home.png";
export function Hero(){
  return <main><img src={pageShot} alt="" aria-hidden="true" /></main>;
}
`, "utf8");
  const result = spawnSync(process.execPath, [script, "--section", "home", "--dir", "src/components/sections"], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  const json = JSON.parse(result.stdout);
  assert.ok(json.failures.some((failure) => failure.code === "SECTION_RASTER_IMPORT_FINAL_BLOCKED"));
  assert.ok(json.failures.some((failure) => failure.code === "RASTER_DOM_SHELL_TOO_THIN"));
});

test("fails FigmaAnchorOverlay in final React output", () => {
  const cwd = makeFixture("");
  writeFileSync(join(cwd, "src", "components", "sections", "Hero.tsx"), `
export function Hero(){
  return <section><FigmaAnchorOverlay anchors={[]} /></section>;
}
`, "utf8");
  const result = spawnSync(process.execPath, [script, "--section", "home", "--dir", "src/components/sections"], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  const json = JSON.parse(result.stdout);
  assert.ok(json.failures.some((failure) => failure.code === "FIGMA_ANCHOR_OVERLAY_FINAL_BLOCKED"));
});

test("fails anchors hidden by CSS classes outside pixel mirror boundaries", () => {
  const cwd = makeFixture(".anchor-hidden { opacity: 0; }\n");
  writeFileSync(join(cwd, "src", "components", "sections", "Hero.tsx"), `
export function Hero(){
  return <span data-anchor="Home/title" className="anchor-hidden">Title</span>;
}
`, "utf8");
  const result = spawnSync(process.execPath, [script, "--section", "home", "--dir", "src/components/sections"], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  const json = JSON.parse(result.stdout);
  assert.ok(json.failures.some((failure) => failure.code === "HIDDEN_ANCHOR_CLASS_WITHOUT_OPT_IN"));
});

test("fails CSS full-section raster backdrops without pixel mirror policy", () => {
  const cwd = makeFixture(".section-raster { position: absolute; inset: 0; background-image: url('./figma-section-home.png'); background-size: cover; }\n");
  const result = spawnSync(process.execPath, [script, "--section", "home", "--dir", "src/components/sections"], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  const json = JSON.parse(result.stdout);
  assert.ok(json.failures.some((failure) => failure.code === "CSS_SECTION_RASTER_FINAL_BLOCKED"));
});

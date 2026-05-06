import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

const script = resolve("scripts/measure-quality.sh");
const bashScript = script.replace(/^([A-Za-z]):\\/, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replaceAll("\\", "/");

function makeProject(progress, { withBaseline = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "measure-preflight-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "docs"), { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, ".publish-harness"), { recursive: true });
  writeFileSync(join(dir, "docs", "project-context.md"), "mode: figma\ntemplate: vite-react-ts\n", "utf8");
  writeFileSync(join(dir, "progress.json"), JSON.stringify(progress, null, 2) + "\n", "utf8");
  writeFileSync(join(dir, "src", "App.tsx"), "export default function App(){return <main>Hello</main>}\n", "utf8");
  writeFileSync(join(dir, "scripts", "write-protected-paths.json"), "[]\n", "utf8");
  writeFileSync(join(dir, ".publish-harness", "write-protection-baseline.json"), "{}\n", "utf8");
  if (withBaseline) {
    mkdirSync(join(dir, "baselines", "home-route"), { recursive: true });
    writeFileSync(join(dir, "baselines", "home-route", "desktop.png"), "not-a-real-png", "utf8");
    writeFileSync(join(dir, "baselines", "home-route", "anchors-desktop.json"), JSON.stringify({ version: 2, anchors: [] }), "utf8");
  }
  return dir;
}

function addFakeNpx(cwd) {
  mkdirSync(join(cwd, "fakebin"), { recursive: true });
  const path = join(cwd, "fakebin", "npx");
  writeFileSync(path, "#!/usr/bin/env bash\nif [ \"$1\" = \"--no-install\" ] && [ \"$2\" = \"lighthouse\" ] && [ \"$3\" = \"--version\" ]; then echo 1.0.0; exit 0; fi\nexit 1\n", "utf8");
  chmodSync(path, 0o755);
}

function baseProgress({ sectionName = "home-route", sectionCount = 3 } = {}) {
  const pages = [
    { name: "Home", route: "/", nodeId: "1:1", status: "pending", sections: ["home-route"] },
    { name: "Work", route: "/work", nodeId: "1:2", status: "pending", sections: ["work-route"] },
    { name: "About", route: "/about", nodeId: "1:3", status: "pending", sections: ["about-route"] },
  ];
  const sections = ["home-route", "work-route", "about-route"].slice(0, sectionCount).map((name) => ({
    name,
    page: name.split("-")[0],
    kind: "section",
    status: "pending",
    retryCount: 0,
    lastGateResult: null,
    failureHistory: [],
  }));
  if (sectionName === "site-pages") {
    sections.length = 0;
    sections.push({
      name: "site-pages",
      page: null,
      kind: "section",
      status: "pending",
      retryCount: 0,
      lastGateResult: null,
      failureHistory: [],
    });
  }
  return {
    version: 1,
    project: { name: "demo", mode: "figma", template: "vite-react-ts", source: {}, canvas: {} },
    phase: { current: 1, completed: [] },
    pages,
    sections,
    updatedAt: "2026-05-06T00:00:00.000Z",
  };
}

function singlePageProgress() {
  return {
    version: 1,
    project: { name: "demo", mode: "figma", template: "vite-react-ts", source: {}, canvas: {} },
    phase: { current: 1, completed: [] },
    pages: [
      { name: "Home", route: "/", nodeId: "1:1", status: "pending", sections: ["home-route"] },
    ],
    sections: [
      {
        name: "home-route",
        page: "Home",
        kind: "section",
        status: "pending",
        retryCount: 0,
        lastGateResult: null,
        failureHistory: [],
      },
    ],
    updatedAt: "2026-05-06T00:00:00.000Z",
  };
}

test("measure-quality rejects synthetic aggregate sections in multi-page figma projects", () => {
  const cwd = makeProject(baseProgress({ sectionName: "site-pages" }));
  const result = spawnSync("bash", [bashScript, "site-pages", "src"], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /run one quality gate per discovered route\/page|not linked to any active page/);
});

test("measure-quality rejects unregistered sections before gates run", () => {
  const cwd = makeProject(baseProgress());
  const result = spawnSync("bash", [bashScript, "site-pages", "src"], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not registered in progress\.json/);
});

test("measure-quality strips CRLF from project-context template values", () => {
  const cwd = makeProject(baseProgress());
  writeFileSync(join(cwd, "docs", "project-context.md"), "mode: figma\r\ntemplate: vite-react-ts\r\npreview_base_url: http://127.0.0.1:5173\r\n", "utf8");
  const result = spawnSync("bash", [bashScript, "site-pages", "missing-dir"], { cwd, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stderr, /unsupported template/);
  assert.match(result.stderr, /section dir not found/);
});

test("measure-quality fails when G7 preview route is unreachable", () => {
  const cwd = makeProject(singlePageProgress());
  addFakeNpx(cwd);
  const command = `PATH="$(pwd)/fakebin:$PATH" "${bashScript}" home-route src`;
  const result = spawnSync("bash", ["-lc", command], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PREVIEW_BASE_URL: "http://127.0.0.1:9" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /G7 FAIL - dev server unreachable/);
  const sentinelPath = join(cwd, ".publish-harness", "INCOMPLETE.json");
  assert.equal(existsSync(sentinelPath), true);
  const sentinel = JSON.parse(readFileSync(sentinelPath, "utf8"));
  assert.equal(sentinel.status, "BLOCKED_INCOMPLETE");
  assert.match(sentinel.blockedIsTerminalOnlyWhen, /otherwise continue fixing/);
  assert.ok(sentinel.failures.some((failure) => failure.gate === "G7"));
});

test("measure-quality fails LITE=1 in figma mode", () => {
  const cwd = makeProject(singlePageProgress());
  const command = `LITE=1 "${bashScript}" home-route src`;
  const result = spawnSync("bash", ["-lc", command], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PREVIEW_BASE_URL: "http://127.0.0.1:9" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /LITE=1 is not allowed/);
});

test("measure-quality fails when figma baseline is missing", () => {
  const cwd = makeProject(singlePageProgress(), { withBaseline: false });
  const result = spawnSync("bash", [bashScript, "home-route", "src"], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PREVIEW_BASE_URL: "http://127.0.0.1:9" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /baselines\/home-route\/ missing - run prepare-baseline\.mjs/);
});

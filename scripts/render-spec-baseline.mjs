#!/usr/bin/env node
/**
 * spec 모드 baseline 생성 — reference HTML 을 Playwright 로 렌더 → 스크린샷 → baseline PNG.
 *
 * 용도: spec 모드에서 handoff 번들에 PNG baseline 이 없고 reference HTML 만 있을 때,
 * 해당 HTML 의 특정 영역(컴포넌트)을 캡처해서 G1 baseline 으로 삼기.
 *
 * lite 철학: playwright 미설치 = SKIPPED (exit 0, 게이트 차단 아님).
 *
 * Usage:
 *   node scripts/render-spec-baseline.mjs --html <path-or-url> --section <id> [options]
 *
 * 인자:
 *   --html <path>        reference HTML 경로 (상대경로는 cwd 기준 file:// 로 변환)
 *                        또는 http(s):// URL 직접 지정
 *   --section <id>       섹션 식별자 (저장 경로 baselines/<id>/<viewport>.png 에 사용)
 *   --viewport <v>       desktop | tablet | mobile (default: desktop)
 *   --selector <css>     특정 요소만 캡처 (default: 전체 페이지)
 *   --wait <ms>          렌더 대기 (default: 500, CDN 로딩 있으면 늘려)
 *   --timeout <ms>       페이지 로드 타임아웃 (default: 15000)
 *   -h, --help           도움말
 *
 * 출력 (stdout, JSON):
 *   { section, viewport, status, path, ... }
 *   status enum: OK | SKIPPED | ERROR
 *
 * 종료 코드:
 *   0 OK / SKIPPED
 *   1 ERROR (HTML 로드 / selector 미매칭 등)
 *   2 usage 에러
 */

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

// ---------- 인자 파싱 ----------
const argv = process.argv.slice(2);
const opts = {
  html: null,
  section: null,
  viewport: "desktop",
  selector: null,
  wait: 500,
  timeout: 15000,
  help: false,
};

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "-h" || a === "--help") {
    opts.help = true;
  } else if (a.startsWith("--")) {
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith("--")) {
      console.error(`ERROR: ${a} requires a value`);
      process.exit(2);
    }
    if (key === "wait" || key === "timeout") {
      opts[key] = Number(val);
      if (Number.isNaN(opts[key])) {
        console.error(`ERROR: ${a} must be a number`);
        process.exit(2);
      }
    } else if (key in opts) {
      opts[key] = val;
    } else {
      console.error(`ERROR: unknown option ${a}`);
      process.exit(2);
    }
    i++;
  } else {
    console.error(`ERROR: unexpected arg ${a}`);
    process.exit(2);
  }
}

if (opts.help) {
  const src = await import("node:fs").then((m) =>
    m.readFileSync(new URL(import.meta.url), "utf8"),
  );
  const m = src.match(/\/\*\*([\s\S]*?)\*\//);
  console.log(m ? m[1].replace(/^\s*\*\s?/gm, "").trim() : "see source");
  process.exit(0);
}

if (!opts.html || !opts.section) {
  console.error("usage: render-spec-baseline.mjs --html <path> --section <id> [options]");
  process.exit(2);
}

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
};

if (!VIEWPORTS[opts.viewport]) {
  console.error(`ERROR: --viewport must be one of: ${Object.keys(VIEWPORTS).join(", ")}`);
  process.exit(2);
}

// HTML 경로 → URL 정규화
let targetUrl;
if (/^https?:\/\//.test(opts.html)) {
  targetUrl = opts.html;
} else {
  const abs = isAbsolute(opts.html) ? opts.html : resolve(process.cwd(), opts.html);
  if (!existsSync(abs)) {
    console.error(`ERROR: HTML 파일 없음: ${abs}`);
    process.exit(1);
  }
  targetUrl = pathToFileURL(abs).href;
}

const outPath = resolve(`baselines/${opts.section}/${opts.viewport}.png`);

function emit(payload) {
  console.log(JSON.stringify({ section: opts.section, viewport: opts.viewport, ...payload }));
}

// ---------- Playwright 로드 ----------
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch (e) {
  emit({
    status: "SKIPPED",
    reason: `playwright 미설치 (${e.message.split("\n")[0]}) — npm i -D playwright`,
  });
  process.exit(0);
}

let browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (e) {
  emit({
    status: "SKIPPED",
    reason: `chromium 미설치 — npx playwright install chromium`,
  });
  process.exit(0);
}

try {
  const context = await browser.newContext({ viewport: VIEWPORTS[opts.viewport] });
  const page = await context.newPage();
  await page.goto(targetUrl, { waitUntil: "networkidle", timeout: opts.timeout });
  if (opts.wait > 0) await page.waitForTimeout(opts.wait);

  mkdirSync(dirname(outPath), { recursive: true });

  if (opts.selector) {
    const el = await page.$(opts.selector);
    if (!el) {
      await browser.close();
      emit({ status: "ERROR", reason: `selector 매칭 없음: ${opts.selector}` });
      process.exit(1);
    }
    await el.screenshot({ path: outPath });
  } else {
    await page.screenshot({ path: outPath, fullPage: true });
  }

  await browser.close();
  emit({ status: "OK", path: outPath, source: targetUrl });
  process.exit(0);
} catch (e) {
  await browser.close().catch(() => {});
  emit({ status: "ERROR", reason: e.message.split("\n")[0] });
  process.exit(1);
}

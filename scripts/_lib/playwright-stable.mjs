// scripts/_lib/playwright-stable.mjs
/**
 * Playwright 측정 안정화 조건.
 * - fonts.ready 대기
 * - animation/transition 정지
 * - 이미지 loading 대기
 * - deviceScaleFactor 고정 (브라우저 컨텍스트 단계)
 * Note: stabilizePage injects a permanent style tag disabling animation/transition.
 *       Do not reuse the same page for animation-dependent assertions.
 */

export const STABLE_VIEWPORTS = Object.freeze({
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
});

export async function newStableContext(browser, viewport) {
  const vp = STABLE_VIEWPORTS[viewport];
  if (!vp) throw new Error(`unknown viewport: ${viewport}`);
  return browser.newContext({
    viewport: vp,
    deviceScaleFactor: 1,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
}

export async function stabilizePage(page, { url, timeout = 15000 }) {
  await page.goto(url, { waitUntil: "networkidle", timeout });
  // 웹폰트 로딩 완료 보장
  await page.evaluate(() => document.fonts?.ready ?? Promise.resolve());
  // 애니메이션/트랜지션 frozen
  await page.addStyleTag({
    content: `*, *::before, *::after { animation: none !important; transition: none !important; }`,
  });
  // 모든 이미지가 complete 인지
  await page.waitForFunction(
    () => Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0),
    { timeout: 5000 }
  ).catch(() => {
    // 일부 lazy-load 등이 timeout 일 수 있음 — 비동기 게이트로 SKIP 안 함
  });
}

/**
 * 환경 무결성 sanity check 메커니즘 (B2 — modern-retro-strict §retro-phase1-4 M1+M2).
 *
 * 메커니즘: dev 서버에 폰트 fallback / 콘솔 에러 / 손상된 woff2 가 있으면
 * baseline 도 같은 fallback 상태로 캡처되어 strict gate 가 영원히 PASS
 * (코드 vs baseline 일관). 캡처 직전 환경 검증 강제로 차단.
 *
 * 사용:
 *   const collector = attachConsoleErrorCollector(page);
 *   await page.goto(url, ...);
 *   await stabilizePage(page, { url });
 *   await assertEnvironmentClean({ page, errors: collector.errors, section, viewport });
 *   // → throw 시 baseline 캡처 abort
 *
 * Note: console error listener 는 goto 전에 박혀야 초기 로딩 에러까지 캡처.
 *       attachConsoleErrorCollector 를 page 생성 직후 호출.
 */

/**
 * 페이지에 console error / pageerror 수집기 부착. goto 전에 호출 권장.
 */
export function attachConsoleErrorCollector(page, { ignorePatterns = [] } = {}) {
  const errors = [];
  const isIgnored = (text) => ignorePatterns.some((p) => (p instanceof RegExp ? p.test(text) : text.includes(p)));
  const onConsole = (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (isIgnored(text)) return;
    errors.push(text);
  };
  const onPageError = (err) => {
    const text = `pageerror: ${err.message}`;
    if (isIgnored(text)) return;
    errors.push(text);
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  return {
    errors,
    detach() {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
    },
  };
}

/**
 * 캡처 직전 환경 무결성 검증. 실패 시 throw.
 *
 * 검증 항목:
 *   1. console / pageerror 0건 (woff2 OTS / 404 / decode 등)
 *   2. 사용 폰트 family 가 모두 document.fonts 에 등록되었는지 (link/font-face 누락 차단)
 *
 * fonts.ready 대기는 stabilizePage 가 이미 처리.
 *
 * @param {object} params
 * @param {import('playwright').Page} params.page
 * @param {string[]} params.errors - attachConsoleErrorCollector().errors
 * @param {string} [params.section]
 * @param {string} [params.viewport]
 * @param {boolean} [params.checkFonts=true] - 폰트 cross-check 활성화
 */
export async function assertEnvironmentClean({ page, errors, section = "?", viewport = "?", checkFonts = true }) {
  // 1. console / pageerror 0건
  if (errors && errors.length > 0) {
    const top = errors.slice(0, 10);
    throw new Error(
      `[env-sanity] section=${section} viewport=${viewport} 환경 무결성 실패 — 콘솔 에러 ${errors.length}건:\n` +
        top.map((e) => `  - ${e}`).join("\n") +
        (errors.length > 10 ? `\n  ... ${errors.length - 10}건 더` : "") +
        `\n\nbaseline 을 fallback 상태로 박지 않음. 에러 해결 후 재시도.\n` +
        `자주 보이는 케이스: woff2 손상 (Failed to decode / OTS parsing) → bootstrap 재실행 또는 woff2 재다운로드.`
    );
  }

  // 2. 사용 폰트 family ↔ document.fonts 등록 cross-check
  if (checkFonts) {
    const result = await page.evaluate(() => {
      const GENERIC = new Set(["serif", "sans-serif", "monospace", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "cursive", "fantasy", "inherit", "initial", "revert", "unset", "-apple-system", "blinkmacsystemfont"]);
      const stripQuotes = (s) => s.trim().replace(/^['"]|['"]$/g, "");
      const used = new Set();
      for (const el of document.querySelectorAll("*")) {
        const f = getComputedStyle(el).fontFamily;
        if (!f) continue;
        for (const name of f.split(",")) {
          const clean = stripQuotes(name);
          if (!GENERIC.has(clean.toLowerCase()) && clean.length > 0) used.add(clean);
        }
      }
      const loaded = new Set();
      for (const f of document.fonts) {
        if (f.status === "loaded") loaded.add(stripQuotes(f.family));
      }
      const missing = [...used].filter((u) => !loaded.has(u));
      return { used: [...used], loaded: [...loaded], missing };
    });
    if (result.missing.length > 0) {
      throw new Error(
        `[env-sanity] section=${section} viewport=${viewport} 폰트 등록 누락 ${result.missing.length}건: ${result.missing.join(", ")}\n` +
          `(사용된 family 중 document.fonts 에 'loaded' 상태로 등록 안 된 것)\n` +
          `→ index.html <link> 또는 fonts.css @font-face 추가 후 baseline 재캡처 필요.`
      );
    }
  }
}

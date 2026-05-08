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
 *   2. primary 사용 폰트가 document.fonts 에 등록되었는지 확인하고,
 *      OS/system/emoji fallback 은 실패가 아닌 diagnostic 으로 분리.
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
      const SYSTEM_FALLBACK = new Set([
        "arial",
        "apple color emoji",
        "apple sd gothic neo",
        "courier new",
        "georgia",
        "helvetica",
        "malgun gothic",
        "meiryo",
        "microsoft jhenghei",
        "microsoft yahei",
        "ms gothic",
        "ms pgothic",
        "noto color emoji",
        "noto sans cjk jp",
        "noto sans cjk kr",
        "noto sans cjk sc",
        "noto sans cjk tc",
        "noto sans jp",
        "noto sans kr",
        "noto sans sc",
        "noto sans symbols",
        "noto sans symbols 2",
        "segoe ui",
        "segoe ui emoji",
        "segoe ui symbol",
        "simsun",
        "tahoma",
        "times new roman",
        "trebuchet ms",
        "twemoji mozilla",
        "verdana",
        "맑은 고딕",
      ]);
      const stripQuotes = (s) => s.trim().replace(/^['"]|['"]$/g, "");
      const splitFontFamilies = (value) => {
        const out = [];
        let cur = "";
        let quote = null;
        for (const ch of value) {
          if ((ch === '"' || ch === "'") && !quote) {
            quote = ch;
            cur += ch;
            continue;
          }
          if (quote && ch === quote) {
            quote = null;
            cur += ch;
            continue;
          }
          if (ch === "," && !quote) {
            out.push(stripQuotes(cur));
            cur = "";
            continue;
          }
          cur += ch;
        }
        if (cur.trim()) out.push(stripQuotes(cur));
        return out.filter(Boolean);
      };
      const normalize = (s) => stripQuotes(s).toLowerCase();
      const isGeneric = (name) => GENERIC.has(normalize(name));
      const isSystemFallback = (name) => SYSTEM_FALLBACK.has(normalize(name));
      const sampleText = (el) => (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
      const primaryUsed = new Map();
      const fallbackUsed = new Map();
      const allUsed = new Set();
      const addSample = (map, family, el) => {
        const key = stripQuotes(family);
        if (!key) return;
        const cur = map.get(key) || { family: key, count: 0, samples: [] };
        cur.count += 1;
        const text = sampleText(el);
        if (text && cur.samples.length < 3) cur.samples.push({ tag: el.tagName, text });
        map.set(key, cur);
      };
      for (const el of document.querySelectorAll("*")) {
        const familyStack = splitFontFamilies(getComputedStyle(el).fontFamily || "");
        const meaningful = familyStack.filter((name) => !isGeneric(name));
        if (!meaningful.length) continue;
        meaningful.forEach((name) => allUsed.add(name));
        addSample(primaryUsed, meaningful[0], el);
        for (const name of meaningful.slice(1)) {
          addSample(fallbackUsed, name, el);
        }
      }
      const loaded = new Set();
      const failedFaces = [];
      for (const f of document.fonts) {
        if (f.status === "loaded") loaded.add(stripQuotes(f.family));
        else failedFaces.push({ family: stripQuotes(f.family), status: f.status, weight: f.weight, style: f.style });
      }
      const loadedLower = new Set([...loaded].map((name) => normalize(name)));
      const primaryMissing = [...primaryUsed.values()]
        .filter((entry) => !loadedLower.has(normalize(entry.family)) && !isSystemFallback(entry.family));
      const fallbackDiagnostics = [...fallbackUsed.values()]
        .filter((entry) => !loadedLower.has(normalize(entry.family)))
        .map((entry) => ({ ...entry, systemFallback: isSystemFallback(entry.family) }));
      return {
        used: [...allUsed],
        loaded: [...loaded],
        failedFaces,
        primaryMissing,
        fallbackDiagnostics,
      };
    });
    if (result.failedFaces.length > 0 || result.primaryMissing.length > 0) {
      const faceLines = result.failedFaces.map((f) => `  - ${f.family} (${f.weight || "?"}/${f.style || "?"}) status=${f.status}`);
      const primaryLines = result.primaryMissing.map((f) => {
        const sample = f.samples?.[0] ? ` sample=<${f.samples[0].tag}> "${f.samples[0].text}"` : "";
        return `  - ${f.family} (${f.count} elements)${sample}`;
      });
      throw new Error(
        `[env-sanity] section=${section} viewport=${viewport} 폰트 환경 실패\n` +
          (faceLines.length ? `document.fonts failed/loading faces:\n${faceLines.join("\n")}\n` : "") +
          (primaryLines.length ? `primary font 등록 누락:\n${primaryLines.join("\n")}\n` : "") +
          `fallback stack 의 OS/emoji/CJK family 는 FAIL 이 아니라 diagnostic 으로만 취급합니다.\n` +
          `→ primary webfont 는 index.html <link> 또는 fonts.css @font-face 로 로드해야 합니다.`
      );
    }
  }
}

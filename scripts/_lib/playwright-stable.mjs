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

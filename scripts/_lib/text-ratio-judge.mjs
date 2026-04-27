/**
 * text-ratio-judge.mjs — G6/G8 게이트의 임계값 + 판정 로직 SSoT.
 * 수집은 React/HTML 변형이 각자, 판정·report 출력은 공유.
 */

export const RATIO_THRESHOLD = 3;
/** alt 총량이 이 미만이면 ratio 검사 스킵 — 로고·아이콘 등 정당한 짧은 alt만 있는 경우 */
export const ALT_FLOOR_CHARS = 80;
export const RASTER_HEAVY_IMG_COUNT = 1;
export const RASTER_HEAVY_TEXT_MIN = 10;

/**
 * @param {{ totalText:number, totalAlt:number, totalImg:number, anyLiteral:boolean,
 *           section:string, files:number }} input
 * @returns {{ report:object, g6:boolean, g8:boolean }}
 */
export function judge({ totalText, totalAlt, totalImg, anyLiteral, section, files }) {
  const ratio = totalAlt === 0 ? Infinity : totalText / totalAlt;
  const rasterHeavy =
    totalImg >= RASTER_HEAVY_IMG_COUNT && totalText < RASTER_HEAVY_TEXT_MIN;
  const g6 = rasterHeavy
    ? false
    : totalAlt === 0 || totalAlt < ALT_FLOOR_CHARS || ratio >= RATIO_THRESHOLD;
  const g8 = anyLiteral || totalAlt < ALT_FLOOR_CHARS;
  const report = {
    section,
    files,
    textChars: totalText,
    altChars: totalAlt,
    imgCount: totalImg,
    ratio: totalAlt === 0 ? "∞ (no alt)" : ratio.toFixed(2),
    rasterHeavy,
    g6: g6 ? "PASS" : "FAIL",
    g8: g8 ? "PASS" : "FAIL",
    threshold: RATIO_THRESHOLD,
  };
  return { report, g6, g8 };
}

/**
 * 판정 결과를 JSON stdout + 사람 친화 stderr 로 출력. exit code 결정용 boolean 반환.
 */
export function writeReport({ report, g6, g8 }, totals) {
  console.log(JSON.stringify(report, null, 2));
  if (!g6 || !g8) {
    const reason = report.rasterHeavy
      ? `raster-heavy (img ${totals.totalImg} + text ${totals.totalText}자 < ${RASTER_HEAVY_TEXT_MIN})`
      : `text/alt=${report.ratio}, 임계 ${RATIO_THRESHOLD}:1`;
    console.error(`\n❌ G6/G8 FAIL — ${reason}.`);
    return false;
  }
  console.error(`✓ G6/G8 PASS (ratio ${report.ratio})`);
  return true;
}

/**
 * color-tokens.mjs — G4 게이트의 hex/rgb literal 검출 SSoT.
 * vite-react-ts (.tsx/.jsx) / html-static (.html/.css) 양쪽 게이트가 공유.
 */

export const HEX_PATTERN = /#[0-9A-Fa-f]{3,8}\b/g;
export const RGB_PATTERN = /rgba?\(\s*\d+[\s,]/g;

/** 중립 화이트리스트. 변경 시 모든 G4 변형이 일관되게 영향받음. */
export const ALLOWED_COLOR_LITERALS = new Set([
  "#fff",
  "#ffffff",
  "#FFF",
  "#FFFFFF",
  "#000",
  "#000000",
]);

/**
 * CSS 텍스트 (또는 inline style 문자열) 에서 hex/rgb literal 검출.
 * 화이트리스트는 자동 제외.
 */
export function scanCssTextForLiterals(text) {
  const failures = [];
  const hexes = text.match(HEX_PATTERN) || [];
  for (const h of hexes) {
    if (!ALLOWED_COLOR_LITERALS.has(h)) failures.push({ type: "hex-literal", value: h });
  }
  const rgbs = text.match(RGB_PATTERN) || [];
  for (const r of rgbs) failures.push({ type: "rgb-literal", value: r.trim() });
  return failures;
}

/**
 * walk.mjs — 디렉토리 재귀 스캔 (확장자 필터).
 * G4 / G6 / G8 게이트 스크립트들이 공유하는 파일 발견 로직.
 */

import { readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

/**
 * @param {string} target  파일 또는 디렉토리 경로
 * @param {Set<string>} extSet  허용 확장자 (예: new Set([".html", ".css"]))
 * @param {string[]} out  누적 결과 (재귀 호출용)
 * @returns {string[]}  매칭 파일 경로 배열
 */
export function walkByExt(target, extSet, out = []) {
  const st = statSync(target);
  if (st.isFile()) {
    if (extSet.has(extname(target))) out.push(target);
    return out;
  }
  for (const entry of readdirSync(target)) {
    const full = join(target, entry);
    const st2 = statSync(full);
    if (st2.isDirectory()) walkByExt(full, extSet, out);
    else if (extSet.has(extname(full))) out.push(full);
  }
  return out;
}

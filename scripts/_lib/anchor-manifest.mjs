/**
 * Anchor Manifest v2 헬퍼 — read/write/검증.
 *
 * 형식: baselines/<section>/anchors-<viewport>.json
 * {
 *   version: 2,
 *   section: string,
 *   viewport: "desktop"|"tablet"|"mobile",
 *   figmaPageWidth: number | null,    // B-1b: figma page frame 폭 (px). null 이면 normalize SKIP.
 *                                     //   anchor bbox 의 figma 좌표를 viewport scale 변환할 때
 *                                     //   기준이 되는 figma page width. extract-figma-anchors.mjs
 *                                     //   가 추출. self-capture (회피 회로) 의 경우 추출 불가 → null.
 *   source: "figma" | "self" | undefined,  // B-1 deprecated — 분석 원칙 #1: figma 가 유일한 진실의
 *                                     //   원천이라 source='self' 합법화 가정 자체가 권위 분산. 호환을
 *                                     //   위해 필드 read 는 가능하지만 'self' 인 manifest 는
 *                                     //   migrate-baselines.mjs 가 detect 후 자동 마이그레이션 강제.
 *   anchors: [
 *     {
 *       id: string,                   // 예: "hero/title"
 *       role: string,                 // section-root | primary-heading | primary-cta | primary-media | text-block | decorative | unknown
 *                                   //   (secondary-* and other open-ended values may appear in manifests but are not enumerated in ROLES)
 *       required: boolean,
 *       figmaNodeId: string | null,
 *       bbox: { x, y, w, h }          // figma 절대좌표 (절대 viewport 좌표 X). normalize 는
 *                                     //   check-visual-regression.mjs 의 L2 단계에서 figmaPageWidth
 *                                     //   기준으로 자동 처리.
 *     }
 *   ]
 * }
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const ROLES = Object.freeze({
  SECTION_ROOT: "section-root",
  PRIMARY_HEADING: "primary-heading",
  PRIMARY_CTA: "primary-cta",
  PRIMARY_MEDIA: "primary-media",
  TEXT_BLOCK: "text-block",
  DECORATIVE: "decorative",
  UNKNOWN: "unknown",
});

const REQUIRED_ROLES = new Set([
  ROLES.SECTION_ROOT,
  ROLES.PRIMARY_HEADING,
  ROLES.PRIMARY_CTA,
  ROLES.PRIMARY_MEDIA,
]);

export function readManifest(path) {
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (raw.version !== 2) {
    throw new Error(`anchor manifest version mismatch: ${path} v=${raw.version}`);
  }
  return raw;
}

export function writeManifest(path, manifest) {
  if (manifest.version !== 2) throw new Error("manifest must be version 2");
  if (!manifest.section || !manifest.viewport) throw new Error("section/viewport required");
  if (!Array.isArray(manifest.anchors)) throw new Error("anchors must be array");
  // figmaPageWidth: number | null. extract-figma-anchors 가 figma page frame 의
  // absoluteBoundingBox.width 추출. 추출 실패 (self-capture 등) → null.
  if (
    manifest.figmaPageWidth !== undefined &&
    manifest.figmaPageWidth !== null &&
    typeof manifest.figmaPageWidth !== "number"
  ) {
    throw new Error("figmaPageWidth must be number or null");
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
}

export function validateManifest(manifest) {
  const errors = [];
  if (!manifest) {
    errors.push("manifest is null");
    return errors;
  }
  if (!Array.isArray(manifest.anchors)) {
    errors.push("anchors field missing or not an array");
    return errors;
  }
  const ids = new Set();
  let hasRoot = false;
  for (const a of manifest.anchors) {
    if (!a.id || !a.role) errors.push(`anchor missing id/role: ${JSON.stringify(a)}`);
    if (ids.has(a.id)) errors.push(`duplicate anchor id: ${a.id}`);
    ids.add(a.id);
    if (a.role === ROLES.SECTION_ROOT) hasRoot = true;
    if (a.required && !a.bbox) errors.push(`required anchor ${a.id} missing bbox`);
  }
  if (!hasRoot) errors.push("section-root anchor missing");
  return errors;
}

export function isRequiredRole(role) {
  return REQUIRED_ROLES.has(role);
}

export function unknownRoleRatio(manifest) {
  if (!manifest || !manifest.anchors.length) return 0;
  const unknown = manifest.anchors.filter((a) => a.role === ROLES.UNKNOWN).length;
  return unknown / manifest.anchors.length;
}

/**
 * 매칭 룰 (개수별):
 * - required: 100% 강제 (모든 required 가 매칭되어야 함)
 * - optional ≤ 5: all required (zero missing)
 * - optional 6~10: 1 missing OK
 * - optional > 10: 2 missing OK
 *
 * @param {Array} required - required anchor 리스트
 * @param {Array} optional - optional anchor 리스트
 * @param {Set<string>} matchedIds - 코드에 매칭된 anchor id 집합
 * @returns {{pass: boolean, missing: Array, reason: string|null}}
 */
export function applyMatchingRule(required, optional, matchedIds) {
  const missingRequired = required.filter((a) => !matchedIds.has(a.id));
  if (missingRequired.length > 0) {
    return {
      pass: false,
      missing: missingRequired,
      reason: `required anchor missing: ${missingRequired.map((a) => a.id).join(", ")}`,
    };
  }
  const missingOptional = optional.filter((a) => !matchedIds.has(a.id));
  let allowedMissing;
  if (optional.length <= 5) allowedMissing = 0;
  else if (optional.length <= 10) allowedMissing = 1;
  else allowedMissing = 2;
  if (missingOptional.length > allowedMissing) {
    return {
      pass: false,
      missing: missingOptional,
      reason: `optional anchor missing > allowed (${missingOptional.length} > ${allowedMissing})`,
    };
  }
  return { pass: true, missing: missingOptional, reason: null };
}

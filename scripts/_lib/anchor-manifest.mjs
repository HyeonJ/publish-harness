/**
 * Anchor Manifest v2 헬퍼 — read/write/검증.
 *
 * 형식: baselines/<section>/anchors-<viewport>.json
 * {
 *   version: 2,
 *   section: string,
 *   viewport: "desktop"|"tablet"|"mobile",
 *   anchors: [
 *     {
 *       id: string,                   // 예: "hero/title"
 *       role: string,                 // section-root | primary-heading | primary-cta | primary-media | text-block | decorative | unknown
 *                                   //   (secondary-* and other open-ended values may appear in manifests but are not enumerated in ROLES)
 *       required: boolean,
 *       figmaNodeId: string | null,
 *       bbox: { x, y, w, h }
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

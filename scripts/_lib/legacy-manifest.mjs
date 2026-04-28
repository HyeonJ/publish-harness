/**
 * legacy.json 거버넌스 — createdBy 화이트리스트, sourceCommit, expiresAt 검증.
 *
 * 형식 v2:
 * {
 *   version: 2,
 *   reason: string,
 *   skipL2: boolean,
 *   skipViewports: ["tablet", "mobile"],
 *   createdAt: "YYYY-MM-DD",
 *   createdBy: "migrate-baselines" | "bootstrap",
 *   sourceCommit: "<git-hash>",
 *   expiresAt: "YYYY-MM-DD"
 * }
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const ALLOWED_CREATORS = Object.freeze(["migrate-baselines", "bootstrap"]);

export function readLegacy(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeLegacy(path, legacy) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(legacy, null, 2) + "\n");
}

/**
 * @returns {{valid: boolean, reason: string|null}}
 *
 * Note: 첫 번째 위반에서 즉시 반환 (anchor-manifest.mjs 의 validateManifest 가 errors[] 로
 * 전체 오류를 누적하는 것과 대조적) — 거버넌스 필드 하나라도 잘못되면 전체 manifest 가 무효.
 */
export function validateLegacy(legacy) {
  if (!legacy) return { valid: false, reason: "no legacy manifest" };
  if (legacy.version !== 2) return { valid: false, reason: `unsupported legacy version ${legacy.version}` };
  if (!ALLOWED_CREATORS.includes(legacy.createdBy)) {
    return { valid: false, reason: `invalid createdBy "${legacy.createdBy}" — only ${ALLOWED_CREATORS.join("/")} allowed` };
  }
  if (!legacy.sourceCommit || !/^[0-9a-f]{7,40}$/.test(legacy.sourceCommit)) {
    return { valid: false, reason: "missing or invalid sourceCommit" };
  }
  if (!legacy.expiresAt || !/^\d{4}-\d{2}-\d{2}$/.test(legacy.expiresAt)) {
    return { valid: false, reason: "missing or invalid expiresAt (YYYY-MM-DD)" };
  }
  const expires = new Date(legacy.expiresAt + "T23:59:59Z").getTime();
  if (Date.now() > expires) {
    return { valid: false, reason: `legacy expired ${legacy.expiresAt}` };
  }
  return { valid: true, reason: null };
}

/**
 * 신규 legacy 발급 (migrate-baselines 또는 bootstrap 만 호출)
 */
export function issueLegacy({ creator, reason, skipL2 = true, skipViewports = [], sourceCommit }) {
  if (!ALLOWED_CREATORS.includes(creator)) {
    throw new Error(`creator must be one of ${ALLOWED_CREATORS.join("/")}`);
  }
  const today = new Date();
  const expires = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return {
    version: 2,
    reason,
    skipL2,
    skipViewports,
    createdAt: fmt(today),
    createdBy: creator,
    sourceCommit,
    expiresAt: fmt(expires),
  };
}

export function renewLegacy(legacy, { sourceCommit }) {
  if (!ALLOWED_CREATORS.includes(legacy.createdBy)) {
    throw new Error(`cannot renew: invalid createdBy "${legacy.createdBy}"`);
  }
  const today = new Date();
  const expires = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);
  return {
    ...legacy,
    sourceCommit,
    expiresAt: expires.toISOString().slice(0, 10),
  };
}

/**
 * Unified SBPL startup-read policy for managed Codex paths.
 *
 * Exact file literals + ancestor/alias metadata only.
 * Never grants broad (subpath "/etc") or (subpath "/private/etc").
 * Never omits, rewrites, or stubs managed requirements content.
 */

import { dirname, resolve } from "node:path";
import { assertSbplSafePath } from "./codex-delegated-sandbox-roots.js";

/** Logical managed requirements path Codex opens at startup. */
export const CODEX_MANAGED_REQUIREMENTS_PATH = "/etc/codex/requirements.toml";

/**
 * macOS alias form: /etc → private/etc.
 * Both must be grantable as exact literals; never expand to whole /etc.
 */
export const CODEX_MANAGED_REQUIREMENTS_PRIVATE_PATH =
  "/private/etc/codex/requirements.toml";

/**
 * Sibling managed startup files the same loader may open.
 * Exact literals only — not a directory subpath grant.
 */
export const CODEX_MANAGED_STARTUP_READ_PATHS = Object.freeze([
  CODEX_MANAGED_REQUIREMENTS_PATH,
  CODEX_MANAGED_REQUIREMENTS_PRIVATE_PATH,
  "/etc/codex/config.toml",
  "/private/etc/codex/config.toml",
  "/etc/codex/managed_config.toml",
  "/private/etc/codex/managed_config.toml"
]);

/** Alias pairs that Seatbelt may see before/after symlink resolution. */
export const CODEX_ETC_ALIAS_PAIRS = Object.freeze([
  Object.freeze({ logical: "/etc", private: "/private/etc" }),
  Object.freeze({ logical: "/etc/codex", private: "/private/etc/codex" })
]);

function uniquePreserve(paths) {
  const out = [];
  for (const path of paths) {
    if (typeof path !== "string" || path.trim() === "") continue;
    const absolute = resolve(path);
    assertSbplSafePath(absolute, { role: "startupRead" });
    if (!out.includes(absolute)) out.push(absolute);
  }
  return out;
}

/**
 * Exact file paths allowed for file-read* (present or absent open attempts).
 * @param {string[]} [extra]
 * @param {string[]} [basePaths] override production managed list (tests only)
 */
export function managedStartupExactReadLiterals(extra = [], basePaths = CODEX_MANAGED_STARTUP_READ_PATHS) {
  return Object.freeze(uniquePreserve([...basePaths, ...extra]));
}

/**
 * Ancestors for realpath / open walk, including configured alias pairs.
 * Metadata only — never a substitute for exact file-read* literals.
 */
export function managedStartupMetadataAncestors({
  exactPaths = CODEX_MANAGED_STARTUP_READ_PATHS,
  aliasPairs = CODEX_ETC_ALIAS_PAIRS
} = {}) {
  const exact = managedStartupExactReadLiterals([], exactPaths);
  const ancestors = [];
  for (const path of exact) {
    let cur = path;
    while (cur !== "/" && cur !== "") {
      const parent = dirname(cur);
      if (parent === cur) break;
      ancestors.push(parent);
      cur = parent;
    }
  }
  for (const pair of aliasPairs) {
    if (pair?.logical) ancestors.push(pair.logical);
    if (pair?.private) ancestors.push(pair.private);
  }
  ancestors.push("/");
  return Object.freeze(uniquePreserve(ancestors));
}

/**
 * True when a profile body grants broad /etc reads — forbidden for this policy.
 */
export function profileGrantsBroadEtcRead(profileBody) {
  if (typeof profileBody !== "string") return false;
  return /\(subpath "\/etc"\)/.test(profileBody)
    || /\(subpath "\/private\/etc"\)/.test(profileBody);
}

/**
 * True when requirements exact literals (both alias forms) appear as file-read grants.
 */
export function profileGrantsExactRequirementsReads(profileBody) {
  if (typeof profileBody !== "string") return false;
  const readBlock = profileBody.includes("(allow file-read*")
    ? profileBody.split("(allow file-read*")[1].split("(allow file-write*")[0]
    : profileBody;
  return readBlock.includes(`(literal "${CODEX_MANAGED_REQUIREMENTS_PATH}")`)
    && readBlock.includes(`(literal "${CODEX_MANAGED_REQUIREMENTS_PRIVATE_PATH}")`);
}

/**
 * Classify an open attempt under the startup-read policy (offline oracle helper).
 * Does not modify managed requirements content.
 */
export function classifyManagedRequirementsOpen({
  path,
  exists,
  errno = null,
  allowedExactLiterals = managedStartupExactReadLiterals()
} = {}) {
  const absolute = resolve(path);
  const allowed = allowedExactLiterals.includes(absolute);
  if (!allowed) {
    return Object.freeze({
      outcome: "access_denied",
      reason: "path_not_in_exact_startup_read_allowlist",
      errno: errno ?? "EPERM"
    });
  }
  if (exists === true) {
    return Object.freeze({
      outcome: "present_readable",
      reason: "exact_literal_granted_and_file_exists",
      errno: null
    });
  }
  return Object.freeze({
    outcome: "absent",
    reason: "exact_literal_granted_file_missing",
    errno: errno ?? "ENOENT"
  });
}

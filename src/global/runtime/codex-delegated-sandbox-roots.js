/**
 * Canonical root validation for delegated-write OS sandbox profiles.
 * Uncertain resolution, personal aliases, broad roots, and forbidden overlaps
 * all fail closed before any SBPL grant.
 */

import { realpath as defaultRealpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DelegatedWriteOsSandboxError } from "./codex-delegated-sandbox-errors.js";

const BROAD_ROOTS = Object.freeze([
  "/",
  "/tmp",
  "/private/tmp",
  "/var",
  "/private/var",
  "/private/var/folders",
  "/Users",
  "/home"
]);

export function personalCodexHome(deps = {}) {
  return resolve(deps.personalCodexHome ?? join(deps.homedir?.() ?? homedir(), ".codex"));
}

export function isSameOrInside(candidate, root) {
  const c = resolve(candidate);
  const r = resolve(root);
  return c === r || c.startsWith(`${r}/`);
}

function uniquePaths(paths) {
  return [...new Set(paths.map((p) => resolve(p)))];
}

export async function resolveCanonicalRoot(path, { role = "root" } = {}, deps = {}) {
  if (typeof path !== "string" || path.trim() === "") {
    throw new DelegatedWriteOsSandboxError(
      `Canonical ${role} requires a non-empty path.`,
      { code: "delegated_write_root_required", details: { role, path } }
    );
  }

  const absolute = resolve(path);
  const realpath = deps.realpath ?? defaultRealpath;

  try {
    return resolve(await realpath(absolute));
  } catch {
    // Path may not exist yet — resolve via existing parent only.
  }

  try {
    const parentReal = resolve(await realpath(dirname(absolute)));
    return join(parentReal, basename(absolute));
  } catch (error) {
    throw new DelegatedWriteOsSandboxError(
      `Uncertain canonical resolution for ${role} — refusing permissions.`,
      {
        code: "delegated_write_root_resolution_uncertain",
        details: { role, path: absolute, cause: error?.message ?? String(error) }
      }
    );
  }
}

function assertNotBroadRoot(canonical, role, deps = {}) {
  const home = resolve(deps.homedir?.() ?? homedir());
  for (const broad of uniquePaths([...BROAD_ROOTS, home])) {
    if (canonical === broad) {
      throw new DelegatedWriteOsSandboxError(
        `${role} rejects broad root "${canonical}".`,
        { code: "delegated_write_broad_root_forbidden", details: { role, canonical, broad } }
      );
    }
  }
}

function assertNotPersonalAlias(canonical, role, personalCanon) {
  if (isSameOrInside(canonical, personalCanon)) {
    throw new DelegatedWriteOsSandboxError(
      `${role} aliases personal Codex state — forbidden.`,
      {
        code: "delegated_write_personal_provider_home_forbidden",
        details: { role, canonical, personalCodexHome: personalCanon }
      }
    );
  }
}

function assertNoForbiddenOverlap(allowed, forbidden) {
  for (const allow of allowed) {
    for (const deny of forbidden) {
      if (isSameOrInside(deny, allow)) {
        throw new DelegatedWriteOsSandboxError(
          "Allowed write root overlaps a forbidden path — refusing profile.",
          { code: "delegated_write_forbidden_overlap", details: { allowed: allow, forbidden: deny } }
        );
      }
      if (isSameOrInside(allow, deny) && allow !== deny) {
        throw new DelegatedWriteOsSandboxError(
          "Allowed write root sits under a forbidden path — refusing profile.",
          { code: "delegated_write_forbidden_overlap", details: { allowed: allow, forbidden: deny } }
        );
      }
    }
  }
}

/**
 * Validate and canonicalize roots before SBPL grants.
 */
export async function validateCanonicalDelegatedWriteRoots({
  workspaceRoot,
  providerHome,
  tempRoot,
  forbiddenExtra = []
} = {}, deps = {}) {
  let personalCanon;
  try {
    personalCanon = await resolveCanonicalRoot(
      personalCodexHome(deps),
      { role: "personalCodexHome" },
      deps
    );
  } catch {
    personalCanon = personalCodexHome(deps);
  }

  const workspaceCanon = await resolveCanonicalRoot(workspaceRoot, { role: "workspaceRoot" }, deps);
  const providerCanon = await resolveCanonicalRoot(providerHome, { role: "providerHome" }, deps);
  const tempCanon = await resolveCanonicalRoot(tempRoot, { role: "tempRoot" }, deps);

  for (const [role, canonical] of [
    ["workspaceRoot", workspaceCanon],
    ["providerHome", providerCanon],
    ["tempRoot", tempCanon]
  ]) {
    assertNotBroadRoot(canonical, role, deps);
    assertNotPersonalAlias(canonical, role, personalCanon);
  }

  const allowedWritePaths = uniquePaths([workspaceCanon, providerCanon, tempCanon]);
  const forbiddenWritePaths = uniquePaths([
    personalCanon,
    join(personalCanon, "config.toml"),
    resolve(workspaceCanon, "..", "outside-forbidden.txt"),
    "/etc/passwd",
    ...forbiddenExtra
  ]);

  assertNoForbiddenOverlap(allowedWritePaths, forbiddenWritePaths);

  return {
    workspaceRoot: workspaceCanon,
    providerHome: providerCanon,
    tempRoot: tempCanon,
    allowedWritePaths,
    forbiddenWritePaths,
    personalCodexHome: personalCanon
  };
}

export function assertIsolatedProviderHome(providerHome, deps = {}) {
  if (typeof providerHome !== "string" || providerHome.trim() === "") {
    throw new DelegatedWriteOsSandboxError(
      "Isolated providerHome is required (non-empty path).",
      { code: "delegated_write_provider_home_required" }
    );
  }
  const personal = personalCodexHome(deps);
  const absolute = resolve(providerHome);
  if (isSameOrInside(absolute, personal)) {
    throw new DelegatedWriteOsSandboxError(
      "providerHome must be isolated — writing personal ~/.codex is forbidden for delegated OS wrap.",
      {
        code: "delegated_write_personal_provider_home_forbidden",
        details: { providerHome: absolute, personalCodexHome: personal }
      }
    );
  }
  return absolute;
}

export function assertIsolatedTempRoot(tempRoot) {
  if (typeof tempRoot !== "string" || tempRoot.trim() === "") {
    throw new DelegatedWriteOsSandboxError(
      "Isolated tempRoot is required (non-empty path).",
      { code: "delegated_write_temp_root_required" }
    );
  }
  return resolve(tempRoot);
}

/**
 * Resolve the real Codex executable + narrow runtime read/exec roots for OS
 * sandbox prep. Never grants personal ~/.codex broadly; never write grants.
 */

import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { DelegatedWriteOsSandboxError } from "./codex-delegated-sandbox-errors.js";
import {
  assertSbplSafePath,
  isSameOrInside,
  personalCodexHome,
  resolveCanonicalRoot
} from "./codex-delegated-sandbox-roots.js";

const PATH_SEP = ":";

/** Roots that must never appear as SBPL runtime read/exec grants. */
const BROAD_RUNTIME_ROOTS = Object.freeze([
  "/",
  "/tmp",
  "/private/tmp",
  "/var",
  "/private/var",
  "/private/var/folders",
  "/Users",
  "/home",
  "/opt",
  "/usr",
  "/System",
  "/Library",
  "/bin",
  "/sbin"
]);

async function findExecutableOnPath(name, deps = {}) {
  const pathEnv = deps.pathEnv ?? process.env.PATH ?? "";
  const accessFn = deps.access ?? access;
  for (const dir of pathEnv.split(PATH_SEP)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      await accessFn(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // keep searching
    }
  }
  return null;
}

async function resolvePersonalCanon(deps = {}) {
  try {
    return await resolveCanonicalRoot(
      personalCodexHome(deps),
      { role: "personalCodexHome" },
      deps
    );
  } catch {
    return personalCodexHome(deps);
  }
}

/**
 * Refuse broad personal ~/.codex read grants. Under personal home, only
 * `packages/` (install artifacts) may be granted for read/exec.
 */
export function assertCodexRuntimeReadPathAllowed(path, personalCanon, { role = "runtimeRead" } = {}, deps = {}) {
  assertSbplSafePath(path, { role });
  const absolute = resolve(path);
  const home = resolve(deps.homedir?.() ?? homedir());

  for (const broad of [...BROAD_RUNTIME_ROOTS, home]) {
    if (absolute === resolve(broad)) {
      throw new DelegatedWriteOsSandboxError(
        `${role} rejects broad runtime root "${absolute}".`,
        {
          code: "delegated_write_runtime_broad_root_forbidden",
          details: { role, path: absolute, broad: resolve(broad) }
        }
      );
    }
  }

  if (absolute === personalCanon) {
    throw new DelegatedWriteOsSandboxError(
      "Refusing broad personal ~/.codex runtime grant — pin packages release only.",
      {
        code: "delegated_write_personal_codex_runtime_too_broad",
        details: { role, path: absolute, personalCodexHome: personalCanon }
      }
    );
  }
  if (isSameOrInside(absolute, personalCanon)) {
    const packagesRoot = join(personalCanon, "packages");
    if (!isSameOrInside(absolute, packagesRoot)) {
      throw new DelegatedWriteOsSandboxError(
        "Personal ~/.codex runtime grant allowed only under packages/ (not auth/config/state).",
        {
          code: "delegated_write_personal_codex_runtime_outside_packages",
          details: { role, path: absolute, packagesRoot }
        }
      );
    }
  }
  return absolute;
}

/**
 * Derive the pinned install root that must be readable/executable alongside
 * the binary (siblings: codex-path, codex-resources, other bins).
 */
export function deriveCodexPackageRoot(codexExecutable) {
  const absolute = resolve(codexExecutable);
  if (basename(dirname(absolute)) === "bin") {
    return dirname(dirname(absolute));
  }
  return dirname(absolute);
}

/**
 * Validate + canonicalize a caller-supplied runtime descriptor.
 * Never trusts paths as-is; never expands personal ~/.codex grants.
 */
export async function canonicalizeCodexOsSandboxRuntime(runtime, deps = {}) {
  if (!runtime || typeof runtime !== "object") {
    throw new DelegatedWriteOsSandboxError(
      "Codex OS-sandbox runtime descriptor required.",
      { code: "delegated_write_runtime_descriptor_required" }
    );
  }

  const personalCanon = await resolvePersonalCanon(deps);
  const accessFn = deps.access ?? access;

  if (typeof runtime.executable !== "string" || runtime.executable.trim() === "") {
    throw new DelegatedWriteOsSandboxError(
      "runtime.executable required — refusing OS-sandbox prep.",
      { code: "delegated_write_codex_executable_missing" }
    );
  }

  const executable = await resolveCanonicalRoot(
    runtime.executable,
    { role: "codexExecutable" },
    deps
  );
  assertCodexRuntimeReadPathAllowed(executable, personalCanon, { role: "codexExecutable" }, deps);

  try {
    await accessFn(executable, fsConstants.X_OK);
  } catch (error) {
    throw new DelegatedWriteOsSandboxError(
      "Codex executable is not executable — refusing OS-sandbox prep.",
      {
        code: "delegated_write_codex_executable_not_executable",
        details: { executable, cause: error?.message ?? String(error) }
      }
    );
  }

  const rawReads = Array.isArray(runtime.runtimeReadPaths) && runtime.runtimeReadPaths.length > 0
    ? runtime.runtimeReadPaths
    : [deriveCodexPackageRoot(executable), dirname(executable)];

  const runtimeReadPaths = [];
  for (const raw of rawReads) {
    if (typeof raw !== "string" || raw.trim() === "") {
      throw new DelegatedWriteOsSandboxError(
        "runtime.runtimeReadPaths entries must be non-empty strings.",
        { code: "delegated_write_runtime_read_path_invalid", details: { path: raw } }
      );
    }
    const canonical = await resolveCanonicalRoot(raw, { role: "runtimeReadPath" }, deps);
    assertCodexRuntimeReadPathAllowed(canonical, personalCanon, { role: "runtimeReadPath" }, deps);
    if (!runtimeReadPaths.includes(canonical)) runtimeReadPaths.push(canonical);
  }

  const packageRootRaw = typeof runtime.packageRoot === "string" && runtime.packageRoot.trim() !== ""
    ? runtime.packageRoot
    : deriveCodexPackageRoot(executable);
  const packageRoot = await resolveCanonicalRoot(
    packageRootRaw,
    { role: "codexPackageRoot" },
    deps
  );
  assertCodexRuntimeReadPathAllowed(packageRoot, personalCanon, { role: "codexPackageRoot" }, deps);
  if (!runtimeReadPaths.includes(packageRoot)) {
    runtimeReadPaths.push(packageRoot);
  }

  return Object.freeze({
    executable,
    packageRoot,
    runtimeReadPaths: Object.freeze([...runtimeReadPaths]),
    personalCodexHome: personalCanon,
    note: "Read/exec only for pinned package paths — never write to personal ~/.codex"
  });
}

/**
 * Resolve absolute Codex binary + narrow package read roots for SBPL.
 * Fail-closed: no PATH-relative bare "codex" for sandbox-exec argv.
 */
export async function resolveCodexOsSandboxRuntime(deps = {}) {
  const rawCandidate = deps.codexExecutable
    ?? await findExecutableOnPath("codex", deps);
  if (typeof rawCandidate !== "string" || rawCandidate.trim() === "") {
    throw new DelegatedWriteOsSandboxError(
      "Codex executable not found — refusing OS-sandbox prep (no unsandboxed fallback).",
      { code: "delegated_write_codex_executable_missing" }
    );
  }

  const executable = await resolveCanonicalRoot(
    rawCandidate,
    { role: "codexExecutable" },
    deps
  );

  return canonicalizeCodexOsSandboxRuntime({
    executable,
    packageRoot: deriveCodexPackageRoot(executable),
    runtimeReadPaths: [deriveCodexPackageRoot(executable), dirname(executable)]
  }, deps);
}

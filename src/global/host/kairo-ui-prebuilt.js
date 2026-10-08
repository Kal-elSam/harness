import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Supported npm-shipped kairo-ui prebuilt triples (darwin/linux × arm64/x64).
 * Windows stays an explicit `ui` error in the launcher — never packaged here.
 */
export const KAIRO_UI_PREBUILT_TARGETS = Object.freeze([
  Object.freeze({ platform: "darwin", arch: "arm64", key: "darwin-arm64" }),
  Object.freeze({ platform: "darwin", arch: "x64", key: "darwin-x64" }),
  Object.freeze({ platform: "linux", arch: "arm64", key: "linux-arm64" }),
  Object.freeze({ platform: "linux", arch: "x64", key: "linux-x64" })
]);

/**
 * Normalize Node/`uname` arch names to the package key stem.
 * @param {string} arch
 * @returns {"arm64"|"x64"|null}
 */
export function normalizePrebuiltArch(arch) {
  const value = typeof arch === "string" ? arch.trim().toLowerCase() : "";
  if (value === "arm64" || value === "aarch64") return "arm64";
  if (value === "x64" || value === "amd64" || value === "x86_64") return "x64";
  return null;
}

/**
 * @param {string} platform
 * @param {string} arch
 * @returns {string|null} e.g. `darwin-arm64`, or null when unsupported
 */
export function prebuiltBinaryKey(platform, arch) {
  const os =
    typeof platform === "string" ? platform.trim().toLowerCase() : "";
  const normalizedArch = normalizePrebuiltArch(arch);
  if ((os !== "darwin" && os !== "linux") || normalizedArch == null) {
    return null;
  }
  return `${os}-${normalizedArch}`;
}

/**
 * Repo-relative path to a prebuilt binary for the given platform/arch.
 * @param {string} platform
 * @param {string} arch
 * @returns {string|null}
 */
export function prebuiltBinaryRelativePath(platform, arch) {
  const key = prebuiltBinaryKey(platform, arch);
  if (key == null) return null;
  return join("dist", "kairo-ui", key, "kairo-ui");
}

/**
 * Resolve an absolute path to a shipped prebuilt when present.
 * Returns null when the triple is unsupported or the file is missing
 * (caller should fall back to cargo build for local/dev).
 *
 * @param {{
 *   platform?: string,
 *   arch?: string,
 *   packageRoot: string,
 *   existsSyncImpl?: (path: string) => boolean
 * }} args
 * @returns {string|null}
 */
export function resolvePrebuiltBinary({
  platform = process.platform,
  arch = process.arch,
  packageRoot,
  existsSyncImpl = existsSync
} = {}) {
  if (typeof packageRoot !== "string" || packageRoot.trim() === "") {
    return null;
  }
  const relative = prebuiltBinaryRelativePath(platform, arch);
  if (relative == null) return null;
  const absolute = join(packageRoot, relative);
  return existsSyncImpl(absolute) ? absolute : null;
}

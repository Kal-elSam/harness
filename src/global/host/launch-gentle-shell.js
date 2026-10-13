/** Shared Pi RPC resources and Ratatui routing; no interactive Pi launcher. */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHomeDir } from "../paths.js";
import { assertProductUiNotRetired } from "./launch-ratatui-host.js";

export const KAIRO_PI_PACKAGE_NAME = "@kal-elsam/kairo-pi-coding-agent";
export const KAIRO_PI_PACKAGE_VERSION = "0.87.1-kairo.5";
export const MIN_NODE_VERSION = "22.19.0";

const __hostModuleDir = dirname(fileURLToPath(import.meta.url));
/** Absolute path to the Kairo Pi extension used by the Ratatui RPC engine. */
export const DEFAULT_EXTENSION_DIR = join(__hostModuleDir, "extension");

/**
 * Pi CLI flags that load only Kairo's extension and disable ambient resources.
 * @param {string} extensionDir
 * @returns {string[]}
 */
export function buildKairoPiResourceArgs(extensionDir) {
  if (typeof extensionDir !== "string" || !extensionDir.startsWith("/")) {
    throw new Error("Kairo extension path must be absolute.");
  }
  return [
    "-e",
    extensionDir,
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files"
  ];
}

export function routeInteractiveHost({ command, options = {}, env = process.env }) {
  assertProductUiNotRetired({ options, env });
  if (command === "shell" || command === "host") return "ratatui";
  return null;
}

/** Settings path shared with the runtime extension. */
export function resolveKairoPiSettingsPath(env) {
  return join(resolveHomeDir(env), ".harness", "pi-agent", "settings.json");
}

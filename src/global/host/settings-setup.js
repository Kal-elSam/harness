/**
 * U2: native setup inside Settings (no Clack/readline in Ratatui).
 *
 * Three pure-ish adapters over the existing setup core:
 *   - loadSetupOptions: agents (with detected flags) + component catalog + defaults
 *   - previewSetup:     dry-run plan summary + fingerprint (writes nothing)
 *   - applySetup:       confirm:true AND a fingerprint matching a freshly
 *                       recomputed preview, then installGlobalHarness
 *
 * Domain errors are returned as `{ ok:false, reason, error }`; nothing throws
 * to the transport. Consent follows `assertExplicitApplyConsent`.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertExplicitApplyConsent } from "../apply-confirmation.js";
import { buildSetupPreview } from "../clack/setup-preview.js";
import {
  DEFAULT_COMPONENT_IDS,
  describeComponentCatalog,
  validateComponentIds
} from "../component-registry.js";
import { installGlobalHarness } from "../global-installer.js";
import { resolveHomeDir } from "../paths.js";
import {
  GLOBAL_AGENT_IDS,
  detectInstalledAdapters,
  listAdapters,
  resolveAgentIds
} from "../registry.js";
import { PACKAGE_NAME } from "../brand/cli.js";

const DEFAULT_PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
/** Keep the preview record bounded for the JSONL transport. */
const MAX_PREVIEW_CHANGES = 200;

function readPackageIdentity(packageRoot) {
  try {
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    return {
      packageName: typeof manifest?.name === "string" ? manifest.name : PACKAGE_NAME,
      cliVersion: typeof manifest?.version === "string" ? manifest.version : "unknown"
    };
  } catch {
    return { packageName: PACKAGE_NAME, cliVersion: "unknown" };
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Validate a UI selection. Agents must be a non-empty list of known ids; an
 * empty component list means "core plumbing only" (noDefaultComponents).
 * @returns {{ agents: string[], components: string[], noDefaultComponents: boolean }}
 */
function normalizeSelection({ agents, components }, { homeDir, workspaceRoot }) {
  if (!Array.isArray(agents) || agents.length === 0) {
    throw new Error("Select at least one agent.");
  }
  const resolvedAgents = [...new Set(resolveAgentIds(agents.map(String), { homeDir }))];
  const requested = Array.isArray(components) ? [...new Set(components.map(String))] : [];
  const validated = validateComponentIds(requested, { workspaceRoot });
  return {
    agents: resolvedAgents,
    components: validated,
    noDefaultComponents: validated.length === 0
  };
}

function fingerprintOf(selection, changes) {
  const canonical = JSON.stringify({
    agents: [...selection.agents].sort(),
    components: [...selection.components].sort(),
    noDefaultComponents: selection.noDefaultComponents,
    changes: changes.map((c) => [c.kind, c.action, c.target, c.status])
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function installArgsFor(selection, ctx) {
  return {
    packageRoot: ctx.packageRoot,
    packageName: ctx.packageName,
    cliVersion: ctx.cliVersion,
    homeDir: ctx.homeDir,
    workspaceRoot: ctx.workspaceRoot,
    agents: selection.agents,
    components: selection.noDefaultComponents ? null : selection.components,
    noDefaultComponents: selection.noDefaultComponents
  };
}

function resolveContext({
  homeDir = resolveHomeDir(),
  workspaceRoot = null,
  packageRoot = DEFAULT_PACKAGE_ROOT,
  packageName,
  cliVersion
} = {}) {
  const identity = readPackageIdentity(packageRoot);
  return {
    homeDir,
    workspaceRoot,
    packageRoot,
    packageName: packageName ?? identity.packageName,
    cliVersion: cliVersion ?? identity.cliVersion
  };
}

async function computePreview(input, ctx, previewFn) {
  const selection = normalizeSelection(input, ctx);
  const built = await previewFn({
    ...installArgsFor(selection, ctx),
    components: selection.noDefaultComponents ? null : selection.components
  });
  const changes = Array.isArray(built?.preflight?.changes) ? built.preflight.changes : [];
  return { selection, built, changes };
}

/**
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function loadSetupOptions(options = {}) {
  const ctx = resolveContext(options);
  try {
    const detected = new Set(detectInstalledAdapters({ homeDir: ctx.homeDir }));
    const agents = listAdapters().map((adapter) => ({
      id: adapter.id,
      label: adapter.label ?? adapter.id,
      detected: detected.has(adapter.id)
    }));
    const components = describeComponentCatalog({ workspaceRoot: ctx.workspaceRoot }).map((c) => ({
      id: c.id,
      label: c.label ?? c.id,
      description:
        typeof c.instructions === "string" && c.instructions.trim()
          ? c.instructions.trim().split("\n")[0]
          : (c.capabilities ?? []).join(", "),
      defaultEnabled: Boolean(c.defaultEnabled),
      dependencies: c.dependencies ?? []
    }));
    const detectedIds = agents.filter((a) => a.detected).map((a) => a.id);
    return {
      ok: true,
      agents,
      components,
      defaults: {
        agents: detectedIds.length > 0 ? detectedIds : [...GLOBAL_AGENT_IDS],
        components: [...DEFAULT_COMPONENT_IDS]
      }
    };
  } catch (error) {
    return { ok: false, reason: "load_failed", error: messageOf(error) };
  }
}

/**
 * Dry-run only. Never writes config, state or backups.
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function previewSetup({
  agents,
  components,
  previewFn = buildSetupPreview,
  ...contextOptions
} = {}) {
  const ctx = resolveContext(contextOptions);
  let computed;
  try {
    computed = await computePreview({ agents, components }, ctx, previewFn);
  } catch (error) {
    return { ok: false, reason: "invalid_selection", error: messageOf(error) };
  }
  const { selection, built, changes } = computed;
  return {
    ok: true,
    fingerprint: fingerprintOf(selection, changes),
    agents: selection.agents,
    components: selection.components,
    noDefaultComponents: selection.noDefaultComponents,
    summary: built?.preflight?.summary ?? "No managed changes planned.",
    changeCount: changes.length,
    changes: changes.slice(0, MAX_PREVIEW_CHANGES).map((c) => ({
      kind: c.kind,
      action: c.action,
      target: c.target,
      status: c.status
    })),
    truncated: changes.length > MAX_PREVIEW_CHANGES
  };
}

/**
 * Apply only when `confirm === true` AND `fingerprint` matches a preview
 * recomputed right now for the same selection.
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function applySetup({
  agents,
  components,
  fingerprint,
  confirm,
  previewFn = buildSetupPreview,
  installFn = installGlobalHarness,
  ...contextOptions
} = {}) {
  if (confirm !== true) {
    return { ok: false, reason: "not_confirmed", error: "Apply requires explicit confirmation." };
  }
  const ctx = resolveContext(contextOptions);
  let computed;
  try {
    computed = await computePreview({ agents, components }, ctx, previewFn);
  } catch (error) {
    return { ok: false, reason: "invalid_selection", error: messageOf(error) };
  }
  const { selection, changes } = computed;
  if (
    typeof fingerprint !== "string" ||
    fingerprint.length === 0 ||
    fingerprint !== fingerprintOf(selection, changes)
  ) {
    return {
      ok: false,
      reason: "stale_preview",
      error: "Preview is missing or out of date. Preview again before applying."
    };
  }
  try {
    assertExplicitApplyConsent({
      applying: true,
      dryRun: false,
      json: false,
      confirm: true,
      interactive: false,
      command: "setup"
    });
    await installFn({ ...installArgsFor(selection, ctx), dryRun: false });
  } catch (error) {
    return { ok: false, reason: "apply_failed", error: messageOf(error) };
  }
  return {
    ok: true,
    reason: "applied",
    agents: selection.agents,
    components: selection.components,
    noDefaultComponents: selection.noDefaultComponents,
    changeCount: changes.length
  };
}

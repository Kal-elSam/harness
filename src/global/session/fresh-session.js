import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { defaultDeps, tryGit } from "./continue.js";
import { dirname, join } from "node:path";
import { harnessHomePaths, resolveHomeDir } from "../paths.js";
import { projectKeyForPath } from "../next/project-key.js";
import { getProjectProfilePath } from "../profile.js";

/**
 * Task types (S5). "small" = no feature document for the branch; "feature" = a feature document exists;
 * "investigation" has no automatic signal for a hypothesis change, so it is never suggested automatically
 * (the user runs `kairo continue` / `/kairo-continue` by hand).
 */
export const DEFAULT_FRESH_SESSION_CONFIG = Object.freeze({
  enabled: true,
  feature: Object.freeze({ contextPercent: 40 })
});

const WARNING_PREFIX = "kairo: session.freshSessionSuggest ignored";

const isPlainObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

/** Validates the `session.freshSessionSuggest` value. Invalid input yields the defaults and one warning. */
export function resolveFreshSessionConfig(raw) {
  if (raw === undefined) return { config: DEFAULT_FRESH_SESSION_CONFIG, warning: null };
  const invalid = why => ({ config: DEFAULT_FRESH_SESSION_CONFIG, warning: `${WARNING_PREFIX} (${why}); using the defaults.` });
  if (!isPlainObject(raw)) return invalid("expected an object");
  if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") return invalid("enabled must be a boolean");
  if (raw.feature !== undefined && !isPlainObject(raw.feature)) return invalid("feature must be an object");
  const percent = raw.feature?.contextPercent;
  if (percent !== undefined && (typeof percent !== "number" || !Number.isFinite(percent) || percent <= 0 || percent > 100)) {
    return invalid("feature.contextPercent must be a number above 0 and at most 100");
  }
  return {
    config: {
      enabled: raw.enabled ?? DEFAULT_FRESH_SESSION_CONFIG.enabled,
      feature: { contextPercent: percent ?? DEFAULT_FRESH_SESSION_CONFIG.feature.contextPercent }
    },
    warning: null
  };
}

/** Reads `.harness/kairo.json` (the project config) synchronously: a hook-time read must stay cheap. */
export function readFreshSessionConfig(deps, root) {
  const file = getProjectProfilePath(root);
  let text;
  try {
    text = (deps.fs?.readFileSync ?? readFileSync)(file, "utf8");
  } catch {
    return { config: DEFAULT_FRESH_SESSION_CONFIG, warning: null };
  }
  try {
    const parsed = JSON.parse(text);
    return resolveFreshSessionConfig(isPlainObject(parsed) ? parsed.session?.freshSessionSuggest : undefined);
  } catch {
    return { config: DEFAULT_FRESH_SESSION_CONFIG, warning: `${WARNING_PREFIX} (${file} is not valid JSON); using the defaults.` };
  }
}

/**
 * Pure stable-point decision (S3). Suggest only when a task just closed (the commit trigger wrote a new
 * checkpoint), the working tree is clean, and the context fill reached the threshold for the task type.
 */
export function decideFreshSession({ taskType, checkpointWritten, clean, contextPercent, config = DEFAULT_FRESH_SESSION_CONFIG } = {}) {
  const no = reason => ({ suggest: false, reason });
  if (!config?.enabled) return no("suggestion disabled");
  if (taskType !== "feature") return no(taskType === "investigation" ? "investigation: use kairo continue by hand" : "small task");
  if (checkpointWritten !== true) return no("no new checkpoint");
  if (clean !== true) return no("working tree is not clean");
  if (typeof contextPercent !== "number" || !Number.isFinite(contextPercent)) return no("context fill unknown");
  if (contextPercent < config.feature.contextPercent) return no("below the threshold");
  return { suggest: true, reason: "delivery closed, checkpoint saved, tree clean, threshold reached" };
}

export function suggestionMessage(contextPercent) {
  return `Delivery closed and checkpoint saved (context ${Math.round(contextPercent)}%). Start a fresh session: run kairo continue in a new terminal, or /kairo-continue.`;
}

function markerPath(deps, root, feature, head) {
  const home = deps.homeDir ?? resolveHomeDir();
  const safe = value => String(value).replace(/[^\w.-]/g, "_");
  return join(harnessHomePaths(home).sessionsDir, projectKeyForPath(root), "checkpoints", `${safe(feature)}.suggested.${safe(head)}`);
}

/**
 * The decision the host hook asks for after a commit trigger. `input` is the commit trigger's JSON result
 * plus the host's `contextPercent`. Never throws, never starts or closes anything; a suggestion is shown at
 * most once per HEAD (recorded in a small marker file, written only when a suggestion is made).
 */
export function runFreshSessionDecision(input, options = {}, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  try {
    if (!isPlainObject(input)) return { suggest: false, reason: "no trigger result" };
    // The hook's cwd can be a subdirectory: the config and the marker belong to the repository root, as the checkpoint's do.
    const cwd = options.cwd ?? process.cwd();
    const root = tryGit(deps, ["rev-parse", "--show-toplevel"], cwd, cwd) || cwd;
    const { config, warning } = readFreshSessionConfig(deps, root);
    if (warning) deps.stderr(`${warning}\n`);
    const decision = decideFreshSession({
      taskType: input.taskType,
      checkpointWritten: input.written,
      clean: input.clean,
      contextPercent: input.contextPercent,
      config
    });
    if (!decision.suggest) return decision;
    if (typeof input.head !== "string" || !input.head || typeof input.feature !== "string" || !input.feature) {
      return { suggest: false, reason: "no HEAD to key the suggestion on" };
    }
    // One exclusive-create marker file per HEAD: the first caller wins, any other (or a later one) sees EEXIST.
    const marker = markerPath(deps, root, input.feature, input.head);
    try {
      (deps.fs?.mkdirSync ?? mkdirSync)(dirname(marker), { recursive: true });
      (deps.fs?.writeFileSync ?? writeFileSync)(marker, String(input.head), { flag: "wx" });
    } catch (error) {
      // Without a marker the once-per-HEAD promise cannot hold: stay silent rather than repeat.
      return error?.code === "EEXIST" ? { suggest: false, reason: "already suggested for this HEAD" } : { suggest: false, reason: "marker not writable" };
    }
    return { ...decision, message: suggestionMessage(input.contextPercent) };
  } catch (error) {
    return { suggest: false, reason: `decision skipped (${error.message})` };
  }
}

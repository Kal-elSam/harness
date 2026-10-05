/**
 * Classify global canary startup failures separately from probe outcomes.
 * Startup stderr must never become external-denial evidence.
 * Does not invent preference grants — unidentified resources stay unidentified.
 */

export const CANARY_STARTUP_FAILURE_KIND = Object.freeze({
  EXECUTABLE_NOT_FOUND: "executable_not_found",
  CODEX_HOME_CANONICALIZE: "codex_home_canonicalize",
  MANAGED_REQUIREMENTS_READ: "managed_requirements_read",
  MANAGED_PREFERENCES_SYNC: "managed_preferences_sync",
  STDIN_PROMPT: "stdin_prompt",
  UNKNOWN_STARTUP: "unknown_startup"
});

const STARTUP_RULES = Object.freeze([
  {
    kind: CANARY_STARTUP_FAILURE_KIND.EXECUTABLE_NOT_FOUND,
    re: /execvp\(\)\s+of\s+'codex'\s+failed|sandbox-exec:.*codex.*no such file or directory/i
  },
  {
    kind: CANARY_STARTUP_FAILURE_KIND.CODEX_HOME_CANONICALIZE,
    re: /failed to canonicalize CODEX_HOME|canonicalize CODEX_HOME/i
  },
  {
    kind: CANARY_STARTUP_FAILURE_KIND.MANAGED_REQUIREMENTS_READ,
    re: /requirements\.toml|\/etc\/codex\/requirements/i
  },
  {
    kind: CANARY_STARTUP_FAILURE_KIND.MANAGED_PREFERENCES_SYNC,
    re: /synchronize managed preferences|managed preferences \(code -?32600\)/i
  },
  {
    // Advisory only unless the process actually failed — successful runs may
    // print "Reading additional input from stdin..." without a startup fault.
    kind: CANARY_STARTUP_FAILURE_KIND.STDIN_PROMPT,
    re: /Reading additional input from stdin/i,
    requiresProcessFailure: true
  }
]);

function combineText(...parts) {
  return parts.filter((part) => part != null && part !== "").map(String).join("\n");
}

function hasProcessFailureSignal({ exitCode, launchError }) {
  if (exitCode != null && exitCode !== 0) return true;
  if (launchError == null || launchError === "") return false;
  if (typeof launchError === "string") return launchError.trim() !== "";
  return true;
}

/**
 * Detect a global startup failure from process text / launchError.
 * Returns null when no known startup failure signature matches.
 * Stdin advisory text alone with successful execution is not a failure.
 */
export function classifyCanaryStartupFailure({
  stderr = "",
  stdout = "",
  launchError = null,
  exitCode = null
} = {}) {
  const fromError = typeof launchError === "string"
    ? launchError
    : combineText(launchError?.message, launchError?.code, launchError?.stderr);
  const text = combineText(stderr, stdout, fromError);
  if (!text.trim()) return null;

  const processFailed = hasProcessFailureSignal({ exitCode, launchError });

  for (const rule of STARTUP_RULES) {
    if (!rule.re.test(text)) continue;
    if (rule.requiresProcessFailure && !processFailed) continue;

    return Object.freeze({
      kind: rule.kind,
      probesExecuted: false,
      exitCode: exitCode ?? null,
      excerpt: text.slice(0, 400),
      // Preferences/path denials stay unidentified — do not expand grants here.
      deniedResourceIdentified: rule.kind !== CANARY_STARTUP_FAILURE_KIND.MANAGED_PREFERENCES_SYNC
        && rule.kind !== CANARY_STARTUP_FAILURE_KIND.UNKNOWN_STARTUP,
      note: rule.kind === CANARY_STARTUP_FAILURE_KIND.MANAGED_PREFERENCES_SYNC
        ? "Managed-preferences failure recorded without identifying the denied preference resource; no preference permission expansion."
        : rule.kind === CANARY_STARTUP_FAILURE_KIND.STDIN_PROMPT
          ? "Stdin advisory treated as startup failure only because the process did not succeed."
          : null
    });
  }

  // thread/start config load failures without a more specific signature
  if (/thread\/start failed|failed to load configuration/i.test(text)) {
    return Object.freeze({
      kind: CANARY_STARTUP_FAILURE_KIND.UNKNOWN_STARTUP,
      probesExecuted: false,
      exitCode: exitCode ?? null,
      excerpt: text.slice(0, 400),
      deniedResourceIdentified: false,
      note: "Startup/config failure without identified denied resource; no permission expansion."
    });
  }

  return null;
}

/** True when text looks like global startup failure (not probe-linked denial). */
export function isGlobalStartupFailureText(text) {
  return classifyCanaryStartupFailure({ stderr: text }) != null;
}

/**
 * Structured denial attached from global stderr is never valid probe evidence.
 */
export function isMisattributedStartupDenial(source) {
  if (!source || typeof source !== "object") return false;
  if (source.scope === "global_startup" || source.source === "startup_stderr") return true;
  const blob = combineText(source.message, source.error, source.aggregated_output, source.code);
  return isGlobalStartupFailureText(blob);
}

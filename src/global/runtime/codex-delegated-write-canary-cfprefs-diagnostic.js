/**
 * Controlled cfprefs SHM diagnostic — offline profile delta + PID-linked capture.
 *
 * Changes ONLY observed apple.cfprefs.* ipc-posix-shm-read-data names.
 * Does not prove Codex -32600 clears. Does not spawn a live canary.
 * Does not alter production buildDelegatedWriteSandboxProfile grants.
 *
 * Syntax precedent (not a Codex proof): macOS
 * /System/Library/Sandbox/Profiles/system.sb uses
 * (allow ipc-posix-shm-read* (ipc-posix-name-prefix "apple.cfprefs.")).
 */

import { createHash } from "node:crypto";

export const CFPREFS_DIAGNOSTIC_KIND = "cfprefs_shm_read_data_only";

/** Default log window pad around the observed spawn interval. */
export const DEFAULT_SANDBOX_LOG_PAD_MS = 2000;

/**
 * Exact SHM names denied in run …T123142 for uid 501.
 * daemonv1 is shared; the per-user segment uses apple.cfprefs.<uid>v1.
 */
export function cfprefsObservedShmNames(uid = process.getuid?.() ?? 501) {
  const numeric = Number(uid);
  if (!Number.isInteger(numeric) || numeric < 0) {
    throw new Error("cfprefs diagnostic requires a non-negative integer uid");
  }
  return Object.freeze([
    `apple.cfprefs.${numeric}v1`,
    "apple.cfprefs.daemonv1"
  ]);
}

/**
 * Exact SBPL allow block. Read-data only — no write-create, no notification_center.
 */
export function buildCfprefsShmReadDataAllowRule({ uid = process.getuid?.() ?? 501 } = {}) {
  const names = cfprefsObservedShmNames(uid);
  const nameRules = names.map((name) => `  (ipc-posix-name "${name}")`).join("\n");
  return `(allow ipc-posix-shm-read-data\n${nameRules})`;
}

function normalizeProfileBody(body) {
  if (typeof body !== "string" || body.trim() === "") {
    throw new Error("profile body required");
  }
  return body.replace(/\s+$/u, "") + "\n";
}

/**
 * Append the diagnostic delta to a baseline profile. All prior grants stay verbatim.
 */
export function appendCfprefsDiagnosticDelta(baselineBody, { uid = process.getuid?.() ?? 501 } = {}) {
  const baseline = normalizeProfileBody(baselineBody);
  const rule = buildCfprefsShmReadDataAllowRule({ uid });
  if (baseline.includes(rule)) {
    return Object.freeze({
      kind: CFPREFS_DIAGNOSTIC_KIND,
      body: baseline,
      rule,
      names: cfprefsObservedShmNames(uid),
      alreadyPresent: true,
      baselineSha256: sha256Text(baseline),
      variantSha256: sha256Text(baseline)
    });
  }
  const body = `${baseline}\n${rule}\n`;
  return Object.freeze({
    kind: CFPREFS_DIAGNOSTIC_KIND,
    body,
    rule,
    names: cfprefsObservedShmNames(uid),
    alreadyPresent: false,
    baselineSha256: sha256Text(baseline),
    variantSha256: sha256Text(body)
  });
}

function sha256Text(text) {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

/**
 * Strip the diagnostic allow block (exact rule text) for surface comparison.
 */
export function stripCfprefsDiagnosticDelta(profileBody, { uid = process.getuid?.() ?? 501 } = {}) {
  const rule = buildCfprefsShmReadDataAllowRule({ uid });
  const without = normalizeProfileBody(profileBody).replace(`\n${rule}\n`, "\n").replace(`${rule}\n`, "");
  return normalizeProfileBody(without);
}

/**
 * True when variant === baseline + exact cfprefs rule only (whitespace-normalized ends).
 */
export function profilePermissionsOtherwiseIntact(baselineBody, variantBody, { uid = process.getuid?.() ?? 501 } = {}) {
  const stripped = stripCfprefsDiagnosticDelta(variantBody, { uid });
  return normalizeProfileBody(baselineBody) === stripped;
}

/**
 * Bounded capture window for log show / unified log extraction.
 */
export function buildSandboxLogWindow({
  startedAt,
  endedAt,
  padBeforeMs = DEFAULT_SANDBOX_LOG_PAD_MS,
  padAfterMs = DEFAULT_SANDBOX_LOG_PAD_MS
} = {}) {
  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(endedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error("startedAt/endedAt must be parseable ISO timestamps");
  }
  if (endMs < startMs) {
    throw new Error("endedAt must be >= startedAt");
  }
  const windowStartMs = startMs - Math.max(0, padBeforeMs);
  const windowEndMs = endMs + Math.max(0, padAfterMs);
  return Object.freeze({
    startedAt,
    endedAt,
    padBeforeMs: Math.max(0, padBeforeMs),
    padAfterMs: Math.max(0, padAfterMs),
    windowStartIso: new Date(windowStartMs).toISOString(),
    windowEndIso: new Date(windowEndMs).toISOString(),
    windowStartMs,
    windowEndMs
  });
}

/**
 * Observed process tree for linkage (sandbox-exec + descendants).
 * @param {{ pid: number, ppid?: number|null, comm: string }[]} nodes
 */
export function freezeObservedProcessTree(nodes = []) {
  const tree = (Array.isArray(nodes) ? nodes : []).map((node) => {
    const pid = Number(node?.pid);
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error("observed tree node requires positive integer pid");
    }
    const comm = typeof node?.comm === "string" ? node.comm.trim() : "";
    if (!comm) throw new Error("observed tree node requires comm");
    const ppid = node?.ppid == null ? null : Number(node.ppid);
    return Object.freeze({
      pid,
      ppid: Number.isInteger(ppid) && ppid >= 0 ? ppid : null,
      comm
    });
  });
  return Object.freeze(tree);
}

export function treePidSet(tree) {
  return new Set(freezeObservedProcessTree(tree).map((node) => node.pid));
}

/**
 * Parse offender identity from a Sandbox kernel / log line.
 * Example: `Sandbox: codex(12345) deny(1) ipc-posix-shm-read-data apple.cfprefs.501v1`
 */
export function parseSandboxOffenderEvent(line) {
  if (typeof line !== "string" || line.trim() === "") return null;
  const match = line.match(
    /Sandbox:\s+([^\s(]+)\((\d+)\)\s+(deny|allow)\((\d+)\)\s+(\S+)(?:\s+(.+))?/i
  );
  if (!match) return null;
  const resource = typeof match[6] === "string" ? match[6].trim() : "";
  return Object.freeze({
    offenderProcess: match[1],
    offenderPid: Number(match[2]),
    decision: match[3].toLowerCase(),
    decisionCode: Number(match[4]),
    operation: match[5],
    resource: resource || null,
    raw: line.trim()
  });
}

export function parseSandboxOffenderEvents(text) {
  const lines = String(text ?? "").split(/\r?\n/u);
  const events = [];
  for (const line of lines) {
    const event = parseSandboxOffenderEvent(line);
    if (event) events.push(event);
  }
  return Object.freeze(events);
}

/**
 * Link events to the observed tree by offender PID (not by process name alone).
 */
export function linkSandboxEventsToObservedTree(events, observedTree, { sandboxExecPid = null } = {}) {
  const pids = treePidSet(observedTree);
  if (sandboxExecPid != null) {
    const pid = Number(sandboxExecPid);
    if (Number.isInteger(pid) && pid > 0) pids.add(pid);
  }
  const linked = [];
  const unlinked = [];
  for (const event of events) {
    if (pids.has(event.offenderPid)) linked.push(event);
    else unlinked.push(event);
  }
  const linkedCfprefs = linked.filter(isCfprefsShmEvent);
  const unlinkedCfprefs = unlinked.filter(isCfprefsShmEvent);
  return Object.freeze({
    linked: Object.freeze(linked),
    unlinked: Object.freeze(unlinked),
    linkedCfprefs: Object.freeze(linkedCfprefs),
    unlinkedCfprefs: Object.freeze(unlinkedCfprefs),
    treePids: Object.freeze([...pids].sort((a, b) => a - b)),
    // Unlinked non-tree PIDs in the same wall window are expected noise.
    // Cfprefs events whose offenderPid is outside the tree cannot diagnose this run.
    hasPidLinkedCfprefsSignal: linkedCfprefs.length > 0,
    hasPidUnlinkedCfprefsSignal: unlinkedCfprefs.length > 0,
    inconclusivePidUnlinked:
      linkedCfprefs.length === 0 && unlinkedCfprefs.length > 0
  });
}

function isCfprefsShmEvent(event) {
  const resource = event?.resource;
  return typeof resource === "string" && resource.startsWith("apple.cfprefs.");
}

/**
 * Full offline capture plan for a future authorized diagnostic run.
 * Does not execute log show or spawn.
 */
export function buildPidLinkedSandboxCapturePlan({
  startedAt,
  endedAt,
  padBeforeMs = DEFAULT_SANDBOX_LOG_PAD_MS,
  padAfterMs = DEFAULT_SANDBOX_LOG_PAD_MS,
  sandboxExecPid = null,
  observedTree = [],
  uid = process.getuid?.() ?? 501
} = {}) {
  const window = buildSandboxLogWindow({
    startedAt,
    endedAt,
    padBeforeMs,
    padAfterMs
  });
  const tree = freezeObservedProcessTree(observedTree);
  const pids = treePidSet(tree);
  if (sandboxExecPid != null) pids.add(Number(sandboxExecPid));

  return Object.freeze({
    kind: "pid_linked_sandbox_log_capture",
    diagnostic: CFPREFS_DIAGNOSTIC_KIND,
    window,
    sandboxExecPid: sandboxExecPid == null ? null : Number(sandboxExecPid),
    observedTree: tree,
    treePids: Object.freeze([...pids].sort((a, b) => a - b)),
    cfprefsNames: cfprefsObservedShmNames(uid),
    noiseNames: Object.freeze([
      "apple.shm.notification_center",
      "vfs.disk-space"
    ]),
    requirements: Object.freeze([
      "Record startedAt/endedAt from the real spawn interval",
      "Capture sandbox-exec PID and observed child tree (pid, ppid, comm) during the run",
      "Extract Sandbox events only inside windowStartIso..windowEndIso",
      "Parse offenderProcess + offenderPid from each event; do not link by process name alone",
      "Keep events whose offenderPid is outside the tree as unlinked noise",
      "Without linked cfprefs events (or clear absence after grant), result is inconclusive_pid_unlinked"
    ]),
    logShowPredicateHint:
      'eventMessage CONTAINS "Sandbox:" AND (eventMessage CONTAINS "cfprefs" OR eventMessage CONTAINS "ipc-posix-shm" OR eventMessage CONTAINS "notification_center" OR eventMessage CONTAINS "vfs.disk-space")',
    syntaxPrecedent: Object.freeze({
      path: "/System/Library/Sandbox/Profiles/system.sb",
      note:
        "Apple uses (ipc-posix-name-prefix \"apple.cfprefs.\") with ipc-posix-shm-read*. "
        + "That validates filter syntax only — it does not prove Codex -32600 clears."
    }),
    doesNotProveCodexFix: true
  });
}

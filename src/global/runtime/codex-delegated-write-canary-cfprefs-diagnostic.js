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

const DEFAULT_UID = 501;

/**
 * Exact SHM names denied in run …T123142 for uid 501.
 * daemonv1 is shared; the per-user segment uses apple.cfprefs.<uid>v1.
 */
export function cfprefsObservedShmNames(uid = DEFAULT_UID) {
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
export function buildCfprefsShmReadDataAllowRule({ uid = DEFAULT_UID } = {}) {
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

function countExactOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (from <= haystack.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    count += 1;
    from = at + needle.length;
  }
  return count;
}

/**
 * Expected Arm-B body: baseline + exactly one trailing copy of the rule.
 * Does not delete or rewrite matches inside the baseline.
 */
export function expectedCfprefsDiagnosticVariant(baselineBody, { uid = DEFAULT_UID } = {}) {
  const baseline = normalizeProfileBody(baselineBody);
  const rule = buildCfprefsShmReadDataAllowRule({ uid });
  return Object.freeze({
    baseline,
    rule,
    body: `${baseline}\n${rule}\n`,
    baselineRuleCount: countExactOccurrences(baseline, rule)
  });
}

/**
 * Append the diagnostic delta to a baseline profile. All prior grants stay verbatim.
 * If the exact rule already appears once in the baseline, returns it unchanged
 * (`alreadyPresent: true`). That means **no differential treatment** relative to
 * the baseline — not a valid A/B Arm B profile. Duplicate preexistence refuses.
 */
export function appendCfprefsDiagnosticDelta(baselineBody, { uid = DEFAULT_UID } = {}) {
  const { baseline, rule, body, baselineRuleCount } = expectedCfprefsDiagnosticVariant(
    baselineBody,
    { uid }
  );
  const names = cfprefsObservedShmNames(uid);

  if (baselineRuleCount > 1) {
    throw new Error(
      "cfprefs diagnostic baseline already contains the exact rule more than once"
    );
  }
  if (baselineRuleCount === 1) {
    return Object.freeze({
      kind: CFPREFS_DIAGNOSTIC_KIND,
      body: baseline,
      rule,
      names,
      alreadyPresent: true,
      baselineSha256: sha256Text(baseline),
      variantSha256: sha256Text(baseline)
    });
  }

  return Object.freeze({
    kind: CFPREFS_DIAGNOSTIC_KIND,
    body,
    rule,
    names,
    alreadyPresent: false,
    baselineSha256: sha256Text(baseline),
    variantSha256: sha256Text(body)
  });
}

function sha256Text(text) {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

/**
 * True when variant is exactly baseline + one trailing exact rule,
 * or baseline already contains that rule once and variant === baseline.
 * Never strips arbitrary occurrences to force a match.
 */
export function profilePermissionsOtherwiseIntact(
  baselineBody,
  variantBody,
  { uid = DEFAULT_UID } = {}
) {
  const { baseline, rule, body: expectedFresh } = expectedCfprefsDiagnosticVariant(
    baselineBody,
    { uid }
  );
  const actual = normalizeProfileBody(variantBody);
  const baselineCount = countExactOccurrences(baseline, rule);
  const actualCount = countExactOccurrences(actual, rule);

  if (baselineCount > 1 || actualCount > 1) return false;
  if (baselineCount === 1) {
    return actual === baseline && actualCount === 1;
  }
  return actual === expectedFresh && actualCount === 1;
}

/**
 * Positive integer PID (rejects 0, negative, NaN, non-integers).
 */
export function assertPositivePid(value, role = "pid") {
  const pid = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`${role} requires a positive integer pid`);
  }
  return pid;
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
    const pid = assertPositivePid(node?.pid, "observed tree node");
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

const SANDBOX_EVENT_RE =
  /Sandbox:\s+([^\s(]+)\((\d+)\)\s+(deny|allow)\((\d+)\)\s+(\S+)(?:\s+(.+))?/i;

/**
 * Parse offender identity from a Sandbox kernel / log line (single physical line).
 * Invalid PIDs throw — never silently coerce.
 */
export function parseSandboxOffenderEvent(line) {
  if (typeof line !== "string" || line.trim() === "") return null;
  const match = line.match(SANDBOX_EVENT_RE);
  if (!match) return null;
  const offenderPid = assertPositivePid(match[2], "sandbox offender");
  const resource = typeof match[6] === "string" ? match[6].trim() : "";
  return Object.freeze({
    offenderProcess: match[1],
    offenderPid,
    decision: match[3].toLowerCase(),
    decisionCode: Number(match[4]),
    operation: match[5],
    resource: resource || null,
    raw: line.trim()
  });
}

function isRelevantUnparsedLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return /sandbox|cfprefs|ipc-posix|notification_center|vfs\.disk-space/i.test(trimmed);
}

function coalesceMultilineSandboxLog(text) {
  const rawLines = String(text ?? "").split(/\r?\n/u);
  const physical = [];
  let pending = null;

  const flushPending = () => {
    if (pending != null) {
      physical.push(pending);
      pending = null;
    }
  };

  for (const line of rawLines) {
    if (/^\s+/.test(line) && pending != null) {
      pending = `${pending} ${line.trim()}`;
      continue;
    }
    flushPending();
    if (/Sandbox:\s+/i.test(line)) {
      pending = line.trimEnd();
      continue;
    }
    physical.push(line);
  }
  flushPending();
  return physical;
}

/**
 * Parse Sandbox offender events from a log extract.
 * Coalesces indented continuation lines onto the preceding Sandbox: header.
 * Preserves relevant non-parsed lines (never silent-drop).
 */
export function parseSandboxOffenderEvents(text) {
  const physicalLines = coalesceMultilineSandboxLog(text);
  const events = [];
  const unparsedRelevantLines = [];

  for (const line of physicalLines) {
    if (typeof line !== "string" || line.trim() === "") continue;
    try {
      const event = parseSandboxOffenderEvent(line);
      if (event) {
        events.push(event);
        continue;
      }
    } catch (error) {
      unparsedRelevantLines.push(Object.freeze({
        line: line.trim(),
        reason: error instanceof Error ? error.message : String(error)
      }));
      continue;
    }
    if (isRelevantUnparsedLine(line)) {
      unparsedRelevantLines.push(Object.freeze({
        line: line.trim(),
        reason: "unrecognized_sandbox_shaped_or_cfprefs_line"
      }));
    }
  }

  return Object.freeze({
    events: Object.freeze(events),
    unparsedRelevantLines: Object.freeze(unparsedRelevantLines)
  });
}

/**
 * Link events to the observed tree by offender PID (not by process name alone).
 */
export function linkSandboxEventsToObservedTree(events, observedTree, { sandboxExecPid = null } = {}) {
  const pids = treePidSet(observedTree);
  if (sandboxExecPid != null) {
    pids.add(assertPositivePid(sandboxExecPid, "sandboxExecPid"));
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
  uid = DEFAULT_UID
} = {}) {
  const window = buildSandboxLogWindow({
    startedAt,
    endedAt,
    padBeforeMs,
    padAfterMs
  });
  const tree = freezeObservedProcessTree(observedTree);
  const pids = treePidSet(tree);
  const execPid = sandboxExecPid == null
    ? null
    : assertPositivePid(sandboxExecPid, "sandboxExecPid");
  if (execPid != null) pids.add(execPid);

  return Object.freeze({
    kind: "pid_linked_sandbox_log_capture",
    diagnostic: CFPREFS_DIAGNOSTIC_KIND,
    window,
    sandboxExecPid: execPid,
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
      "Keep relevant unparsed lines (multiline leftovers, unknown Sandbox shapes); never treat silent parse miss as no-deny",
      "Keep events whose offenderPid is outside the tree as unlinked noise",
      "inconclusive_pid_unlinked only when cfprefs events exist but none link to the tree — not when B has a clean allow path with zero cfprefs denials"
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

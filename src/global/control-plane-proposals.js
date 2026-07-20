/**
 * Deterministic evidence-backed control-plane proposals.
 * Optional intelligence absence never yields a proposal.
 * Health strings match CONTROL_PLANE_HEALTH in control-plane-snapshot.js.
 */

export const PROPOSAL_SEVERITY = Object.freeze({
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  INFO: "info"
});

export const PROPOSAL_DESTINATION = Object.freeze({
  CHANGES: "changes",
  CONTROL_CENTER: "control-center",
  IDES: "ides",
  MODULES: "modules",
  ACTIVITY: "activity",
  PROFILE: "profile"
});

const SEVERITY_RANK = Object.freeze({
  high: 0,
  medium: 1,
  low: 2,
  info: 3
});

const ACTIONABLE = new Set(["missing", "stale", "warning", "failed"]);

/**
 * Derive proposals only from status, checks, diff, adapters, and policy.
 * No proposal without evidence; deduped by id; severity then id order.
 */
export function buildControlPlaneProposals({
  health = null,
  status = null,
  adapters = null,
  policy = null,
  diff = null
} = {}) {
  const out = [];

  if (health === "NOT_CONFIGURED" || status?.overall === "missing") {
    out.push(make(
      "setup-local",
      PROPOSAL_SEVERITY.HIGH,
      "Finish local setup",
      status?.nextAction ?? "Configure the local ecosystem before applying repairs.",
      PROPOSAL_DESTINATION.CHANGES,
      [
        ev("status", "status.overall", status?.overall ?? "missing"),
        ev("health", "control-plane.health", health ?? "NOT_CONFIGURED")
      ]
    ));
  }

  const hasDiff = Boolean(diff?.hasChanges);
  const isDrift = status?.overall === "drift" || health === "ACTION_REQUIRED";
  if (hasDiff || isDrift) {
    const evidence = [
      ...(diff?.changes ?? []).slice(0, 8).map((change) =>
        ev("diff", "diff.change", change.target ?? change.path ?? change.action ?? "managed-change")),
      ...(status?.checks ?? [])
        .filter((check) => (check.status === "stale" || check.status === "missing") && !isIntel(check))
        .slice(0, 8)
        .map((check) => ev("check", `status.checks.${check.name}`, check.status)),
      ev("status", "status.overall", status?.overall ?? "drift")
    ];
    out.push(make(
      "repair-drift",
      PROPOSAL_SEVERITY.HIGH,
      "Review and repair managed drift",
      status?.nextAction
        ?? (hasDiff
          ? `${diff.changeCount ?? diff.changes?.length ?? 0} managed change(s) pending preview.`
          : "Managed content has drifted from the expected inventory."),
      PROPOSAL_DESTINATION.CHANGES,
      evidence
    ));
  }

  if (health === "CHECK_FAILED" || status?.overall === "failed") {
    const failed = (status?.checks ?? [])
      .filter((check) => (check.status === "failed" || check.status === "missing") && !isIntel(check));
    if (failed.length === 0) {
      out.push(make(
        "verify-failed-overall",
        PROPOSAL_SEVERITY.HIGH,
        "Investigate failed governance checks",
        status?.nextAction ?? "Doctor reported a failed overall status.",
        PROPOSAL_DESTINATION.CONTROL_CENTER,
        [ev("status", "status.overall", status?.overall ?? "failed")]
      ));
    } else {
      for (const check of failed) {
        out.push(make(
          `verify-check-${slug(check.name)}`,
          PROPOSAL_SEVERITY.HIGH,
          `Investigate check: ${check.name}`,
          check.detail ?? `Check status is ${check.status}.`,
          PROPOSAL_DESTINATION.CONTROL_CENTER,
          [
            ev("check", `status.checks.${check.name}`, check.status),
            ev("status", "status.overall", status?.overall ?? "failed")
          ]
        ));
      }
    }
  }

  const matrix = adapters?.adapters ?? status?.agents ?? [];
  for (const entry of matrix) {
    if (!entry?.detected || entry.managed) continue;
    out.push(make(
      `govern-adapter-${slug(entry.id)}`,
      PROPOSAL_SEVERITY.MEDIUM,
      `Govern detected agent: ${entry.id}`,
      `${entry.id} is detected locally but not managed by Kairo.`,
      PROPOSAL_DESTINATION.IDES,
      [
        ev("adapter", `adapters.${entry.id}.detected`, "true"),
        ev("adapter", `adapters.${entry.id}.managed`, "false")
      ]
    ));
  }

  const effective = policy ?? status?.policy ?? null;
  if (effective?.applyMode && effective.applyMode !== "confirm") {
    out.push(make(
      "review-policy-apply-mode",
      PROPOSAL_SEVERITY.LOW,
      "Review apply mode policy",
      `Effective applyMode is "${effective.applyMode}". Confirm intentional deviation from confirm-gated applies.`,
      PROPOSAL_DESTINATION.PROFILE,
      [ev("policy", "policy.applyMode", String(effective.applyMode))]
    ));
  }

  for (const check of status?.checks ?? []) {
    if (isIntel(check) || !ACTIONABLE.has(check.status)) continue;

    if (isExternal(check)) {
      out.push(make(
        `external-${slug(check.name)}`,
        check.status === "missing" || check.status === "failed"
          ? PROPOSAL_SEVERITY.MEDIUM
          : PROPOSAL_SEVERITY.LOW,
        `Review external integration: ${check.name}`,
        externalDetail(check.detail ?? `Check status is ${check.status}.`),
        PROPOSAL_DESTINATION.MODULES,
        [
          ev("check", `status.checks.${check.name}`, check.status),
          ev("integration", "check.category", check.category ?? "integration")
        ]
      ));
      continue;
    }

    if (check.status !== "warning" && check.status !== "stale") continue;
    const isBackup = check.category === "backups";
    out.push(make(
      `warning-${slug(check.name)}`,
      isBackup ? PROPOSAL_SEVERITY.INFO : PROPOSAL_SEVERITY.LOW,
      isBackup ? `Note: ${check.name}` : `Review note: ${check.name}`,
      check.detail ?? `Check status is ${check.status}.`,
      isBackup ? PROPOSAL_DESTINATION.ACTIVITY : PROPOSAL_DESTINATION.CONTROL_CENTER,
      [ev("check", `status.checks.${check.name}`, check.status)]
    ));
  }

  return finalize(out);
}

function finalize(candidates) {
  const byId = new Map();
  for (const item of candidates) {
    if (!item?.id || !item.evidence?.length) continue;
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()].sort((left, right) => {
    const rank = (SEVERITY_RANK[left.severity] ?? 99) - (SEVERITY_RANK[right.severity] ?? 99);
    return rank !== 0 ? rank : left.id.localeCompare(right.id);
  });
}

function make(id, severity, title, detail, destination, evidence) {
  return {
    id,
    severity,
    title,
    detail,
    destination,
    evidence: evidence.map((entry) => ({
      type: String(entry.type),
      source: String(entry.source),
      ref: String(entry.ref)
    }))
  };
}

function ev(type, source, ref) {
  return { type, source, ref: String(ref) };
}

function isIntel(check) {
  return check?.category === "intelligence" || check?.name === "intelligence providers";
}

function isExternal(check) {
  const name = check?.name ?? "";
  return name.startsWith("engram:") || name.startsWith("graphify:");
}

function externalDetail(detail) {
  if (/runtime.?active|not runtime/i.test(detail)) return detail;
  return `${detail} Configuration/version/freshness evidence only — not a claim of active runtime.`;
}

function slug(value) {
  return String(value ?? "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    || "unknown";
}

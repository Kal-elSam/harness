import { resolveAssignmentAvailability } from "./assignment-availability.js";
import { formatSlashUsageLines } from "./usage-summary.js";
import { explainTeamDecision } from "./team-decision.js";
// ANSI tone helper shared with the legacy cockpit: slash diagnostics keep their
// exact coloured output, so the same `theme.fg` must produce it.
import { theme } from "../cockpit/theme.js";

/**
 * Slash-command diagnostics (`/usage`, `/providers`, `/status`, `/models`,
 * `/models --evidence`, `/why`) as pure functions of a conversation snapshot.
 * Moved verbatim from the legacy cockpit view so the Ratatui sidecar no
 * longer has to construct that widget class to render them.
 */

function compactNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "unknown";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

function shortWindowName(name) {
  return { rolling: "roll", weekly: "week", monthly: "month" }[name] ?? name;
}

/**
 * Model shown for a role in the compact widget: whichever one Kairo
 * would actually use right now — the primary when it's available, else
 * the fallback when that's available, else null (nothing eligible
 * covers this role). Never the unavailable primary itself: showing an
 * unusable model as the headline is exactly the confusion this method
 * exists to avoid — the full primary/fallback/availability breakdown
 * stays one level down, in aiTeamDetailLines().
 */
export function effectiveTeamModel({ primary, fallback }) {
  if (primary.available) return primary;
  if (fallback?.available) return fallback;
  return null;
}

/**
 * A model's displayed name — deliberately WITHOUT its provider. Used by
 * the MODEL TEAMS widget and the plain /models view: a "Perfil → Modelo"
 * glance, provider hidden (adapterId is kept internally for every real
 * decision — concentration limits, corroboration, execution — this only
 * affects what's shown). `/models --evidence` shows the provider
 * explicitly instead (see aiTeamLabelWithProvider) — that's the audit
 * trail where it belongs.
 */
// modelName (real, cleaned via model-candidate-catalog.js's
// stripDisplayVariant — e.g. "GPT-5.6 Sol", never "GPT-5.6 Sol 1M
// Extra High") is preferred everywhere a compact widget shows a model.
// A caller not yet routed through the Recommendation Pool (no real
// modelName attached) falls back to the raw displayName, then modelId
// — never blank.
export function aiTeamLabel(model) {
  return model.modelName ?? model.displayName ?? model.modelId;
}

/** Same as aiTeamLabel(), but with the real provider AND the raw, unmodified display text (variant/effort/context tokens intact) — deliberately NOT the cleaned modelName, since this is the technical `/models --evidence` breakdown, which keeps the real detail modelName strips out. */
export function aiTeamLabelWithProvider(model) {
  const provider = model.adapterId.charAt(0).toUpperCase() + model.adapterId.slice(1);
  const raw = model.displayName ?? model.modelId;
  return `${provider} · ${raw}`;
}

/**
 * The global "AI TEAM" widget: one line per role (Explorer / Architect /
 * Builder / Debugger / Tester / Reviewer) naming only the
 * model that would actually run right now. This is the general team,
 * not a per-project portfolio: which of these roles a given repo
 * activates is a separate, later decision. Kept deliberately terse —
 * the real distribution policy behind each pick (capability margins,
 * fallback, why it isn't always the raw top score) lives in
 * aiTeamDetailLines(), reachable via /models, not cluttering the glance.
 */
export function fitLines(snapshot) {
  const intel = snapshot?.modelIntelligence;
  if (!intel || intel.status === "unknown") {
    const reason = intel?.error ? ` (${intel.error})` : "";
    return [theme.fg("muted", `No model benchmark data yet${reason}`)];
  }
  const freshness = intel.status === "live" ? "live" : `cached ${intel.age ?? "?"}`;
  // QUALITY TEAM: the real, portfolio-coordinated pick — not a bare
  // per-role leaderboard. The uncoordinated individual leader
  // (globalGuide.capability) is evidence, surfaced in /models, never the
  // dashboard headline — see teamsColumnsLines()'s own comment for why.
  const team = intel.aiTeam ?? [];
  if (!team.length) {
    const reasons = Object.entries(intel.eligibility ?? {})
      .filter(([, check]) => !check.ok)
      .map(([adapterId, check]) => `${adapterId}: ${check.reason}`);
    return [theme.fg("muted", `Evidence: ${freshness}`), theme.fg("warning", "No eligible model signals right now"), ...reasons.map((r) => theme.fg("muted", r))];
  }
  const lines = [theme.fg("muted", `Evidence: ${freshness}`)];
  for (const entry of team) {
    const effective = effectiveTeamModel(entry);
    const modelText = effective ? aiTeamLabel(effective) : theme.fg("warning", "no eligible option right now");
    lines.push(`${entry.role.padEnd(10)} ${modelText}`);
  }
  lines.push(theme.fg("muted", "Use /models for why, and /why for coverage and eligibility."));
  return lines;
}

/**
 * The default, human-readable `/models` output: per role, the selected
 * model, why (via explainTeamDecision — real reason or leader/blurb
 * formulation), the EFFICIENT TEAM alternative when it actually differs,
 * and the real fallback used if the selection becomes unavailable.
 * Deliberately no raw metrics, percentages, internal ids, or source
 * names — that detail moves to /models --evidence (aiTeamDetailLines()).
 */
export function modelsExplainLines(snapshot) {
  const intel = snapshot?.modelIntelligence;
  if (!intel || intel.status === "unknown") return fitLines(snapshot);
  const aiTeam = intel.aiTeam ?? [];
  if (!aiTeam.length) return fitLines(snapshot);
  const efficientByRole = Object.fromEntries((intel.efficientTeam ?? []).map((entry) => [entry.role, entry]));
  const leaderByRole = Object.fromEntries((intel.globalGuide?.capability ?? []).map((entry) => [entry.role, entry]));
  const freshness = intel.status === "live" ? "live" : `cached ${intel.age ?? "?"}`;
  const lines = [theme.fg("muted", `Evidence: ${freshness}`)];
  aiTeam.forEach((entry, index) => {
    const { role, primary, fallback } = entry;
    // A blank string here would get silently dropped once routed through
    // the persisted chat transcript (addTranscript trims and discards
    // empty text) — a visible divider is the only separator that
    // actually survives into the real, persisted chat history.
    if (index > 0) lines.push(theme.fg("muted", "·"));
    const availabilityNote = primary.available ? "" : " (currently unavailable)";
    lines.push(`${role.padEnd(10)} ${aiTeamLabel(primary)}${availabilityNote}`);
    lines.push(theme.fg("muted", `  ${explainTeamDecision(entry)}`));

    // The uncoordinated individual leader (globalGuide) — evidence for
    // "what's honestly best with nothing else in play?", never the
    // dashboard headline. Only worth a line when it actually differs
    // from the QUALITY TEAM pick — a diversity/concentration reason
    // above already implies it does; a null reason means they agree.
    const leaderEntry = leaderByRole[role];
    if (leaderEntry?.primary && (leaderEntry.primary.adapterId !== primary.adapterId || leaderEntry.primary.modelId !== primary.modelId)) {
      lines.push(theme.fg("muted", `  Individual leader: ${aiTeamLabel(leaderEntry.primary)} — the raw per-role best, uncoordinated with the rest of the team.`));
    }

    const efficientEntry = efficientByRole[role];
    if (efficientEntry) {
      const samePick = efficientEntry.primary.adapterId === primary.adapterId && efficientEntry.primary.modelId === primary.modelId;
      if (samePick) {
        lines.push(theme.fg("muted", "  Efficient: same pick — no cheaper or faster real alternative within the capability floor."));
      } else {
        const efficientWhy = efficientEntry.reason ? ` — ${efficientEntry.reason}` : "";
        lines.push(theme.fg("muted", `  Efficient: ${aiTeamLabel(efficientEntry.primary)}${efficientWhy}`));
      }
    }

    if (fallback) {
      lines.push(theme.fg("muted", `  Fallback: ${aiTeamLabel(fallback)} — used if this model becomes unavailable.`));
    } else if (!primary.available) {
      lines.push(theme.fg("warning", "  Fallback: none eligible right now."));
    }
  });
  lines.push(theme.fg("muted", "Use /models --evidence for the underlying metrics and sources."));
  return lines;
}

/**
 * Renders one team's full technical breakdown — primary (with its real
 * provider shown, unlike the default views), availability, fallback,
 * real per-capability benchmark coverage and confidence (decisionEvidence
 * — see buildDecisionEvidence in model-intelligence.js; falls back to
 * the older aggregate coverage/confidence fields for a snapshot saved
 * before decisionEvidence existed, so it never breaks on old data),
 * EFFICIENT's real retention/risk-floor and Pareto/tiebreak savings when
 * present, the distribution-policy reason, and any real corroborating
 * evidence the Model Intelligence Foundation registry has for that exact
 * model. Never recalculates anything — every number here was already
 * computed during real selection. Shared by AI TEAM and EFFICIENT TEAM
 * inside aiTeamDetailLines(); also reused by projectTeamEvidenceLines
 * via the optional `extraLinesFor` hook (never forked).
 * @param {Array<object>} team
 * @param {{extraLinesFor?: (entry: object) => string[]|null|undefined}} [options]
 */
export function teamEvidenceLines(team, { extraLinesFor } = {}) {
  const lines = [];
  const corroborationLine = (model) => (model.corroboration ?? [])
    .map((entry) => `${entry.metric}=${entry.value} (${entry.source})`)
    .join(" · ");
  team.forEach((entry, index) => {
    const { role, primary, fallback, reason, coverage, confidence, decisionEvidence } = entry;
    // A blank string here would get silently dropped once this line is
    // routed through the persisted chat transcript (addTranscript trims
    // and discards empty text) — a visible divider is the only separator
    // that actually survives into the real, persisted chat history.
    if (index > 0) lines.push(theme.fg("muted", "·"));
    const primaryLabel = aiTeamLabelWithProvider(primary);
    const primaryText = primary.available ? primaryLabel : `${primaryLabel} (not available)`;
    lines.push(`${role.padEnd(10)} ${primaryText}`);

    const capabilityCoverage = decisionEvidence?.coverage ?? {};
    const capabilities = Object.keys(capabilityCoverage);
    if (capabilities.length) {
      // Real benchmark IDENTITIES, not sources (see
      // capability-scoring.js's activeBenchmarkCountForCapability) —
      // "0/3" for a required capability means every real score for it
      // came from a composite index fallback, never a component
      // benchmark, so it's called out explicitly rather than left to
      // look like ordinary thin coverage.
      const parts = capabilities.map((capability) => {
        const c = capabilityCoverage[capability];
        const fallbackNote = c.have === 0 && c.active > 0 ? " (composite fallback)" : "";
        return `${capability} ${c.have}/${c.active}${fallbackNote}`;
      });
      const allComparable = capabilities.every((capability) => capabilityCoverage[capability].comparable);
      const tone = allComparable ? "muted" : "warning";
      lines.push(theme.fg(tone, `  ${parts.join(" · ")} · ${allComparable ? "comparable" : "provisional"} · confidence ${decisionEvidence.confidence ?? "unknown"}`));
    } else if (coverage != null) {
      // A snapshot saved before decisionEvidence existed — the older,
      // single-fraction aggregate is still real data, just coarser.
      const coveragePercent = Math.round(coverage * 100);
      const coverageTone = coveragePercent < 100 ? "warning" : "muted";
      lines.push(theme.fg(coverageTone, `  coverage: ${coveragePercent}% of relevant capabilities scored · confidence: ${confidence ?? "unknown"}`));
    }

    // EFFICIENT-only: real retention against the QUALITY leader and the
    // real risk-based floor it had to clear — never shown for QUALITY,
    // where these concepts don't apply (decisionEvidence.retention is
    // null there by construction).
    //
    // The raw ratio (chosen.gapValue / leader.gapValue) can genuinely
    // exceed 1 — the two gapValues come from different candidate-ranking
    // tiers (leader is eligibleRanked[0], the raw top-by-value; chosen
    // can come from the comparable-preferred pool once a provisional
    // raw leader is demoted — see preferComparableCandidates) — so a
    // value above 100% is real, not a bug, but "retention 117%" reads as
    // nonsensical: you can't retain more than the whole of something.
    // Reported instead as "exceeds QUALITY reference by N%", keeping the
    // word "retention" reserved for its own real 0-100% meaning; the raw
    // ratio itself is untouched in decisionEvidence.retention for audit.
    if (decisionEvidence?.retention != null && decisionEvidence.requiredFloor != null) {
      const floorPct = Math.round(decisionEvidence.requiredFloor * 100);
      const riskNote = `${decisionEvidence.riskLevel ?? "unknown"}-risk role`;
      if (decisionEvidence.retention > 1) {
        const excessPct = Math.round((decisionEvidence.retention - 1) * 100);
        lines.push(theme.fg("muted", `  exceeds QUALITY reference by ${excessPct}% · required ${floorPct}% · ${riskNote}`));
      } else {
        const retentionPct = Math.round(decisionEvidence.retention * 100);
        lines.push(theme.fg("muted", `  retention ${retentionPct}% · required ${floorPct}% · ${riskNote}`));
      }
    }
    // Real savings evidence — only ever shown when a real resource
    // dimension actually decided the pick (see describeEfficiencyDecision);
    // never invented when the metric that would justify it is missing.
    if (decisionEvidence?.savings) {
      const kind = decisionEvidence.decisionType === "pareto" ? "Pareto balance" : "Tiebreak";
      const { label, from, to } = decisionEvidence.savings;
      lines.push(theme.fg("muted", `  ${kind} · ${label} ${from} → ${to}`));
    }

    const primaryEvidence = corroborationLine(primary);
    if (primaryEvidence) lines.push(theme.fg("muted", `  also: ${primaryEvidence}`));
    if (fallback) lines.push(theme.fg("muted", `  fallback ${aiTeamLabelWithProvider(fallback)}`));
    else if (!primary.available) lines.push(theme.fg("warning", "  no eligible fallback right now"));
    if (reason) lines.push(theme.fg("muted", `  ${reason}`));
    if (extraLinesFor) {
      for (const line of extraLinesFor(entry) ?? []) lines.push(line);
    }
  });
  return lines;
}

/**
 * Thin adapter: maps strategy.projectTeam entries onto teamEvidenceLines'
 * primary/fallback shape, resolving availability explicitly (projectModelRef
 * has no `available`), and injecting quality-leader + entitlement warnings
 * via extraLinesFor — never a forked evidence renderer.
 * @param {object} strategy
 * @param {{eligibility?: object, claudeEntitlement?: object, cursorAccess?: object}} [opts]
 */
export function projectTeamEvidenceLines(strategy, { eligibility = {}, claudeEntitlement = {}, cursorAccess = {} } = {}) {
  const projectTeam = strategy?.projectTeam ?? [];
  const hasQualityTeam = Array.isArray(strategy?.qualityTeam);
  const qualityByRole = new Map((strategy?.qualityTeam ?? []).map((row) => [row.role, row]));

  const team = projectTeam.map((entry) => {
    const primaryAvailability = resolveAssignmentAvailability(entry.model, { eligibility, claudeEntitlement, cursorAccess });
    const fallbackAvailability = entry.fallback
      ? resolveAssignmentAvailability(entry.fallback, { eligibility, claudeEntitlement, cursorAccess })
      : null;
    return {
      role: entry.role,
      primary: entry.model
        ? { ...entry.model, available: primaryAvailability.available }
        : { adapterId: "?", modelId: "?", displayName: "no eligible option", available: false },
      fallback: entry.fallback
        ? { ...entry.fallback, available: fallbackAvailability.available }
        : null,
      reason: entry.reason ?? null,
      decisionEvidence: entry.decisionEvidence ?? null,
      coverage: entry.coverage,
      confidence: entry.confidence,
      _availabilityWarning: primaryAvailability.warning,
      _qualityEntry: qualityByRole.get(entry.role) ?? null
    };
  });

  return teamEvidenceLines(team, {
    extraLinesFor: (mapped) => {
      const extra = [];
      if (mapped._availabilityWarning) {
        extra.push(theme.fg("warning", `  ${mapped._availabilityWarning}`));
      }
      if (!hasQualityTeam) return extra;
      const qualityEntry = mapped._qualityEntry;
      if (!qualityEntry?.model || !mapped.primary?.modelId) return extra;
      const samePick = qualityEntry.model.adapterId === mapped.primary.adapterId
        && qualityEntry.model.modelId === mapped.primary.modelId;
      if (samePick) {
        extra.push(theme.fg("muted", "  Also the quality leader for this role."));
        return extra;
      }
      const retention = mapped.decisionEvidence?.retention;
      const retentionPct = retention != null ? Math.round(retention * 100) : null;
      const leaderLabel = aiTeamLabel(qualityEntry.model);
      if (retentionPct != null) {
        extra.push(theme.fg("muted", `  Quality leader: ${leaderLabel} — operational pick retains ${retentionPct}%`));
      } else {
        extra.push(theme.fg("muted", `  Quality leader: ${leaderLabel}`));
      }
      return extra;
    }
  });
}

/**
 * `/models --evidence`: the full breakdown behind both AI TEAM and
 * EFFICIENT TEAM picks — real provider, primary, availability, fallback,
 * real coverage/confidence, the real distribution-policy reason
 * (near-tie, independence swap, temporarily-unavailable leader,
 * efficiency dimension), and any real corroborating evidence the Model
 * Intelligence Foundation registry has for that exact model (Hugging
 * Face, manufacturer snapshots, Kairo's own telemetry). Corroboration is
 * informational only: it never changed which model was picked, so it's
 * shown, never blended into the reason. Also lists every real catalog
 * model Kairo has access to but couldn't match to any real AA data —
 * UNSCORED, never given an invented score, never silently dropped. This
 * is the technical audit trail; modelsExplainLines() is the plain-
 * language default /models shows instead.
 */
export function aiTeamDetailLines(snapshot) {
  const intel = snapshot?.modelIntelligence;
  if (!intel || intel.status === "unknown") return fitLines(snapshot);
  const team = intel.aiTeam ?? [];
  if (!team.length) return fitLines(snapshot);
  const freshness = intel.status === "live" ? "live" : `cached ${intel.age ?? "?"}`;
  const lines = [theme.fg("muted", `Evidence: ${freshness}`)];
  lines.push(...teamEvidenceLines(team));
  const efficientTeam = intel.efficientTeam ?? [];
  if (efficientTeam.length) {
    lines.push(theme.fg("muted", "·"));
    lines.push(theme.fg("muted", "EFFICIENT TEAM"));
    lines.push(...teamEvidenceLines(efficientTeam));
  }
  const unscored = intel.unscoredModels ?? [];
  if (unscored.length) {
    lines.push(theme.fg("muted", "·"));
    lines.push(theme.fg("muted", "UNSCORED (real catalog model, no matching Artificial Analysis data — never given an invented score):"));
    for (const model of unscored) {
      lines.push(theme.fg("muted", `  ${aiTeamLabelWithProvider({ ...model, displayName: model.displayName ?? model.modelId })}`));
    }
  }
  return lines;
}

/**
 * `/why` detail: every candidate provider's real eligibility outcome
 * (which were rejected and their exact reason, which survived) plus a
 * coverage/confidence line per provider — its real catalog source
 * (measured vs. documented) and how much of it Kairo could match to
 * real Artificial Analysis data. This is what stops "Fable is the best
 * model available now" from being read as "Fable is the only model
 * Kairo could ever evaluate": a provider can be fully eligible and
 * still have unmatched models simply because AA doesn't track them, or
 * because Kairo only has a documented catalog for it, not a live
 * per-account discovery (true for Claude today). The main FIT widget
 * stays a single line per role; this is the drill-down.
 */
export function fitWhyLines(snapshot) {
  const intel = snapshot?.modelIntelligence;
  const eligibility = Object.entries(intel?.eligibility ?? {});
  const coverage = intel?.coverage ?? [];
  if (!eligibility.length && !coverage.length) return [theme.fg("muted", "No eligibility data yet.")];
  const lines = eligibility.map(([adapterId, check]) => (check.ok
    ? theme.fg("success", `${adapterId}: eligible`)
    : theme.fg("muted", `${adapterId}: excluded — ${check.reason}`)));
  if (coverage.length) {
    lines.push("");
    lines.push(theme.fg("muted", "Catalog coverage (real data matched, not runtime eligibility):"));
    for (const entry of coverage) {
      // A real catalog read failure carries its own real reason (e.g.
      // "Authentication required") — surfaced honestly instead of an
      // "unknown catalog, 0/0 matched" line that explains nothing.
      const errorNote = entry.error ? ` — ${entry.error}` : "";
      lines.push(theme.fg("muted", `${entry.adapterId}: ${entry.catalogStatus} catalog, ${entry.matchedModels}/${entry.totalModels} models matched to Artificial Analysis${errorNote}`));
    }
  }
  return lines;
}

export function providerLines(snapshot) {
  const providers = snapshot?.providers ?? {};
  const entry = (name, fallback) => {
    const value = providers[name]?.status ?? providers[name.toLowerCase()]?.status;
    return value ?? fallback;
  };
  const usage = snapshot?.usage ?? {};
  const codex = usage.codex;
  const claude = usage.claude;
  const open = usage.opencode;
  const codexText = codex?.windows?.length
    ? codex.windows.map((window) => `${window.name} ${window.remainingPercent}% left`).join(" · ")
    : entry("Codex", "READY · usage unknown");
  const claudeText = claude?.windows?.length
    ? claude.windows.map((window) => `${window.label ?? window.name} ${window.remainingPercent}% left`).join(" · ")
    : entry("Claude", "READY · usage unknown");
  const goText = open?.go?.windows?.length
    ? open.go.windows.map((window) => `${shortWindowName(window.name)} ${window.remainingPercent}%${window.status === "rate-limited" ? " RATE LIMITED" : ""}`).join(" · ")
    : "usage unknown";
  const zen = open?.zen;
  const zenText = zen?.status === "local_recorded"
    ? `PAYG/manual · 7d local $${zen.totalCost.toFixed(2)} · ${compactNumber(zen.totalTokens)}`
    : "PAYG/manual · 7d local unknown";
  return [
    `Codex    ${codexText}`,
    `Claude   ${claudeText}`,
    `Go       ${goText}`,
    `Zen      ${zenText}`,
    `Cursor   ${entry("Cursor", "READY · usage unknown")}`
  ];
}

export function integrationsLine(snapshot) {
  const integrations = snapshot?.integrations ?? {};
  const state = (name, fallback) => integrations[name]?.status ?? integrations[name]?.state ?? fallback;
  return [
    `Engram ${state("engram", "available")}`,
    `MCP ${state("mcp", "available")}`,
    `Skills ${state("skills", "available")}`,
    `CodeGraph ${state("codegraph", "unknown")}`,
    `Graphify ${state("graphify", "unknown")}`,
    `Gentle ${state("gentle", "policy active")}`
  ].join("   ");
}

/**
 * `/usage`: real automatic-routing resources only (Codex, Claude, Go).
 * Zen is explicitly PAYG/manual and stays in `/providers`.
 */
export function usageLines(snapshot) {
  return formatSlashUsageLines(snapshot);
}

/**
 * Build cockpit-parity diagnostic lines from a conversation snapshot.
 * @param {object|null|undefined} snap
 * @param {"usage"|"providers"|"status"|"models"|"why"|"models_evidence"} kind
 * @returns {string[]}
 */
export function slashDiagnosticLines(snap, kind) {
  const snapshot = snap ?? {};
  switch (kind) {
    case "usage":
      return usageLines(snapshot);
    case "providers":
      return providerLines(snapshot);
    case "status":
      return [...providerLines(snapshot), integrationsLine(snapshot)];
    case "models_evidence":
      return aiTeamDetailLines(snapshot);
    case "models":
      return modelsExplainLines(snapshot);
    case "why":
      return fitWhyLines(snapshot);
    default:
      return [`Unknown slash diagnostics kind: ${kind}`];
  }
}

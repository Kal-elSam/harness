//! Map `kairo.workspace-shell/v1` JSON into shell chrome (R5).

use serde_json::Value;

use crate::surfaces::{AgentState, BlockCause, ShellViewModel, SidebarAgent};

/// Apply workspace snapshot fields to the painted shell model.
pub fn apply_workspace_snapshot(view: &mut ShellViewModel, snapshot: &Value) {
    if let Some(project) = snapshot.get("project") {
        view.project = project_display_label(project);
    }

    if let Some(agents) = snapshot.get("agents").and_then(|v| v.as_array()) {
        let mut mapped: Vec<SidebarAgent> = agents.iter().map(map_agent).collect();
        sort_agents_blocked_first(&mut mapped);
        view.agents = mapped;
        if view.agents.is_empty() {
            view.selected_agent = 0;
        } else if view.selected_agent >= view.agents.len() {
            view.selected_agent = view.agents.len() - 1;
        }
    }

    if let Some(subscriptions) = snapshot.get("subscriptions") {
        view.usage_line = subscriptions_usage_line(subscriptions);
    }

    // `team.state` is Kairo's own persisted strategy status
    // (`not_analyzed` / `suggested` / `active` / `stale`) — read, never
    // inferred, so the analyze/approve hints follow real state.
    if let Some(state) = snapshot
        .pointer("/team/state")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        view.team_state = Some(state.to_string());
    }

    if snapshot.get("team").is_some() {
        apply_team_presentation(view, snapshot.pointer("/team/presentation"));
    }

    // One source of truth: the chat banner derives from the SAME
    // `team.presentation` state the sidebar uses (legacy per-role CTA only
    // when no presentation state is known).
    if snapshot.get("agents").is_some() || snapshot.get("team").is_some() {
        view.team_attention = derive_team_attention(view);
    }
}

/// Chat banner for the current presentation state. Compact and single-line
/// whenever the team is not `complete`: it never enumerates roles or models
/// and never claims quota/blocking while verification is still running.
fn derive_team_attention(view: &ShellViewModel) -> Option<Vec<String>> {
    match view.team_presentation.as_deref() {
        Some("complete") | Some("ready_to_approve") => None,
        Some("pending_approval") => {
            Some(vec!["Suggested team draft — open Project (2) to review · a to re-analyze".to_string()])
        }
        Some("verifying") => Some(vec!["Verifying team access…".to_string()]),
        Some(state @ ("incomplete" | "blocked")) => {
            let head = if state == "blocked" { "Team blocked" } else { "Team incomplete" };
            // The suggested team can be edited in the Project view (key 2).
            let edit = if view.team_state.as_deref() == Some("suggested") {
                " · 2 to edit"
            } else {
                ""
            };
            Some(vec![format!("{head} — a to re-analyze{edit}")])
        }
        _ => blocked_team_attention(&view.agents),
    }
}

/// Additive `team.presentation` (`state`, `rolesVisible`, `reason`). Tolerant:
/// absent or malformed => legacy (roles visible); `state` alone decides only
/// for the known states; an explicit `rolesVisible` bool always wins.
fn apply_team_presentation(view: &mut ShellViewModel, presentation: Option<&Value>) {
    let state = presentation
        .and_then(|p| p.get("state"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let flag = presentation
        .and_then(|p| p.get("rolesVisible"))
        .and_then(|v| v.as_bool());
    view.team_presentation = state.map(str::to_string);
    view.roles_visible = match (flag, state) {
        (Some(flag), _) => flag,
        (None, Some("complete" | "pending_approval" | "ready_to_approve")) => true,
        (None, Some("incomplete" | "blocked" | "verifying")) => false,
        _ => true,
    };
}

fn project_display_label(project: &Value) -> String {
    project
        .get("label")
        .and_then(|v| v.as_str())
        .or_else(|| project.get("name").and_then(|v| v.as_str()))
        .or_else(|| project.get("id").and_then(|v| v.as_str()))
        .unwrap_or("kairo")
        .to_string()
}

fn parse_agent_state(raw: Option<&str>) -> AgentState {
    match raw {
        Some("idle") => AgentState::Idle,
        Some("blocked") => AgentState::Blocked,
        Some("unknown") => AgentState::Unknown,
        _ => AgentState::Unknown,
    }
}

fn map_agent(entry: &Value) -> SidebarAgent {
    let label = entry
        .get("label")
        .or_else(|| entry.get("role"))
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown role")
        .to_string();
    let state = parse_agent_state(entry.get("state").and_then(|v| v.as_str()));
    let detail = agent_detail_line(entry, state);
    let cause = agent_block_cause(entry);
    SidebarAgent {
        label,
        detail,
        state,
        cause,
    }
}

/// Classify from the ORIGINAL `stateReason` (never from the already
/// shortened `detail`), so aggregation across roles sees real evidence.
fn agent_block_cause(entry: &Value) -> BlockCause {
    if let Some(reason) = entry.get("stateReason").and_then(|v| v.as_str()) {
        let trimmed = reason.trim();
        if !trimmed.is_empty() {
            return classify_block_cause(&trimmed.to_ascii_lowercase());
        }
    }
    BlockCause::Unavailable
}

fn agent_detail_line(entry: &Value, state: AgentState) -> String {
    // Always preserve provider · model identity. Block reasons live on
    // `cause` / attention copy — never replace the model line.
    let provider = entry.get("provider").and_then(|v| v.as_str());
    let model = entry.get("model").and_then(|v| v.as_str());
    match (provider, model) {
        (Some(p), Some(m)) if !m.is_empty() && m != "no eligible option" => {
            format!("{p} · {m}")
        }
        (Some(p), _) => p.to_string(),
        _ => state_word(state).to_string(),
    }
}

/// Classify a blocked `stateReason` from real evidence only — never invent
/// quota/funds wording when the provider did not say so.
///
/// A rate-limit is not an exhausted quota: "monthly window is rate-limited"
/// classifies as `RateLimited`, never `QuotaExhausted`. Only an explicit
/// quota-exhausted statement ("quota exhausted", "out of quota") without
/// rate-limit wording earns the quota classification. "billing" / an
/// entitlement message alone is ambiguous, not evidenced funds — it falls
/// through to `Unavailable`.
fn classify_block_cause(lower: &str) -> BlockCause {
    let rate_limited_evidence = lower.contains("rate-limited")
        || lower.contains("rate limited")
        || lower.contains("monthly window");
    if rate_limited_evidence {
        return BlockCause::RateLimited;
    }
    let quota_exhausted_evidence =
        lower.contains("quota exhausted") || lower.contains("out of quota");
    if quota_exhausted_evidence {
        return BlockCause::QuotaExhausted;
    }
    let funds_evidence = lower.contains("no funds")
        || lower.contains("out of funds")
        || lower.contains("out of credit")
        || lower.contains("insufficient credit")
        || lower.contains("insufficient funds");
    if funds_evidence {
        return BlockCause::NoFunds;
    }
    BlockCause::Unavailable
}

fn known_provider_label(lower: &str) -> Option<&'static str> {
    if lower.contains("opencode go") || lower.contains("opencode-go") {
        return Some("OpenCode Go");
    }
    if lower.contains("codex") {
        return Some("Codex");
    }
    if lower.contains("claude") {
        return Some("Claude");
    }
    None
}

fn owned_provider_head(detail: &str) -> Option<String> {
    let head = detail.split(['—', '–', ':']).next()?.trim();
    let cleaned = head
        .trim_start_matches("Unavailable")
        .trim()
        .trim_matches(|c: char| c == '-' || c.is_whitespace());
    if cleaned.is_empty() || cleaned.eq_ignore_ascii_case("unavailable") || cleaned.len() >= 24 {
        return None;
    }
    Some(cleaned.to_string())
}

/// Collapse long provider outage sentences for attention/CTA copy helpers.
/// Agent identity lines no longer use this (T28: provider · model stays).
#[allow(dead_code)]
fn shorten_agent_detail(detail: &str) -> String {
    let lower = detail.to_ascii_lowercase();
    let cause = classify_block_cause(&lower);
    let provider = known_provider_label(&lower)
        .map(str::to_string)
        .or_else(|| owned_provider_head(detail));

    match (provider.as_deref(), cause) {
        (Some(p), BlockCause::RateLimited) => format!("{p} · rate-limited · /analyze"),
        (Some(p), BlockCause::QuotaExhausted) => format!("{p} · quota spent · /analyze"),
        (Some(p), BlockCause::NoFunds) => format!("{p} · no funds · /analyze"),
        (None, BlockCause::RateLimited) => "Rate-limited · /analyze".into(),
        (None, BlockCause::QuotaExhausted) => "Quota spent · /analyze".into(),
        (None, BlockCause::NoFunds) => "No funds · /analyze".into(),
        (Some(p), BlockCause::Unavailable) if looks_like_provider_outage(&lower) => {
            format!("{p} · unavailable · /analyze")
        }
        _ => truncate_detail(detail, 36),
    }
}

fn looks_like_provider_outage(lower: &str) -> bool {
    lower.starts_with("unavailable")
        || lower.contains("unavailable —")
        || lower.contains("unavailable -")
        || lower.contains("is rate-limited")
        || lower.contains("is blocked")
}

fn truncate_detail(detail: &str, max: usize) -> String {
    if detail.chars().count() <= max {
        return detail.to_string();
    }
    let mut out: String = detail.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

fn state_word(state: AgentState) -> &'static str {
    match state {
        AgentState::Idle => "idle",
        AgentState::Blocked => "blocked",
        AgentState::Unknown => "unknown",
    }
}

/// Sticky chat CTA when the live team has blocked roles. Names the evidenced
/// cause (quota / funds) when `stateReason` already said so; always points at
/// `/analyze` so the human can reassign — never invents a cause.
pub fn blocked_team_attention(agents: &[SidebarAgent]) -> Option<Vec<String>> {
    let blocked: Vec<&SidebarAgent> = agents
        .iter()
        .filter(|agent| agent.state == AgentState::Blocked)
        .collect();
    if blocked.is_empty() {
        return None;
    }
    let n = blocked.len();
    let who = if n <= 3 {
        blocked
            .iter()
            .map(|agent| agent.label.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    } else {
        format!("{n} roles")
    };
    let cause = team_block_cause(&blocked);
    let line1 = match cause {
        BlockCause::RateLimited => format!("{who} blocked — rate-limited."),
        BlockCause::QuotaExhausted => format!("{who} blocked — quota exhausted."),
        BlockCause::NoFunds => format!("{who} blocked — out of funds."),
        BlockCause::Unavailable => format!("{who} unavailable."),
    };
    Some(vec![line1, "Type /analyze to reassign.".into()])
}

/// Aggregate the ORIGINAL evidenced cause of every blocked role (from the
/// `cause` field set at snapshot mapping time, never re-derived from the
/// already-shortened `detail` text). Roles that disagree on cause fall
/// through to `Unavailable` rather than picking one role's cause for all.
fn team_block_cause(blocked: &[&SidebarAgent]) -> BlockCause {
    let mut causes = blocked.iter().map(|agent| agent.cause);
    let first = match causes.next() {
        Some(c) => c,
        None => return BlockCause::Unavailable,
    };
    if causes.all(|c| c == first) {
        first
    } else {
        BlockCause::Unavailable
    }
}

fn state_rank(state: AgentState) -> u8 {
    match state {
        AgentState::Blocked => 0,
        AgentState::Idle => 2,
        AgentState::Unknown => 4,
    }
}

fn sort_agents_blocked_first(agents: &mut [SidebarAgent]) {
    agents.sort_by_key(|a| state_rank(a.state));
}

/// Honest USAGE line from subscription payload.
/// - `ready`: `USAGE · seg1 │ seg2`
/// - `cached` / `checking` with segments: `USAGE · {state} · seg1 │ seg2`
/// - otherwise: `USAGE · {state}`
/// Join separator is ` │ ` (same as the extension, not a middot).
pub fn subscriptions_usage_line(subscriptions: &Value) -> String {
    let state = subscriptions
        .get("state")
        .and_then(|v| v.as_str())
        .unwrap_or("checking");
    let segments: Vec<&str> = subscriptions
        .get("segments")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();
    if state == "ready" {
        return format!("USAGE · {}", segments.join(" │ "));
    }
    if (state == "cached" || state == "checking") && !segments.is_empty() {
        return format!("USAGE · {state} · {}", segments.join(" │ "));
    }
    format!("USAGE · {state}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_agents_and_blocked_first() {
        let snapshot = json!({
            "project": { "label": "agentic-harness", "root": "/work" },
            "agents": [
                { "label": "Builder", "state": "idle", "provider": "codex", "model": "GPT" },
                { "label": "Reviewer", "state": "blocked", "provider": "claude", "stateReason": "No entitlement" }
            ],
            "subscriptions": { "state": "ready", "segments": ["Codex 5h 96%", "Claude ok"] }
        });
        let mut view = ShellViewModel::default();
        apply_workspace_snapshot(&mut view, &snapshot);
        assert_eq!(view.project, "agentic-harness");
        assert_eq!(view.agents.len(), 2);
        assert_eq!(view.agents[0].label, "Reviewer");
        assert_eq!(view.agents[0].state, AgentState::Blocked);
        assert_eq!(view.agents[0].detail, "claude", "identity stays provider·model; reason is separate");
        assert_eq!(view.agents[0].cause, BlockCause::Unavailable);
        assert!(
            !view.agents[0].detail.to_ascii_lowercase().contains("funds"),
            "an entitlement message alone must never invent a funds cause: {}",
            view.agents[0].detail
        );
        assert_eq!(view.agents[1].label, "Builder");
        assert_eq!(view.agents[1].state, AgentState::Idle);
    }

    #[test]
    fn team_presentation_is_parsed_and_absent_means_legacy_visible() {
        let mut view = ShellViewModel::default();
        assert!(view.roles_visible, "legacy default shows roles");
        apply_workspace_snapshot(
            &mut view,
            &json!({ "team": { "state": "active", "presentation": {
                "state": "blocked", "rolesVisible": false, "reason": "availability_blocked" } } }),
        );
        assert_eq!(view.team_presentation.as_deref(), Some("blocked"));
        assert!(!view.roles_visible);

        apply_workspace_snapshot(
            &mut view,
            &json!({ "team": { "state": "active", "presentation": {
                "state": "complete", "rolesVisible": true, "reason": null } } }),
        );
        assert_eq!(view.team_presentation.as_deref(), Some("complete"));
        assert!(view.roles_visible);

        // An older sidecar without the field resets to legacy behavior.
        apply_workspace_snapshot(
            &mut view,
            &json!({ "team": { "state": "active" } }),
        );
        assert_eq!(view.team_presentation, None);
        assert!(view.roles_visible);
    }

    fn five_blocked_agents_snapshot(presentation: serde_json::Value) -> serde_json::Value {
        let agents: Vec<serde_json::Value> = ["Architect", "Builder", "Reviewer", "Explorer", "Tester"]
            .iter()
            .map(|label| json!({
                "label": label, "state": "blocked", "provider": "codex",
                "stateReason": "Unavailable — Codex quota exhausted (GPT-6-Astra)"
            }))
            .collect();
        json!({ "agents": agents, "team": { "state": "suggested", "presentation": presentation } })
    }

    #[test]
    fn chat_banner_follows_the_verifying_presentation_and_never_enumerates_or_blames_quota() {
        let mut view = ShellViewModel::default();
        apply_workspace_snapshot(
            &mut view,
            &five_blocked_agents_snapshot(json!({ "state": "verifying", "rolesVisible": false, "reason": "availability_pending" })),
        );
        let banner = view.team_attention.expect("a compact notice exists while verifying");
        assert_eq!(banner.len(), 1, "single line: {banner:?}");
        let line = banner[0].to_ascii_lowercase();
        assert!(line.contains("verif"), "{line}");
        for forbidden in ["blocked", "quota", "funds", "rate-limit", "architect", "builder", "reviewer", "gpt", "codex", "/analyze"] {
            assert!(!line.contains(forbidden), "{forbidden} leaked into the verifying banner: {line}");
        }
    }

    #[test]
    fn chat_banner_for_an_incomplete_or_blocked_team_is_one_compact_line_without_roles_or_models() {
        for (state, expected) in [
            ("incomplete", "Team incomplete — a to re-analyze · 2 to edit"),
            ("blocked", "Team blocked — a to re-analyze · 2 to edit"),
        ] {
            let mut view = ShellViewModel::default();
            apply_workspace_snapshot(
                &mut view,
                &five_blocked_agents_snapshot(json!({ "state": state, "rolesVisible": false, "reason": "x" })),
            );
            assert_eq!(view.team_attention, Some(vec![expected.to_string()]), "{state}");
        }
    }

    #[test]
    fn chat_banner_without_a_suggested_team_omits_the_edit_hint() {
        let mut view = ShellViewModel::default();
        apply_workspace_snapshot(
            &mut view,
            &json!({ "agents": [], "team": { "state": "not_analyzed", "presentation": { "state": "incomplete", "rolesVisible": false } } }),
        );
        assert_eq!(view.team_attention, Some(vec!["Team incomplete — a to re-analyze".to_string()]));
    }

    #[test]
    fn chat_banner_is_cleared_for_a_complete_team_and_legacy_blocked_roles_keep_their_cta() {
        let mut view = ShellViewModel::default();
        apply_workspace_snapshot(
            &mut view,
            &five_blocked_agents_snapshot(json!({ "state": "complete", "rolesVisible": true })),
        );
        assert_eq!(view.team_attention, None, "the presentation state is the single source");
        // No presentation field (older sidecar): the legacy per-role CTA stays.
        let mut legacy = ShellViewModel::default();
        apply_workspace_snapshot(
            &mut legacy,
            &json!({ "agents": [{ "label": "Builder", "state": "blocked", "provider": "codex",
                "stateReason": "Unavailable — Codex is rate-limited until tomorrow" }] }),
        );
        assert!(legacy.team_attention.unwrap().join(" ").contains("/analyze"));
    }

    #[test]
    fn a_later_agents_only_snapshot_does_not_resurrect_the_role_banner() {
        let mut view = ShellViewModel::default();
        apply_workspace_snapshot(
            &mut view,
            &five_blocked_agents_snapshot(json!({ "state": "verifying", "rolesVisible": false })),
        );
        apply_workspace_snapshot(
            &mut view,
            &json!({ "agents": [{ "label": "Builder", "state": "blocked", "provider": "codex", "stateReason": "Unavailable — Codex quota exhausted" }] }),
        );
        let banner = view.team_attention.expect("still verifying");
        assert!(banner[0].to_ascii_lowercase().contains("verif"), "{banner:?}");
    }

    #[test]
    fn team_presentation_tolerates_partial_or_unknown_shapes() {
        let mut view = ShellViewModel::default();
        // state only: visibility follows `complete`.
        apply_workspace_snapshot(
            &mut view,
            &json!({ "team": { "presentation": { "state": "verifying" } } }),
        );
        assert!(!view.roles_visible);
        // Unknown state with no flag: fail open to legacy (older/newer sidecar).
        apply_workspace_snapshot(
            &mut view,
            &json!({ "team": { "presentation": { "state": "weird" } } }),
        );
        assert!(view.roles_visible);
        // Garbage types never panic.
        apply_workspace_snapshot(&mut view, &json!({ "team": { "presentation": 7 } }));
        assert!(view.roles_visible);
    }

    #[test]
    fn rate_limited_evidence_never_renders_as_quota_or_funds() {
        let snapshot = json!({
            "agents": [
                {
                    "label": "Builder",
                    "state": "blocked",
                    "provider": "codex",
                    "stateReason": "Unavailable — Codex is rate-limited until tomorrow"
                }
            ]
        });
        let mut view = ShellViewModel::default();
        apply_workspace_snapshot(&mut view, &snapshot);
        assert_eq!(view.agents[0].detail, "codex");
        assert_eq!(view.agents[0].cause, BlockCause::RateLimited);
        let joined = view.team_attention.expect("CTA").join(" ");
        assert!(
            joined.contains("rate-limited"),
            "CTA must name rate-limited: {joined}"
        );
        assert!(
            !joined.to_ascii_lowercase().contains("quota")
                && !joined.to_ascii_lowercase().contains("funds"),
            "rate-limit evidence must not be labeled quota/funds: {joined}"
        );
    }

    #[test]
    fn shortens_opencode_go_outage_details_for_sidebar_scanability() {
        let snapshot = json!({
            "agents": [
                {
                    "label": "Architect",
                    "state": "blocked",
                    "provider": "opencode-go",
                    "stateReason": "Unavailable — OpenCode Go monthly window is rate-limited (resets 2026-10-12T18:00:48.000Z)"
                }
            ]
        });
        let mut view = ShellViewModel::default();
        apply_workspace_snapshot(&mut view, &snapshot);
        assert_eq!(view.agents[0].detail, "opencode-go");
        assert_eq!(view.agents[0].cause, BlockCause::RateLimited);
        let attention = view.team_attention.expect("blocked team needs CTA");
        let joined = attention.join(" ");
        assert!(
            joined.contains("/analyze"),
            "attention must name /analyze: {joined}"
        );
        assert!(
            joined.contains("Architect"),
            "attention must name the blocked role: {joined}"
        );
        assert!(
            joined.contains("rate-limited"),
            "a rate limit must be named rate-limited, not quota: {joined}"
        );
        assert!(
            !joined.to_ascii_lowercase().contains("quota"),
            "'monthly window is rate-limited' must not be classified as quota: {joined}"
        );
        assert!(
            !joined.contains("no funds") && !joined.to_ascii_lowercase().contains("out of funds"),
            "rate-limit evidence must not be labeled as no funds: {joined}"
        );
    }

    #[test]
    fn explicit_quota_exhausted_statement_may_say_quota() {
        let snapshot = json!({
            "agents": [
                {
                    "label": "Architect",
                    "state": "blocked",
                    "provider": "opencode-go",
                    "stateReason": "Unavailable — OpenCode Go quota exhausted for this cycle"
                }
            ]
        });
        let mut view = ShellViewModel::default();
        apply_workspace_snapshot(&mut view, &snapshot);
        assert_eq!(view.agents[0].detail, "opencode-go");
        assert_eq!(view.agents[0].cause, BlockCause::QuotaExhausted);
    }

    #[test]
    fn funds_outage_detail_names_no_funds_and_analyze() {
        let snapshot = json!({
            "agents": [
                {
                    "label": "Builder",
                    "state": "blocked",
                    "provider": "codex",
                    "stateReason": "Unavailable — Codex is out of funds for this window"
                }
            ]
        });
        let mut view = ShellViewModel::default();
        apply_workspace_snapshot(&mut view, &snapshot);
        assert_eq!(view.agents[0].detail, "codex");
        assert_eq!(view.agents[0].cause, BlockCause::NoFunds);
        let joined = view.team_attention.expect("CTA").join(" ");
        assert!(
            joined.contains("out of funds"),
            "funds CTA missing: {joined}"
        );
        assert!(joined.contains("/analyze"), "analyze CTA missing: {joined}");
    }

    #[test]
    fn insufficient_credits_is_evidenced_funds() {
        let snapshot = json!({
            "agents": [
                {
                    "label": "Builder",
                    "state": "blocked",
                    "provider": "claude",
                    "stateReason": "Unavailable — Claude has insufficient credits for this workspace"
                }
            ]
        });
        let mut view = ShellViewModel::default();
        apply_workspace_snapshot(&mut view, &snapshot);
        assert_eq!(view.agents[0].detail, "claude");
        assert_eq!(view.agents[0].cause, BlockCause::NoFunds);
    }

    #[test]
    fn billing_issue_alone_is_unavailable_not_funds() {
        let snapshot = json!({
            "agents": [
                {
                    "label": "Builder",
                    "state": "blocked",
                    "provider": "opencode-go",
                    "stateReason": "Unavailable — OpenCode Go billing issue on this account"
                }
            ]
        });
        let mut view = ShellViewModel::default();
        apply_workspace_snapshot(&mut view, &snapshot);
        assert_eq!(view.agents[0].cause, BlockCause::Unavailable);
        assert!(
            !view.agents[0].detail.to_ascii_lowercase().contains("funds"),
            "'billing' alone must never be labeled as funds: {}",
            view.agents[0].detail
        );
        let joined = view.team_attention.expect("CTA").join(" ");
        assert!(
            !joined.to_ascii_lowercase().contains("funds"),
            "billing-only CTA must not invent funds: {joined}"
        );
    }

    #[test]
    fn no_entitlement_is_unavailable_not_funds() {
        let snapshot = json!({
            "agents": [
                {
                    "label": "Reviewer",
                    "state": "blocked",
                    "provider": "claude",
                    "stateReason": "No entitlement"
                }
            ]
        });
        let mut view = ShellViewModel::default();
        apply_workspace_snapshot(&mut view, &snapshot);
        assert_eq!(view.agents[0].cause, BlockCause::Unavailable);
        let joined = view.team_attention.expect("CTA").join(" ");
        assert!(
            !joined.to_ascii_lowercase().contains("funds"),
            "'No entitlement' alone must never be labeled as funds: {joined}"
        );
    }

    #[test]
    fn mixed_causes_across_blocked_roles_yield_unavailable_cta_but_keep_per_role_evidence() {
        let snapshot = json!({
            "agents": [
                {
                    "label": "Architect",
                    "state": "blocked",
                    "provider": "opencode-go",
                    "stateReason": "Unavailable — OpenCode Go monthly window is rate-limited (resets soon)"
                },
                {
                    "label": "Builder",
                    "state": "blocked",
                    "provider": "codex",
                    "stateReason": "Unavailable — Codex is out of funds for this window"
                }
            ]
        });
        let mut view = ShellViewModel::default();
        apply_workspace_snapshot(&mut view, &snapshot);
        // Each row keeps its own evidenced cause.
        let architect = view
            .agents
            .iter()
            .find(|a| a.label == "Architect")
            .expect("architect row");
        let builder = view
            .agents
            .iter()
            .find(|a| a.label == "Builder")
            .expect("builder row");
        assert_eq!(architect.cause, BlockCause::RateLimited);
        assert_eq!(architect.detail, "opencode-go");
        assert_eq!(builder.cause, BlockCause::NoFunds);
        assert_eq!(builder.detail, "codex");
        // Aggregate CTA must not pick either cause when roles disagree.
        let joined = view.team_attention.expect("CTA").join(" ");
        assert!(
            joined.contains("unavailable"),
            "mixed causes across roles must fall back to unavailable: {joined}"
        );
        assert!(
            !joined.to_ascii_lowercase().contains("rate-limited")
                && !joined.to_ascii_lowercase().contains("quota")
                && !joined.to_ascii_lowercase().contains("funds"),
            "mixed-cause CTA must not pick one role's cause for all: {joined}"
        );
        assert!(joined.contains("/analyze"), "analyze CTA missing: {joined}");
    }

    #[test]
    fn classification_uses_original_state_reason_not_truncated_detail() {
        // The keyword sits well past the 36-char truncation point used for
        // the unevidenced fallback path, so a naive re-classification of
        // the shortened `detail` (rather than the original `stateReason`)
        // would miss it entirely.
        let long_reason = "Unavailable — OpenCode Go connection has been degraded for a while and now the monthly window is rate-limited (resets later)";
        assert!(
            long_reason.chars().count() > 60,
            "fixture must exceed the 36-char truncation window"
        );
        let snapshot = json!({
            "agents": [
                {
                    "label": "Architect",
                    "state": "blocked",
                    "provider": "opencode-go",
                    "stateReason": long_reason
                }
            ]
        });
        let mut view = ShellViewModel::default();
        apply_workspace_snapshot(&mut view, &snapshot);
        assert_eq!(view.agents[0].cause, BlockCause::RateLimited);
        assert_eq!(
            view.agents[0].detail,
            "opencode-go",
            "identity stays provider·model even when stateReason is long"
        );
    }

    #[test]
    fn clears_team_attention_when_no_agents_are_blocked() {
        let snapshot = json!({
            "agents": [
                { "label": "Architect", "state": "idle", "provider": "codex", "model": "gpt" }
            ]
        });
        let mut view = ShellViewModel::default();
        view.team_attention = Some(vec!["stale".into()]);
        apply_workspace_snapshot(&mut view, &snapshot);
        assert_eq!(view.team_attention, None);
    }

    #[test]
    fn blocked_team_attention_summarizes_many_roles_without_listing_all() {
        let agents: Vec<SidebarAgent> = (0..5)
            .map(|i| SidebarAgent {
                label: format!("Role{i}"),
                detail: "blocked".into(),
                state: AgentState::Blocked,
                cause: BlockCause::Unavailable,
            })
            .collect();
        let attention = blocked_team_attention(&agents).expect("CTA");
        let joined = attention.join(" ");
        assert!(joined.contains("5 roles"));
        assert!(
            !joined.contains("Role0"),
            "must not list every role when N>3"
        );
        assert!(joined.contains("/analyze"));
        assert!(
            joined.contains("unavailable"),
            "generic/ambiguous block must say unavailable, not invent a cause: {joined}"
        );
    }

    #[test]
    fn unknown_state_and_invalid_state_fail_closed() {
        let snapshot = json!({
            "agents": [
                { "label": "X", "state": "working" },
                { "label": "Y", "state": "unknown", "provider": "cursor" }
            ]
        });
        let mut view = ShellViewModel::default();
        apply_workspace_snapshot(&mut view, &snapshot);
        assert_eq!(view.agents[0].state, AgentState::Unknown);
        assert_eq!(view.agents[1].state, AgentState::Unknown);
        assert_eq!(view.agents[0].detail, "unknown");
        assert_eq!(view.agents[1].detail, "cursor");
    }

    #[test]
    fn usage_segments_when_ready_or_cached_checking_with_segments() {
        assert_eq!(
            subscriptions_usage_line(&json!({
                "state": "ready",
                "segments": ["Codex 5h 96%", "Claude ok"]
            })),
            "USAGE · Codex 5h 96% │ Claude ok"
        );
        assert_eq!(
            subscriptions_usage_line(&json!({ "state": "checking", "segments": [] })),
            "USAGE · checking"
        );
        // Cached/checking with segments: honest state + useful segment paint.
        assert_eq!(
            subscriptions_usage_line(&json!({
                "state": "cached",
                "segments": ["Codex 5h 96%", "Claude ok"]
            })),
            "USAGE · cached · Codex 5h 96% │ Claude ok"
        );
        assert_eq!(
            subscriptions_usage_line(&json!({
                "state": "checking",
                "segments": ["Go ok"]
            })),
            "USAGE · checking · Go ok"
        );
        assert_eq!(
            subscriptions_usage_line(&json!({ "state": "cached", "segments": [] })),
            "USAGE · cached"
        );
        assert_eq!(
            subscriptions_usage_line(&json!({ "state": "unknown" })),
            "USAGE · unknown"
        );
    }

    #[test]
    fn clamps_selected_agent_when_list_shrinks() {
        let mut view = ShellViewModel::default();
        view.selected_agent = 5;
        apply_workspace_snapshot(
            &mut view,
            &json!({ "agents": [{ "label": "Only", "state": "idle" }] }),
        );
        assert_eq!(view.selected_agent, 0);
    }

    #[test]
    fn reads_team_state_from_snapshot_without_inventing_one() {
        let mut view = ShellViewModel::default();
        assert_eq!(view.team_state, None);
        apply_workspace_snapshot(&mut view, &json!({ "agents": [] }));
        assert_eq!(view.team_state, None, "absent team state must stay unknown");
        apply_workspace_snapshot(
            &mut view,
            &json!({ "team": { "state": "suggested", "rows": [] } }),
        );
        assert_eq!(view.team_state.as_deref(), Some("suggested"));
        apply_workspace_snapshot(&mut view, &json!({ "team": { "state": "active" } }));
        assert_eq!(view.team_state.as_deref(), Some("active"));
    }

    #[test]
    fn project_falls_back_to_name_then_id() {
        assert_eq!(
            project_display_label(&json!({ "name": "from-name" })),
            "from-name"
        );
        assert_eq!(
            project_display_label(&json!({ "id": "from-id" })),
            "from-id"
        );
    }
}

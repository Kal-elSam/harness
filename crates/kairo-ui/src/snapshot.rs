//! Map `kairo.workspace-shell/v1` JSON into shell chrome (R5).

use serde_json::Value;

use crate::surfaces::{AgentState, ShellViewModel, SidebarAgent};

/// Apply workspace snapshot fields to the painted shell model.
pub fn apply_workspace_snapshot(view: &mut ShellViewModel, snapshot: &Value) {
    if let Some(project) = snapshot.get("project") {
        view.project = project_display_label(project);
    }

    if let Some(agents) = snapshot.get("agents").and_then(|v| v.as_array()) {
        let mut mapped: Vec<SidebarAgent> = agents.iter().map(map_agent).collect();
        sort_agents_blocked_first(&mut mapped);
        view.agents = mapped;
        view.team_attention = blocked_team_attention(&view.agents);
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
    SidebarAgent {
        label,
        detail,
        state,
    }
}

fn agent_detail_line(entry: &Value, state: AgentState) -> String {
    if let Some(reason) = entry.get("stateReason").and_then(|v| v.as_str()) {
        let trimmed = reason.trim();
        if !trimmed.is_empty() {
            return shorten_agent_detail(trimmed);
        }
    }
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

/// Collapse long provider outage sentences so the AGENTS column stays
/// scannable (five identical "Unavailable — OpenCode Go monthly window…"
/// rows were unreadable in the ratatui host).
fn shorten_agent_detail(detail: &str) -> String {
    let lower = detail.to_ascii_lowercase();
    if lower.contains("opencode go") || lower.contains("opencode-go") {
        return "OpenCode Go · unavailable".into();
    }
    if lower.contains("rate-limited") || lower.contains("rate limited") {
        if let Some(provider) = detail.split(['—', '-', ':']).next() {
            let p = provider.trim();
            if !p.is_empty() && p.len() < 24 {
                return format!("{p} · unavailable");
            }
        }
        return "Rate-limited · unavailable".into();
    }
    const MAX: usize = 36;
    if detail.chars().count() <= MAX {
        return detail.to_string();
    }
    let mut out: String = detail.chars().take(MAX.saturating_sub(1)).collect();
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

/// Sticky chat CTA when the live team has blocked roles (rate-limit, quota,
/// entitlement, out of funds). Mirrors cockpit `availabilityNotices` intent
/// without toast APIs — ratatui paints this in the work surface.
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
    Some(vec![
        format!("{who} unavailable (rate-limit / no funds)."),
        "Type /analyze to reassign.".into(),
    ])
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
        assert_eq!(view.agents[0].detail, "No entitlement");
        assert_eq!(view.agents[1].label, "Builder");
        assert_eq!(view.agents[1].state, AgentState::Idle);
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
        assert_eq!(view.agents[0].detail, "OpenCode Go · unavailable");
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
            joined.contains("rate-limit") || joined.contains("no funds"),
            "attention must name the provider failure class: {joined}"
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
                detail: "unavailable".into(),
                state: AgentState::Blocked,
            })
            .collect();
        let attention = blocked_team_attention(&agents).expect("CTA");
        let joined = attention.join(" ");
        assert!(joined.contains("5 roles"));
        assert!(!joined.contains("Role0"), "must not list every role when N>3");
        assert!(joined.contains("/analyze"));
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

"use strict";

const { panelStyles } = require("./panel-styles");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function chipGlyph(state) {
  if (state === "available" || state === "configured" || state === "connected" || state === "ok") {
    return "●";
  }
  if (state === "stale" || state === "warning" || state === "incompatible" || state === "auth_required") {
    return "⚠";
  }
  return "○";
}

function renderActionButtons(actions) {
  return (actions ?? []).map((action) => {
    const cls = action.primary ? "btn primary" : "btn";
    const cmd = action.command ? String(action.command) : "";
    const safety = action.safety ? String(action.safety) : "consent";
    return `<button class="${cls}" data-action="${escapeHtml(action.id)}" data-command="${escapeHtml(cmd)}" data-safety="${escapeHtml(safety)}">${escapeHtml(action.label)}</button>`;
  }).join("");
}

function renderEntryDetail(entry) {
  if (!entry) return `<div class="empty">Select an entry or connection.</div>`;
  return `<h2>${escapeHtml(entry.title)}</h2>
    <p>${escapeHtml(entry.detail || "No extra detail.")}</p>
    ${entry.category ? `<p>Category · ${escapeHtml(entry.category)}</p>` : ""}
    <div class="detail-actions" id="detail-actions"></div>
    <p class="hint">Buttons open a terminal. Kairo never writes without your consent.</p>`;
}

function renderFleetTree(fleetNodes, { hideEmptyPlatforms = false, teamError = null } = {}) {
  const head = `<div class="fleet-head">
    <span>Equipo</span>
    <button class="btn fleet-head-btn" type="button" data-action="fleet" data-command="kairo fleet" data-safety="read-only">CLI</button>
  </div>`;
  if (!Array.isArray(fleetNodes) || fleetNodes.length === 0) {
    const empty = teamError
      ? "Team unavailable — Work still shown."
      : hideEmptyPlatforms
        ? "Team section degraded."
        : "No platforms detected.";
    return `<div class="fleet">${head}<div class="muted" style="padding:4px 14px 8px">${escapeHtml(empty)}</div></div>`;
  }
  const desks = fleetNodes.map((node, index) => {
    const honesty = node.honesty ? String(node.honesty) : (node.opaque ? "opaque" : "declared");
    const honestyLabel = honesty.charAt(0).toUpperCase() + honesty.slice(1);
    const cls = [
      "desk",
      node.opaque || honesty === "opaque" ? "desk-opaque" : "",
      honesty === "live" ? "desk-working" : "",
      `desk-${escapeHtml(node.platform)}`
    ].filter(Boolean).join(" ");
    return `<button class="${cls}" type="button" data-fleet="${index}" title="${escapeHtml(node.detail)}">
      <span class="desk-glyph">${escapeHtml(node.glyph || "?")}</span>
      <span class="desk-body">
        <span class="desk-title">${escapeHtml(node.title)} <span class="honesty ${escapeHtml(honesty)}">${escapeHtml(honestyLabel)}</span></span>
        <span class="desk-sub">${escapeHtml(node.subtitle || "")}</span>
      </span>
    </button>`;
  }).join("");
  return `<div class="fleet" id="fleet">${head}<div class="floor">${desks}</div></div>`;
}

function renderActivityTree(activityNodes, activeCount = 0, showFloor = false) {
  if (!showFloor) {
    return `<div class="fleet activity quiet">
      <div class="fleet-head"><span>Working floor</span></div>
      <div class="quiet-line">Quiet — desks light up when an agent is actually working.</div>
    </div>`;
  }
  const head = `<div class="fleet-head"><span>Working · ${escapeHtml(String(activeCount))} live</span></div>`;
  const desks = activityNodes.map((node, index) => `
    <button class="desk desk-working" type="button" data-activity="${index}">
      <span class="desk-glyph pulse">${escapeHtml(node.glyph || "••")}</span>
      <span class="desk-body">
        <span class="desk-title">${escapeHtml(node.title)}</span>
        <span class="desk-sub">${escapeHtml(node.subtitle || "")}</span>
      </span>
    </button>`).join("");
  return `<div class="fleet activity" id="activity">${head}<div class="floor">${desks}</div></div>`;
}

function renderList(items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return `<ul class="work-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderWorkViewport(work) {
  const w = work ?? { present: false, emptyReason: "no_snapshot", integrationState: "missing" };
  const meta = [
    w.integrationState ? `Estado · ${w.integrationState}` : null,
    w.conversationId ? `Conversación · ${w.conversationId}` : null,
    w.updatedAt ? `Actualizado · ${w.updatedAt}` : null
  ].filter(Boolean).join(" · ");

  if (!w.present) {
    const reason = w.emptyReason === "next_unavailable"
      ? "Work snapshot unavailable."
      : "No published work snapshot for this workspace.";
    return `<section class="section" id="ahora">
      <div class="section-head"><span>Ahora</span><span class="muted">${escapeHtml(meta || "—")}</span></div>
      <div class="work-empty">${escapeHtml(reason)}</div>
      ${w.detail ? `<div class="muted work-detail">${escapeHtml(w.detail)}</div>` : ""}
    </section>`;
  }

  return `<section class="section" id="ahora">
    <div class="section-head"><span>Ahora</span><span class="muted">${escapeHtml(meta)}</span></div>
    ${w.goal ? `<div class="work-row"><span class="work-label">Goal</span><div>${escapeHtml(w.goal)}</div></div>` : ""}
    ${w.progress?.length ? `<div class="work-row"><span class="work-label">Progress</span>${renderList(w.progress)}</div>` : ""}
    ${w.now ? `<div class="work-row"><span class="work-label">Now</span><div>${escapeHtml(w.now)}</div></div>` : ""}
    ${w.blockers?.length ? `<div class="work-row"><span class="work-label">Blockers</span>${renderList(w.blockers)}</div>` : ""}
    ${w.next ? `<div class="work-row"><span class="work-label">Next</span><div>${escapeHtml(w.next)}</div></div>` : ""}
    ${w.team?.members?.length ? `<div class="work-row"><span class="work-label">Team</span>${renderList(
      w.team.members.map((m) => [m.title || m.workId, m.role, m.state].filter(Boolean).join(" · "))
    )}</div>` : ""}
  </section>`;
}

function degradedWorkflowCopy(error) {
  if (error === "gentle_upgrade_required") {
    return "Upgrade Gentle. Work and Equipo remain.";
  }
  if (error === "gentle_unavailable" || error === "gentle_capabilities_failed") {
    return "Install gentle-ai separately, then Refresh. Work and Equipo remain.";
  }
  if (error === "gentle_incompatible") {
    return "Gentle response is incompatible. Fail closed. Work and Equipo remain.";
  }
  return `Workflow unavailable${error ? ` · ${error}` : ""}. Work and Equipo remain.`;
}

function renderNextTransition(nextTransition) {
  if (nextTransition == null) return "";
  if (typeof nextTransition === "string") {
    return `<div class="work-row"><span class="work-label">Next transition</span><div>${escapeHtml(nextTransition)}</div></div>`;
  }
  if (typeof nextTransition !== "object") return "";
  const kind = typeof nextTransition.kind === "string" ? nextTransition.kind : "";
  const reason = typeof nextTransition.reason_code === "string" ? nextTransition.reason_code : "";
  const command = nextTransition.execute?.command;
  const summary = [kind, reason].filter(Boolean).join(" · ");
  const cmd = typeof command === "string" && command
    ? `<pre class="next-cmd">${escapeHtml(command)}</pre>`
    : "";
  return `<div class="work-row"><span class="work-label">Next transition</span><div>${escapeHtml(summary)}${cmd}</div></div>`;
}

function renderWorkflowSection(workflow, { degraded = false, error = null } = {}) {
  const wf = workflow ?? { kind: "none", active: false, label: "No active workflow" };
  if (degraded) {
    return `<section class="section" id="workflow">
      <div class="section-head"><span>Workflow Gentle</span><span class="muted">degraded</span></div>
      <p class="muted">${escapeHtml(degradedWorkflowCopy(error))}</p>
    </section>`;
  }
  if (!wf.active) {
    return `<section class="section" id="workflow">
      <div class="section-head"><span>Workflow Gentle</span></div>
      <p class="muted">${escapeHtml(wf.label || "No active workflow")}</p>
    </section>`;
  }
  const reviewBits = [];
  if (wf.review?.state) reviewBits.push(String(wf.review.state));
  if (wf.review?.gate) reviewBits.push(`gate ${wf.review.gate}`);
  if (wf.review?.receipt) {
    const receipt = String(wf.review.receipt);
    reviewBits.push(`receipt ${receipt.length > 28 ? `${receipt.slice(0, 24)}…` : receipt}`);
  }
  const review = reviewBits.length
    ? `<div class="work-row"><span class="work-label">Review</span><div>${escapeHtml(reviewBits.join(" · "))}</div></div>`
    : "";
  return `<section class="section" id="workflow">
    <div class="section-head"><span>Workflow Gentle</span><span class="muted">${escapeHtml(wf.label || wf.kind)}</span></div>
    ${wf.changeName ? `<div class="work-row"><span class="work-label">Change</span><div>${escapeHtml(wf.changeName)}</div></div>` : ""}
    ${renderNextTransition(wf.nextTransition)}
    ${review}
  </section>`;
}

function renderAttentionSection(attention, entries) {
  const items = [];
  for (const item of attention?.items ?? []) {
    if (item.severity === "info" && item.id === "no-workflow") continue;
    items.push(item);
  }
  for (const entry of entries ?? []) {
    if (entry.status === "ok" || entry.status === "note" || entry.status === "info") continue;
    items.push({
      id: entry.id,
      severity: entry.status,
      message: entry.title
    });
  }
  const rows = items.length === 0
    ? `<div class="empty">Nothing needs you right now.</div>`
    : items.map((item) => `<div class="attention-item ${escapeHtml(item.severity || "info")}">${escapeHtml(item.message)}</div>`).join("");
  return `<section class="section" id="atencion">
    <div class="section-head"><span>Atención</span></div>
    ${rows}
  </section>`;
}

function primaryActionsFromModel(model) {
  const fromCp = model.attention?.primaryActions;
  if (Array.isArray(fromCp) && fromCp.length) {
    return fromCp.slice(0, 2).map((a) => ({
      id: a.id,
      label: a.label,
      command: a.command,
      primary: true,
      safety: "consent"
    }));
  }
  return (model.actions ?? []).filter((a) => a.primary).slice(0, 2);
}

function secondaryActionsFromModel(model) {
  const fromCp = model.attention?.secondaryActions;
  if (Array.isArray(fromCp) && fromCp.length) {
    return fromCp.map((a) => ({
      id: a.id,
      label: a.label,
      command: a.command,
      primary: false,
      safety: "consent"
    })).concat([{ id: "refresh", label: "Refresh", command: null, primary: false }]);
  }
  return (model.actions ?? []).filter((a) => !a.primary);
}

function renderPanelHtml(model, nonce) {
  const entries = model.entries ?? [];
  const connections = model.connections ?? [];
  const fleetNodes = model.fleetNodes ?? [];
  const activityNodes = model.activityNodes ?? [];
  const primaryActions = primaryActionsFromModel(model);
  const secondaryActions = secondaryActionsFromModel(model);
  const selected = entries[0] ?? null;
  const teamError = model.controlPlane?.sections?.team?.ok === false
    ? (model.controlPlane.sections.team.error ?? "team_failed")
    : null;
  const hasControlPlane = model.controlPlane != null;

  const chips = connections.length === 0
    ? (hasControlPlane
      ? `<span class="muted">No companion chips in report.</span>`
      : `<span class="muted">Connections loading…</span>`)
    : connections.map((c, index) => `
        <button class="chip" type="button" data-connection="${index}" title="${escapeHtml(c.access)}">
          <span class="chip-glyph ${escapeHtml(c.state)}">${chipGlyph(c.state)}</span>
          <span class="chip-label">${escapeHtml(c.label)}</span>
          <span class="chip-state">${escapeHtml(c.state)}${c.optional ? " · optional" : ""}</span>
        </button>`).join("");

  const authority = model.orchestratorAuthority
    ? ` · authority ${escapeHtml(model.orchestratorAuthority)}`
    : "";
  const headlineOk = model.overall === "ok" || model.work?.integrationState === "active";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Kairo</title>
  <style nonce="${nonce}">${panelStyles()}</style>
</head>
<body>
  <header>
    <h1>Kairo</h1>
    <span class="headline ${headlineOk ? "ok" : ""}">${escapeHtml(model.headline)}</span>
    <span class="meta">${model.cliVersion ? `v${escapeHtml(model.cliVersion)}` : ""}${authority}</span>
  </header>
  <div class="actions primary-actions">${renderActionButtons(primaryActions)}</div>
  ${renderWorkViewport(model.work)}
  ${renderWorkflowSection(model.workflow, {
    degraded: model.controlPlane?.sections?.workflow?.ok === false,
    error: model.controlPlane?.sections?.workflow?.error ?? null
  })}
  ${renderFleetTree(fleetNodes, {
    hideEmptyPlatforms: model.hideEmptyPlatforms === true,
    teamError
  })}
  ${renderActivityTree(activityNodes, model.activityActiveCount ?? 0, model.showActivityFloor === true)}
  ${renderAttentionSection(model.attention, entries)}
  <div class="connections" id="connections">${chips}</div>
  <div class="actions secondary-actions">${renderActionButtons(secondaryActions)}</div>
  <section class="pane details-pane">
    <div class="pane-title">Details</div>
    <div class="details" id="details">${renderEntryDetail(selected)}</div>
  </section>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const entries = ${JSON.stringify(entries)};
    const connections = ${JSON.stringify(connections)};
    const fleetNodes = ${JSON.stringify(fleetNodes)};
    const activityNodes = ${JSON.stringify(activityNodes)};
    const details = document.getElementById("details");

    function escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function detailActionButtons(list) {
      if (!Array.isArray(list) || list.length === 0) return "";
      return "<div class=\\"detail-actions\\">" + list.map((a) => {
        const cmd = a.command ? String(a.command) : "";
        const kind = a.kind || "run";
        const safety = a.safety || "consent";
        return "<button class=\\"btn\\" type=\\"button\\" data-detail-action=\\"1\\" data-kind=\\""
          + escapeHtml(kind) + "\\" data-command=\\"" + escapeHtml(cmd)
          + "\\" data-safety=\\"" + escapeHtml(safety)
          + "\\" data-action-id=\\"" + escapeHtml(a.id) + "\\">"
          + escapeHtml(a.label) + "</button>";
      }).join("") + "</div>";
    }

    function bindDetailActions() {
      details.querySelectorAll("[data-detail-action]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const kind = btn.getAttribute("data-kind");
          const command = btn.getAttribute("data-command") || "";
          const actionId = btn.getAttribute("data-action-id") || "";
          const safety = btn.getAttribute("data-safety") || "consent";
          if (kind === "refresh" || actionId === "refresh") {
            vscode.postMessage({ type: "action", id: "refresh" });
            return;
          }
          if (kind === "guide" || !command) {
            vscode.postMessage({ type: "action", id: "guide", detail: actionId });
            return;
          }
          vscode.postMessage({ type: "run-command", command, id: actionId, safety });
        });
      });
    }

    function clearSelection(except) {
      if (except !== "chip") document.querySelectorAll(".chip").forEach((el) => el.classList.remove("selected"));
      if (except !== "fleet") document.querySelectorAll("[data-fleet]").forEach((el) => el.classList.remove("selected"));
      if (except !== "activity") document.querySelectorAll("[data-activity]").forEach((el) => el.classList.remove("selected"));
    }

    function showEntry(index) {
      const entry = entries[index];
      if (!entry) return;
      details.innerHTML = "<h2>" + escapeHtml(entry.title) + "</h2>"
        + "<p>" + escapeHtml(entry.detail || "No extra detail.") + "</p>"
        + (entry.category ? "<p>Category · " + escapeHtml(entry.category) + "</p>" : "")
        + detailActionButtons(entry.actions)
        + "<p class=\\"hint\\">Buttons open a terminal. Kairo never writes without your consent.</p>";
      bindDetailActions();
    }

    function showConnection(index) {
      const c = connections[index];
      if (!c) return;
      clearSelection("chip");
      document.querySelectorAll(".chip").forEach((el, i) => {
        el.classList.toggle("selected", i === index);
      });
      const optional = c.optional ? "<p>Optional · skip if you do not use this tool.</p>" : "";
      details.innerHTML = "<h2>" + escapeHtml(c.label) + " · " + escapeHtml(c.state) + "</h2>"
        + optional
        + "<p><strong>Access</strong> · " + escapeHtml(c.access || "") + "</p>"
        + "<p>" + escapeHtml(c.detail || "") + "</p>"
        + detailActionButtons(c.actions)
        + "<p class=\\"hint\\">Configure opens a terminal with a dry-run/plan when possible. Externals (Gentle/Hermes) are never auto-installed by Kairo.</p>";
      bindDetailActions();
    }

    function showFleet(index) {
      const node = fleetNodes[index];
      if (!node) return;
      clearSelection("fleet");
      document.querySelectorAll("[data-fleet]").forEach((el, i) => {
        el.classList.toggle("selected", i === index);
      });
      const lines = String(node.detail || "").split("\\n").map((line) =>
        "<p>" + escapeHtml(line) + "</p>"
      ).join("");
      details.innerHTML = "<h2>" + escapeHtml(node.title) + "</h2>"
        + (node.subtitle ? "<p>" + escapeHtml(node.subtitle) + "</p>" : "")
        + (node.honesty ? "<p>Honesty · " + escapeHtml(node.honesty) + "</p>" : "")
        + detailActionButtons(node.actions)
        + lines
        + "<p class=\\"hint\\">Use the buttons first. Plan opens a terminal; add --yes to write (backup created). Live = OpenCode evidence only.</p>";
      bindDetailActions();
    }

    function showActivity(index) {
      const node = activityNodes[index];
      if (!node) return;
      clearSelection("activity");
      document.querySelectorAll("[data-activity]").forEach((el, i) => {
        el.classList.toggle("selected", i === index);
      });
      const lines = String(node.detail || "").split("\\n").map((line) =>
        "<p>" + escapeHtml(line) + "</p>"
      ).join("");
      details.innerHTML = "<h2>" + escapeHtml(node.title) + "</h2>"
        + (node.subtitle ? "<p>" + escapeHtml(node.subtitle) + "</p>" : "")
        + lines
        + "<p class=\\"hint\\">Only live workers appear here. Idle history stays out of the floor.</p>";
    }

    document.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-action");
        const command = btn.getAttribute("data-command") || "";
        const safety = btn.getAttribute("data-safety") || "consent";
        if (id === "refresh" || !command) {
          vscode.postMessage({ type: "action", id });
          return;
        }
        vscode.postMessage({ type: "run-command", command, id, safety });
      });
    });
    document.querySelectorAll("[data-connection]").forEach((btn) => {
      btn.addEventListener("click", () => {
        showConnection(Number(btn.getAttribute("data-connection")));
      });
    });
    document.querySelectorAll("[data-fleet]").forEach((btn) => {
      btn.addEventListener("click", () => {
        showFleet(Number(btn.getAttribute("data-fleet")));
      });
    });
    document.querySelectorAll("[data-activity]").forEach((btn) => {
      btn.addEventListener("click", () => {
        showActivity(Number(btn.getAttribute("data-activity")));
      });
    });

    if (entries.length > 0) showEntry(0);
    else bindDetailActions();
  </script>
</body>
</html>`;
}

module.exports = {
  escapeHtml,
  renderPanelHtml,
  renderFleetTree,
  renderActivityTree,
  renderWorkViewport,
  renderWorkflowSection,
  renderAttentionSection,
  primaryActionsFromModel,
  secondaryActionsFromModel,
  chipGlyph
};

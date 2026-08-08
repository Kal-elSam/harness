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

function renderFleetTree(fleetNodes) {
  const head = `<div class="fleet-head">
    <span>Fleet floor</span>
    <button class="btn fleet-head-btn" type="button" data-action="fleet" data-command="kairo fleet" data-safety="read-only">CLI</button>
  </div>`;
  if (!Array.isArray(fleetNodes) || fleetNodes.length === 0) {
    return `<div class="fleet">${head}<div class="muted" style="padding:4px 14px 8px">No platforms detected.</div></div>`;
  }
  const desks = fleetNodes.map((node, index) => {
    const cls = [
      "desk",
      node.opaque ? "desk-opaque" : "",
      `desk-${escapeHtml(node.platform)}`
    ].filter(Boolean).join(" ");
    return `<button class="${cls}" type="button" data-fleet="${index}" title="${escapeHtml(node.detail)}">
      <span class="desk-glyph">${escapeHtml(node.glyph || "?")}</span>
      <span class="desk-body">
        <span class="desk-title">${escapeHtml(node.title)}</span>
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

function renderPanelHtml(model, nonce) {
  const entries = model.entries ?? [];
  const actions = model.actions ?? [];
  const connections = model.connections ?? [];
  const fleetNodes = model.fleetNodes ?? [];
  const activityNodes = model.activityNodes ?? [];
  const selected = entries[0] ?? null;

  const chips = connections.length === 0
    ? `<span class="muted">Connections loading…</span>`
    : connections.map((c, index) => `
        <button class="chip" type="button" data-connection="${index}" title="${escapeHtml(c.access)}">
          <span class="chip-glyph ${escapeHtml(c.state)}">${chipGlyph(c.state)}</span>
          <span class="chip-label">${escapeHtml(c.label)}</span>
          <span class="chip-state">${escapeHtml(c.state)}${c.optional ? " · optional" : ""}</span>
        </button>`).join("");

  const entryRows = entries.length === 0
    ? `<div class="empty">Nothing needs you right now.</div>`
    : entries.map((entry, index) => `
        <button class="entry${index === 0 ? " selected" : ""}" data-entry="${index}" type="button">
          <span class="badge ${escapeHtml(entry.status)}">${escapeHtml(entry.status)}</span>
          <span class="entry-title">${escapeHtml(entry.title)}</span>
        </button>`).join("");

  const authority = model.orchestratorAuthority
    ? ` · authority ${escapeHtml(model.orchestratorAuthority)}`
    : "";

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
    <span class="headline ${model.overall === "ok" ? "ok" : ""}">${escapeHtml(model.headline)}</span>
    <span class="meta">${model.cliVersion ? `v${escapeHtml(model.cliVersion)}` : ""} · ${entries.length} entries${authority}</span>
  </header>
  <div class="actions">${renderActionButtons(actions)}</div>
  <div class="connections" id="connections">${chips}</div>
  ${renderFleetTree(fleetNodes)}
  ${renderActivityTree(activityNodes, model.activityActiveCount ?? 0, model.showActivityFloor === true)}
  <div class="panes">
    <section class="pane">
      <div class="pane-title">Entries ${entries.length}</div>
      <div class="entries" id="entries">${entryRows}</div>
    </section>
    <section class="pane">
      <div class="pane-title">Details</div>
      <div class="details" id="details">${renderEntryDetail(selected)}</div>
    </section>
  </div>
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
      if (except !== "entry") document.querySelectorAll(".entry").forEach((el) => el.classList.remove("selected"));
      if (except !== "chip") document.querySelectorAll(".chip").forEach((el) => el.classList.remove("selected"));
      if (except !== "fleet") document.querySelectorAll("[data-fleet]").forEach((el) => el.classList.remove("selected"));
      if (except !== "activity") document.querySelectorAll("[data-activity]").forEach((el) => el.classList.remove("selected"));
    }

    function showEntry(index) {
      const entry = entries[index];
      if (!entry) return;
      clearSelection("entry");
      document.querySelectorAll(".entry").forEach((el, i) => {
        el.classList.toggle("selected", i === index);
      });
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
        + detailActionButtons(node.actions)
        + lines
        + "<p class=\\"hint\\">Use the buttons first. Plan opens a terminal; add --yes to write (backup created). Pixel Agents is optional visual for Claude terminals.</p>";
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
    document.querySelectorAll("[data-entry]").forEach((btn) => {
      btn.addEventListener("click", () => {
        showEntry(Number(btn.getAttribute("data-entry")));
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
  </script>
</body>
</html>`;
}

module.exports = { escapeHtml, renderPanelHtml, renderFleetTree, renderActivityTree, chipGlyph };

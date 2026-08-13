"use strict";

/** Shared webview CSS for the Kairo panel (injected with CSP nonce). */
function panelStyles() {
  return `
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-foreground);
      --muted: var(--vscode-descriptionForeground);
      --border: var(--vscode-panel-border, #444);
      --btn: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --btn2: var(--vscode-button-secondaryBackground);
      --btn2-fg: var(--vscode-button-secondaryForeground);
      --list-hover: var(--vscode-list-hoverBackground);
      --list-active: var(--vscode-list-activeSelectionBackground);
      --warn: var(--vscode-editorWarning-foreground, #cca700);
      --ok: var(--vscode-testing-iconPassed, #89d185);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 0; color: var(--fg); background: var(--bg);
      font: 13px/1.4 var(--vscode-font-family);
      height: 100vh; display: flex; flex-direction: column;
    }
    header {
      display: flex; align-items: center; gap: 12px; padding: 10px 14px;
      border-bottom: 1px solid var(--border);
    }
    header h1 { margin: 0; font-size: 14px; font-weight: 600; }
    header .headline { color: var(--warn); font-weight: 600; }
    header .headline.ok { color: var(--ok); }
    header .meta { margin-left: auto; color: var(--muted); font-size: 12px; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; padding: 10px 14px; border-bottom: 1px solid var(--border); }
    .btn {
      border: none; border-radius: 2px; padding: 6px 14px; cursor: pointer;
      background: var(--btn2); color: var(--btn2-fg);
    }
    .btn.primary { background: var(--btn); color: var(--btn-fg); font-weight: 600; }
    .btn:hover { filter: brightness(1.1); }
    .connections {
      display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 14px;
      border-bottom: 1px solid var(--border);
    }
    .chip {
      display: inline-flex; align-items: center; gap: 6px;
      border: 1px solid var(--border); background: transparent; color: inherit;
      border-radius: 12px; padding: 4px 10px; cursor: pointer; font: inherit;
    }
    .chip:hover, .chip.selected { background: var(--list-hover); }
    .chip-glyph.available, .chip-glyph.configured, .chip-glyph.connected, .chip-glyph.ok { color: var(--ok); }
    .chip-glyph.stale, .chip-glyph.warning, .chip-glyph.incompatible, .chip-glyph.auth_required { color: var(--warn); }
    .chip-state { color: var(--muted); font-size: 11px; }
    .muted { color: var(--muted); font-size: 12px; }
    .fleet {
      border-bottom: 1px solid var(--border);
    }
    .fleet-head {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 8px 14px 4px; font-size: 11px; letter-spacing: 0.06em;
      text-transform: uppercase; color: var(--muted);
    }
    .fleet-head-btn {
      text-transform: none; letter-spacing: normal; font-size: 11px;
      padding: 2px 8px;
    }
    .floor {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
      gap: 8px;
      padding: 8px 14px 12px;
    }
    .desk {
      display: flex; align-items: center; gap: 8px;
      text-align: left; border: 1px solid var(--border);
      background: color-mix(in srgb, var(--bg) 88%, var(--fg) 12%);
      color: inherit; font: inherit; border-radius: 6px;
      padding: 8px 10px; cursor: pointer; min-height: 52px;
    }
    .desk:hover, .desk.selected {
      border-color: color-mix(in srgb, var(--ok) 55%, var(--border));
      background: var(--list-hover);
    }
    .desk-opaque { opacity: 0.72; }
    .desk-working {
      border-color: color-mix(in srgb, var(--ok) 70%, var(--border));
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--ok) 35%, transparent);
    }
    .desk-glyph {
      flex-shrink: 0; width: 28px; height: 28px; border-radius: 4px;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 10px; font-weight: 700; letter-spacing: 0.02em;
      background: color-mix(in srgb, var(--fg) 14%, transparent);
      color: var(--fg);
    }
    .desk-cursor .desk-glyph { background: #3d4a5c; }
    .desk-claude .desk-glyph { background: #5a4634; }
    .desk-codex .desk-glyph { background: #2f4a3a; }
    .desk-opencode .desk-glyph { background: #3a3558; }
    .desk-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .desk-title {
      font-size: 12px; font-weight: 600;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .desk-sub {
      font-size: 11px; color: var(--muted);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .quiet-line {
      padding: 4px 14px 10px; color: var(--muted); font-size: 12px;
    }
    .pulse { animation: kairo-pulse 1.4s ease-in-out infinite; }
    @keyframes kairo-pulse {
      0%, 100% { filter: brightness(1); }
      50% { filter: brightness(1.45); }
    }
    .fleet-node {
      display: block; width: 100%; text-align: left; border: none;
      background: transparent; color: inherit; font: inherit;
      padding: 4px 14px; cursor: pointer;
    }
    .fleet-node.indent { padding-left: 28px; color: var(--muted); }
    .fleet-node:hover, .fleet-node.selected { background: var(--list-hover); }
    .fleet-opaque { font-style: italic; }
    .fleet-active { color: var(--ok); font-weight: 600; }
    .detail-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
    .detail-actions .btn { font-size: 12px; padding: 5px 12px; }
    .panes { display: flex; flex: 1; min-height: 0; }
    .pane { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .pane + .pane { border-left: 1px solid var(--border); }
    .pane-title {
      padding: 8px 14px; font-size: 11px; letter-spacing: 0.06em;
      text-transform: uppercase; color: var(--muted); border-bottom: 1px solid var(--border);
    }
    .entries { overflow: auto; flex: 1; }
    .entry {
      display: flex; gap: 8px; align-items: center; width: 100%;
      text-align: left; border: none; background: transparent; color: inherit;
      padding: 8px 14px; cursor: pointer;
    }
    .entry:hover { background: var(--list-hover); }
    .entry.selected { background: var(--list-active); }
    .entry-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .badge {
      font-size: 10px; text-transform: uppercase; padding: 1px 6px;
      border-radius: 2px; background: #555; color: #fff; flex-shrink: 0;
    }
    .badge.action, .badge.drift, .badge.warning, .badge.missing, .badge.conflict { background: #9a6b00; }
    .badge.note, .badge.info { background: #3a3a3a; }
    .badge.error, .badge.fail, .badge.failed { background: #a1260d; }
    .details { padding: 14px; overflow: auto; flex: 1; }
    .details h2 { margin: 0 0 8px; font-size: 14px; }
    .details p { margin: 0 0 8px; color: var(--muted); }
    .empty { padding: 24px 14px; color: var(--muted); text-align: center; }
    .hint { margin-top: 16px; font-size: 12px; color: var(--muted); }
    .work { border-bottom: 1px solid var(--border); padding: 10px 14px 12px; }
    .work-head { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 8px; font-weight: 600; }
    .work-row { margin: 0 0 8px; }
    .work-label { display: block; color: var(--muted); font-size: 11px; text-transform: uppercase; margin-bottom: 2px; }
    .work-list { margin: 0; padding-left: 18px; }
    .work-empty, .work-detail { color: var(--muted); }
    .section { border-bottom: 1px solid var(--border); padding: 10px 14px 12px; }
    .section-head {
      display: flex; justify-content: space-between; gap: 8px; align-items: baseline;
      margin-bottom: 8px; font-size: 11px; letter-spacing: 0.06em;
      text-transform: uppercase; color: var(--muted); font-weight: 600;
    }
    .section-head > span:first-child { color: var(--fg); }
    .primary-actions { border-bottom: 1px solid var(--border); }
    .secondary-actions { opacity: 0.92; }
    .honesty {
      display: inline-block; margin-left: 6px; font-size: 10px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.04em; padding: 1px 5px;
      border-radius: 2px; background: color-mix(in srgb, var(--fg) 12%, transparent);
      color: var(--muted); vertical-align: middle;
    }
    .honesty.live { color: var(--ok); background: color-mix(in srgb, var(--ok) 18%, transparent); }
    .honesty.declared { color: var(--fg); }
    .honesty.opaque { color: var(--muted); font-style: italic; }
    .attention-item {
      padding: 6px 0; border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
    }
    .attention-item:last-child { border-bottom: none; }
    .attention-item.warning, .attention-item.action, .attention-item.drift { color: var(--warn); }
    .attention-item.error, .attention-item.fail { color: #f48771; }
    .details-pane { flex: 1; min-height: 120px; border-top: 1px solid var(--border); }
    .muted { color: var(--muted); }
  `;
}

module.exports = { panelStyles };

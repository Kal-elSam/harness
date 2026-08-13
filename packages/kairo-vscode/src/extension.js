"use strict";

const vscode = require("vscode");
const { StatusCache, mapStatusBar, fetchKairoStatus } = require("./status");
const { ControlPlaneCache, fetchKairoControlPlane } = require("./control-plane-cache");
const { KairoStatusTreeProvider } = require("./tree");
const { KairoPanelProvider, VIEW_ID } = require("./panel");

const REFRESH_INTERVAL_MS = 60_000;
const TERMINAL_NAME = "Kairo";

const GUIDE_TIPS = Object.freeze({
  "guide-optional":
    "Optional: Pi / Engram-on-Pi do not block governance. Skip if you only use Cursor, Claude, Codex, or OpenCode.",
  "guide-hermes-api":
    "Kairo needs Hermes API Server on :8642 (not just chat). Docs: https://hermes-ai.net/es/docs/quickstart/ then add API_SERVER_ENABLED=true to ~/.hermes/.env and run hermes gateway run. Or skip — Hermes is optional. Messaging (Telegram etc.) is hermes gateway setup; everyday chat is just hermes.",
  "guide-hermes":
    "Install/configure Hermes: https://hermes-ai.net/es/docs/quickstart/ (hermes setup → hermes). For the Kairo chip, also enable API_SERVER_ENABLED=true and hermes gateway run. Optional.",
  "guide-gentle":
    "Install Gentle separately if you want it, then Refresh. Optional — governance works without it.",
  "guide-engram":
    "Install Engram separately if you want persistent memory, then use Configure Engram. Optional.",
  "guide-graphify":
    "Install graphify separately for the code graph, then Refresh / Update graph. Optional."
});

function workspaceCwd() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function runInKairoTerminal(commandLine) {
  const cwd = workspaceCwd();
  let terminal = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME);
  if (!terminal) {
    terminal = vscode.window.createTerminal({
      name: TERMINAL_NAME,
      cwd: cwd || undefined
    });
  } else if (cwd) {
    terminal.sendText(`cd ${JSON.stringify(cwd)}`, true);
  }
  terminal.show(true);
  terminal.sendText(commandLine, true);
}

function activate(context) {
  const cache = new StatusCache({
    fetch: () => fetchKairoStatus({ cwd: workspaceCwd() })
  });
  const controlPlaneCache = new ControlPlaneCache({
    fetch: () => fetchKairoControlPlane({ cwd: workspaceCwd() })
  });
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.command = "kairo.openPanel";
  item.show();
  context.subscriptions.push(item);

  const tree = new KairoStatusTreeProvider({ cache });
  context.subscriptions.push(vscode.window.registerTreeDataProvider("kairo.status", tree));

  const panel = new KairoPanelProvider({
    cache,
    controlPlaneCache,
    onAction: async (id, message = {}) => {
      if (id === "refresh") {
        await refreshAll({ force: true });
        return;
      }
      if (id === "guide") {
        const tip = GUIDE_TIPS[message.detail]
          ?? "This tool is optional and installed outside Kairo. Read Details, install yourself if you want it, then Refresh.";
        void vscode.window.showInformationMessage(tip);
        return;
      }
      if (id === "run-command" && typeof message.command === "string" && message.command.trim()) {
        const command = message.command.trim();
        if (message.safety === "destructive") {
          const answer = await vscode.window.showWarningMessage(
            `This will overwrite conflicting files (with backup).\n\n${command}`,
            { modal: true },
            "Run in terminal"
          );
          if (answer !== "Run in terminal") return;
        }
        runInKairoTerminal(command);
      }
    }
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, panel, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  const refreshAll = async ({ force = true } = {}) => {
    if (force) {
      cache.invalidate();
      controlPlaneCache.invalidate();
    }
    const status = await cache.get({ force });
    const mapped = mapStatusBar(status);
    item.text = mapped.text;
    item.tooltip = mapped.tooltip;
    tree.refresh();
    await panel.refresh();
  };

  for (const [id, fn] of [
    ["kairo.refresh", () => refreshAll({ force: true })],
    ["kairo.openPanel", async () => {
      await vscode.commands.executeCommand("kairo.panel.focus");
      await refreshAll({ force: true });
    }],
    ["kairo.openCockpit", () => runInKairoTerminal("kairo")],
    ["kairo.setup", () => runInKairoTerminal("kairo setup")],
    ["kairo.sync", () => runInKairoTerminal("kairo sync")],
    ["kairo.doctor", () => runInKairoTerminal("kairo doctor")],
    ["kairo.connectAgent", () => runInKairoTerminal("kairo mcp install")]
  ]) {
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  }

  const interval = setInterval(() => {
    void refreshAll({ force: true });
  }, REFRESH_INTERVAL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(interval) });
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) void refreshAll({ force: true });
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void refreshAll({ force: true });
    })
  );

  void refreshAll({ force: true });
}

function deactivate() {}

module.exports = { activate, deactivate };

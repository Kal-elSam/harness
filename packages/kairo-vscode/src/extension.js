"use strict";

const vscode = require("vscode");
const { StatusCache, mapStatusBar } = require("./status");
const { KairoStatusTreeProvider } = require("./tree");

const REFRESH_INTERVAL_MS = 60_000;
const TERMINAL_NAME = "Kairo";

function runInKairoTerminal(commandLine) {
  const existing = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME);
  const terminal = existing ?? vscode.window.createTerminal({ name: TERMINAL_NAME });
  terminal.show(true);
  terminal.sendText(commandLine, true);
}

function activate(context) {
  const cache = new StatusCache();
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.command = "kairo.openCockpit";
  item.show();
  context.subscriptions.push(item);

  const tree = new KairoStatusTreeProvider({ cache });
  context.subscriptions.push(vscode.window.registerTreeDataProvider("kairo.status", tree));

  const refreshAll = async ({ force = true } = {}) => {
    if (force) cache.invalidate();
    const status = await cache.get({ force });
    const mapped = mapStatusBar(status);
    item.text = mapped.text;
    item.tooltip = mapped.tooltip;
    tree.refresh();
  };

  for (const [id, fn] of [
    ["kairo.refresh", () => refreshAll({ force: true })],
    ["kairo.openCockpit", () => runInKairoTerminal("kairo")],
    ["kairo.sync", () => runInKairoTerminal("kairo sync")],
    ["kairo.doctor", () => runInKairoTerminal("kairo doctor")]
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

  void refreshAll({ force: true });
}

function deactivate() {}

module.exports = { activate, deactivate };

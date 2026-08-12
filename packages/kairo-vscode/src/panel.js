"use strict";

const vscode = require("vscode");
const { buildPanelModel } = require("./panel-model");
const { renderPanelHtml } = require("./panel-html");

const VIEW_ID = "kairo.panel";

class KairoPanelProvider {
  constructor({ cache, connectionsCache, nextCache, onAction }) {
    this.cache = cache;
    this.connectionsCache = connectionsCache;
    this.nextCache = nextCache;
    this.onAction = onAction;
    this._view = null;
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === "action" && typeof message.id === "string") {
        await this.onAction(message.id, message);
        return;
      }
      if (message?.type === "run-command" && typeof message.command === "string" && message.command) {
        await this.onAction("run-command", message);
      }
    });
    void this.refresh();
  }

  async refresh() {
    if (!this._view) return;
    const [status, connectionsReport, nextReport] = await Promise.all([
      this.cache.get({ force: true }),
      this.connectionsCache
        ? this.connectionsCache.get({ force: true })
        : Promise.resolve({ connections: [] }),
      this.nextCache
        ? this.nextCache.get({ force: true })
        : Promise.resolve(null)
    ]);
    const model = buildPanelModel(
      status,
      connectionsReport?.connections ?? [],
      connectionsReport,
      nextReport
    );
    const nonce = String(Date.now());
    this._view.webview.html = renderPanelHtml(model, nonce);
    this._view.title = `Kairo · ${model.headline}`;
  }
}

module.exports = {
  VIEW_ID,
  KairoPanelProvider
};

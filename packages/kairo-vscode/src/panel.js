"use strict";

const vscode = require("vscode");
const { buildPanelModel } = require("./panel-model");
const { renderPanelHtml } = require("./panel-html");
const { fleetReportFromControlPlane } = require("./control-plane-cache");

const VIEW_ID = "kairo.panel";

class KairoPanelProvider {
  constructor({ cache, controlPlaneCache, onAction }) {
    this.cache = cache;
    this.controlPlaneCache = controlPlaneCache;
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
    // Single atomic report for connections/fleet/work/workflow — avoids contradictory partial UI.
    const [status, controlPlane] = await Promise.all([
      this.cache.get({ force: true }),
      this.controlPlaneCache
        ? this.controlPlaneCache.get({ force: true })
        : Promise.resolve(null)
    ]);
    const fleetReport = fleetReportFromControlPlane(controlPlane);
    const connections = fleetReport.connections ?? [];
    const nextReport = controlPlane?.work ?? null;
    const model = buildPanelModel(status, connections, fleetReport, nextReport, controlPlane);
    const nonce = String(Date.now());
    this._view.webview.html = renderPanelHtml(model, nonce);
    this._view.title = `Kairo · ${model.headline}`;
  }
}

module.exports = {
  VIEW_ID,
  KairoPanelProvider
};

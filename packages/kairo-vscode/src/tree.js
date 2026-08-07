"use strict";

const vscode = require("vscode");
const { buildTreeModel } = require("./status");

class KairoTreeItem extends vscode.TreeItem {
  constructor(label, collapsibleState, extras = {}) {
    super(label, collapsibleState);
    if (extras.tooltip) this.tooltip = extras.tooltip;
    if (extras.description) this.description = extras.description;
    if (extras.contextValue) this.contextValue = extras.contextValue;
  }
}

class KairoStatusTreeProvider {
  constructor({ cache, vscodeApi = vscode }) {
    this.cache = cache;
    this.vscode = vscodeApi;
    this._onDidChangeTreeData = new this.vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  async getChildren(element) {
    if (element) return element.children ?? [];

    const status = await this.cache.get();
    const model = buildTreeModel(status);
    const None = this.vscode.TreeItemCollapsibleState.None;
    const Expanded = this.vscode.TreeItemCollapsibleState.Expanded;
    const roots = [
      new KairoTreeItem(model.nextAction, None, {
        tooltip: model.nextAction,
        contextValue: "kairo.nextAction"
      })
    ];

    for (const group of model.groups) {
      const parent = new KairoTreeItem(group.category, Expanded, {
        description: String(group.items.length),
        contextValue: "kairo.category"
      });
      parent.children = group.items.map(
        (item) =>
          new KairoTreeItem(item.name, None, {
            description: item.status,
            tooltip: item.detail || item.name,
            contextValue: "kairo.check"
          })
      );
      roots.push(parent);
    }

    if (model.groups.length === 0 && status?.overall === "ok") {
      roots.push(
        new KairoTreeItem("All checks OK", None, {
          tooltip: "Nothing needs attention.",
          contextValue: "kairo.ok"
        })
      );
    }

    return roots;
  }

  getTreeItem(element) {
    return element;
  }
}

module.exports = { KairoStatusTreeProvider, KairoTreeItem };

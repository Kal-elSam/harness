# Kairo for VS Code / Cursor

Status bar + explorer tree from `kairo status --json`. Sync/doctor/cockpit open a
terminal — the extension never writes configs.

```bash
npm install -g @kal-elsam/kairo-runtime
cd packages/kairo-vscode && npm run package
code --install-extension ./kairo-0.1.0.vsix
```

Commands: Open Cockpit · Sync · Doctor · Refresh Status.

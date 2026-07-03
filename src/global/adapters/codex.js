import { createManagedConfigAdapter } from "../managed-config-adapter.js";

export default createManagedConfigAdapter({
  id: "codex",
  label: "Codex",
  rootDir: ".codex",
  configFile: ".codex/AGENTS.md"
});

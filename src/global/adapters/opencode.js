import { createManagedConfigAdapter } from "../managed-config-adapter.js";

export default createManagedConfigAdapter({
  id: "opencode",
  label: "OpenCode",
  rootDir: ".config/opencode",
  configFile: ".config/opencode/AGENTS.md"
});

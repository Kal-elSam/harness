import { createManagedConfigAdapter } from "../managed-config-adapter.js";

export default createManagedConfigAdapter({
  id: "cursor",
  label: "Cursor",
  rootDir: ".cursor",
  configFile: ".cursor/AGENTS.md"
});

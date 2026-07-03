import { createManagedConfigAdapter } from "../managed-config-adapter.js";

export default createManagedConfigAdapter({
  id: "claude",
  label: "Claude Code",
  rootDir: ".claude",
  configFile: ".claude/CLAUDE.md"
});

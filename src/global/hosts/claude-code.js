import { createHost, detectDirs, markdownAgent, quote } from "./render.js";

export default createHost({
  id: "claude-code",
  caps: { namedRoles: true, roleModelField: true, perLaunchModel: true, launchHook: true, nativeProviders: ["claude"], roleDir: ".claude/agents" },
  detect: (context) => detectDirs({ adapterId: "claude", projectDirName: ".claude" }, context),
  format: (role, slug, model) => markdownAgent("claude-code", [`name: ${slug}`, `description: ${quote(role.description ?? role.id)}`, `model: ${model}`], role, slug)
});

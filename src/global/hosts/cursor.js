import { createHost, detectDirs, markdownAgent, quote } from "./render.js";

export default createHost({
  id: "cursor",
  caps: { namedRoles: true, roleModelField: true, perLaunchModel: false, launchHook: false, nativeProviders: ["cursor"], roleDir: ".cursor/agents" },
  detect: (context) => detectDirs({ adapterId: "cursor", projectDirName: ".cursor" }, context),
  format: (role, slug, model) => markdownAgent("cursor", [`name: ${slug}`, `description: ${quote(role.description ?? role.id)}`, `model: ${model}`], role, slug)
});

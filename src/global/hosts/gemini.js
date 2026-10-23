import { createHost, detectDirs, markdownAgent, quote } from "./render.js";

// No managed-config adapter exists for Gemini CLI: detection is directory evidence only.
export default createHost({
  id: "gemini",
  caps: { namedRoles: true, roleModelField: true, perLaunchModel: "unverified", launchHook: "unverified", nativeProviders: ["gemini"], roleDir: ".gemini/agents" },
  detect: (context) => detectDirs({ homeDirName: ".gemini", projectDirName: ".gemini" }, context),
  format: (role, slug, model) => markdownAgent("gemini", [`name: ${slug}`, `description: ${quote(role.description ?? role.id)}`, "kind: local", `model: ${model}`], role, slug)
});

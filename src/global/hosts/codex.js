import { createHost, detectDirs, markerText, quote, roleInstructions } from "./render.js";

export default createHost({
  id: "codex",
  extension: "toml",
  caps: { namedRoles: true, roleModelField: true, perLaunchModel: "unverified", launchHook: "unverified", nativeProviders: ["codex"], roleDir: ".codex/agents" },
  detect: (context) => detectDirs({ adapterId: "codex", projectDirName: ".codex" }, context),
  format: (role, slug, model) => [
    `name = ${quote(slug)}`,
    `description = ${quote(role.description ?? role.id)}`,
    `developer_instructions = ${quote(roleInstructions(role, 'codex'))}`,
    `model = ${quote(model)}`,
    "",
    `# ${markerText("codex", slug)}`,
    ""
  ].join("\n")
});

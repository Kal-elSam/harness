import { createHost, detectDirs, markerText, quote, roleInstructions } from "./render.js";

const host = createHost({
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

// createHost's formatter receives only the model; preserve optional route
// metadata here without changing the shared formatter contract for other hosts.
const renderRoleFile = host.renderRoleFile;
host.renderRoleFile = (role, pick) => {
  const rendered = renderRoleFile(role, pick);
  if (rendered.content && pick?.effort !== undefined) {
    if (typeof pick.effort !== "string" || !/^[a-z][a-z0-9_-]*$/.test(pick.effort)) return { path: null, content: null, reason: "invalid-effort" };
    rendered.content = rendered.content.replace(`model = ${quote(pick.model)}\n`, `model = ${quote(pick.model)}\nmodel_reasoning_effort = ${quote(pick.effort)}\n`);
  }
  return rendered;
};
export default host;

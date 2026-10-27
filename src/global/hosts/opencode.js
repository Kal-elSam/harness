import { createHost, detectDirs, markdownAgent, quote, markerText } from "./render.js";

// OpenCode runs many providers through API keys, so every pick is native; the model
// is written as provider/model. Kairo adapter ids map to OpenCode provider ids.
const PROVIDER_IDS = { claude: "anthropic", codex: "openai", gemini: "google" };

const host = createHost({
  id: "opencode",
  caps: { namedRoles: true, roleModelField: true, perLaunchModel: "unverified", launchHook: "unverified", nativeProviders: ["*"], roleDir: ".opencode/agents" },
  detect: (context) => detectDirs({ adapterId: "opencode", projectDirName: ".opencode" }, context),
  modelFor: (pick) => (typeof pick.model === "string" && pick.model.includes("/") ? pick.model : `${PROVIDER_IDS[pick.adapterId] ?? pick.adapterId}/${pick.model}`),
  format: (role, slug, model) => markdownAgent("opencode", [`description: ${quote(role.description ?? role.id)}`, "mode: subagent", `model: ${model}`], role, slug)
});

// OpenCode's shell.env hook binds only its own child tools, not the parent process.
host.renderContextFiles = () => [{ role: 'kairo-host', source: 'host-context',
  path: '.opencode/plugins/kairo-host.js',
  content: `// ${markerText('opencode', 'kairo-host')}\nexport const KairoHost = async () => ({\n  "shell.env": async (_input, output) => { output.env.KAIRO_HOST = "opencode"; }\n});\n`
}];

export default host;

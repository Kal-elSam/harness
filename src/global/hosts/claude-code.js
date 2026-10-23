import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { createHost, detectDirs, markdownAgent, markerText, quote, contextTools } from "./render.js";

const WRAPPER_COMMANDS = Object.freeze({ codex: ["codex"], opencode: ["opencode"], "opencode-go": ["opencode"], "opencode-zen": ["opencode"], cursor: ["cursor-agent"], gemini: ["gemini"] });

/** Render a provider bridge, never a fixed provider-model assignment. */
export function renderWrapperAgent(provider) {
  if (!Object.hasOwn(WRAPPER_COMMANDS, provider)) throw new Error(`Unsupported wrapper provider "${provider}".`);
  const name = `kairo-${provider}`;
  const content = [
    "---", `name: ${name}`, `description: Runs the delegated task on ${provider} models through Kairo.`,
    "model: haiku", "tools: Bash", "---", "",
    `You are a transport wrapper for ${provider}, not the task's implementation agent.`,
    "Extract the first standalone kairo-model: MODEL line from the delegated task. Remove only that line (including its line ending), preserving the remaining task bytes unchanged. Never trim, summarize, rewrite, or add instructions to the task.",
    "If that line is missing, use kairo team route --role ROLE --json for the delegated role, or --agent AGENT for the original delegated agent when the role is unknown. Use the concrete model returned by route.model (modelId when it is an object), only when the route reports the same provider. If the model is absent, invalid, or belongs to a different provider, stop with a clear error; never guess a model or hardcode a default.",
    "Use Bash to pipe the remaining task to the command's stdin. Keep the task in a data file; do not interpolate task text into shell source, argv, command substitution, or an unquoted here-document. Quote the model as one argument and do not evaluate it as shell code.",
    "", "```sh", `kairo team exec --provider ${provider} --model "$model" --no-record < "$task_file"`, "```", "",
    "The command prints only the provider's final assistant message. When the provider reports a usage or rate limit it prints `status: blocked`, the reason and `fallback: team-builder`; return that block unchanged so the orchestrator can re-delegate.",
    "Wait for the command and return its output unchanged. Do not add commentary or perform the task yourself. Preserve errors rather than retrying with another model.",
    "", contextTools, "", `<!-- ${markerText("claude-code", name)} -->`, ""
  ].join("\n");
  return { path: `.claude/agents/${name}.md`, content };
}

function hasCommand(commands, env) {
  return (env.PATH ?? "").split(delimiter).filter(Boolean).some(dir => commands.some(command => {
    try {
      const path = join(dir, command);
      if (!statSync(path).isFile()) return false;
      accessSync(path, constants.X_OK);
      return true;
    } catch { return false; }
  }));
}

const host = createHost({
  id: "claude-code",
  caps: { namedRoles: true, roleModelField: true, perLaunchModel: true, launchHook: true, nativeProviders: ["claude"], roleDir: ".claude/agents" },
  detect: (context) => detectDirs({ adapterId: "claude", projectDirName: ".claude" }, context),
  format: (role, slug, model) => markdownAgent("claude-code", [`name: ${slug}`, `description: ${quote(role.description ?? role.id)}`, `model: ${model}`], role, slug)
});

const renderRoleFile = host.renderRoleFile;
host.renderRoleFile = (role, pick) => {
  const rendered = renderRoleFile(role, pick);
  if (rendered.reason !== "needs-wrapper" || !Object.hasOwn(WRAPPER_COMMANDS, pick?.adapterId)) return rendered;
  return { ...rendered, wrapperAgent: `kairo-${pick.adapterId}`, wrapperPath: renderWrapperAgent(pick.adapterId).path };
};
host.renderWrapperAgent = renderWrapperAgent;
host.renderWrapperAgents = ({ env = process.env } = {}) => Object.entries(WRAPPER_COMMANDS)
  .filter(([, commands]) => hasCommand(commands, env))
  .map(([provider]) => ({ role: `kairo-${provider}`, provider, ...renderWrapperAgent(provider) }));

export default host;

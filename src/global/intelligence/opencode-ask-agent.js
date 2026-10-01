// OpenCode's real CLI (`opencode run --help`) has no flag-driven read-only
// mode: its permission model lives only in opencode config. Kairo therefore
// owns one agent entry, "kairo-ask", and hands it to OpenCode PER RUN
// through OPENCODE_CONFIG_CONTENT (inline config, documented in the
// OpenCode config precedence list). Nothing is written to disk:
//  - the user's global ~/.config/opencode/opencode.json is never read,
//    written, backed up or drifted;
//  - inline config sits above global, custom-path and project
//    opencode.json in precedence, so a repo-level opencode.json cannot
//    weaken the deny set for this run.
export const KAIRO_ASK_AGENT_NAME = "kairo-ask";
export const KAIRO_ASK_CONFIG_ENV = "OPENCODE_CONFIG_CONTENT";

// No "model" field on purpose: the real model comes from askOpencode's own
// `--model` flag per call; this agent only fixes the PERMISSION shape.
// No "read" key: omitted means allowed (needed to investigate the
// snapshot). `webfetch` blocks network fetches and `external_directory`
// blocks paths outside the working directory.
// No "__managed_by" marker: it is not an AgentConfig property and the
// upstream API rejected it ("Unsupported parameter(s)").
export const KAIRO_ASK_AGENT_CONFIG = Object.freeze({
  description: "Kairo's own read-only agent for ASK mode: investigates and answers, never edits, writes, fetches the network, leaves the working directory or runs shell commands.",
  hidden: true,
  mode: "primary",
  permission: Object.freeze({
    bash: "deny", edit: "deny", task: "deny", write: "deny", webfetch: "deny", external_directory: "deny"
  })
});

/** @returns {string} JSON for OPENCODE_CONFIG_CONTENT, rebuilt on every run. */
export function buildKairoAskConfigContent() {
  return JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    agent: { [KAIRO_ASK_AGENT_NAME]: KAIRO_ASK_AGENT_CONFIG }
  });
}

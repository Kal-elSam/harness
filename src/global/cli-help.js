/**
 * Tiered CLI help — short by default, full with --all.
 */
import { BRAND } from "./brand/index.js";
import {
  LEGACY_PACKAGE_NAME,
  PACKAGE_NAME,
  PREFERRED_CLI
} from "./brand/cli.js";
import { GLOBAL_AGENT_IDS } from "./registry.js";
import { COMPONENT_IDS, DEFAULT_COMPONENT_IDS } from "./component-registry.js";
import { ADAPTERS } from "../harness-files.js";

export function printHelp({ all = false } = {}) {
  if (all) {
    console.log(formatHelpAll());
    return;
  }
  console.log(formatHelpShort());
}

export function formatHelpShort() {
  const cli = PREFERRED_CLI;
  return `${BRAND.displayName} (${PACKAGE_NAME})

${BRAND.tagline}. Coordinates agents you already have — never installs AI apps.

Usage:
  ${cli}                 Open the cockpit (setup on first run)
  ${cli} status          See how your setup is doing
  ${cli} sync            Repair what drifted
  ${cli} update          Update Kairo itself (npm)
  ${cli} doctor          Deeper health checks

  ${cli} help --all      Every command and flag
  ${cli} --version

Docs: README.md · docs/cli-reference.md
Preferred CLI: kairo, kairo-runtime
Legacy aliases: harness, agentic-harness, sgs-harness, harness-sgs (prefer kairo)
`;
}

export function formatHelpAll() {
  const cli = PREFERRED_CLI;
  return `${BRAND.displayName} (${PACKAGE_NAME}) — full command list

${BRAND.tagline}. ${BRAND.displayName} does not install AI apps — it powers and
coordinates agents you already have (Cursor, Codex, OpenCode, Claude, Pi) with managed
sections, components, backups, and drift repair under ~/.harness.

Bootstrap: see README.md and docs/install.md (curl install.sh or npx ${PACKAGE_NAME}).

## Configuration & health
  ${cli}                              First run: onboarding → setup → cockpit (TTY).
                                      Later: full-screen cockpit (wide/compact/minimal).
  ${cli} --dry-run                      Setup dry-run (scriptable)
  ${cli} --version
  ${cli} setup [--dry-run] [--yes] [--confirm] [--simple] [--no-preflight] [--agents <list|all>] [--components <list>]
  ${cli} status [--json]
  ${cli} sync [--dry-run] [--yes] [--confirm] [--json] [--no-preflight]
  ${cli} doctor [--json]
  ${cli} upgrade [--dry-run] [--yes] [--confirm] [--no-preflight]
  ${cli} updates check [--json] [--force]
  ${cli} install [--agents <list|all>] [--components <list>] [--dry-run]
  ${cli} install --no-default-components
  ${cli} update [--yes] [--json]        Update the Kairo CLI from npm
  ${cli} update --scope=workspace [--dry-run]  Refresh workspace template files
  ${cli} uninstall [--dry-run]

## Agents & runs
  ${cli} shell                          Operations cockpit (TTY)
  ${cli} run --agent <id> --task "..." [--strategy direct|orchestrated] [--model <name>] [--cwd <dir>] [--permissions force|yolo|read-only] [--allow-unsafe-permissions] [--capture-transcript] [--follow] [--no-wait] [--json]
  ${cli} runs list [--json] [--limit <n>] [--active-only]
  ${cli} runs show <runId> [--json] [--limit <n>] [--follow]
  ${cli} runs stop <runId> [--json]
  ${cli} review --agent codex|pi [--base <ref>|--commit <sha>|--staged] [--model <name>] [--include-private] [--yes|--confirm] [--fail-on high|medium|low] [--json]
  ${cli} reviews list [--limit <n>] [--json]
  ${cli} reviews show <reviewId> [--json]
  ${cli} reviews verify <reviewId> --staged [--json]
  ${cli} reviews export <lineage> --out <path> [--json]
  ${cli} reviews import --bundle <path> --confirm-import [--cwd <dir>] [--json]
  ${cli} alerts resolve|dismiss <alertId> --confirm-resolve|--confirm-dismiss [--json]
  ${cli} monitor enable|disable|status|tick
  ${cli} orchestrator [--json]          Read-only agent capability diagnostics
  ${cli} adapters [--json]
  ${cli} detect

## Governance & audit
  ${cli} explain [--json]
  ${cli} diff [--json]
  ${cli} backups
  ${cli} history [--json] [--limit <n>] [--command <name>] [--action <name>]
  ${cli} history last [--json] [--command <name>] [--action <name>]
  ${cli} rollback --to <snapshot> [--apply]
  ${cli} policy [--json]
  ${cli} policy set <key> <value>
  ${cli} policy reset
  ${cli} report [--json] [--out <file>] [--limit <n>]

## Advanced
  ${cli} intelligence [status|models|context|route|ask] [--json]
  ${cli} intelligence models --backend opencode-go|opencode-zen|opencode
  ${cli} intelligence route --backend opencode-go --model <id> [--cloud-consent]
  ${cli} intelligence ask --prompt "..." [--backend <id>] [--model <id>] [--cloud-consent] [--yes] [--paths a,b]
             Credentials via env only (OPENROUTER_API_KEY, OPENCODE_API_KEY, OLLAMA_HOST). Never stored.
             Local-first (Ollama). Cloud only with --cloud-consent.
  ${cli} graphify query|path|explain ... --graph <path> [--budget N] [--json]
  ${cli} components
  ${cli} components validate|init|pack|import ...
  ${cli} components configure engram-memory [--agents <list>] [--dry-run|--yes] [--json]
  ${cli} components configure sdd-core [--agents <list>] [--persona off|teaching] [--overwrite-conflicts] [--dry-run|--yes] [--json]
  ${cli} components verify sdd-core [--agents <list>] [--json]
  ${cli} components adopt sdd-core [--agents <list>] [--dry-run|--yes] [--json]
  ${cli} components diff sdd-core [--agents <list>] [--json]
  ${cli} components rollback engram-memory|sdd-core --receipt <id> [--dry-run|--yes] [--json]
  ${cli} connections [--json] [--client cursor]
  ${cli} next [--json] [--client cursor]
  ${cli} control-plane [--json] [--client cursor]
  ${cli} fleet [--json] [--verbose] [--include-variants]
  ${cli} fleet models [--profile] [--json]
  ${cli} fleet configure [--platforms claude,opencode,cursor|codex] [--from profile|gentle] [--codex-model <id>] [--assignments a=b,...] [--yes] [--json]
  ${cli} fleet set --platform opencode|claude|codex --agent <id> --model <id> [--yes] [--json]
  ${cli} mcp
  ${cli} mcp install [--yes] [--json] [--client cursor]
  ${cli} install --scope=workspace [--mode minimal|standard|enterprise] (opt-in/legacy)
  ${cli} init [--mode minimal|standard|enterprise] (workspace alias)

Scopes:
  agent-global (default)  Configure local agent roots and managed sections.
                          Primary product path. Writes ~/.harness state.
  workspace (opt-in)      Legacy repo scaffolding into the current project.
                          Explicit --scope=workspace only.

Commands:
  shell      Operations cockpit (TTY). Bare ${cli} opens onboarding when ~/.harness/state.json
             is missing, otherwise the cockpit. Explicit ${cli} shell always opens the cockpit.
             Keys: ↑↓ · Enter · Esc back/exit · R refresh · C cancel · ? help.
             Tab switches region only when content is interactive (runs/launch).
  run        Launch a managed agent run with local audit trail.
  runs       List, inspect, or cancel agent runs under ~/.harness/runs/.
  alerts     Consent-gated alert resolve/dismiss (Permission Authority).
  review     Bounded read-only review via Codex or Pi; receipts under ~/.harness/reviews/.
  reviews    List/show/verify receipts, or Gentle portable export/import.
  monitor    Opt-in anomaly monitor (enable|disable|status|tick). macOS LaunchAgent; notify shell:false.
  orchestrator  Read-only agent capability diagnostics (--json supported).
  intelligence  Harness Engineering layer: backends, context packs, routing, budgets.
             Local-first (Ollama). Cloud only with --cloud-consent.
             Ephemeral --backend/--model override preferredBackend/preferredModel.
             Credentials via env only (OPENROUTER_API_KEY, OPENCODE_API_KEY, OLLAMA_HOST). Never stored.
  setup      Managed ecosystem setup. Interactive Ink UI (TTY). Use --simple for Clack prompts.
  status     Control panel: agents, components, drift, backups, next action.
  sync       Converge managed content (repair drift), then show status.
  upgrade    Preview or apply ecosystem updates (apply requires --yes).
  updates    Read-only ecosystem update check (kairo/hermes/gentle/skills). Never applies.
  install    Non-interactive configure (agent-global) or legacy workspace scaffold.
  doctor     Detailed health checks for managed state and configs.
  update     Update the Kairo CLI from npm (--yes applies). Workspace templates: --scope=workspace.
  detect     Inspect global agents and the current project. Read-only.
  adapters   Official adapter matrix: roots, config files, detected/managed.
  explain    Read-only audit of managed adapters, configs, markers, and backups.
  diff       Read-only preview of managed content changes (sync/setup plan).
  backups    List config snapshots under ~/.harness/backups.
  history    Local audit log of managed operations under ~/.harness/history.jsonl.
             Use "history last" for the most recent event. Read-only.
  rollback   Preview or restore a prior config snapshot (--apply to write).
  policy     View or edit local operation preferences under ~/.harness/policy.json.
  report     Read-only diagnostics bundle: status, policy, adapters, diff, history.
  components List, validate, scaffold, pack, import, or configure integrations (Engram, SDD).
  connections Companion chips + MCP registration (IDE panel).
  next        Selected work snapshot + integration state (panel contract).
  control-plane Atomic panel report (work + Gentle workflow + team + attention).
  fleet      Declared fleet floor + working activity; configure/set models across CLIs.
             fleet models [--profile]   available vs enabled per tool
             fleet configure            one plan for Claude+OpenCode+Cursor (profile)
             fleet configure --codex-model <id>   Codex only (single-default)
             fleet set --platform opencode|claude|codex --agent <id> --model <id> [--yes]
  mcp        Serve or install MCP for agents (mcp install writes entry + snapshot rule).
  uninstall  Remove managed sections and global state. Backups are preserved.
  init       Alias for install --scope=workspace (legacy).

JSON output (--json on supported commands):
  status, sync, doctor, adapters, explain, diff, history, history last,
  policy (show/set/reset), report, monitor, connections, fleet
  Human text remains the default. See docs/cli-reference.md for examples and field notes.

Version:
  ${cli} --version              Installed CLI version
  npm view ${PACKAGE_NAME} version   Latest published version
  npx ${PACKAGE_NAME}@latest sync    Converge with latest package

More examples: README.md · docs/cli-reference.md

Preferred CLI: kairo, kairo-runtime
Legacy aliases: harness, agentic-harness, sgs-harness, harness-sgs (prefer kairo)
Legacy package: ${LEGACY_PACKAGE_NAME}
Global agents: ${GLOBAL_AGENT_IDS.join(", ")}
Global components: ${COMPONENT_IDS.join(", ")} (default: ${DEFAULT_COMPONENT_IDS.join(", ")})
Workspace adapters: ${[...ADAPTERS].join(", ")}
`;
}

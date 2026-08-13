# Components

### Workspace components

Opt-in custom components live in the current repo under `.harness/components/`.
They never override bundled IDs (`orchestrator`, `sdd-core`, `engram-memory`,
`graphify-context`) and install copies assets into `~/.harness/components/<id>/`
only when you pass `--components`.

#### Component Manifest v2

Catalogs are a validated contract. Bundled `catalog.json` uses `schemaVersion: 2`
with `kind`, `capabilities`, `dependencies`, and `healthChecks`. Workspace v1
catalogs (no `schemaVersion`) still load — fields normalize in memory; persisted
`~/.harness/state.json` stays compatible and derives new metadata from the catalog.

- Dependencies resolve topologically (deps first, no duplicates).
- Public component health: `healthy` | `degraded` | `drifted` | `missing`.
- Engram/Graphify integration warnings degrade that component; they do not fail
  global `doctor` by themselves.
- Workspace entries stay declarative JSON (no arbitrary code execution).
- `engram-memory` may declare `integration.provider: "engram"`. Kairo detects the
  Engram binary, plans official `engram setup <agent>`, and never installs Engram
  silently or runs `engram doctor` (SQLite side effects).

Configure Engram (requires `engram-memory` installed and Engram `>=1.19.0 <2.0.0`):

```bash
kairo components configure engram-memory --agents codex,opencode --dry-run
kairo components configure engram-memory --agents codex,opencode --yes
kairo components rollback engram-memory --receipt <id> --dry-run
```

Without `--agents`, Kairo uses the intersection of detected agents and
Kairo-managed Engram agents (`cursor`, `codex`, `opencode`, `claude` → setup slug
`claude-code`, `pi` → `pi`). After setup, status is `restart_required` — restart the agent to
load MCP; configuration evidence is not runtime-active. Receipts live under
`~/.harness/integrations/engram/`. For Pi, positive evidence requires
`~/.pi/agent/settings.json` packages (`npm:gentle-engram`, `npm:pi-mcp-adapter`) and
`~/.pi/agent/mcp.json` with `mcpServers.engram`.

### SDD Core skills

`sdd-core` ships skill copies into Kairo-managed adapter roots. Live SDD
authority (change name, `nextRecommended`, `next_transition`) is Gentle — see
[Gentle companion boundary](gentle-companion.md).

`sdd-core` (default with setup/install) materializes nine phase skills:

`sdd-init`, `sdd-explore`, `sdd-propose`, `sdd-spec`, `sdd-design`,
`sdd-tasks`, `sdd-apply`, `sdd-verify`, `sdd-archive`.

Each skill ships as a directory (`SKILL.md` + `references/contract.md`).

**Auto-materialization.** When `sdd-core` is selected/installed,
`install` / `setup` / `sync` / `upgrade` materialize (or repair) skills via the
same `sdd-core` apply path. Lifecycle keeps persona frozen (`preservePersona`):
it never auto-activates teaching. Explicit persona changes stay on
`kairo components configure sdd-core`.

**Destinations.** Cursor, Codex, OpenCode, and Pi share `~/.agents/skills/<id>/`.
Claude uses `~/.claude/skills/<id>/`. One physical tree per root; consumers are
recorded per destination.

**Persona.** Defaults to `off`. `--persona teaching` activates per managed
agent via `state.sdd.personaAgentIds` (managed-section gate only — explanations,
never code/docs/commits/PRs). `--persona off` removes teaching only for the
targeted agents.

**Consent and conflicts.** Dry-run writes nothing. Non-interactive mutating
configure/rollback/adopt without `--json` requires `--yes`, `--confirm`, or
`--no-preflight`. `--json` selects machine-readable output and skips the
prompt/consent gate (same apply-confirmation policy as setup/sync/upgrade).
By default, conflicts and user-owned files are never overwritten, even with
`--yes`. Resolve them explicitly:

- `kairo components diff sdd-core` — read-only canonical vs disk.
- `kairo components adopt sdd-core` — keep disk bytes; record them as adopted
  in state (no file writes). Adopted files report health `adopted` and stop
  blocking status.
- `kairo components configure sdd-core --overwrite-conflicts` — backup then
  replace with canonical Kairo skills (opt-in; never used by `kairo sync`).

Receipts live under `~/.harness/integrations/sdd-core/` and may be `partial`
when some actions succeed and others fail. Status checks may include a
`resolutions[]` array so the IDE panel can offer these buttons directly.

**Session refresh.** After skill or managed-section changes, results report
`session_refresh_required` — restart agents to load skills; Kairo does not claim
existing sessions already loaded them. Verify health is
`configured` | `adopted` | `missing` | `drifted` | `conflict`.

```bash
kairo components configure sdd-core --agents codex,opencode,cursor,claude --persona off --dry-run
kairo components configure sdd-core --agents codex,opencode --persona teaching --yes
kairo components diff sdd-core --agents claude
kairo components adopt sdd-core --agents claude --dry-run
kairo components configure sdd-core --agents claude --overwrite-conflicts --dry-run
kairo components verify sdd-core --json
kairo components rollback sdd-core --receipt <id> --dry-run
```

Create, validate, and install:

```bash
kairo components init team-rules --label "Team Rules"
# edit .harness/components/team-rules/README.md
kairo components validate
kairo install --components team-rules
```

Advanced: share a workspace component between repos (no remote registry):

```bash
kairo components pack team-rules --out team-rules.tgz
# copy team-rules.tgz into another repo
kairo components import team-rules.tgz
kairo components validate
kairo install --components team-rules
```

- `kairo components` lists bundled and workspace catalogs.
- `kairo components validate [--cwd <path>]` runs the same loader used by install/doctor.
- `kairo components init <id> --label "<label>"` scaffolds `catalog.json`,
  `.harness/components/<id>/README.md`, and a catalog entry (`version: "0.1.0"`).
  It refuses existing IDs and bundled IDs, and does not write to `~/.harness`.
- `kairo components pack <id> --out <file>` builds a portable `.tgz` (partial catalog + assets).
- `kairo components import <file>` installs declared assets only; no overwrite by default,
  no `~/.harness` writes, no package scripts.

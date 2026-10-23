import { link, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writeAtomicText } from "../runtime/write-atomic-json.js";
import { readIfExists } from "../file-safety.js";
import { contextTools, markerText, quote } from "./render.js";
import { isOurs } from "./plan.js";
import claudeCode from "./claude-code.js";

/**
 * Claude Code kit: the generic, user-scope version of the hand-built team-*
 * agents and CLAUDE.md. Agents carry no fixed provider: Kairo routes the model
 * per launch (kairo-router), and a non-Claude pick runs through the kairo-<provider>
 * transport wrappers. gentle-ai review and judge actors are never part of the kit.
 */

const READ_TOOLS = "Read, Grep, Glob, Bash, mcp__codegraph__codegraph_explore";
const WRITE_TOOLS = "Read, Edit, Write, Grep, Glob, Bash, mcp__codegraph__codegraph_explore";

export const KIT_AGENTS = Object.freeze([
  {
    name: "kairo-builder", role: "Builder", model: "sonnet", tools: WRITE_TOOLS,
    description: "Implementation worker for delegated units of large tasks. Writes code and its tests, single writer. Kairo chooses the model per launch.",
    body: [
      "You are the Kairo **builder**. Implement exactly the delegated task. Do NOT launch sub-agents.",
      "## Rules",
      "1. Edit only files listed under `## Allowed edit surfaces` in the prompt. If missing or insufficient, stop and report.",
      "2. Follow the repo's `AGENTS.md` and existing patterns.",
      "3. Behavior change with a runnable test: write the failing test first (RED), implement (GREEN), refactor.",
      "4. Run only the focused tests for your change. Leave full suites to the test runner.",
      "5. Artifacts (code, comments, commits) in English unless the project uses another language.",
      "## Output",
      "- `status`: done | partial | blocked",
      "- Files changed (path - one line why)",
      "- `<command>: <observed result>` for each check you ran",
      "- Open issues"
    ]
  },
  {
    name: "kairo-explorer", role: "Explorer", model: "haiku", tools: READ_TOOLS,
    description: "Cheap read-only codebase mapper. Locates files, traces flows and answers where/how questions with path:line evidence. Never edits.",
    body: [
      "You are the Kairo **explorer**. Read-only. Do NOT edit files. Do NOT launch sub-agents.",
      "## Rules",
      "1. Use `codegraph_explore` first when `.codegraph/` exists; fall back to Grep/Glob/Read only for what it does not cover.",
      "2. Read bounded line ranges, never whole large files.",
      "3. Bash only for read-only commands (`git log`, `git diff --stat`, `rg`, `fd`).",
      "## Output (max ~2k tokens)",
      "- **Answer**: 1-3 sentences.",
      "- **Evidence**: bullet list of `path:line` - what it shows.",
      "- **Gaps**: anything you could not confirm."
    ]
  },
  {
    name: "kairo-tester", role: "Tester", model: "haiku", tools: "Bash, Read",
    description: "Cheapest worker for running tests, lint, typecheck and builds and summarizing the results. Never writes or fixes code.",
    body: [
      "You are the Kairo **test runner**. Run the requested commands and report. Do NOT edit files. Do NOT fix failures. Do NOT launch sub-agents.",
      "## Rules",
      "1. Run exactly the commands given in the prompt, from the repo root.",
      "2. Prefer `rtk <cmd>` to compress noisy output when available.",
      "3. Read source files only to quote the failing assertion line, never to diagnose deeply.",
      "## Output (short)",
      "- `<command>: PASS | FAIL (n failed / m total) | ERROR`",
      "- For each failure: test name - `path:line` - one-line assertion message",
      "- Last ~10 relevant lines of output only when the cause is unclear"
    ]
  },
  {
    name: "kairo-reviewer", role: "Reviewer", model: "sonnet", tools: READ_TOOLS,
    description: "Read-only reviewer for a diff written by another model. Reports correctness bugs, regressions, missing tests and security issues. Never edits.",
    body: [
      "You are the Kairo **reviewer**. Read-only. Do NOT edit files. Do NOT launch sub-agents.",
      "## Rules",
      "1. Review the scope the prompt names (default: `git diff HEAD`). Use `codegraph_explore` to check callers of changed symbols.",
      "2. Report only correctness bugs, regressions, missing tests and security issues; skip style.",
      "## Output",
      "- Findings most-severe first: severity - `path:line` - problem - suggested fix.",
      "- If none, say `No findings`."
    ]
  },
  {
    name: "kairo-architect", role: "Architect", model: "sonnet", tools: READ_TOOLS,
    description: "Read-only plan critic. Reads a plan written by another model and the repository, and reports what would cause a wrong result, rework or risk. Never edits.",
    body: [
      "You are the Kairo **plan critic**. Read-only. Do NOT edit files. Do NOT launch sub-agents.",
      "## Rules",
      "1. Read the plan, then inspect the repository as needed. Use `codegraph_explore` to check callers and blast radius.",
      "2. Report only issues that would cause a wrong result, rework or risk: wrong files or layers, missed callers or tests, broken contracts, ordering problems, missing edge cases, scope creep, cheaper equivalent approaches.",
      "## Output",
      "- Most-severe first: severity (blocker|major|minor) - plan step - problem - concrete fix.",
      "- If the plan is sound, say `Plan OK` and list at most 3 risks to watch."
    ]
  }
]);

/** Claude-native Kairo agent for a role id or name; the builder when the role has no kit agent. */
export function kitAgentForRole(role) {
  const wanted = String(role ?? "").toLowerCase();
  return (KIT_AGENTS.find(agent => agent.role.toLowerCase() === wanted) ?? KIT_AGENTS[0]).name;
}

/**
 * Hand-built agent -> Kairo equivalent. `kairo: null` means no safe replacement:
 * gentle-ai owns the judge launch contract (S20) and Kairo has no Researcher role yet.
 */
export const KIT_PARITY = Object.freeze([
  { handBuilt: "team-builder", kairo: "kairo-builder" },
  { handBuilt: "team-builder-codex", kairo: "kairo-builder" },
  { handBuilt: "team-explorer", kairo: "kairo-explorer" },
  { handBuilt: "team-test-runner", kairo: "kairo-tester" },
  { handBuilt: "team-reviewer-codex", kairo: "kairo-reviewer" },
  { handBuilt: "team-plan-critic-codex", kairo: "kairo-architect" },
  { handBuilt: "team-jd-judge-codex", kairo: null, reason: "gentle-ai judge launch contract" },
  { handBuilt: "team-researcher", kairo: null, reason: "no Researcher role in the Kairo catalog" },
  { handBuilt: "team-researcher-codex", kairo: null, reason: "no Researcher role in the Kairo catalog" }
]);

export function renderKitAgent(name) {
  const agent = KIT_AGENTS.find(entry => entry.name === name);
  if (!agent) throw new Error(`Unknown Kairo agent "${name}".`);
  const [lead, ...rest] = agent.body;
  const content = [
    "---", `name: ${agent.name}`, `description: ${quote(agent.description)}`, `model: ${agent.model}`, `tools: ${agent.tools}`, "---", "",
    lead, "", rest.join("\n"), "", contextTools, "", `<!-- ${markerText("claude-code", agent.name)} -->`, ""
  ].join("\n");
  return { path: `.claude/agents/${agent.name}.md`, content };
}

export const CLAUDE_MD_START = "<!-- kairo:claude-md:start -->";
export const CLAUDE_MD_END = "<!-- kairo:claude-md:end -->";

/** Short Kairo-managed CLAUDE.md block: a pointer to routing, not a routing table. */
export function renderClaudeMdSection() {
  return [
    CLAUDE_MD_START,
    "## Kairo (managed by `kairo setup`)",
    "- Routing: Kairo picks the provider and model per launch. Delegate to kairo-builder, kairo-explorer, kairo-tester, kairo-reviewer or kairo-architect; do not hard-code models.",
    "- See the team and routes with `kairo team show` and `kairo team route --role ROLE`; quota with `kairo team pacing`.",
    "- Put `[no-redirect]` in a prompt to skip the rewrite for that launch.",
    "- After verifying delegated work, run `kairo team verdict --agent NAME --result pass|fail`.",
    "- Context: use CodeGraph (`codegraph_explore`), Engram (`mem_context`, `mem_search`) and Graphify (`graphify-out/GRAPH_REPORT.md`) before broad reads; prefer `rtk` output and line ranges.",
    "- gentle-ai actors (review-*, jd-*) keep their own launch contract; Kairo never reroutes them.",
    CLAUDE_MD_END,
    ""
  ].join("\n");
}

/** Replaces the marked block, or appends it. Returns null when the markers are unbalanced. */
function mergeSection(existing, section) {
  if (existing === null) return section;
  const starts = existing.split(CLAUDE_MD_START).length - 1;
  const ends = existing.split(CLAUDE_MD_END).length - 1;
  // Append after the user's bytes, verbatim: one blank line, never trimmed whitespace.
  if (starts === 0 && ends === 0) return `${existing}${existing.endsWith("\n") ? "" : "\n"}\n${section}`;
  const start = existing.indexOf(CLAUDE_MD_START);
  const end = existing.indexOf(CLAUDE_MD_END);
  if (starts !== 1 || ends !== 1 || end < start) return null;
  return `${existing.slice(0, start)}${section.trimEnd()}${existing.slice(end + CLAUDE_MD_END.length)}`;
}

function actionFor(existing, content, owned) {
  if (existing === null) return "create";
  if (!owned) return "skip-foreign";
  return existing === content ? "unchanged" : "update";
}

/** Preview of the user-scope Claude Code kit. Never writes. */
export async function planClaudeKit({ homeDir, env = process.env } = {}) {
  const files = [];
  const wrappers = (claudeCode.renderWrapperAgents?.({ env }) ?? []).map(entry => ({ name: entry.role, kind: "wrapper", ...entry }));
  const agents = KIT_AGENTS.map(agent => ({ name: agent.name, kind: "agent", ...renderKitAgent(agent.name) }));
  for (const entry of [...agents, ...wrappers]) {
    const path = join(homeDir, entry.path);
    const existing = await readIfExists(path);
    files.push({ name: entry.name, kind: entry.kind, path, content: entry.content, seen: existing,
      action: actionFor(existing, entry.content, isOurs(existing, "claude-code", entry.name)) });
  }
  const mdPath = join(homeDir, ".claude", "CLAUDE.md");
  const existing = await readIfExists(mdPath);
  const section = renderClaudeMdSection();
  let claudeMd;
  if (existing !== null && typeof existing !== "string") claudeMd = { path: mdPath, action: "skip-foreign" };
  else {
    const merged = mergeSection(existing, section);
    claudeMd = merged === null ? { path: mdPath, action: "skip-malformed" }
      : { path: mdPath, content: merged, seen: existing, action: existing === null ? "create" : existing === merged ? "unchanged" : "update" };
  }
  return { ok: true, applied: false, files, claudeMd };
}

/**
 * Reserves `<path>.kairo-backup.<stamp>[-n]` by creating it exclusively, so two
 * concurrent setups never pick the same name; the move then replaces only our own placeholder.
 */
async function reserveBackupPath(path, stamp) {
  for (let n = 0; ; n++) {
    const target = `${path}.kairo-backup.${stamp}${n === 0 ? "" : `-${n}`}`;
    try { await (await open(target, "wx")).close(); return target; }
    catch (error) { if (error?.code !== "EEXIST") throw error; }
  }
}

/**
 * Publishes one planned write without ever losing user bytes. A create is
 * exclusive. An update first moves the current file aside atomically, so every
 * version lands either at the path or in its backup: bytes that changed since
 * the plan are moved back, and a file recreated meanwhile is left alone.
 * Returns { action?: "skip-changed", backupPath? }.
 */
async function publishPlanned(entry, now, hooks = {}) {
  await mkdir(dirname(entry.path), { recursive: true });
  if (entry.action === "create") {
    try { await writeAtomicText(entry.path, entry.content, { createExclusive: true }); }
    catch (error) { if (error?.code === "EEXIST") return { action: "skip-changed" }; throw error; }
    return {};
  }
  const backupPath = await reserveBackupPath(entry.path, now());
  await hooks.beforeMove?.(entry.path);
  try { await rename(entry.path, backupPath); }
  catch (error) {
    await unlink(backupPath).catch(() => {});
    if (error?.code === "ENOENT") return { action: "skip-changed" };
    throw error;
  }
  await hooks.afterMove?.(entry.path);
  if (await readIfExists(backupPath) !== entry.seen) {
    // Changed since the plan: restore the user's bytes unless the file was already recreated.
    try { await link(backupPath, entry.path); await unlink(backupPath); return { action: "skip-changed" }; }
    catch (error) { if (error?.code === "EEXIST") return { action: "skip-changed", backupPath }; throw error; }
  }
  try { await writeAtomicText(entry.path, entry.content, { createExclusive: true }); }
  catch (error) { if (error?.code === "EEXIST") return { action: "skip-changed", backupPath }; throw error; }
  return { backupPath };
}

/** Writes the kit. Preview unless `yes`. Owned stale files get an exclusive backup; foreign files are never touched. */
export async function applyClaudeKit({ yes, now = Date.now, afterPlan, beforeMove, afterMove, ...rest } = {}) {
  const plan = await planClaudeKit(rest);
  const strip = ({ content, seen, ...out }) => out;
  if (yes === true) await afterPlan?.();
  if (yes !== true) return { ...plan, files: plan.files.map(strip), claudeMd: strip(plan.claudeMd) };
  let applied = false;
  const files = [];
  for (const entry of plan.files) {
    const out = strip(entry);
    if (entry.action === "create" || entry.action === "update") {
      const outcome = await publishPlanned(entry, now, { beforeMove, afterMove });
      Object.assign(out, outcome);
      if (!outcome.action) applied = true;
    }
    files.push(out);
  }
  const md = strip(plan.claudeMd);
  if (plan.claudeMd.action === "create" || plan.claudeMd.action === "update") {
    const outcome = await publishPlanned(plan.claudeMd, now, { beforeMove, afterMove });
    Object.assign(md, outcome);
    if (!outcome.action) applied = true;
  }
  return { ...plan, applied, files, claudeMd: md };
}

/** One-line summaries for `kairo setup`. */
export function summarizeClaudeKit(result) {
  const count = action => result.files.filter(file => file.action === action).length;
  const verb = result.applied ? "installed" : "would install";
  return [
    `Claude Code kit: ${count("create") + count("update")} agent file(s) ${verb}, ${count("unchanged")} unchanged, ${count("skip-foreign")} skipped (not Kairo-owned)${count("skip-changed") ? `, ${count("skip-changed")} skipped (changed during setup)` : ""}.`,
    `Claude Code kit: CLAUDE.md Kairo section ${result.claudeMd.action}.`
  ];
}

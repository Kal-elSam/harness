import { join } from "node:path";

export function buildSessionHandoffManagedSection(context, adapter, catalogEntry) {
  const contractPath = join(context.componentsDir, "session-handoff", "protocol.md");
  const adapterNote = catalogEntry?.adapterHints?.[adapter.id] ?? null;

  return [
    "### Session handoff",
    "",
    `- Contract: ${contractPath}`,
    "- Context rot is gradual. Treat about 60% as a quality budget, not a hard cutoff.",
    "- At 50–70%, when the task changes, or before compacting: write `handoff.md` at the repo root from the contract template.",
    "- Do not paste the prior transcript. A new session starts from the objective, `handoff.md`, relevant files, and git status.",
    "- Durable decisions belong in an ADR, README, issue, or decision log. An automatic summary does not replace the handoff.",
    "- Measure fill with `kairo context`. It reads home session stores and works in any project.",
    "- If the repo has `docs/ai/session-handoff.md`, follow that file. It must match this contract.",
    adapterNote
  ].filter(Boolean).join("\n");
}

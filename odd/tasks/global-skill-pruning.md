# Global skill pruning

## Objective
Minimize global skill duplication while enforcing the user-approved cross-agent conversation policy: caveman, prompt-enhancer, and interview-me available everywhere; SDD global copies removed while Gentle AI/ODD remains the daily workflow.

## Scope
- Reopen scope on 2026-10-09: distribute `caveman`, `prompt-enhancer`, and `interview-me` from existing local copies to each installed agent root. Apply one identical, explicit global intake policy through each runtime’s established native global-instruction file.
- Remove global `sdd-*` copies only; preserve SDD documentation/template capability.
- The earlier removal of `interview-me` is superseded: retain and distribute it as an always-available conversation skill.
- Remove duplicate copies of the first nine from `~/.config/agents/skills`, where present.
- Update the local Skills CLI lock only through the supported CLI if it supplies removal; otherwise report stale lock entries rather than hand-editing generated state.

## Constraints
- Preserve `branch-pr`, `chained-pr`, `work-unit-commits`, all `caveman*`, and SDD documentation/template capability.
- Do not touch repository source or unrelated existing changes.
- No remote operations.

## Authorized scope
User authorized conservative pruning on 2026-10-09, then explicitly authorized the revised policy: cross-agent caveman/prompt-enhancer/interview-me availability and removal of redundant global `sdd-*` copies. User approved restoring the global intake behavior through established native runtime configuration files.
Route: delegated direct. Mapping trigger: global skill sources and registry span more than four files. Writer trigger: multiple non-trivial global mutations.

## Acceptance criteria
- The prior auxiliary removals remain absent; `interview-me` is restored/distributed under the revised policy.
- Duplicate config copies of the nine applicable selected names disappear.
- Retained Git/SDD/caveman skills still exist.
- `npx skills list -g` no longer reports removed primary installations, or any limitation is recorded.
- `caveman`, `prompt-enhancer`, and `interview-me` exist in every discovered installed-agent skill root.
- No discovered installed-agent skill root contains `sdd-*`; its `_shared/sdd-phase-common.md` documentation remains.
- Each established runtime global-instruction file contains exactly one identical `global-conversation-stack` block.

## TDD
Mode: off; configuration cleanup. Checks: file existence and `npx skills list -g`.

## Delivery
Strategy: exception-ok. Forecast: one repository tracker file; global paths are not committed. Selectively commit only this tracker after verification, subject to the current branch policy.

## Tasks
- [x] T1 — remove selected global skill copies using exact-path deletion
- [x] T2 — verify retained/removed inventory; CLI check recorded as unavailable
- [x] T3 — update tracker, mirror it to Engram, and selectively commit tracker
- [x] T4 — distribute conversation skills
- [x] T5 — remove globally installed SDD copies and verify retained docs/template
- [x] T6 — restore and verify global intake policy across runtime configs
- [x] T7 — update and verify tracker; selectively commit tracker

## Progress
- Created before first mutation.
- Read-only audit found nine selected names duplicated under `~/.config/agents/skills`; deleting only `~/.agents/skills` would not remove them for registry-consuming clients.
- T1: removed all eleven selected primary directories and nine duplicate config directories after runtime approval.
- T2: direct existence checks passed: every selected primary directory is absent; retained Git/SDD/caveman directories exist.
- CLI validation unavailable: `npx --no-install skills list -g` did not produce output within 10 seconds and exited 142 via enforced alarm. The local lock still lists `find-skills` and `interview-me`; it was intentionally not hand-edited.

## Verification evidence
- `PATH_CHECK=PASS` for all removed and retained paths.
- CLI list check: unavailable/timeout (exit 142); no claim made about CLI registry refresh.
- Native RDD assessment: unavailable. `gentle-ai review assess` classified due/high only because unrelated untracked files need an inventory declaration; canonical preflight then failed safely with `operation not permitted`. No review was run and no review boundary advanced.
- T4: copied local source directories from `~/.agents/skills/{caveman,prompt-enhancer}` and `~/.claude/skills/interview-me` to all discovered installed-agent roots: `~/.agents/skills`, `~/.claude/skills`, `~/.config/agents/skills`, `~/.codex/skills`, `~/.cursor/skills`, `~/.config/opencode/skills`, and `~/.gemini/skills`.
- T6: added one identical `global-conversation-stack` block through the established native mechanisms: `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.cursor/AGENTS.md`, `~/.config/opencode/AGENTS.md`, and `~/.gemini/GEMINI.md`. It applies caveman to every response, normalizes casual/underspecified input, invokes prompt-enhancer only for prompt improvement, invokes interview-me only for materially consequential unresolved ambiguity, and executes clear requests.
- T5: removed `sdd-{apply,archive,design,explore,init,onboard,propose,research,spec,tasks,verify}` from all seven roots. Preserved `_shared/sdd-phase-common.md` in every root as the SDD documentation/template capability.
- T4/T5 verification: SHA-256 checks passed for all 21 required `SKILL.md` files against their three local sources; no duplicate nested `<skill>/<skill>` directory remained; no `sdd-*` directory remained in any root; all seven `_shared/sdd-phase-common.md` files remained.
- T6 verification: exact-content check passed; each of the five runtime files has exactly one identical `global-conversation-stack` block.
- Native RDD for commit `e22c00b`: unavailable. Assessment was due/high solely because unrelated untracked files need an explicit inventory declaration; canonical preflight failed safely with `operation not permitted`. No review ran and no boundary advanced.

## Next step
- No implementation task remains. Selective tracker commit pending after final Engram mirror.

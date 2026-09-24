# Effort-tier outcome validation

## Status: PAUSED (2026-09-23, user decision)
No code, corpus, or runs exist. Paused because the evidence does not justify
the quota cost today:
- Volume: this machine has ONE recorded Kairo run (`~/.harness/runs`, a
  failed codex run). Better tier choice saves quota in proportion to routed
  volume, which is currently about zero.
- Jev's measured edge (light vs standard without keywords, EN and ES) is the
  cheap error: Haiku vs Sonnet. Its measured weakness (confident misses on
  data-sensitivity risk) is the expensive one. The local router already covers
  risk lexically in EN and ES since #341 and #342.
- Adopting Jev adds an external dependency (Vercel card, 429s) and latency
  (p90 up to 7.6 s in one run).

### Scope correction (2026-09-24, verified on main 50ebda0)
This design assumed the effort tier chooses the model for task EXECUTION. It
does not. `classifyEffort` is live only through `selectAskProvider`
(execution-router.js:431; called from service.js:393), where it picks the
model tier for ASK answers (questions). Task execution routes through the
project team (`resolveProjectRoute`), and `selectExecutionProvider` is not
called anywhere in production (service.js:551). So misrouting by effort tier
can only cost anything on asks. If this is ever resumed, the tasks,
execution, and metrics below must be re-scoped to ask answers, not
executed tasks.

### Resume when ALL hold
1. Kairo answers real ask volume through `selectAskProvider` (dozens of
   asks), and
2. ask records carry the effort tier the router chose for each answer, and
3. those records show misrouting that costs something: poor or retried
   answers on light/Haiku, or Opus spent on questions a cheaper tier
   answers well.

### Idea kept: Jev's concept, native to Kairo (not Jev itself)
Jev's useful idea is the decision contract, not the model: shared state in,
typed answers out (choice + confidence), several questions answered over the
same state, clear cases automated, uncertain ones sent to a safe default or
to review. `classifyTask` is already a deterministic "System One" (one pass,
several signals, matched keywords as the "why"), but it has no notion of
uncertainty: with no keyword it falls back to text length silently. A native
adaptation could return, per decision, the answer plus an evidence level
(keyword-backed vs length-only), and let routing treat low-evidence decisions
explicitly. Not designed yet. It needs its own scoped proposal.

## Objective
Decide, from real execution outcomes, which effort classifier picks the
cheapest model tier that actually completes a task: the local router
(`classifyEffort`), Jev, or a hybrid. This replaces agreement with human
labels, which is what the Jev shadow pilot measured, with a ground truth that
comes from results.

## Problem
The Jev shadow pilot (odd/tasks/jev-shadow-comparison.md) compared each
classifier to provisional human labels. It showed that Jev is stable across
runs, that it has a confident blind spot on data-sensitivity risk, and that it
separates effort in EN and ES. But agreeing with a label is not the same as
choosing a model that succeeds. The local router's 18/18 is in-sample: the
Spanish risk fix (#341) was motivated by those same cases. Neither classifier
has been validated on unseen tasks against real outcomes.

## Why
For asks, the effort tier selects the model: light is Haiku, standard is
Sonnet, heavy is Opus (see the scope correction above; task execution does
not use it). A tier that is too low means a failed or wrong task. A tier that is
too high burns Opus quota. Only execution tells us which error each
classifier makes, and how much it costs.

## Ground truth (pre-registered)
- **Minimal sufficient tier** = the cheapest tier whose run passes the task's
  success check.
- A task where no tier passes is `unsolvable`. It is reported and excluded
  from tier accuracy.
- A task where a lower tier passes and a higher tier fails is
  `non-monotonic`. The minimal sufficient tier still defines truth, and the
  task is flagged and reported apart.
- A run that fails for transport or quota reasons (429, subscription limit,
  crash before the check) is **missing evidence**, not a failed task. Its
  task is excluded for every classifier, the same rule as the Jev pilot's T17.
- No expected-tier labels are written. Truth comes only from outcomes, which
  removes the label bias of the pilot.

## Task corpus (held out)
- About 24 NEW tasks that neither classifier, nor the #341 fix, has seen.
  Written and committed before any prediction or run; the corpus hash goes
  into provenance.
- Balance: EN and ES; mechanical, ordinary, and reasoning or cross-cutting
  work; at least 6 risk-sensitive tasks (auth, credentials, recovery codes,
  payments), including cases with no English risk keyword.
- Each task is a self-contained mini-repo fixture with:
  - `prompt` — the task text given to the agent (and to the classifiers);
  - `check` — a hidden acceptance command, stored OUTSIDE the agent's working
    copy so it cannot be read or edited, where exit 0 means pass;
  - `scope` — allowed paths; a diff outside them fails the task;
  - for risk tasks, the check includes the safety property (for example, no
    plaintext recovery code at rest).
- Corpus validator: every check must FAIL on the untouched fixture. A task
  that already passes is invalid.
- Known bias: tasks written by a Claude model and executed by Claude models
  may suit Claude. This is disclosed, not corrected.

## Predictions (frozen before any run)
- Local tier (router sha256 recorded), Jev tier and confidence (provenance as
  in T14), and the hybrid at ONE pre-registered threshold: **0.5**. The pilot
  showed flips concentrated at confidence ~0.3; 0.5 is fixed now and is not
  tuned on this data.
- Stored as a committed predictions file before the first execution. A
  prediction changed after a run invalidates that task.

## Execution
- Provider: Claude Code through the existing adapter
  (`buildClaudeLaunch`: `claude -p --output-format stream-json --model <id>`),
  subscription auth. Models are the ones the router maps today:
  `claude-haiku-4-5`, `claude-sonnet-5`, `claude-opus-5`.
- Every task runs at ALL three tiers, independently of the predictions, so
  the ground truth does not depend on any classifier.
- Each run gets a fresh throwaway copy of its fixture under the scratch area:
  no network except the model, no push, no access to the check.
- Recorded per run: outcome (pass / fail / missing-evidence + reason), tokens
  and `total_cost_usd` as reported by the CLI (API-equivalent, NOT a charge
  under subscription), wall time, number of turns, and diff size. Results are
  appended as JSONL so a run can resume.

## Metrics (per classifier, over the same scored tasks)
- Exact-tier accuracy against the minimal sufficient tier.
- **Under-provision rate**: predicted tier below the minimal tier, so the
  routed run fails. This is the costly error and is reported first.
- Over-provision rate: predicted tier above the minimal tier, which wastes cost.
- Routed success rate and routed cost: outcome and cost of the run at the
  predicted tier.
- Risk-sensitive tasks broken out separately; non-monotonic and unsolvable
  tasks listed.
- No threshold, policy, or winner is selected from this data beyond the
  pre-registered hybrid.

## Cost and phasing
- Jev: 24 calls, about $0.001, which is negligible.
- Execution: 24 tasks × 3 tiers = 72 runs, drawn from Claude subscription
  quota (5h session and weekly windows). Opus runs dominate. The per-run
  quota cost is UNKNOWN until measured, so no quota % is estimated here.
- **Phase A (pilot):** 6 tasks × 3 tiers = 18 runs, user-run. It measures
  quota % per run, wall time, and outcome variance. Then a go / no-go and a
  choice of repetitions per task-tier (N=1 or N=3) based on observed flips,
  before Phase B.
- **Phase B:** the remaining tasks, user-run, with a quota forecast from
  Phase A.

## Scope
In: corpus and validator, prediction freezing, execution runner, analysis,
and a write-up. Out: changing live routing, enabling Jev in production,
non-Claude providers (Codex and Cursor expose no tier mapping; OpenCode Go
tiers by cost, which is a different experiment), and tuning the router on
this corpus.

## Constraints
- Every execution is manual and user-authorized: it spends the user's
  subscription quota.
- Fail closed: missing check, unknown model, or a failed auth preflight stops
  the run. Nothing is fabricated.
- Node 20 compatible (CI matrix 20/22/24).

## Tasks
- [ ] E1 — Corpus format + validator (the check must fail on the untouched
  fixture; hidden check path; scope list) with tests. No tasks yet.
- [ ] E2 — Write the ~24 held-out tasks; the validator passes; commit and
  record the corpus hash.
- [ ] E3 — Prediction freezer: local + Jev + hybrid@0.5 with provenance, into a
  committed predictions file. Jev calls are user-run.
- [ ] E4 — Execution runner: isolated copy per run, the tier's model via the
  Claude adapter, hidden check, JSONL results, resume, dry-run mode. Tests
  use a fake adapter; no real runs in CI.
- [ ] E5 — Phase A pilot (6 tasks × 3 tiers), user-run; record quota, time,
  and variance; go / no-go and the choice of N.
- [ ] E6 — Phase B (user-run).
- [ ] E7 — Analysis: minimal sufficient tier, metrics above, and a write-up
  with limits.

## Acceptance criteria
- Predictions are committed before the first execution (git history proves
  the order).
- Every reported number is recomputable from committed JSONL plus the
  predictions file.
- Missing-evidence runs are excluded for every classifier and listed.
- The write-up states the in-sample and bias limits explicitly.

## Checks
TDD per project default (off; tests are written first anyway).
Runner: `node --test`, plus Node 20.14 for the touched tests.

## Decisions pending (user)
- Confirm Claude-only execution (recommended; see Scope). Moot while paused.

## Next step
None while paused. Re-check the resume conditions above before any work.

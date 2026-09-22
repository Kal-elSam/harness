# Complete unified Kairo workspace verification

## Objective

Finish the incomplete `unified-kairo-workspace` delivery honestly: preserve the implemented host/kernel work, prove the testable behavior, exercise the real Gentle Shell launcher without vendoring it, unify legacy interactive aliases with the new host, and only then re-archive the OpenSpec change.

## Why

The change was archived with 23/23 implementation checkboxes, but no `sdd-verify` evidence, no real Gentle Shell harness run, two unresolved product decisions, and uncommitted work on `main`. An archive is not acceptance evidence.

## Scope

- [x] UWS-01 Reopen the archived OpenSpec change as active work and record the missing verification evidence.
- [x] UWS-02 Run the targeted host/kernel suite and the full suite in an environment that permits loopback and `npm pack`; classify any remaining failure from real output. Final full suite: 2049 pass, 0 fail, 1 skip outside the restricted sandbox.
- [x] UWS-03 Install `gentle-pi@3.5.1` only in an isolated temporary verification prefix, inspect its declared license, and run the real host harness through that temporary PATH. Do not vendor or add it to runtime dependencies. Package metadata declares MIT; live host harness: 5/5.
- [x] UWS-04 Route `kairo conversation` and `kairo ui` through the new host by default, retaining `--legacy-cockpit` as the explicit compatibility escape hatch. New regression tests were RED then GREEN.
- [x] UWS-05 Produce a manual verification report equivalent to the unavailable `sdd-verify` phase, then re-archive OpenSpec only if all required checks pass or are explicitly deferred with evidence. `verify-report.md` records manual evidence and explicitly does not claim `sdd-verify` ran.
- [x] UWS-06 Commit the completed local work on this feature branch; do not push, create a PR, merge, or publish. Commit: `0968661` (`feat(host): unify kairo interactive workspace`).

## Constraints

- The only visible interactive entry point is `kairo`; aliases must not create a second default host.
- Gentle Shell remains external and PATH-gated until commercial distribution/license review is explicitly resolved.
- Preserve unrelated untracked paths (`docs/assets/`, `scripts/inspect-opencode-tier.sh`).
- TDD mode: ordinary functional checks; existing implementation tests provide regression coverage. New alias behavior must be RED then GREEN.
- Remote operations require separate authorization.

## Acceptance criteria

- The archive contains a verification report with observed commands and outcomes.
- The focused workspace suite passes, including a real Gentle Shell harness when the temporary verification binary is present.
- The full suite has no product failure; environment restrictions are separated from code failures with evidence.
- `kairo`, `kairo start`, `kairo resume`, `kairo conversation`, and `kairo ui` all converge on the same new host unless `--legacy-cockpit` is explicit.
- No package vendoring or paid-provider fallback is introduced.

## Progress

- Created on branch `feat/unified-kairo-workspace-completion` after auditing the prematurely archived change.
- OpenSpec was re-archived with `verify-report.md` after the final passing suite.
- The inherited implementation had existed uncommitted on `main`; it was preserved in one recovery commit rather than falsely inventing the five historical PR slices described by the archived task plan.

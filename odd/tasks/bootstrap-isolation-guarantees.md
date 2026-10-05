# Bootstrap isolation guarantees

## Objective

Document which Bootstrap Analysis adapters can guarantee filesystem confinement, with evidence; pin write-outside-snapshot and incompatible-config cases in tests. Keep native RDD persistence review separate (high/due, no approval claimed).

## Scope

- `docs/bootstrap-isolation.md` + links from `docs/README.md`, `docs/adapters.md`
- `test/bootstrap-isolation-boundary.test.js`
- No kernel edits; no Gentle review start

## Acceptance

- [x] Matrix: Codex/Cursor verified (macOS sandbox-exec), Claude restricted, others unverified — with evidence notes
- [x] Write allowlists exclude outside-workspace paths (Codex + Cursor profiles)
- [x] Incompatible configs fail closed (off-platform, missing sandbox-exec, Claude never verified, unknown adapter)
- [x] RDD persistence slice remains recorded as high/due without approval in tracker

## Evidence

- `node --test test/bootstrap-isolation-boundary.test.js`: pass
- RDD (separate, not started): persistence assess still `risk: high` / `review_due: true` on eligible `claude-code` agent; Cursor remains unassessable. No receipt claimed.

## Non-goals

- Starting or granting native RDD review
- Live OS canary re-runs against real CLIs this turn (documented prior canaries stand)

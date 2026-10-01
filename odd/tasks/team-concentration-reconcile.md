# Verificar y cerrar la selección de equipos de Kairo

Locator: `odd/tasks/team-concentration-reconcile.md`
Worktree: `agentic-harness-worktrees/kairo-plan1-baseline`
Branch: `feat/kairo-cursor-baseline`
Engram mirror: `odd/team-concentration-reconcile/tasks` (project `harness`)

## Shared base (Claude branch point)

- Branch: `feat/kairo-cursor-baseline`
- HEAD at plan start: `cf9cab8641872a68c8b467e39804f0b6e9998d11`
- Claude contract tests authored as `60e7acf51` on herd-shell; integrated here by Cursor.

## Objective

Explain the real proposal with the existing policy (capability, evidence, consumption, quotas, concentration). **Do not impose artificial diversity or change rules to force an expected result.**

**No evidence justifies changing the concentrator.** The historical cause of the approved all-Codex portfolio is **not** declared resolved. No further paid reanalysis.

## Key learnings

1. A recorded exception does not by itself prove it was necessary.
2. Current selection works with these preserved inputs; the historical recommendation pool remains unknown.

## Offline fixture

- `test/fixtures/team-selection-repro-dfd018.json` — anonymized session `dfd018…` + AA excerpt.
- Declared gaps (never invented): Codex catalog at approve time; **recommendation-pool membership at approve time**; Cursor catalog; dated Haiku id unmatched in AA.

## Saved approved outcome (evidence)

| Role | Model | Recorded reason |
|------|-------|-----------------|
| Explorer | codex/gpt-5.6-terra | Near-equivalent diversity **within Codex** |
| Architect | codex/gpt-6-astra | (none) — Astra use 1/2 |
| Debugger | codex/gpt-6-astra | (none) — Astra use 2/2 = `MAX_ROLES_PER_MODEL` |
| Reviewer | codex/gpt-5.5 | **`only-adequate-concentration`** — 4th Codex technical role |

What the saved approval shows:

- Astra×2 saturates `MAX_ROLES_PER_MODEL` (2).
- Reviewer is the 4th Codex technical role; the selector **recorded** `only-adequate-concentration`. **That exception’s historical justification is not verifiable** (the evaluated pool at approve time was not persisted). Do not read the label as proof that no adequate alternative existed.

## Current walk with fixture entitlements

With Claude `allowed` in the recommendation pool (preserved entitlement map), QUALITY/EFFICIENT/project **diversify** and Reviewer does **not** emit only-adequate. That is evidence about **current** inputs, not a reconstruction of the approve-time pool.

Balancer: `providerCapacity` Codex 22 / Claude 29 / Go 0 from measured windows.

## Proposal (future proposals — evidence, not reconstruction)

Persist with each suggested/approved strategy (schema additive, no concentrator change):

1. **Evaluated recommendation pool** — opaque candidate keys (`adapterId::modelId`) that entered QUALITY/EFFICIENT ranking after lifecycle + entitlement filters, plus per-candidate `entitlement` / `lifecycle` / `accessMode`.
2. **Per-role decision causes** — already partially present as `reason`; also store machine `reasonKind`, concentration snapshots (model/provider usage before the pick), and whether Stage-2 widen ran.
3. **Eligibility + `providerCapacity` fingerprint** used for that build.

Next explanation then cites stored evidence instead of reconstructing catalogs from strategy rows alone.

## Tests

| Kind | File |
|------|------|
| Fixture repro (preserved data) | `test/team-selection-repro.test.js` |
| SYNTHETIC policy contracts (Claude) | `test/team-selector-policy-contract.test.js` |
| SYNTHETIC contracts (Cursor) | `test/model-intelligence.test.js`, `test/project-strategy.test.js` (`SYNTHETIC contract`) |

## Tasks

- [x] B1 — Register shared base HEAD `cf9cab8…`
- [x] B2 — Anonymized fixture + declared gaps
- [x] B3 — Deterministic journey tests
- [x] B4 — Label Cursor synthetic contracts as `SYNTHETIC`
- [x] B5 — Document four-Codex + Astra×2 **recorded** evidence (justification not verifiable)
- [x] B6 — Integrate Claude `team-selector-policy-contract` tests
- [x] B7 — Propose pool + per-role cause persistence for future proposals
- [x] B8 — Joint checks + commit (WIP files verified by user)

## Applicable checks

- `node --test test/team-selection-repro.test.js test/team-selector-policy-contract.test.js`
- `node --test --test-name-pattern "SYNTHETIC contract" test/model-intelligence.test.js test/project-strategy.test.js`

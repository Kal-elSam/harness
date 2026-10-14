# Kairo UI real-use polish (Claude + Codex, Matrix theme, analysis progress) + branch cleanup

Objective: fix what real terminal testing of the installed delivery build (0.35.1) exposed, then audit and migrate/clean all open branches.
Branch: `delivery/kairo-runtime-clean` (local commits only; no push/PR/merge without Sam). Delivery strategy: feature-branch-chain (cached). Test runners: `cd crates/kairo-ui && cargo test`; `node --test test/*.test.js`; PTY scripts with absolute `KAIRO_UI_BINARY`.

## Specs
- S1 `[setWidget]` must not appear as a raw notice in Chat (Pi extension `setWidget` request in RPC mode is unhandled in `crates/kairo-ui/src/extension_ui.rs:275`).
- S2 "quiza acotemos uniucamente por ahora a el uso de claude y codex": analyst catalog and team suggestion/edit use only Claude and Codex for now (today hardcoded in `src/global/conversation/project-strategy.js:45` and `:572`).
- S3 "teniamos ya varias cosas de ui cagadas para el anlaisis del proeycto y todo eso, par aver que si esta haciendo un analisis": during project analysis the UI must show that the analysis is really progressing (elapsed time that advances, real stages); look for the richer UI built on other branches before building new.
- S4 "por que no tenemos el ui nuevo de nego estilo matrix?": the Ratatui UI gets the black Matrix-style (CRT/phosphor green) theme, ported from the preserved WIP (`preserve/ratatui-owned-window-crt`) and the uncommitted Pi-extension theme work in the main checkout (read-only source; never modify the main checkout).
- S5 "debemos ver como estmaos hainedo en analiss del poreycto para poder estiamr que modelos son los ideales para tabjar": evaluate, with evidence, how the project analysis chooses models per role once restricted to Claude + Codex.
- S6 "al terimnar analisa todas las ramas abiertas y ver que sirve y que no, necsitamos limpiar y migra todo l oqeu ahga falta": after S1-S5, audit all open branches/worktrees, report what is useful vs obsolete, migrate what is missing; any deletion of branches/worktrees needs Sam's explicit confirmation.

## Tasks
- [x] U1 (9dbf0ca36; RED 393/1 fail -> GREEN 394; fmt/clippy clean; Risk none) (S1) handle `setWidget` in Rust extension UI — route: delegated (team-builder-codex), strict TDD
- [x] U2 (b9230c81a; KAIRO_ACTIVE_PROVIDERS=[claude,codex] in project-strategy.js:48 used by analyst pools, team suggestion/fallbacks, edit choices, access verification, picker filter; 5 RED -> GREEN; parent full JS 3001/0 fail; cargo 394; Risk item 3) (S2) restrict analyst/team providers to Claude + Codex — delegated, strict TDD
- [x] U3 (a198b0a0b; reused the compact progress popup from feat/kairo-startup-analyst-team surfaces.rs:1419; local monotonic clock for elapsed, real stages only, no percent, terminal result shows stopping stage + reason; RED JS 1 + Rust 4 -> GREEN; cargo 398, clippy 32 warnings, fmt clean; parent full JS 3002/0 fail, PTY team-flow + recovery-throttle PASS, worker PTY analyst-picker PASS (expectations updated to U2 Claude/Codex policy); Risk item 3) (S3) analysis progress: ticking elapsed + real stages; search other branches for prior UI — delegated (explore + write), strict TDD + PTY
- [ ] U4 (S4) Matrix/CRT theme in Ratatui — delegated, after mapping the WIP
- [ ] U5 (S5) analysis model-selection evaluation (read-only report; changes only if Sam approves)
- [ ] U6 (S6) branch/worktree audit + migration plan; deletions only with Sam's confirmation
- [ ] U7 reinstall `kairo` from the branch for Sam's real tests

## Log
- L1 (2026-10-14, Sam): "ya lo probe, pero por que no tenemos el ui nuevo de nego estilo matrix? teniamos ya varias cosas de ui cagadas para el anlaisis del proeycto y todo eso, par aver que si esta haciendo un analisis [...] tambien siento que debemos ver como estmaos hainedo en analiss del poreycto para poder estiamr que modelos son los ideales para tabjar, quiza acotemos uniucamente por ahora a el uso de claude y codex"
- L2 (2026-10-14, Sam): "si, arranca en ese orden, y al terimnar analisa todas las ramas abiertas y ver que sirve y que no, necsitamos limpiar y migra todo l oqeu ahga falta"
- Mapping (team-explorer): CRT theme absent from delivery Rust; `preserve/ratatui-owned-window-crt` (68569e1fc) is a ~2145-file WIP snapshot, not an ancestor of delivery; Pi-side theme uncommitted in main checkout. `analysis_progress` wired (kairo-ui-rpc-stdio.js:1948-1956 -> main.rs:571/1124) but rendered as one notice; likely emitted once (elapsed stuck at 0s). `[setWidget]` from extension/index.js:271,313,329,332 -> extension_ui.rs:275 generic fallback. Provider sets hardcoded at project-strategy.js:45 (ASK_SUPPORTED_ADAPTERS) and :572 (TEAM_EDIT_ADAPTERS); no user setting found (grep-level).

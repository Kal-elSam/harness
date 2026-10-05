# Context-fill concurrent persistence

## Objective

Close partial-checkpoint reads and hook races on shared context-fill state as one concurrent persistence cluster: atomic STATE.md publish + locked shared JSON updates.

## Problem

`writeCheckpoint` used non-atomic `writeFile`, so SessionStart could load a truncated STATE.md. `claimVisibleNotice` / `recordContextFill` did unlocked read-modify-write on `context-fill.json`, so concurrent hooks could grant the notice twice or drop `announced` marks.

## Scope

- `src/global/runtime/write-atomic-json.js` (`writeAtomicText` / `writeAtomicFile`)
- `src/global/observability/context-fill-{checkpoint,hook,state,constants}.js`
- `test/context-fill-persistence.test.js`
- No kernel edits

## Acceptance

- [x] Readers never see partial STATE.md during commit
- [x] Concurrent claims grant once; record+claim merge announced marks
- [x] Multiprocess claims/records keep both adapters
- [x] Existing hook/atomic JSON tests green

## Evidence

- `node --test test/context-fill-persistence.test.js test/context-fill-hook.test.js test/write-atomic-json.test.js`: 17 pass

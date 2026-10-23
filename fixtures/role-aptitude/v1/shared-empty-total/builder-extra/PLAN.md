# Builder plan (role-aptitude v1)

## Goal
Fix `computeTotal([])` crashing without changing the public API.

## File targets
1. `src/compute-total.js` — give `reduce` an initial value of `0` (or equivalent) so an empty array returns `0`.

## Acceptance
- `node --test` passes, including the empty-array case.
- Export name `computeTotal` unchanged; no new required parameters.

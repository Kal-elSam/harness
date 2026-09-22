# Verification Report: unified-kairo-workspace

**Date**: 2026-09-22
**Method**: Manual verification recovery. The provider-backed `sdd-verify` phase was unavailable and was not represented as having run.

## Observed checks

| Check | Result | Evidence |
|---|---|---|
| Full test suite | Pass | Final `npm test` outside the restricted sandbox: 2050 tests, 2049 pass, 0 fail, 1 skip. |
| Focused host/kernel suite | Pass | `node --test test/host-launch.test.js test/cli-implicit-host.test.js test/kernel-contracts.test.js test/context-bundle.test.js test/worker-events.test.js test/ecosystem-degrade.test.js`: 25 pass, 1 skip when no host binary is present. |
| Real host harness | Pass | Isolated `/tmp/kairo-gentle-shell-verify` install put `gentle-shell 3.5.1` and `pi 0.85.1` on PATH; `test/host-launch.test.js` passed 5/5, including the previously skipped live version/argv test. |
| Interactive aliases | Pass | `test/cli-invocation.test.js test/cli-default-entry.test.js`: 17 pass. Bare `kairo conversation` and `kairo ui` now select the unified host; explicit `kairo conversation snapshot` remains scripted. |
| License declaration | Verified, non-legal | Installed `gentle-pi@3.5.1` declares `MIT` in package metadata. This change does not vendor or redistribute it; it keeps PATH install plus version gate. Commercial/trademark review remains outside technical verification. |

## Deliberate limits

- No real interactive Gentle Shell session was held open during automated verification; the live harness verifies the installed binary, Pi version gate, and exact `--link -e` launch argv without starting an interactive TTY.
- `sdd-verify` was not run because its provider phase was unavailable. This report is evidence for the implementation, not a synthetic SDD receipt.
- The feature remains local until normal branch review, commit, and separate remote authorization.

## Result

The testable local implementation is verified. The change may be archived with this report as its verification evidence, while commercial redistribution of Gentle Shell remains explicitly out of scope.

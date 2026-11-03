# Test only the behavior that matters

Per work unit, run focused tests plus affected tests. Run the full suite once per PR or review slice, not after every edit. A hub can legitimately select much of the suite: report the count rather than hiding that cost.

## Select and run

```sh
kairo test affected --base HEAD
kairo test affected --base HEAD --run
printf 'src/global/team/delegation-contract.js\n' | kairo test affected --stdin --run
```

`--cwd ROOT` selects the project. The default base is `HEAD`; Git diff includes staged and unstaged changes, and untracked files are included. Stdin takes one repository-relative file per line. CodeGraph supplies impact through `codegraph affected --stdin -p ROOT --json`. Changed test files are also included. Counts show affected files out of all JavaScript files under `test/`, matching this repository's suite file extensions.

Missing, failing or malformed CodeGraph evidence prints **unknown**, exits nonzero and recommends the full suite. It never reports zero as a substitute for missing evidence or silently runs the full suite. A successful empty selection runs nothing.

## Budget a delegation

Add this optional field to the existing handoff:

```json
{"testBudget":{"focused":["test/delegation-contract.test.js"],"affected":[],"fullSuite":"never"}}
```

The result carries corresponding evidence:

```json
{"testsRun":{"focused":["node --test test/delegation-contract.test.js: passed"],"affected":[],"fullSuite":false}}
```

Call `validateWorkerResult(result, handoff)` to enforce the budget. `fullSuite` is `never` or `once-per-slice`; a result claiming a full run under `never` is rejected. Budgeted results require `testsRun`. Legacy handoffs and results without these optional fields remain valid and unchanged. Evidence is worker-reported, not process monitoring; once-per-slice scheduling remains the parent's responsibility.

## Measure before expanding

```sh
kairo test audit --run --cache /tmp/kairo-test-timings.json
kairo test audit --cache /tmp/kairo-test-timings.json
```

`--run` executes every discovered test file once using `node --test FILE`, up to four processes concurrently, with a two-minute timeout per file. This is a full measurement run: schedule it as the slice's full run. The cache is optional; without `--run`, `--cache` is required and no tests run. Cached measurements include their date and may be stale. Failed or timed-out files are listed and produce a nonzero exit; timing is not proof of passing tests. Per-file wall times include Node startup and contention. Their sum is not elapsed wall time; both are printed.

The report shows the ten slowest files and candidate redundancies. The conservative heuristic groups files with the same literal `kairo` commands and identical sets of at least two assertion lines. Reading source files is separately flagged as possible implementation coupling. Neither signal proves a test is redundant. Report only: never delete tests without Sam's approval.

Every new test needs one comment line naming the observable behavior it protects. Test public interfaces, not internals or hypothetical inputs. Add one regression test per bug. Preserve a failing-before/passing-after record; run only focused and affected tests while iterating.

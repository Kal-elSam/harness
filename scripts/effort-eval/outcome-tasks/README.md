# Held-out synthetic outcome corpus

24 new dependency-free CommonJS mini-repos: 12 English / 12 Spanish, eight
each mechanical / ordinary / reasoning, and eight risk-sensitive tasks.
No real user prompts, effort labels, classifier predictions, or model outcomes
are included. Corpus creation does not resume the paused execution experiment.

## Validate offline

```sh
node scripts/effort-eval/outcome-tasks/validate.mjs
node --test test/effort-outcome-corpus.test.js
```

The CLI copies each fixture to a fresh temporary directory and requires its
external check to fail (exit 1) before deleting the copy. Missing files, invalid
metadata, timeouts, and process launch failures reject validation. It writes
`provenance.json` only after successful validation. The importable
`validateCorpus(root, { writeProvenance: false })` defaults to read-only
provenance behavior. Checks are trusted committed synthetic code, not a sandbox.

Manifest paths are relative to this directory. Scope entries are exact
fixture-relative filenames, not globs. Each check compares the candidate
against the original fixture and rejects added, removed, or changed files
outside scope, then asserts functionality and applicable safety properties.
Checks return 0 for acceptance and 1 for failure.

The SHA-256 input is the manifest's exact bytes plus fixture files and all
check files (including shared helpers), ordered by relative path. Each entry
is framed by a JSON path/byte-length tuple and newline before its bytes.
Provenance itself is excluded to avoid a circular hash. No timestamp is used.
Changing prompts, scope, fixture bytes, or check bytes changes provenance.

## Future KairoBench consumption

`runKairoBenchTask` already accepts `{ id, category, prompt, setup?, verify }`.
A future caller can map each manifest entry without exposing checks:

- `setup(io)`: copy only that entry's fixture files through `io.writeFile`.
  These fixtures are flat; no directory creation or dependencies are needed.
- `verify(io)`: call `io.run(process.execPath, [absoluteCheckPath, '.'])`
  and return whether `exitCode === 0`. The check and shared helper stay in
  the evaluator checkout outside the agent's working copy.
- Pass the entry's prompt and retain its scope for reporting. Never copy the
  manifest, checks, evaluator, or provenance into the agent fixture.

This documents the existing task interface; no execution runner or adapter
is added. A scratch copy alone is not access isolation: future execution must
also deny agent access to the evaluator checkout, network, and unrelated files.
Do not invoke an agent or provider without separate user authorization.

## Limits and provenance

The pre-registered design notes this known bias: tasks written by a Claude
model and executed by Claude models may suit Claude. This caveat is disclosed,
not corrected; it is not a claim that this corpus was authored by Claude.
Synthetic tasks, tiny Node fixtures, bilingual phrasing, and hand-authored
checks introduce additional selection and coverage bias. Passing these checks
does not establish production safety or generalize to real projects.
Labels must come later from outcomes, not author judgment or predictions.
The design's ask-versus-execution scope correction still applies; this corpus
alone does not validate live ASK routing.

The existing parent `scripts/effort-eval/.npmignore` contains `**`, excluding
this whole nested corpus under npm ignore semantics. No packaging configuration
was changed. Actual tarball proof requires the parent outside this sandbox.

Next: parent reviews and commits corpus/hash before any predictions or runs.

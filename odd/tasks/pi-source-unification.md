# Pi source unification

## Objective

Keep one working folder and one Git repository (`agentic-harness`) that
holds Kairo and the source of its Pi fork
(`@kal-elsam/kairo-pi-coding-agent`). The Pi fork keeps its own build,
npm lockfile, and npm package; Kairo keeps its pnpm lockfile and pins an
exact published fork version.

## Why

The fork lived in a sibling repo (`../kairo-pi`) with no remote, while
its package is public on npm. That meant two folders, a source that
nobody else could reach, and extra steps for every fork change.

## Scope and constraints

- Import upstream `earendil-works/pi` `v0.87.1` (`f07218c4d`) squashed
  under `third_party/pi`, then replay the 17 Kairo commits
  (`v0.87.1..kairo/0.87.1`) as normal commits. This keeps the Kairo diff
  reviewable against the tag without adding upstream's 6507-commit
  history (77 MiB) to Kairo.
- Pi builds with npm inside `third_party/pi`; Kairo builds with pnpm at
  the root. The two never share a lockfile.
- Kairo's `npm test` must run only Kairo's tests. The bare
  `node --test` would otherwise pick up `third_party/pi/**/test/*.js`.
- Kairo's published package must not include `third_party/`.
- Publishing the fork stays a separate operation that the user
  authorizes.
- No push, PR, or merge without authorization.
- Another session works in the main checkout (`feat/herd-shell-layout`),
  so this feature uses a temporary worktree that is removed at the end.

## Tasks

- [x] U1 Import upstream `v0.87.1` squashed at `third_party/pi`
  (`git subtree add --squash` from the local fork repo tag).
  Route: inline (mechanical git).
- [x] U2 Replay the 17 Kairo commits into `third_party/pi`
  (`git format-patch` + `git am --directory=third_party/pi`), keeping
  authorship and messages. Route: inline.
- [x] U3 Scope Kairo tooling: the `npm test` globs (same test count as
  before, 2234 pass), codegraph/graphify ignores, and a check that the
  Kairo package excludes `third_party/`. Route: delegated writer.
- [x] U4 Prove the imported source builds the published `.3`: build
  `third_party/pi` offline, `npm pack`, compare its file list and bytes
  with the published `0.87.1-kairo.3` tarball, and run the fork's
  `test/kairo` suite. Route: delegated writer.
- [x] U5 CI: a paths-filtered workflow that builds and tests
  `third_party/pi` (`test/kairo`) on changes there. Route: delegated
  writer.
- [x] U6 Docs: how to update, build, and publish the fork from
  `third_party/pi`; NOTICE and attribution. Route: delegated writer.
- [ ] U7 Remove the `.3` release-age exclusion from `.npmrc` after
  2026-09-26T18:03Z (24 h after the publish).
- [ ] U8 Retire the extra folders:
  - `../kairo-pi`, only after U4 passes;
  - the other worktrees, only if they are clean and not in use, keeping
    their branches and preserving any untracked work first;
  - this temporary worktree.
  Each removal is confirmed with the user.

## Acceptance

- `agentic-harness` builds and tests both Kairo and the Pi fork from one
  checkout.
- The imported source reproduces the published `.3` package.
- Kairo's suite count and results are unchanged.
- No sibling folder is needed.

## TDD

- Mode: strict (source: `~/.claude/CLAUDE.md`). Kairo runner:
  `node --test`. Fork runner: `npx vitest --run` inside
  `third_party/pi/packages/coding-agent`.

## Delivery

- The import commit is vendored upstream code (~25 MiB uncompressed), so
  the PR needs a size exception. The Kairo-authored diff (U2 replay and
  U3–U6) is reviewable on its own.

## Progress

- U1: `7b0c558f6` squashes `f07218c4d`; merge commit `04cefdd49`; 1863
  files. Only 2078 new objects are reachable (no upstream history). No
  upstream tags or refs leaked. The local `.git` holds the fetched
  upstream objects loose until `git gc` (U8).
- U2: 17 commits applied with `git am --directory=third_party/pi`,
  keeping authorship and dates; the last one is `1f03781ba`.
  Verification: `HEAD:third_party/pi` has tree `9611eda62acf…`, identical
  to the fork's `kairo/0.87.1` tree.

- 2026-09-25: The stray `(HARNESS_HOME)/` folder was deleted from the
  main checkout. It was last touched on 2026-09-24, and its `auth.json`
  was `{}` (no credentials).
- `main` already contains P02 (PR #352 merged, `c17ee0c`).

- U3 (`8941020d4`): the worktree's `node_modules` was missing (`pnpm
  install --frozen-lockfile` had never run there), which made the bare
  baseline run fail 130 test files with `ERR_MODULE_NOT_FOUND` before
  any third_party change — fixed by installing first. Branch baseline
  with `third_party/` moved aside: `node --test` (bare) = 2236 tests,
  2235 pass, 1 skip (one more than main's 2234/1; not investigated, not
  a third_party effect since third_party was absent for this run).
  Node's default `node --test` glob matches both `**/*.test.{js,mjs,cjs}`
  anywhere and any `.js/.cjs/.mjs` file inside a directory literally
  named `test` at any depth (this also matches non-test helper/fixture
  files, e.g. `test/helpers/*.js`, `test/test-fixtures.js`, which
  register zero tests themselves but are still "touched" by the bare
  run). The new explicit-glob `test` script
  (`test/**/*.{js,mjs,cjs}` + `packages/kairo-vscode/test/**/*.{js,mjs,cjs}`)
  reproduces the exact same 288-file set (diff empty, verified with a
  custom `node:test` reporter recording each event's source file) and
  the exact same counts, 2236/2235/1, with `third_party/` present.
  `pnpm test` re-run after restoring third_party confirms 2236/2235/1.
  No `.codegraph` or graphify ignore-config files exist in this repo;
  only `.gitattributes` (`third_party/** linguist-vendored`) was added.
  The `test/package-contents.test.js` addition (`npm pack --dry-run
  --json`, assert no `third_party/` path) was observed RED (1 fail)
  after temporarily adding `"third_party"` to `package.json` `files`,
  then GREEN (5/5 pass) after reverting. Full suite after the fix:
  2237/2236/1 (baseline + the one new test).
- U4: `npm ci` + `npm run build:offline` in `third_party/pi` succeed
  (the husky "`.git` can't be found" warning is expected for a subtree,
  not a submodule). `npm pack` of `packages/coding-agent` into the
  scratchpad produces a tarball with the exact same 1110-file list and
  identical per-file `sha256` for all 1110 files (diff empty) as the
  published `@kal-elsam/kairo-pi-coding-agent@0.87.1-kairo.3` tarball
  (`sha256 7621f1e7…`, at
  `/private/tmp/.../scratchpad/kal-elsam-kairo-pi-coding-agent-0.87.1-kairo.3.tgz`).
  `npx vitest --run test/kairo` = 25/25 pass. `third_party/pi/node_modules`
  and `packages/*/dist` are gitignored via `third_party/pi/.gitignore`;
  `git status --short third_party/` was empty after the build.
- U5 (`986e97f1a`): added `.github/workflows/pi-fork.yml`, triggered on
  `pull_request`/`push:main` with `paths: third_party/pi/**` and the
  workflow file itself; Node 22.19; `npm ci` + `npm run build:offline`
  in `third_party/pi`; `npx vitest --run test/kairo` in
  `packages/coding-agent`; `npm pack --dry-run`. `ci.yml` left
  unmodified: it already runs `pnpm test` unconditionally, and `pnpm
  test` now excludes `third_party/` (U3), so a third_party-only change
  triggering it is harmless, not a reason to add `paths-ignore`.
- U6 (`a24adbe28`): added `third_party/pi/KAIRO.md` — what the vendored
  copy is, MIT attribution (points at
  `packages/coding-agent/NOTICE.md`), npm-vs-pnpm split, build/test
  commands, the full publish sequence (bump version, regenerate
  shrinkwrap, `build:offline`, pack and verify, maintainer-run `npm
  publish --tag kairo --access public`, move `latest`, pin in Kairo,
  conditional `minimum-release-age-exclude`), and `git subtree pull
  --squash` for future upstream pulls.

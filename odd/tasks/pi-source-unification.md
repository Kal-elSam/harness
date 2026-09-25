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
- [ ] U3 Scope Kairo tooling: the `npm test` globs (same test count as
  before, 2234 pass), codegraph/graphify ignores, and a check that the
  Kairo package excludes `third_party/`. Route: delegated writer.
- [ ] U4 Prove the imported source builds the published `.3`: build
  `third_party/pi` offline, `npm pack`, compare its file list and bytes
  with the published `0.87.1-kairo.3` tarball, and run the fork's
  `test/kairo` suite. Route: delegated writer.
- [ ] U5 CI: a paths-filtered workflow that builds and tests
  `third_party/pi` (`test/kairo`) on changes there. Route: delegated
  writer.
- [ ] U6 Docs: how to update, build, and publish the fork from
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

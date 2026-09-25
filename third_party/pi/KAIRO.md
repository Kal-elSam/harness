# Kairo notes on this vendored Pi fork

This directory is a vendored copy of
[`earendil-works/pi`](https://github.com/earendil-works/pi) `v0.87.1`,
imported with `git subtree add --squash` (one commit,
`f07218c4d` squashed), plus the 17 Kairo-authored commits replayed on
top with `git format-patch` / `git am --directory=third_party/pi`
(`v0.87.1..kairo/0.87.1`). It used to live in a separate, unpublished
sibling repository (`../kairo-pi`); it now lives here so Kairo and its
Pi fork share one Git repository and one history that anyone with this
checkout can read.

Upstream Pi is licensed MIT, copyright (c) 2025 Mario Zechner. See
`LICENSE` in this directory for the full text, unmodified. The
Kairo-only fork of the `coding-agent` package
(`@kal-elsam/kairo-pi-coding-agent`) and its changes are documented in
`packages/coding-agent/NOTICE.md`.

## Two lockfiles, two package managers

- `third_party/pi` is an npm workspace monorepo. It builds and tests
  with **npm**, using its own `package-lock.json`. Never run `npm
  install` at the Kairo repository root, and never let `pnpm` touch
  anything under `third_party/pi`.
- Kairo, at the repository root, uses **pnpm** (`pnpm-lock.yaml`) and
  depends on the fork only through the exact published npm package it
  pins (`@kal-elsam/kairo-pi-coding-agent`), never through a local
  workspace link into `third_party/pi`.

## Build and test

From `third_party/pi`:

```
npm ci
npm run build:offline
```

Use `build:offline`, not the plain `build`, for anything you intend to
publish: `build` re-fetches the model catalog from models.dev, which
makes the output depend on when you ran it. `build:offline` reuses the
catalog already committed at `packages/ai/src/providers/data/` so the
build only depends on the tagged source; two consecutive
`build:offline` runs produce byte-identical
`packages/coding-agent/dist/bundle/**` output.

Run the Kairo-only fork tests from `packages/coding-agent`:

```
npx vitest --run test/kairo
```

The full upstream test suite for each package also runs with `npx
vitest` inside that package, but `test/kairo` is the one that matters
for this fork: it is the only suite Kairo CI runs (see
`.github/workflows/pi-fork.yml`), scoped by `paths:
third_party/pi/**`.

`third_party/pi/node_modules` and every package's `dist/` are
gitignored (`third_party/pi/.gitignore`); a clean build never shows up
in `git status`.

## Publishing a new fork version

Publishing stays a separate, user-authorized operation — nothing here
runs it automatically. The steps, in order:

1. Bump the version in `packages/coding-agent/package.json` (for
   example `0.87.1-kairo.3` → `0.87.1-kairo.4`).
2. Regenerate the shrinkwrap: `node
   scripts/generate-coding-agent-shrinkwrap.mjs` (run `--check` first
   to confirm it is actually stale).
3. `npm run build:offline` from `third_party/pi`.
4. `npm pack` in `packages/coding-agent` and verify the result: check
   the file list and, if comparing against a previous version, diff
   the per-file `sha256` sums to confirm only the intended source
   changed.
5. The maintainer runs `npm publish --tag kairo --access public` from
   `packages/coding-agent`. This never happens as part of a build or
   CI step.
6. Once published, move the `kairo` dist-tag to `latest` when that
   version is meant to become the default fork release.
7. Pin the new version explicitly in the Kairo root `package.json`
   (`@kal-elsam/kairo-pi-coding-agent`) and run `pnpm install
   --frozen-lockfile` (or update the lockfile as usual) to pick it up.
8. Only if the pinned version needs to install before npm's default
   24-hour publish cooldown, add a version-scoped
   `minimum-release-age-exclude[]` entry to the root `.npmrc` — never
   widen it to the bare package name — and record the reason and the
   removal date in a comment next to it. Remove the exclusion once the
   version is older than the cooldown.

## Pulling a newer upstream release later

From the Kairo repository root, with the local fork history available
as a remote (or a local clone) at the desired tag:

```
git subtree pull --prefix=third_party/pi <upstream-remote> v<new-version> --squash
```

This squashes the upstream delta since the last import into one
commit, on top of which the Kairo-specific commits already in
`third_party/pi` continue to apply. Rebuild
(`npm ci && npm run build:offline`), rerun `npx vitest --run
test/kairo`, and re-verify the packed tarball before publishing a new
fork version from the pulled source.

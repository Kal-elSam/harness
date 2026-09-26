# Notice

This package, `@kal-elsam/kairo-pi-coding-agent`, is a Kairo-only fork of
[`@earendil-works/pi-coding-agent`](https://github.com/earendil-works/pi/tree/main/packages/coding-agent)
version `0.87.1`, built from the upstream source at that exact release
(`packages/coding-agent` in `earendil-works/pi`, tag `v0.87.1`) using the
upstream build (`tsgo` compile followed by the upstream
`scripts/build-coding-agent-bundle.mjs` bundler), run reproducibly via
`npm run build:offline` — see "Reproducible release build" below.

Upstream `@earendil-works/pi-coding-agent` is licensed under the MIT
License, copyright (c) 2025 Mario Zechner. See `LICENSE` in this package
for the full text, unmodified from upstream.

## What changed in this fork

- `packages/coding-agent/src/core/session-manager.ts`: sessions with no
  assistant reply yet (a brand-new session, or one forked before a reply)
  are now persisted to disk immediately instead of only after the first
  assistant message. This is opt-in and off by default: it only applies
  when the environment variable `KAIRO_PI_EMPTY_SESSIONS` is set to `1` in
  the process running this package. With that variable unset, or set to
  anything else, behavior is unchanged from upstream `0.87.1`.
- `packages/coding-agent/src/main.ts`: `--mode rpc` may start when
  `session.model` is unset. Upstream exits(1) for every non-interactive
  mode without a model; this fork skips that exit for `appMode === "rpc"`
  only so a host (Kairo ratatui sidecar) can call `set_model` after
  connect. Interactive and other non-rpc modes keep the upstream
  no-model exit. Not unit-tested here: `main()` is CLI entry and needs a
  full agent bootstrap; coverage is the intentional `appMode === "rpc"`
  exception plus Kairo bridge tests that assume RPC can answer before
  Architect `set_model`. **Runtime-active only after the next npm
  publish of this fork** — vendored `third_party` edits are not the pin
  `kairo` resolves until published.
- This package's `package.json` has no `bin` entry (upstream publishes a
  `pi` bin at `dist/bundle/cli.js`; this fork does not, since it is run by
  the Kairo launcher by resolving that same file's path directly).
- This package's `name` and `version` are changed to distinguish it from
  upstream on npm; no other upstream source under `packages/coding-agent`
  was modified beyond the changes above.

All other behavior, code, and licensing terms are unchanged from upstream
`@earendil-works/pi-coding-agent@0.87.1`.

## Reproducible release build

Build this package from a clean checkout of the `kairo/0.87.1` branch with,
from the repository root:

```
npm run build:offline
```

This is the upstream `build:offline` switch (already present in the
monorepo root `package.json`, unmodified by this fork). It builds every
workspace package in dependency order and, for `packages/ai`, skips the
live `generate-models` fetch to models.dev and instead reuses the model
catalog already committed at `packages/ai/src/providers/data/` (tracked in
git for this fork instead of being gitignored, precisely so the release
build never depends on a live network fetch). Do not use the plain `npm run
build` for a release: it runs `generate-models`, which fetches the current
model catalog over the network and makes the output depend on when the
build ran instead of on the tagged source.

Two consecutive `npm run build:offline` runs from the same checkout produce
byte-identical `packages/coding-agent/dist/bundle/**` output.

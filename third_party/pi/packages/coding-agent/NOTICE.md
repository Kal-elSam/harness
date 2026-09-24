# Notice

This package, `@kal-elsam/kairo-pi-coding-agent`, is a Kairo-only fork of
[`@earendil-works/pi-coding-agent`](https://github.com/earendil-works/pi/tree/main/packages/coding-agent)
version `0.87.1`, built from the upstream source at that exact release
(`packages/coding-agent` in `earendil-works/pi`, tag `v0.87.1`) using the
upstream build (`npm run build`, i.e. `tsgo` compile followed by the
upstream `scripts/build-coding-agent-bundle.mjs` bundler).

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
- This package's `package.json` has no `bin` entry (upstream publishes a
  `pi` bin at `dist/bundle/cli.js`; this fork does not, since it is run by
  the Kairo launcher by resolving that same file's path directly).
- This package's `name` and `version` are changed to distinguish it from
  upstream on npm; no other upstream source under `packages/coding-agent`
  was modified beyond the change above.

All other behavior, code, and licensing terms are unchanged from upstream
`@earendil-works/pi-coding-agent@0.87.1`.

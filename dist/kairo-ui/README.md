# Prebuilt `kairo-ui` binaries (U6 packaging)

Layout (one executable per supported triple):

```
dist/kairo-ui/
  darwin-arm64/kairo-ui
  darwin-x64/kairo-ui
  linux-arm64/kairo-ui
  linux-x64/kairo-ui
```

## How launch selects a binary

`launchRatatuiHost` resolves `dist/kairo-ui/<platform>-<arch>/kairo-ui` first
(`resolvePrebuiltBinary`). When present, the host starts **without Cargo**.

When the prebuilt is missing (typical local checkout before this script runs),
launch falls back to `cargo build --release` against `crates/kairo-ui` — **dev only**.

Windows: `kairo ui` keeps the existing explicit error (non-interactive CLI only).

## Building

```bash
scripts/build-kairo-ui-binaries.sh           # host + cross targets when possible
scripts/build-kairo-ui-binaries.sh --host-only
scripts/build-kairo-ui-binaries.sh --target darwin-arm64
```

Cross strategy:

| Situation | Tooling |
|---|---|
| Host triple | native `cargo build --release` |
| Same-OS foreign arch (e.g. `darwin-x64` on Apple Silicon) | `cargo build --target …` when the rustup target is installed |
| Non-host **Linux** triples | Prefer `cargo zigbuild --target …` when **both** `cargo-zigbuild` and `zig` are on `PATH`; otherwise plain `cargo --target`, then honest skip |

Missing toolchains / linkers are skipped honestly (no fake PASS). JS unit tests still assert path selection for all four keys without requiring every binary on every machine.

## Clean-install verification

```bash
scripts/verify-kairo-ui-clean-install.sh
# or separately:
node --test test/kairo-ui-clean-install.test.js
npm run verify:kairo-ui-npm-pack-install
```

1. **Hand-staged** crate-less root (all four prebuilts + minimal sidecar, **no**
   `crates/` / `Cargo.toml`).
2. **Real `npm pack`**: binaries are gitignored but still packed via
   `package.json` `files: ["dist/kairo-ui"]`. Extract the tarball and assert
   all four `dist/kairo-ui/*/kairo-ui` paths, launch selection without cargo,
   and host `--v3-capture` from that install root.

Asserts:

- `launchRatatuiHost` selects the matching prebuilt for each of the four keys and never invokes cargo
- Host-arch binary actually runs `--v3-capture` (exit 0 + output files) from a crate-less root
- Foreign triples: `file` magic always; **observed status 0 → foreign-exec PASS (diagnostic)**; non-zero/spawn error → honest gap. Never invent PASS.

## CI matrix and packaged verification

Workflow: `.github/workflows/kairo-ui-prebuilt.yml` — **`workflow_dispatch` only** (not on PRs).
A dispatch-only workflow must exist on `main` to be dispatchable; this one was registered
via PR #354 and is run against a branch with `gh workflow run kairo-ui-prebuilt.yml --ref <branch>`.
**Status: observed green.** Run `36486806394` on SHA `1ee2c28c8` (`--ref feat/ratatui-host`):
9/9 jobs success (4 build, `Assemble npm package`, 4 `Verify packaged host`). Each native
runner (darwin-arm64, darwin-x64, linux-x64, linux-arm64) logged selection from the extracted
tarball, launch without cargo OK, `v3-capture: 52 files`, and PTY PASS at 60x30/100x30/160x48
with terminal restore. Scope: mock sidecar only; this does **not** prove real providers.
Non-blocking: Node 20 deprecation annotation on `upload/download-artifact@v4`.

| Job | What it does |
|---|---|
| `host-v3-capture` (matrix) | Build the host binary, `--v3-capture`, upload `kairo-ui-bin-<key>-<github.sha>` |
| `assemble` | Download the four binaries, place them under `dist/kairo-ui/<key>/kairo-ui` (exec bit), `npm pack`, assert all four are in the tarball, upload `kairo-ui-package-<github.sha>` |
| `verify-package` (matrix, needs `assemble`) | Extract the tarball on each native runner and run `scripts/verify-kairo-ui-packaged.sh` (no Rust toolchain) |

| Runner | Expected key |
|---|---|
| macos-14 (Apple Silicon) | `darwin-arm64` |
| macos-15-intel | `darwin-x64` |
| ubuntu-24.04 x64 | `linux-x64` |
| ubuntu-24.04-arm | `linux-arm64` |

`scripts/verify-kairo-ui-packaged.sh <tarball> [key]` checks, using the binary,
resolver and launcher from the extracted package: key selection, launch
selection with no Cargo (restricted PATH, no `crates/`), `--v3-capture` >= 10
files, and a PTY run (60x30, 100x30, 160x48) asserting bridge connection,
output and alt-screen enter/leave. Run it locally against `npm pack` output on
the host platform. The mock sidecar comes from the repo checkout and does
**NOT** prove real providers.

Binaries are gitignored; this README and `.gitkeep` markers stay in source control.
U6 packaging is verified on all four native runners (mock sidecar only). This does not imply
total product parity, and it does not prove real providers.

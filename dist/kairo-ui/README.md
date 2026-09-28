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

## CI matrix

Workflow: `.github/workflows/kairo-ui-prebuilt.yml` — **`workflow_dispatch` only** (not on PRs).

| Runner | Expected key |
|---|---|
| macos-14 (Apple Silicon) | `darwin-arm64` (exec) |
| macos-13 x64 | `darwin-x64` (exec) |
| ubuntu-24.04 x64 | `linux-x64` (exec) |
| ubuntu-24.04-arm | `linux-arm64` (exec) |

Attach built artifacts under this directory before `npm pack` / publish.
Binaries are gitignored; this README and `.gitkeep` markers stay in source control.
U6 stays **partial** until foreign-exec gaps close on matching runners.

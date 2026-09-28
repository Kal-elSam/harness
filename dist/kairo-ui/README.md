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
# or:
node --test test/kairo-ui-clean-install.test.js
```

Stages a package root with all four prebuilts + a minimal sidecar path and **no**
`crates/` / `Cargo.toml`. Asserts:

- `launchRatatuiHost` selects the matching prebuilt for each of the four keys and never invokes cargo
- Host-arch binary actually runs `--v3-capture` (exit 0 + output files) from that crate-less root
- Foreign triples: `file` magic (Mach-O x86_64 / ELF x86-64 / ELF aarch64) + launch selection; runtime exec needs Rosetta / Linux CI / Docker (not faked)

## CI matrix (placeholder)

| Runner | Expected key |
|---|---|
| macos-14 (Apple Silicon) | `darwin-arm64` |
| macos-13/14 x64 or Rosetta | `darwin-x64` (exec) |
| ubuntu-22.04 x64 | `linux-x64` |
| ubuntu arm64 / qemu / zigbuild | `linux-arm64` |

Attach built artifacts under this directory before `npm pack` / publish.
Binaries are gitignored; this README and `.gitkeep` markers stay in source control.

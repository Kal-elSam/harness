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
scripts/build-kairo-ui-binaries.sh           # host + any installed cross targets
scripts/build-kairo-ui-binaries.sh --host-only
scripts/build-kairo-ui-binaries.sh --target darwin-arm64
```

Cross targets that lack a rustup toolchain or linker are skipped honestly.
JS unit tests assert path selection for all four keys without requiring every binary.

## CI matrix (placeholder)

| Runner | Expected key |
|---|---|
| macos-14 (Apple Silicon) | `darwin-arm64` |
| macos-13/14 x64 or cross | `darwin-x64` |
| ubuntu-22.04 x64 | `linux-x64` |
| ubuntu arm64 / qemu | `linux-arm64` |

Attach built artifacts under this directory before `npm pack` / publish.
Binaries are gitignored; this README and `.gitkeep` markers stay in source control.

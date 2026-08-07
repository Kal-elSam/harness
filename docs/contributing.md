# Contributing

## Local development

This repo uses **pnpm 10.x** for install and CI. End-user installs still go
through npm (`npx` / `npm install -g`). Publishing keeps `npm publish` with
Trusted Publishing/OIDC.

```bash
# requires Node.js 20.12+ and pnpm 10.34.5 (see packageManager in package.json)
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm run smoke
npm pack --dry-run
```

Install scripts are blocked by default (`pnpm.onlyBuiltDependencies` is empty).
`.npmrc` sets `strict-dep-builds=true` and `minimum-release-age=1440` (one day).

Smoke scripts that pack and install a tarball still call `npm pack` / `npm install`
on purpose — they simulate the path real users take.

## Modes

| Mode | Use case |
|---|---|
| minimal | scripts, technical spikes, landing pages, small prototypes |
| standard | real frontend/backend apps, simple SaaS, medium products |
| enterprise | AI agents, critical workflows, API/DB/auth/evals, multi-agent |

## Publishing

Published on npm as `@kal-elsam/kairo-runtime` under the **MIT** license (see root `LICENSE`).
Releases use **npm Trusted Publishing/OIDC**
from GitHub Actions — no `NPM_TOKEN`.

`@kal-elsam/harness` is published separately as a compatibility bridge from
`packages/harness-bridge/` (see bridge README).

### Git tags (package-aware)

| Tag pattern | Package | Publish root |
|---|---|---|
| `kairo-runtime-v*` | `@kal-elsam/kairo-runtime` | repo root |
| `harness-bridge-v*` | `@kal-elsam/harness` | `packages/harness-bridge/` |
| `v*` | legacy / historical root releases | repo root |

Kairo Runtime releases should use `kairo-runtime-vX.Y.Z` going forward. The first
bootstrap used `v0.1.0`; later releases use package-aware tags such as
`kairo-runtime-v0.1.1`.

Before tagging a new version:

```bash
pnpm test
pnpm run smoke
npm pack --dry-run
```

After the release commit, verify attribution was not added to the message:

```bash
pnpm run release:check
git log -1 --format=%B
```

CI also scans commit ranges for attribution trailers:

```bash
pnpm run release:check --range origin/main...HEAD
```

Release commits must **not** include `Co-authored-by` or other AI attribution
trailers. Do not rewrite published tags; ship a corrective patch version instead.

`pnpm run smoke` packs the current source into a tarball, installs it in a
throwaway temp project with a fake `HARNESS_HOME`, and exercises both scopes end
to end:

- **agent-global:** `setup --dry-run`, `status`, `install`, `doctor`, drift
  simulation, `sync` repair, `backups`, rollback preview (no writes),
  rollback apply (with safety backup), `uninstall`.
- **workspace:** `install --scope=workspace`, `doctor`, `update --dry-run`.

Release flow (Kairo Runtime):

```bash
# bump version in package.json and pnpm-lock.yaml
git add .
git commit -m "chore: release kairo-runtime 0.1.1"
pnpm run release:check
git tag kairo-runtime-v0.1.1
git push origin main
git push origin kairo-runtime-v0.1.1
```

Bridge release flow:

```bash
# bump packages/harness-bridge/package.json (+ pnpm-lock.yaml)
git add .
git commit -m "chore: release harness bridge 0.30.0"
pnpm run release:check
git tag harness-bridge-v0.30.0
git push origin main
git push origin harness-bridge-v0.30.0
```

Legacy `v*` tags still publish from the repo root for historical continuity.

After npm publishes the tag, verify published provenance against git and the registry:

```bash
git fetch --tags origin
git fetch origin main
pnpm run release:published --version 0.1.1 --tag kairo-runtime-v0.1.1
pnpm run smoke:registry --version 0.1.1
pnpm run smoke:installer --version 0.1.1 --tag kairo-runtime-v0.1.1
pnpm run smoke:bridge
```

`release:published` checks npm `version`, npm `gitHead`, the release git tag on
`origin`, and `origin/main`. Override the package and tag when needed:

```bash
pnpm run release:published \
  --package @kal-elsam/kairo-runtime \
  --tag kairo-runtime-v0.1.1 \
  --version 0.1.1

pnpm run release:published \
  --package @kal-elsam/harness \
  --tag harness-bridge-v0.30.0 \
  --version 0.30.0
```

Without `--tag`, provenance checks fall back to `v${version}` (legacy tags).

`smoke:registry` installs `@kal-elsam/kairo-runtime` from the npm registry (not the local tarball) into a throwaway workspace with a fake `HARNESS_HOME` and npm cache, then runs the recommended flow via `kairo`: `setup --dry-run`, `setup --yes`, `status`, drift simulation, `sync`, `status --json` (expects `overall=ok`), and `uninstall`. Use `latest` by default, pin with `--version x.y.z`, or override with `--package`.

`smoke:installer` validates the public one-liner path: `curl .../install.sh | sh` against GitHub `raw` and the npm registry with isolated `HARNESS_HOME`. Preview must not write `~/.harness`; `--yes --agents all` must reach `kairo status --json` with `overall=ok`, then `kairo uninstall` must remove managed sections. Pin with `--version x.y.z` after publish. For package-aware Kairo Runtime tags, pass the git tag explicitly:

```bash
pnpm run smoke:installer --version 0.1.1 --tag kairo-runtime-v0.1.1
```

Without `--tag`, the install script resolves from legacy `v${version}` tags.

Suggested first Kairo Runtime tag after bootstrap: `kairo-runtime-v0.1.1`.

The `publish.yml` workflow runs on `v*`, `kairo-runtime-v*`, and `harness-bridge-v*`
tags and publishes to npm using the `npm-publish` environment.
It installs with pnpm, then runs `pnpm run release:check` on `HEAD` immediately
before `npm publish` (OIDC trusted publishing stays on the npm CLI).

See the full policy in `SECURITY.md`.

## Base rule

The agent must not operate as a free-form programmer.

```txt
Requirement
→ Spec
→ Plan
→ Tests failing first
→ Implementation
→ Validation
→ Review
→ Human approval
```


## Compatibility bridge

`@kal-elsam/harness` remains a compatibility bridge that delegates to Kairo Runtime and prints a migration warning. Prefer `@kal-elsam/kairo-runtime` and the `kairo` CLI.

Legacy CLI aliases: `harness`, `agentic-harness`, `sgs-harness`, `harness-sgs`.

# Agentic Harness Security Policy

Agentic Harness is a package installer for repository-level AI governance. Treat it as supply-chain infrastructure: if the package is compromised, every project that installs it can inherit bad instructions.

## Release standard

All public npm releases must use this path:

```txt
GitHub tag
→ GitHub Actions publish workflow
→ npm Trusted Publishing via OIDC
→ npm registry
```

## Required controls

| Area | Requirement |
|---|---|
| Publishing auth | Use npm Trusted Publishing/OIDC. Do not use a long-lived `NPM_TOKEN` for publish. |
| Workflow permission | `id-token: write` is required only in the publish workflow. |
| Runner | Publish only from GitHub-hosted runners. Do not publish from self-hosted runners. |
| Node/npm | Use Node 22.14+ and npm 11.5.1+ for trusted publishing support. |
| Release trigger | Publish only from immutable git tags: `kairo-runtime-v*`, `harness-bridge-v*`, or legacy `v*`. |
| Install | Use `npm ci` with a committed lockfile. |
| Package verification | Run `npm test`, `npm run smoke`, and `npm pack --dry-run` before publish. |
| Release commit hygiene | No `Co-authored-by` or AI attribution in release commits; run `npm run release:check` after committing. |
| CI attribution guard | Run `npm run release:check -- --range <rev-range>` on pull requests and pushes. |
| Publish gate | Run `npm run release:check` on `HEAD` in `publish.yml` before `npm publish`. |
| Post-publish provenance | Run `npm run release:published -- --version x.y.z [--tag <tag>] [--package <name>]` after npm publish. |
| Post-publish registry smoke | Run `npm run smoke:registry -- --version x.y.z` manually after npm publish; not in CI. |
| Published tag policy | Do not force-push or rewrite published `v*` tags; ship corrective versions instead. |
| Account security | Require 2FA on GitHub and npm maintainer accounts. |
| Branch protection | Protect `main`; require review and passing CI before merge. |

## npm Trusted Publisher setup

Configure the package on npm with:

```txt
Publisher: GitHub Actions
Repository: <owner>/<repo>
Workflow filename: publish.yml
Environment name: npm-publish
Allowed action: npm publish
```

The workflow lives at:

```txt
.github/workflows/publish.yml
```

## Dependency posture

This package should stay dependency-free unless a dependency provides clear architectural value. If dependencies are added:

- prefer direct, well-maintained dependencies;
- pin through `package-lock.json`;
- update via pull request, not silent automatic publish;
- run CI before release;
- review install-time scripts before allowing them.

## Reporting

Report suspected security issues privately to the repository owner. Do not open a public issue for exploitable supply-chain vulnerabilities.

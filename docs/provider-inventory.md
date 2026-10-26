# Provider inventory

Run `kairo team providers [--json] [--cwd PATH]` for a read-only inventory of
Codex, Claude, Cursor, and OpenCode Go. No model is run and no login is started.
Text output has one line per provider; JSON returns `{ "providers": [...] }`.

Each row includes `providerId`, `installed`, `authenticated`, `models` (catalog
IDs or `"unknown"`), `remainingPercent` (number or `"unknown"`), and `available`.
Unavailable providers include a short `reason`: `not_installed`,
`not_authenticated`, `no_quota_data`, `quota_exhausted`, or `catalog_unknown`,
with installation and authentication checked first, then quota, then catalog.
Availability requires installed CLI, authenticated session, available quota,
and a known model catalog; catalog presence alone is not proof of entitlement.

Codex lists its real catalog through `codex app-server`'s `model/list` RPC.
Claude retains its existing documented catalog and cached entitlement reader.
Cursor's pool-level evidence is not a model catalog; OpenCode Go has no catalog
reader here. Both therefore report unknown catalogs. Quota uses existing recent
usage caches only; missing or stale quota remains unknown. `--cwd` selects the
working directory for Codex catalog discovery, without writing project state.

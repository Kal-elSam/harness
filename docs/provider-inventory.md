# Provider inventory

Run `kairo team providers [--json] [--cwd PATH]` for a read-only inventory of
Codex, Claude, Cursor, and OpenCode Go. No model is run and no login is started.
Text output has one line per provider; JSON returns `{ "providers": [...] }`.

Each row includes `providerId`, `configured`, `installed`, `authenticated`, `models` (catalog
IDs or `"unknown"`), `remainingPercent` (number or `"unknown"`), and `available`.
Unavailable providers include a short `reason`: `not_configured`, `not_installed`,
`not_authenticated`, `no_quota_data`, `quota_exhausted`, or `catalog_unknown`,
with configuration, installation and authentication checked first, then quota, then catalog.
Availability requires installed CLI, authenticated session, available quota,
and a known model catalog; catalog presence alone is not proof of entitlement.

Codex lists its real catalog through `codex app-server`'s `model/list` RPC.
Claude retains its existing documented catalog and cached entitlement reader.
Cursor's pool-level evidence is not a model catalog; OpenCode Go has no catalog
reader here. Both therefore report unknown catalogs. Quota uses existing recent
usage caches only; missing or stale quota remains unknown. `--cwd` selects the
working directory for Codex catalog discovery, without writing project state.

## Team providers

Only providers in the profile field `teamProviders` can hold team roles. It
defaults to `["claude", "codex"]`; a profile without the field behaves exactly
as before. Valid ids are `cursor`, `codex`, `claude`, `opencode`, `pi` and
`opencode-go`; an unknown id, an empty list or a non-array value is rejected
with the allowed ids. A provider outside the list shows `configured: false`
and `available: false` with reason `not_configured`.

Change the list with `kairo team providers --enable ID` or
`kairo team providers --disable ID`; both write the global profile
(`~/.harness/profile.json`) and keep its other fields. The project profile
(`.harness/kairo.json`) may also set `teamProviders` and overrides the global one.

A change to `teamProviders`, or a configured provider losing its install, login
or model catalog (`not_installed`, `not_authenticated`, `catalog_unknown`),
re-forms the approved team automatically; see [team-reform.md](team-reform.md).

# Codex delegated-write canary — executable protocol (offline prep)

This protocol is ready for a **future authorized** live run. It does **not**
prove containment. `verifiedEffective` stays **false**. The oracle only
consumes captured evidence.

## Fixed disposable layout

| Role | Path |
|---|---|
| workspaceRoot | `/tmp/kairo-wt-delegated-1/tree` |
| providerHome (isolated) | `/tmp/kairo-wt-delegated-1/provider-home` |
| tempRoot (isolated) | `/tmp/kairo-wt-delegated-1/tmp` |
| profile | `/tmp/kairo-wt-delegated-1/profile.sb` |
| internal attempt | `/tmp/kairo-wt-delegated-1/tree/canary-internal-write.txt` |
| external attempt | `/tmp/kairo-wt-delegated-1/canary-external-probe.txt` |

Never target personal `~/.codex`. This prep does not copy credentials.

## Build protocol (no spawn)

```js
import { prepareDelegatedWriteCanaryProtocol } from
  "../src/global/runtime/codex-delegated-write-canary-protocol.js";

const protocol = await prepareDelegatedWriteCanaryProtocol({
  workspaceRoot: "/tmp/kairo-wt-delegated-1/tree",
  providerHome: "/tmp/kairo-wt-delegated-1/provider-home",
  tempRoot: "/tmp/kairo-wt-delegated-1/tmp",
  profilePath: "/tmp/kairo-wt-delegated-1/profile.sb"
});
// protocol.verifiedEffective === false
// protocol.command — exact shell line with cd + --cd
// protocol.profile.body — exact SBPL
```

## Capture checklist

**Before:** initialState per attempt (`exists`, `contentHash` or `mtimeMs`).  
**During:** full stdout + tool/process events linked to each target path.  
**After:** finalState per attempt; external denial only via linked `tool_error` /
`toolError` (not agent “denied” / generic “sandbox” text); `executed: true`
only if the wrapped process ran.

Feed `{ attempts, executed, stdout, events, launchError }` into
`judgeDelegatedWriteCanaryOracle`. Contained ≠ admission promotion.

## Exact command shape

See `protocol.command` (includes `cd <workspace> && … --cd <workspace>`).

## RDD (integrated tip, Gentle)

Receipt recorded in `odd/tasks/codex-delegated-write-compat.md`
(lineage `review-4b66cfffd44c6167`, burned). Review ≠ containment.

## Live authorization (not executed here)

Concrete one-run package:
`docs/codex-delegated-write-canary-authorization.md`.

Status: **prepared / not authorized / not run.**  
Authorize in plain language (name the model); no ceremonial token required.
A `contained` verdict still needs a separate promotion decision.

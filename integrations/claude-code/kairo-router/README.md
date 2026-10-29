# Kairo router

The Kairo pane shows provider quota and reset times, the routing plan, running delegations, and pending verdicts. Stale quota data is marked. Use `/kairo-pane` to toggle the pane; supported fullscreen surfaces open it automatically. Unavailable sources are shown as unavailable and do not prevent prompts or delegations.

A routed Agent call shows who runs the work on its task card: `Role · model (provider) — task`. Launches marked `[no-redirect]` keep their description as written. The spinner names the running delegation, the running tool (`Running Bash`), or the current stage, and adds `· <provider> CRITICAL` while a provider's quota pacing is critical.

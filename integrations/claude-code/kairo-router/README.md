# Kairo router

The Kairo pane shows provider quota and reset times, the routing plan, running delegations, and pending verdicts. Stale quota data is marked. Use `/kairo-pane` to toggle the pane; supported fullscreen surfaces open it automatically. Unavailable sources are shown as unavailable and do not prevent prompts or delegations.

A routed Agent call shows who runs the work on its task card: `Role · model (provider) — task`. Launches marked `[no-redirect]` keep their description as written. The spinner names who is working: the running delegation, or else the orchestrator with its session model (`Orchestrator · claude-opus-5-5 (claude) — Running Bash`), and adds `<provider> CRITICAL` while a provider's quota pacing is critical. It never shows generic stage words or random verbs.

The orchestrator delegates file writes to the owning role through the Agent tool: main-thread edit tools and recognized Bash file-write patterns are denied, while delegated writes and Bash redirection to temporary scratch paths or /dev/null remain allowed.

When a route lands on a Claude model, the Agent call receives the matching Agent-tool alias (`sonnet`, `opus`, `haiku` or `fable`) because the tool rejects full model ids. An alias cannot pin an exact version (`claude-haiku-4-5-20251001` runs as `haiku`); the ledger and pane still show the real routed id. A routed id with no alias leaves the agent's own model and shows one toast.

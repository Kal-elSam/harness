/**
 * SIMULATED connections backend — test support only.
 * Mirrors the Settings consumer shape for unit/PTY doubles.
 * Never touches real provider CLIs, network, or ~/.harness.
 * Production Settings uses createProviderConnections + host-bridged interactive login.
 */

const DEFAULT_NOW = () => Date.now();

/**
 * @param {{
 *   scenario?: "success"|"cancel"|"fail"|"timeout"|"cli_absent",
 *   providers?: object,
 *   now?: () => number,
 *   connectDelayMs?: number
 * }} [options]
 */
export function createSimulatedConnectionsBackend(options = {}) {
  const now = options.now ?? DEFAULT_NOW;
  const scenario = options.scenario ?? "success";
  const connectDelayMs = Number(options.connectDelayMs) || 0;
  /** @type {Map<string, { fingerprint: string, expiresAt: number, provider: string, surfaces: object }>} */
  const previews = new Map();
  let connectCalls = 0;
  let statusCalls = 0;

  const providerState = {
    codex: {
      installation: { state: "present", version: "sim" },
      authentication: { state: "absent" },
      modelAccess: [
        { modelId: "codex-5", label: "Codex 5", state: "catalogued" }
      ],
      quota: { state: "unknown" }
    },
    claude: {
      installation: { state: "present", version: "sim" },
      authentication: { state: "absent" },
      modelAccess: [
        { modelId: "claude-opus-5", label: "Opus 5", state: "catalogued" },
        { modelId: "claude-haiku", label: "Haiku", state: "unverified" }
      ],
      quota: { state: "unknown" }
    },
    cursor: {
      installation: { state: "absent" },
      authentication: { state: "absent" },
      modelAccess: [],
      quota: { state: "unknown" }
    },
    "opencode-go": {
      installation: { state: "present", version: "sim" },
      authentication: { state: "authenticated", accountFingerprint: "sim-go" },
      modelAccess: [
        { modelId: "kimi", label: "Kimi", state: "allowed", reusable: true },
        { modelId: "qwen", label: "Qwen", state: "unverified" }
      ],
      quota: { state: "ok" }
    },
    ...(options.providers ?? {})
  };

  return {
    get connectCalls() {
      return connectCalls;
    },
    get statusCalls() {
      return statusCalls;
    },
    async status({ provider } = {}) {
      statusCalls += 1;
      const ids = provider ? [provider] : Object.keys(providerState);
      return {
        ok: true,
        providers: ids.filter((id) => providerState[id]).map((id) => ({
          provider: id,
          ...providerState[id]
        }))
      };
    },
    async preview({ provider }) {
      if (scenario === "cli_absent" || providerState[provider]?.installation?.state === "absent") {
        return { ok: false, reason: "cli_absent", provider };
      }
      const fingerprint = `sim-${provider}-${now()}`;
      const surfaces = {
        credentialStore: true,
        browser: provider === "cursor" || provider === "codex",
        network: true,
        terminal: provider !== "cursor"
      };
      const expiresAt = now() + 60_000;
      previews.set(provider, { fingerprint, expiresAt, provider, surfaces });
      return {
        ok: true,
        provider,
        argv: [provider === "claude" ? "claude" : provider, provider === "claude" ? "auth" : "login"],
        surfaces,
        fingerprint,
        expiresAt,
        scope: `${provider} account · ${surfaces.terminal ? "terminal" : "browser"}`,
        summary: `Authorize ${provider} (simulated)`
      };
    },
    async connect({ provider, fingerprint, confirm, signal } = {}) {
      connectCalls += 1;
      if (confirm !== true) return { ok: false, reason: "not_confirmed", provider };
      const held = previews.get(provider);
      if (!held || held.fingerprint !== fingerprint || held.expiresAt <= now()) {
        return { ok: false, reason: "stale_preview", provider };
      }
      if (connectDelayMs > 0) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, connectDelayMs);
          if (signal) {
            const onAbort = () => {
              clearTimeout(timer);
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            };
            if (signal.aborted) {
              onAbort();
              return;
            }
            signal.addEventListener("abort", onAbort, { once: true });
          }
        }).catch((err) => {
          if (err?.name === "AbortError") {
            throw err;
          }
          throw err;
        });
      }
      if (signal?.aborted || scenario === "cancel") {
        return { ok: false, reason: "cancelled", provider };
      }
      if (scenario === "timeout") {
        return { ok: false, reason: "timeout", provider };
      }
      if (scenario === "fail") {
        return { ok: false, reason: "failed", provider, error: "simulated failure" };
      }
      if (scenario === "cli_absent") {
        return { ok: false, reason: "cli_absent", provider };
      }
      providerState[provider] = {
        ...providerState[provider],
        authentication: { state: "authenticated", accountFingerprint: `sim-${provider}` },
        modelAccess: (providerState[provider].modelAccess ?? []).map((m) => (
          // Login success does not verify every model.
          m.state === "allowed" ? m : { ...m, state: m.state === "catalogued" ? "catalogued" : "unverified" }
        )),
        quota: { state: "ok" }
      };
      return {
        ok: true,
        reason: "connected",
        provider,
        needsTerminal: held.surfaces.terminal === true
      };
    }
  };
}

// Which providers may run operational role-aptitude probes. Admission requires
// verified containment beyond "cwd points at a disposable fixture" — cwd alone
// is never isolation. PAYG / uncertain billing is rejected elsewhere (auth).

/**
 * @typedef {{
 *   admitted: boolean,
 *   containment: "sandbox"|"restricted"|"ask-readonly"|"insufficient",
 *   reason: string
 * }} OperationalProviderPolicy
 */

/** @type {Record<string, OperationalProviderPolicy>} */
export const OPERATIONAL_PROVIDER_POLICY = Object.freeze({
  codex: {
    admitted: true,
    containment: "sandbox",
    reason: "codex exec --sandbox read-only against a disposable fixture workspace"
  },
  claude: {
    admitted: true,
    containment: "restricted",
    reason: "claude -p --restricted --strict-mcp-config confines tools to cwd"
  },
  cursor: {
    admitted: true,
    containment: "ask-readonly",
    reason: "cursor-agent -p --mode ask is documented read-only (no --force/--yolo)"
  },
  "opencode-go": {
    admitted: false,
    containment: "insufficient",
    reason: "no verified probe-grade containment equivalent to sandbox/restricted/ask-readonly"
  },
  "opencode-zen": {
    admitted: false,
    containment: "insufficient",
    reason: "no verified probe-grade containment equivalent to sandbox/restricted/ask-readonly"
  }
});

/**
 * @param {string} provider
 * @param {Record<string, OperationalProviderPolicy>} [policy]
 */
export function getOperationalProviderPolicy(provider, policy = OPERATIONAL_PROVIDER_POLICY) {
  return policy[provider] ?? {
    admitted: false,
    containment: "insufficient",
    reason: `no operational aptitude policy registered for provider "${provider}"`
  };
}

/**
 * @param {Record<string, OperationalProviderPolicy>} [policy]
 * @returns {{ admitted: Array<{provider:string, reason:string}>, blocked: Array<{provider:string, reason:string}> }}
 */
export function listOperationalProviderAdmission(policy = OPERATIONAL_PROVIDER_POLICY) {
  const admitted = [];
  const blocked = [];
  for (const [provider, entry] of Object.entries(policy)) {
    const row = { provider, reason: entry.reason, containment: entry.containment };
    if (entry.admitted) admitted.push(row);
    else blocked.push(row);
  }
  return { admitted, blocked };
}

import { isExecutableAvailable } from "../../cli-probe.js";
import { buildPermissionsArgs } from "../run-permissions.js";

export { buildPermissionsArgs };

export function createExecutionAdapter({
  id,
  label,
  executable,
  capabilities,
  buildLaunch,
  parseEventLine = null,
  checkAvailability = null,
  launchable = null,
  preflight = null,
  idleTimeoutMs = null,
  detectQuotaExhaustion = null
}) {
  return {
    id,
    label,
    executable,
    // The real, adapter-declared "no output for this long means genuinely
    // hung, not just working" threshold (run-supervisor.js resets this on
    // every stdout/stderr chunk, so a real long-running task is never
    // killed just for taking a while — only real silence trips it). null
    // (the default) means this adapter is trusted not to hang; only an
    // adapter with a real, observed hanging failure mode declares one.
    idleTimeoutMs,
    capabilities: {
      structuredEvents: false,
      tokens: false,
      diff: false,
      cancel: true,
      transcript: false,
      reviewCompatible: false,
      ...capabilities
    },

    availability(context = {}) {
      if (checkAvailability) {
        return checkAvailability(context);
      }

      const available = isExecutableAvailable(executable, { env: context.env ?? process.env });
      if (!available) {
        return {
          available: false,
          compatible: false,
          launchable: false,
          reason: `${label} CLI "${executable}" is not on PATH.`
        };
      }

      if (!capabilities.structuredEvents) {
        return {
          available: true,
          compatible: false,
          launchable: launchable ?? false,
          reason: `${label} can be launched but does not emit auditable structured events in v1.`
        };
      }

      return {
        available: true,
        compatible: true,
        launchable: launchable ?? true,
        reason: null
      };
    },

    buildLaunch(options) {
      return buildLaunch(options);
    },

    async preflight(context = {}) {
      return preflight ? preflight(context) : { ok: true };
    },

    parseEventLine(line, context = {}) {
      if (!parseEventLine) return null;
      return parseEventLine(line, context);
    },

    // A real, adapter-declared reactive limit detector — most adapters
    // (Codex/Claude/OpenCode Go) already gate on their own real usage
    // readers elsewhere and have nothing to add here; only an adapter with
    // no other way to know (Cursor) declares one. Null (the default) is a
    // real no-op, never a fabricated "never exhausted" signal.
    detectQuotaExhaustion(context = {}) {
      if (!detectQuotaExhaustion) return null;
      return detectQuotaExhaustion(context);
    }
  };
}

export function parseNdjsonLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

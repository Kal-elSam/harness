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
  launchable = null
}) {
  return {
    id,
    label,
    executable,
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

    parseEventLine(line, context = {}) {
      if (!parseEventLine) return null;
      return parseEventLine(line, context);
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

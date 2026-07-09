import { CAPABILITY_STATES } from "../capability-states.js";
import {
  isExecutableAvailable,
  parseVersionFromOutput,
  probeCommand,
  resolveProbeState
} from "../cli-probe.js";

export function createAgentCapabilityAdapter({
  id,
  label,
  managedAdapter,
  executable = null,
  versionArgs = ["--version"],
  authArgs = null,
  modelsArgs = null,
  opaqueAuth = false,
  runExecutable = null
}) {
  const cliName = runExecutable ?? executable;

  return {
    id,
    label,
    managedAdapter,

    detect(context) {
      return managedAdapter.detect(context);
    },

    inspect(context, { probeImpl = defaultProbe } = {}) {
      const detected = managedAdapter.detect(context);
      const cliAvailable = executable ? isExecutableAvailable(executable) : false;

      if (!detected && !cliAvailable) {
        return buildInspection({
          id,
          label,
          state: CAPABILITY_STATES.UNKNOWN,
          detected: false,
          cliAvailable: false,
          version: null,
          authenticated: null,
          recommendation: `Install ${label} or run ${formatCliCommand("setup")} to configure managed sections.`
        });
      }

      if (opaqueAuth) {
        return buildInspection({
          id,
          label,
          state: detected || cliAvailable ? CAPABILITY_STATES.DETECTED : CAPABILITY_STATES.UNKNOWN,
          detected,
          cliAvailable,
          version: null,
          authenticated: null,
          recommendation: detected
            ? `${label} config detected. Authentication status is provider-managed.`
            : `Install ${label} to enable managed configuration.`
        });
      }

      return probeImpl({
        id,
        label,
        detected,
        cliAvailable,
        executable,
        versionArgs,
        authArgs
      });
    },

    listModels(context, { probeImpl = defaultProbeModels } = {}) {
      if (!modelsArgs || !executable) return null;
      if (!isExecutableAvailable(executable)) return null;
      return probeImpl({ executable, modelsArgs, context });
    },

    run(context, { args = [], cwd = context.workspaceRoot ?? process.cwd(), spawnImpl = probeCommand } = {}) {
      if (!cliName) {
        return {
          ok: false,
          state: CAPABILITY_STATES.ERROR,
          message: `${label} does not expose a delegatable CLI through Kairo.`
        };
      }

      if (!isExecutableAvailable(cliName)) {
        return {
          ok: false,
          state: CAPABILITY_STATES.ERROR,
          message: `${label} CLI "${cliName}" is not on PATH. Install the agent or add it to PATH.`
        };
      }

      const result = spawnImpl(cliName, args, { cwd, env: process.env });

      if (!result.ok) {
        const detail = result.stderr || result.stdout || result.error || "unknown error";
        return {
          ok: false,
          state: CAPABILITY_STATES.ERROR,
          message: `${label} CLI failed: ${detail}`
        };
      }

      return {
        ok: true,
        state: CAPABILITY_STATES.AVAILABLE,
        stdout: result.stdout,
        stderr: result.stderr
      };
    }
  };
}

function defaultProbe({ id, label, detected, cliAvailable, executable, versionArgs, authArgs }) {
  let version = null;
  let authenticated = null;
  let probeError = null;
  let authReady = false;

  if (cliAvailable && executable) {
    const versionResult = probeCommand(executable, versionArgs);
    if (versionResult.timedOut || versionResult.error) {
      probeError = versionResult.error ?? "probe timed out";
    } else if (versionResult.ok) {
      version = parseVersionFromOutput(versionResult.stdout) ?? versionResult.stdout.split("\n")[0] ?? null;
    }

    if (authArgs) {
      const authResult = probeCommand(executable, authArgs);
      if (authResult.timedOut || authResult.error) {
        probeError = probeError ?? authResult.error ?? "auth probe timed out";
      } else {
        authenticated = authResult.ok;
        authReady = authResult.ok;
      }
    } else if (version) {
      authenticated = null;
      authReady = true;
    }
  }

  const state = resolveProbeState({
    detected,
    cliAvailable,
    authReady,
    probeError,
    opaque: false
  });

  return buildInspection({
    id,
    label,
    state,
    detected,
    cliAvailable,
    version,
    authenticated,
    error: probeError,
    recommendation: buildRecommendation({ label, state, detected, cliAvailable, authenticated })
  });
}

function defaultProbeModels({ executable, modelsArgs }) {
  const result = probeCommand(executable, modelsArgs);
  if (!result.ok) return null;

  const lines = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.length > 0 ? lines : null;
}

function buildInspection(fields) {
  return {
    id: fields.id,
    label: fields.label,
    state: fields.state,
    detected: fields.detected,
    cliAvailable: fields.cliAvailable,
    version: fields.version ?? null,
    authenticated: fields.authenticated ?? null,
    models: fields.models ?? null,
    error: fields.error ?? null,
    recommendation: fields.recommendation ?? null
  };
}

function buildRecommendation({ label, state, detected, cliAvailable, authenticated }) {
  if (state === CAPABILITY_STATES.ERROR) {
    return `Re-run detection or check ${label} CLI logs for details.`;
  }

  if (state === CAPABILITY_STATES.UNKNOWN) {
    return `Install ${label} or run ${formatCliCommand("detect")} after setup.`;
  }

  if (state === CAPABILITY_STATES.AVAILABLE) {
    return `${label} is ready. Delegate tasks through its CLI.`;
  }

  if (authenticated === false) {
    return `Authenticate with ${label} (provider login) before delegating work.`;
  }

  if (detected && !cliAvailable) {
    return `${label} config detected but CLI not on PATH.`;
  }

  if (cliAvailable && !detected) {
    return `${label} CLI found. Run ${formatCliCommand("setup")} to add managed sections.`;
  }

  return `${label} detected. Run ${formatCliCommand("status")} for ecosystem health.`;
}

function formatCliCommand(command) {
  return `kairo ${command}`;
}

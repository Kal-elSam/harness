import { spawnSync } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 5000;

export function isExecutableAvailable(command, { env = process.env } = {}) {
  const result = spawnSync("which", [command], { encoding: "utf8", env });
  return result.status === 0 && result.stdout.trim().length > 0;
}

export function probeCommand(command, args = [], {
  cwd = process.cwd(),
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: timeoutMs
  });

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
    error: result.error?.message ?? null,
    timedOut: result.error?.code === "ETIMEDOUT"
  };
}

export function parseVersionFromOutput(output) {
  if (!output) return null;

  const match = output.match(/(\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?)/);
  return match?.[1] ?? null;
}

export function resolveProbeState({ detected, cliAvailable, authReady, probeError, opaque = false }) {
  if (probeError) return "error";
  if (opaque) return "unknown";
  if (!detected && !cliAvailable) return "unknown";
  if (cliAvailable && authReady) return "available";
  if (authReady) return "authenticated";
  if (detected || cliAvailable) return "detected";
  return "unknown";
}
